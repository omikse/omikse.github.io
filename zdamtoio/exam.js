/*
 * exam.js — the shell around the question renderer.
 *
 * Owns everything type-independent: the exam menu, loading a converted exam
 * over HTTP, building the card chrome, and the Gemini API key. It knows nothing
 * about individual question types — that all lives behind the RENDERERS
 * registry in renderers.js, which is generated (see sync.py). Keep it that way.
 *
 * Closely modelled on tools/pdf-json/app.js, which is the debug harness for the
 * same renderer; loadExam and resolveAssets are lifted from it deliberately.
 */

import { RENDERERS, esc, stripJsonc, renderReference } from "./renderers.js";

let exam = null;      // the loaded exam: { id, name, questions[] }
let examIndex = [];   // exams/index.json

/* ------------------------------------------------------------------ *
 * Gemini API key (per student, in localStorage)
 * ------------------------------------------------------------------ */

export const MODEL_NAME = "gemini-2.5-flash";   // pinned; see CLAUDE.md rule 4
let apiKey = "";

function updateStatusUI(connected) {
  const dot = document.getElementById("status-indicator");
  const text = document.getElementById("status-text");
  dot.className = connected ? "w-2 h-2 rounded-full bg-green-500" : "w-2 h-2 rounded-full bg-slate-400";
  text.className = connected ? "font-medium text-indigo-600" : "font-medium text-slate-500";
}

function saveConfig() {
  const key = document.getElementById("api-key-input").value.trim();
  const msg = document.getElementById("connection-msg");
  if (!key) {
    msg.textContent = "Podaj klucz.";
    return;
  }
  apiKey = key;
  localStorage.setItem("gemini_api_key", apiKey);
  updateStatusUI(true);
  msg.textContent = "";
  document.getElementById("config-modal").close();
}

/* ------------------------------------------------------------------ *
 * Menu
 * ------------------------------------------------------------------ */

/* MPOP-P0-100-2305 -> { level: "poziom podstawowy", when: "Maj 2023" }.
   Segments are subject-formula-variant-session; the session is YYMM and CKE
   only runs the May sitting for these papers. */
function describeExam(id) {
  const bits = String(id).split("-");
  const formula = bits[1] || "";
  const session = bits[3] || "";
  const year = session.length === 4 ? "20" + session.slice(0, 2) : "";
  const month = session.slice(2) === "05" ? "Maj" : session.slice(2) || "";
  const level = formula.startsWith("R") ? "poziom rozszerzony" : "poziom podstawowy";
  return { level, when: [month, year].filter(Boolean).join(" ") };
}

function renderMenu() {
  const grid = document.getElementById("exam-grid");
  grid.innerHTML = "";

  if (!examIndex.length) {
    grid.innerHTML = `<p class="text-slate-500 text-sm col-span-full">
      Brak arkuszy. Uruchom <code>python sync.py</code>.</p>`;
    return;
  }

  examIndex.forEach(entry => {
    const { level, when } = describeExam(entry.id);
    const extended = level.includes("rozszerzony");
    const colour = extended ? "purple" : "indigo";

    const card = document.createElement("div");
    card.className = "group bg-white rounded-2xl shadow-sm border border-slate-200 p-6 cursor-pointer "
      + "hover:shadow-xl hover:-translate-y-1 transition-all relative overflow-hidden flex flex-col h-full";
    card.innerHTML = `
      <div class="absolute -right-6 -top-6 w-24 h-24 bg-${colour}-50 rounded-full group-hover:bg-${colour}-100 transition-colors"></div>
      <div class="relative z-10 flex flex-col h-full">
        <div class="flex items-center justify-between mb-4">
          <span class="bg-${colour}-600 text-white text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wide">Oficjalny</span>
          <span class="material-symbols-outlined text-${colour}-300 text-3xl">history_edu</span>
        </div>
        <h3 class="text-lg font-bold text-slate-800 mb-1">Matura ${esc(when)}</h3>
        <p class="text-xs text-slate-500 mb-4">${esc(level)}</p>
        <ul class="text-xs text-slate-500 space-y-1 mb-4 flex-grow">
          <li class="flex items-center gap-2"><span class="material-symbols-outlined text-sm">list</span> ${esc(entry.questions)} zadań</li>
          <li class="flex items-center gap-2"><span class="material-symbols-outlined text-sm">grade</span> ${esc(entry.max_points)} pkt</li>
        </ul>
        <span class="text-${colour}-600 font-semibold text-xs flex items-center gap-1 mt-auto">
          Rozwiąż <span class="material-symbols-outlined text-sm">arrow_forward</span>
        </span>
      </div>`;
    card.addEventListener("click", () => loadExam(entry.id));
    grid.appendChild(card);
  });
}

function showMenu() {
  document.getElementById("view-menu").classList.remove("hidden");
  document.getElementById("view-exam").classList.add("hidden");
  document.getElementById("back-btn").classList.add("hidden");
  document.getElementById("logo-container").classList.remove("hidden");
}

function showExam() {
  document.getElementById("view-menu").classList.add("hidden");
  document.getElementById("view-exam").classList.remove("hidden");
  document.getElementById("back-btn").classList.remove("hidden");
  document.getElementById("logo-container").classList.add("hidden");
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

/* Each booklet keeps its images in its own exams/<id>/assets/ directory, so a
   two-part exam has two asset roots and one global base cannot serve both.
   Resolve every reference path against the part it came from, at load time; the
   JSON on disk keeps bare, portable filenames. (pdf-json DOCUMENTATION §15.3) */
function resolveAssets(question, base) {
  for (const ref of question.reference_data || []) {
    if (ref.path && !/^([a-z]+:|\/)/i.test(ref.path)) ref.path = base + ref.path;
  }
}

function setStatus(text) {
  document.getElementById("exam-status").textContent = text || "";
}

/* Load one exam, which may be printed as several booklets. Parts arrive in the
   order the index lists them (Arkusz 1, then the wypracowanie) and their
   questions are simply concatenated — CKE numbers them as one continuous run,
   so the essay already sorts last. */
async function loadExam(examId) {
  const entry = examIndex.find(e => e.id === examId);
  if (!entry) return;

  const { level, when } = describeExam(entry.id);
  document.getElementById("exam-title-display").textContent = `Matura ${when}`;
  document.getElementById("exam-subtitle-display").textContent = `${level} · ${entry.max_points} pkt`;
  document.getElementById("exam-host").innerHTML = "";
  showExam();
  setStatus("Wczytywanie arkusza…");

  try {
    const questions = [];
    let name = "";
    for (const part of entry.parts) {
      const res = await fetch(part.path, { cache: "reload" });
      if (!res.ok) throw new Error(`${part.id}: ${res.status} ${res.statusText}`);
      const doc = JSON.parse(stripJsonc(await res.text()));
      name = name || doc.name || "";
      for (const question of doc.questions || []) {
        resolveAssets(question, part.assets);
        questions.push(question);
      }
    }
    exam = { id: entry.id, name, questions };
    renderExam(exam);
  } catch (err) {
    console.error(err);
    setStatus(`Nie udało się wczytać arkusza: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function renderCard(question) {
  const renderer = RENDERERS[question.type];
  const card = document.createElement("section");
  card.className = "q-card";
  card.dataset.questionId = question.id || question.number || "";

  const points = question.scoring?.max_points ?? "";
  const answerHtml = renderer
    ? renderer.render(question)
    : `<div class="q-unsupported">Nieobsługiwany typ: ${esc(question.type)}</div>`;

  card.innerHTML = `
    <header class="q-header">
      <span class="q-number">Zadanie ${esc(question.number)}</span>
      <span class="q-points">${esc(points)} pkt</span>
    </header>
    ${renderReference(question.reference_data)}
    <p class="q-prompt">${esc(question.question || "")}</p>
    <div class="q-answer">${answerHtml}</div>
    <div class="q-result"></div>
    <footer class="q-actions">
      ${renderer?.grade ? `<button type="button" data-action="grade">Sprawdź</button>` : ""}
    </footer>`;

  if (renderer?.mount) renderer.mount(question, card);

  // Deterministic types only, for now. P-TF and P-CHOICE compare against
  // scoring.correct_answers — exact, instant, free, and never a model
  // (CLAUDE.md rule 3). AI grading for the open types is wired separately.
  const gradeBtn = card.querySelector('[data-action="grade"]');
  if (gradeBtn) {
    gradeBtn.addEventListener("click", () => {
      renderer.collect(question, card);
      question.grade_result = renderer.grade(question);
      card.querySelector(".q-result").innerHTML =
        renderer.renderResult ? renderer.renderResult(question) : "";
    });
  }

  return card;
}

function renderExam(loadedExam) {
  const host = document.getElementById("exam-host");
  host.innerHTML = "";

  const questions = loadedExam.questions || [];
  questions.forEach(question => {
    try {
      host.appendChild(renderCard(question));
    } catch (err) {
      const box = document.createElement("pre");
      box.className = "q-unsupported";
      box.textContent = `Błąd renderowania zadania ${question.number}: ${err.message}`;
      host.appendChild(box);
      console.error("Render error", question, err);
    }
  });

  setStatus(`${questions.length} zadań.`);
}

/* Read every answer back out of the DOM and into the question objects. */
export function collectAll() {
  document.querySelectorAll(".q-card").forEach(card => {
    const id = card.dataset.questionId;
    const q = (exam?.questions || []).find(item => String(item.id || item.number) === String(id));
    const renderer = q && RENDERERS[q.type];
    if (renderer) renderer.collect(q, card);
  });
  return exam;
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function init() {
  const stored = localStorage.getItem("gemini_api_key");
  if (stored) {
    apiKey = stored;
    document.getElementById("api-key-input").value = apiKey;
    updateStatusUI(true);
  }

  document.getElementById("back-btn").addEventListener("click", showMenu);
  document.getElementById("config-save").addEventListener("click", saveConfig);

  try {
    const res = await fetch("exams/index.json", { cache: "reload" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    examIndex = (await res.json()).exams || [];
  } catch (err) {
    console.error("Nie wczytano exams/index.json", err);
    examIndex = [];
  }
  renderMenu();
}

init();
