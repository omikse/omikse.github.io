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

import { RENDERERS, esc, stripJsonc, renderReference } from "./renderers.js?v=f100896e";
import { startOrResume, save, flushNow, listAttempts, userReady, onSaveState } from "./progress.js?v=f100896e";
import { gradeQuestion, gradeEssay, GradingError } from "./grading.js?v=f100896e";
import { isAdmin, loadCatalog, isPublished, mountAdminPanel } from "./admin.js?v=f100896e";

let exam = null;      // the loaded exam: { id, name, questions[] }
let examIndex = [];   // exams/index.json — everything the pipeline produced
let catalog = {};     // catalog/{examId} — what students are allowed to see

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

/* Polish plurals take three forms: 1 zadanie, 2-4 zadania, 5+ zadań — and the
   teens are the exception that takes the last form (12 zadań, not 12 zadania).
   The rozszerzony sheets hold a single question, so this is not hypothetical. */
function plural(n, one, few, many) {
  const num = Number(n) || 0;
  if (num === 1) return one;
  const lastTwo = num % 100;
  const last = num % 10;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few;
  return many;
}

function renderMenu(showHidden = false) {
  const grid = document.getElementById("exam-grid");
  grid.innerHTML = "";

  if (!examIndex.length) {
    grid.innerHTML = `<p class="text-slate-500 text-sm col-span-full">
      Brak arkuszy. Uruchom <code>python sync.py</code>.</p>`;
    return;
  }

  // Students see only published exams. An admin sees the hidden ones too, so
  // they can check a sheet before releasing it — dimmed, so the difference
  // between what they see and what a student sees is never a guess.
  const visible = examIndex.filter(e => showHidden || isPublished(catalog, e.id));

  if (!visible.length) {
    grid.innerHTML = `<p class="text-slate-500 text-sm col-span-full">
      Brak opublikowanych arkuszy.</p>`;
    return;
  }

  visible.forEach(entry => {
    const { level, when } = describeExam(entry.id);
    const extended = level.includes("rozszerzony");
    const colour = extended ? "purple" : "indigo";

    const hidden = !isPublished(catalog, entry.id);
    const card = document.createElement("div");
    card.className = "group bg-white rounded-2xl shadow-sm border border-slate-200 p-6 cursor-pointer "
      + "hover:shadow-xl hover:-translate-y-1 transition-all relative overflow-hidden flex flex-col h-full"
      + (hidden ? " opacity-50 ring-1 ring-dashed ring-slate-300" : "");
    card.innerHTML = `
      <div class="absolute -right-6 -top-6 w-24 h-24 bg-${colour}-50 rounded-full group-hover:bg-${colour}-100 transition-colors"></div>
      <div class="relative z-10 flex flex-col h-full">
        <div class="flex items-center justify-between mb-4">
          <!-- The badge carries the level, not "Oficjalny": every paper here is
               official, but each year ships both a podstawowy and a rozszerzony
               sheet, so without this the six cards read as three duplicates. -->
          <span class="bg-${colour}-600 text-white text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wide">${extended ? "Rozszerzona" : "Podstawowa"}</span>
          <span class="material-symbols-outlined text-${colour}-300 text-3xl">history_edu</span>
        </div>
        <h3 class="text-lg font-bold text-slate-800 mb-1">Matura ${esc(when)}</h3>
        <p class="text-xs text-slate-500 mb-4">${esc(level)}</p>
        <ul class="text-xs text-slate-500 space-y-1 mb-4 flex-grow">
          <li class="flex items-center gap-2"><span class="material-symbols-outlined text-sm">list</span> ${esc(entry.questions)} ${plural(entry.questions, "zadanie", "zadania", "zadań")}</li>
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
  flushNow();                     // leaving the sheet must not drop pending work
  document.getElementById("view-menu").classList.remove("hidden");
  document.getElementById("view-exam").classList.add("hidden");
  document.getElementById("back-btn").classList.add("hidden");
  document.getElementById("logo-container").classList.remove("hidden");
  renderHistory();
}

/* ------------------------------------------------------------------ *
 * History, under the exam cards
 * ------------------------------------------------------------------ */

function historyBox() {
  let box = document.getElementById("attempt-history");
  if (!box) {
    box = document.createElement("div");
    box.id = "attempt-history";
    box.className = "mt-12";
    document.getElementById("view-menu").appendChild(box);
  }
  return box;
}

function formatWhen(ts) {
  const d = ts?.toDate?.() ?? (typeof ts === "number" ? new Date(ts) : null);
  return d ? new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(d) : "—";
}

async function renderHistory() {
  const box = historyBox();
  const attempts = await listAttempts();

  if (!attempts.length) {
    box.innerHTML = "";
    return;
  }

  box.innerHTML = `
    <h3 class="text-lg font-bold text-slate-800 mb-4">Twoje podejścia</h3>
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100">
      ${attempts.map(a => {
        const { level, when } = describeExam(a.examId);
        const t = a.totals || {};
        const answered = Object.keys(a.answers || {}).length;
        return `
          <div class="flex items-center gap-4 px-6 py-4">
            <div class="flex-grow min-w-0">
              <div class="font-semibold text-slate-800 text-sm">Matura ${esc(when)}</div>
              <div class="text-xs text-slate-500">${esc(level)} · ${esc(formatWhen(a.updatedAt))}</div>
            </div>
            <div class="text-xs text-slate-500 text-right flex-none">
              <div>${esc(answered)} ${plural(answered, "odpowiedź", "odpowiedzi", "odpowiedzi")}</div>
              <div class="font-semibold text-slate-700">${esc(t.points ?? 0)}/${esc(t.maxPoints ?? 0)} pkt</div>
            </div>
          </div>`;
      }).join("")}
    </div>
    <p class="text-xs text-slate-400 mt-3">
      Punktacja obejmuje tylko zadania już sprawdzone. Otwórz arkusz, aby wrócić do swoich odpowiedzi.
    </p>`;
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

let statusText = "";

function setStatus(text) {
  statusText = text || "";
  paintStatus();
}

/* The save indicator sits beside the question count. A student needs to know
   their work is safe before closing the tab, and "it looked fine" is not
   evidence — an autosave that fails silently already cost us once. */
let saveBadge = "";

function paintStatus() {
  const el = document.getElementById("exam-status");
  if (!el) return;
  el.innerHTML = esc(statusText) + (saveBadge ? ` <span class="ml-2">${saveBadge}</span>` : "");
}

onSaveState((state, detail) => {
  const time = detail instanceof Date
    ? new Intl.DateTimeFormat("pl-PL", { timeStyle: "short" }).format(detail)
    : "";
  saveBadge = {
    dirty:  `<span class="text-slate-400">niezapisane zmiany…</span>`,
    saving: `<span class="text-slate-400">zapisywanie…</span>`,
    saved:  `<span class="text-green-600 font-medium">zapisano ${esc(time)}</span>`,
    error:  `<span class="text-red-600 font-medium">NIE ZAPISANO (${esc(detail || "")})</span>`,
  }[state] || "";
  paintStatus();
});

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

    // Put any saved work back on the questions BEFORE rendering: every
    // renderer reads q.user_answer when it draws, so restoring is just an
    // assignment — no per-type restore logic anywhere.
    const { answers, grades, essay } = await startOrResume(entry.id, name);
    let restored = 0;
    for (const q of questions) {
      const qid = String(q.id || q.number);
      if (answers[qid] !== undefined) { q.user_answer = answers[qid]; restored++; }
      if (grades[qid] !== undefined) q.grade_result = grades[qid];
      if (essay?.ai_grading_history && q.type === "P-ESSAY") {
        q.essay_grading = essay.ai_grading_history;
      }
    }

    renderExam(exam);
    if (restored) setStatus(`${questions.length} ${plural(questions.length, "zadanie", "zadania", "zadań")} · przywrócono ${restored} ${plural(restored, "zapisaną odpowiedź", "zapisane odpowiedzi", "zapisanych odpowiedzi")}.`);
  } catch (err) {
    console.error(err);
    setStatus(`Nie udało się wczytać arkusza: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

/* Has the student actually put anything in? Only strings count: the essay
   carries word_count 0 and a boolean flag even when untouched, and every
   question ships an empty user_answer skeleton in the source JSON. Without
   this every attempt looked like all 18 questions were answered. */
function isAnswered(value) {
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some(isAnswered);
  if (value && typeof value === "object") {
    // P-TEXT and P-TABLE-TEXT wrap each blank as
    // { "input-field-id": "input-field-id-1", "input-field-prefix": "", answer: "" }
    // — the id is a non-empty string, so counting every value marks an
    // untouched question as answered. Where there is an `answer` key, it is
    // the only thing that means anything.
    if ("answer" in value) return isAnswered(value.answer);
    // Everything else keys answers directly: { "tf-1": "P" },
    // { selected_option_id: "A" }, { content: "…" }. Numbers and booleans
    // (word_count, has_specific_learning_difficulties) never count.
    return Object.values(value).some(isAnswered);
  }
  return false;
}

/* Snapshot the whole exam into the flat maps the attempt document stores. */
function snapshot() {
  const answers = {};
  const grades = {};
  let essay = null;
  let points = 0, maxPoints = 0, graded = 0;

  for (const q of exam?.questions || []) {
    const qid = String(q.id || q.number);
    if (isAnswered(q.user_answer)) answers[qid] = q.user_answer;
    maxPoints += Number(q.scoring?.max_points ?? 0);
    if (q.grade_result) {
      grades[qid] = q.grade_result;
      points += Number(q.grade_result.points ?? 0);
      graded++;
    }
    if (q.essay_grading) essay = { ai_grading_history: q.essay_grading };
  }

  const total = (exam?.questions || []).length;
  const payload = { answers, grades, totals: { points, maxPoints, graded, pending: total - graded } };
  if (essay) payload.essay = essay;
  return payload;
}

/* Collect the DOM into the question objects, then queue a save. */
function persist() {
  if (!exam) return;
  collectAll();
  save(snapshot());
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

/* Small inline notice inside a question card. */
function note(text, bad = false) {
  return `<div class="q-result-box${bad ? " result-error" : ""}">${esc(text)}</div>`;
}

/* Raw per-criterion values from the essay grading run.
 *
 * TEMPORARY. The real display is renderEssayScorecard() in renderers.js, which
 * needs q.evaluation — the examiner's table produced by the deterministic
 * aggregator (matrix, thresholds, gating rules). That aggregator is roadmap
 * item #2 and does not exist, so there is no official score to show and this
 * says so rather than inventing one. When the aggregator lands, delete this and
 * call the scorecard. */
function renderEssayDiagnostics(history = {}) {
  const raw = history.ai_raw_results || {};
  const failed = history.failed_criteria || [];
  const names = {
    "1": "Spełnienie formalnych warunków polecenia",
    "2": "Kompetencje literackie i kulturowe",
    "3a": "Struktura wypowiedzi", "3b": "Spójność wypowiedzi", "3c": "Styl wypowiedzi",
    "4a": "Zakres i poprawność środków językowych",
    "4b": "Poprawność ortograficzna", "4c": "Poprawność interpunkcyjna",
  };

  const rows = Object.keys(names).map(id => {
    const v = raw[id];
    const body = v
      ? esc(Object.entries(v)
          .filter(([, x]) => typeof x !== "object")
          .map(([k, x]) => `${k}: ${x}`).join(", ")) || "—"
      : `<em>${failed.includes(id) ? "nie udało się ocenić" : "brak"}</em>`;
    return `<tr><td><strong>${esc(id)}</strong></td><td>${esc(names[id])}</td><td>${body}</td></tr>`;
  }).join("");

  return `
    <div class="q-result-box result-ai">
      <div class="result-points">Ocena diagnostyczna — <strong>nie jest to wynik oficjalny</strong></div>
      <div class="result-expl">
        Model ocenił każde kryterium osobno. Przeliczenie tych wartości na punkty
        według tabeli egzaminatora (matryca, progi, reguły zerowania) nie jest
        jeszcze zaimplementowane, więc suma punktów nie jest tu pokazywana.
      </div>
      <table class="essay-raw"><tbody>${rows}</tbody></table>
    </div>`;
}

function renderCard(question) {
  const renderer = RENDERERS[question.type];
  const card = document.createElement("section");
  card.className = "q-card";
  card.dataset.questionId = question.id || question.number || "";

  const points = question.scoring?.max_points ?? "";
  const answerHtml = renderer
    ? renderer.render(question)
    : `<div class="q-unsupported">Nieobsługiwany typ: ${esc(question.type)}</div>`;

  // Three kinds of question: graded by comparison, graded by one AI call, or
  // the wypracowanie, which takes eight. The renderer says which.
  const deterministic = !!renderer?.grade;
  const isEssay = question.type === "P-ESSAY";
  const aiGraded = !deterministic && !!renderer?.buildPrompt;

  const buttonLabel = deterministic ? "Sprawdź"
    : isEssay ? "Oceń wypracowanie (8 zapytań AI)"
    : "Sprawdź (AI)";

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
      ${(deterministic || aiGraded) ? `<button type="button" data-action="grade">${esc(buttonLabel)}</button>` : ""}
    </footer>`;

  if (renderer?.mount) renderer.mount(question, card);

  // A grade restored from a previous session should be on screen straight
  // away, not only after the student clicks Sprawdź again.
  if (question.grade_result && renderer?.renderResult) {
    card.querySelector(".q-result").innerHTML = renderer.renderResult(question);
  }

  const gradeBtn = card.querySelector('[data-action="grade"]');
  const resultBox = card.querySelector(".q-result");

  if (gradeBtn && deterministic) {
    // P-TF and P-CHOICE compare against scoring.correct_answers — exact,
    // instant, free, and never a model (CLAUDE.md rule 3).
    gradeBtn.addEventListener("click", () => {
      renderer.collect(question, card);
      question.grade_result = { ...renderer.grade(question), source: "auto" };
      resultBox.innerHTML = renderer.renderResult ? renderer.renderResult(question) : "";
      persist();
    });
  }

  if (gradeBtn && aiGraded) {
    gradeBtn.addEventListener("click", async () => {
      renderer.collect(question, card);

      if (!isAnswered(question.user_answer)) {
        resultBox.innerHTML = note("Najpierw odpowiedz na zadanie.");
        return;
      }

      gradeBtn.disabled = true;
      const label = gradeBtn.textContent;
      try {
        if (isEssay) {
          // Eight calls spaced for the 5/min limit, so show movement.
          resultBox.innerHTML = note("Ocenianie: 0/8 kryteriów…");
          question.essay_grading = await gradeEssay(question, apiKey, (done, total) => {
            gradeBtn.textContent = `Ocenianie… ${done}/${total}`;
            resultBox.innerHTML = note(`Ocenianie: ${done}/${total} kryteriów…`);
          });
          resultBox.innerHTML = renderEssayDiagnostics(question.essay_grading);
        } else {
          resultBox.innerHTML = note("Ocenianie przez AI…");
          question.grade_result = await gradeQuestion(question, apiKey);
          resultBox.innerHTML = renderer.renderResult ? renderer.renderResult(question) : "";
          if (!question.grade_result.parsed_ok) {
            resultBox.innerHTML += note("Nie udało się odczytać oceny z odpowiedzi modelu — "
              + "surowa odpowiedź została zapisana.");
          }
        }
        persist();     // the response is paid for; store it before anything else
      } catch (err) {
        // A failed call still cost quota, so say what happened rather than
        // silently doing nothing.
        resultBox.innerHTML = note(err instanceof GradingError ? err.message : String(err), true);
      } finally {
        gradeBtn.disabled = false;
        gradeBtn.textContent = label;
      }
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

  setStatus(`${questions.length} ${plural(questions.length, "zadanie", "zadania", "zadań")}.`);

  // One delegated listener for the whole sheet rather than one per field:
  // renderers own their markup, and this stays correct whatever they emit.
  // `input` covers typing and `change` covers radios and selects.
  host.addEventListener("input", persist);
  host.addEventListener("change", persist);
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

  // The catalogue and the admin role both need a signed-in user, which arrives
  // after the first auth callback — later than this function runs.
  userReady.then(async user => {
    if (!user) return;
    renderHistory();
    catalog = await loadCatalog();
    const admin = await isAdmin();
    renderMenu(admin);
    await mountAdminPanel(examIndex, catalog, describeExam, () => renderMenu(true));
  });
}

init();
