/*
 * exam.js — the shell around the question renderer.
 *
 * Owns everything type-independent: the exam menu, loading a converted exam
 * over HTTP, building the card chrome, and the Gemini API key. It knows nothing
 * about individual question types — that all lives behind the RENDERERS
 * registry in renderers.js, which is generated (see sync.py). Keep it that way.
 *
 * Closely modelled on tools/web-renderer/app.js, which is the debug harness for the
 * same renderer; loadExam and resolveAssets are lifted from it deliberately.
 */

import { RENDERERS, esc, stripJsonc, renderReference, aggregateEssay, scoreRange,
         gradesDeterministically }
  from "./renderers.js?v=206fb2cf";
import { startOrResume, save, flushNow, listAttempts, userReady, onSaveState,
         submitAttempt, startOver } from "./progress.js?v=206fb2cf";
import { gradeQuestion, gradeEssay, GradingError, runConcurrently }
  from "./grading.js?v=206fb2cf";
import { isAdmin, loadCatalog, isPublished, mountAdminButton, hideAdminView }
  from "./admin.js?v=206fb2cf";

let exam = null;      // the loaded exam: { id, name, questions[] }
let examIndex = [];   // exams/index.json — everything the pipeline produced
let catalog = {};     // catalog/{examId} — what students are allowed to see
let adminMode = false; // admins get the per-question analysis button

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

/* How long CKE gives for each paper.
 *
 * Not in the exam JSON — the booklets carry only id, name and the questions —
 * so it lives here, keyed by the formula code describeExam() already reads off
 * the id. If a paper ever gets its own duration, move this into the pipeline
 * rather than special-casing an id here. */
const EXAM_MINUTES = { P0: 240, R0: 210 };

function examMinutes(id) {
  const level = String(id).split("-")[1] || "";
  return EXAM_MINUTES[level] ?? EXAM_MINUTES[level.startsWith("R") ? "R0" : "P0"];
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

/* What an exam actually contains, in words rather than a bare count.
 *
 * "1 zadanie" on a rozszerzona card reads as a broken import, but it is
 * correct: that paper really is a single wypracowanie worth 35 pkt, with no
 * test section — the arkusz's own instructions say so. Saying "wypracowanie"
 * removes the doubt without changing the data.
 *
 * The podstawowa count includes the essay (CKE numbers it straight on from
 * Arkusz 1), so quoting it whole reads as more test questions than there are.
 * `kind` comes from the manifest; the renderer harness describes exams the same
 * way, and they should not drift. */
function describeSheet(questions) {
  const essays = questions.filter(q => q.type === "P-ESSAY").length;
  return describeContents({
    questions: questions.length,
    kind: !essays ? "test" : questions.length === essays ? "essay" : "full",
  });
}

function describeContents(entry) {
  const n = Number(entry.questions) || 0;
  if (entry.kind === "essay") return "wypracowanie";
  if (entry.kind === "full") {
    const test = Math.max(0, n - 1);
    return `${test} ${plural(test, "zadanie", "zadania", "zadań")} + wypracowanie`;
  }
  return `${n} ${plural(n, "zadanie", "zadania", "zadań")}`;
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
          <li class="flex items-center gap-2"><span class="material-symbols-outlined text-sm">list</span> ${esc(describeContents(entry))}</li>
          <li class="flex items-center gap-2"><span class="material-symbols-outlined text-sm">grade</span> ${esc(entry.max_points)} pkt</li>
        </ul>
        <div class="mt-auto flex items-center justify-between gap-2">
          <span class="text-${colour}-600 font-semibold text-xs flex items-center gap-1">
            Rozwiąż <span class="material-symbols-outlined text-sm">arrow_forward</span>
          </span>
          <button type="button" data-mode="exam" title="Z zegarem, bez sprawdzania w trakcie"
            class="text-[10px] font-semibold text-slate-400 hover:text-${colour}-600 border border-slate-200
                   hover:border-${colour}-300 rounded-full px-2 py-1 transition-colors flex items-center gap-1">
            <span class="material-symbols-outlined text-xs">timer</span>${esc(examMinutes(entry.id))} min
          </button>
        </div>
      </div>`;
    // Clicking the card practises; the small button sits the paper under the
    // clock. Two targets rather than a dialog, so the default stays one click.
    card.querySelector('[data-mode="exam"]').addEventListener("click", event => {
      event.stopPropagation();
      loadExam(entry.id, "exam");
    });
    card.addEventListener("click", () => loadExam(entry.id, "practice"));
    grid.appendChild(card);
  });
}

/* Which build is this browser actually running?
 *
 * publish.py stamps every module URL with a content hash, so this module's own
 * URL already carries it — no extra machinery, and it cannot drift from the
 * truth. It is shown because GitHub Pages caches index.html for ten minutes
 * (Cache-Control: max-age=600) and offers no way to change that, so a returning
 * visitor can be running old code with no outward sign. "I don't see the new
 * feature" has already cost us an hour twice; now the answer is on screen. */
const BUILD = new URL(import.meta.url).searchParams.get("v") || "dev";

function renderBuildStamp() {
  let el = document.getElementById("build-stamp");
  if (!el) {
    el = document.createElement("p");
    el.id = "build-stamp";
    el.className = "text-center text-[10px] text-slate-300 py-6 font-mono";
    // On <body>, not inside #view-menu: history and the admin panel are
    // appended to the menu later, so a stamp added at boot would sit in the
    // middle of the page looking like the footer — which hid both of them
    // below the fold the first time this shipped.
    document.body.appendChild(el);
  }
  el.textContent = `build ${BUILD}`;
}

function showMenu() {
  flushNow();                     // leaving the sheet must not drop pending work
  hideAdminView();
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
  hideAdminView();
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

/* The score so far. snapshot() already computes exactly these numbers on every
   save and then throws them away; showing them costs nothing and saves the
   student adding up eighteen badges by hand. */
function scoreSummaryText() {
  if (!exam) return "";
  const { totals } = snapshot();
  const checked = `${totals.graded} z ${(exam.questions || []).length} sprawdzonych`;
  return `${totals.points}/${totals.maxPoints} pkt · ${checked}`;
}

function paintStatus() {
  const el = document.getElementById("exam-status");
  if (!el) return;
  const score = scoreSummaryText();
  el.innerHTML = esc(statusText)
    + (score ? ` <span class="font-semibold text-slate-700">${esc(score)}</span>` : "")
    + (saveBadge ? ` <span class="ml-2">${saveBadge}</span>` : "");
}

onSaveState((state, detail) => {
  const time = detail instanceof Date
    ? new Intl.DateTimeFormat("pl-PL", { timeStyle: "short" }).format(detail)
    : "";
  saveBadge = {
    nosession: `<span class="text-slate-400">niezalogowany — postęp nie jest zapisywany</span>`,
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
async function loadExam(examId, mode = "practice") {
  const entry = examIndex.find(e => e.id === examId);
  if (!entry) return;

  stopClock();
  document.getElementById("exam-summary")?.remove();

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
    const resumed = await startOrResume(entry.id, name,
      { mode, minutes: examMinutes(entry.id) });
    const { answers, grades, essay } = resumed;
    attempt = {
      mode: resumed.mode || "practice",
      deadline: resumed.deadline ?? null,
      status: resumed.status || "in_progress",
    };
    let restored = 0;
    for (const q of questions) {
      const qid = String(q.id || q.number);
      if (answers[qid] !== undefined) { q.user_answer = answers[qid]; restored++; }
      if (grades[qid] !== undefined) q.grade_result = grades[qid];
      if (essay?.ai_grading_history && q.type === "P-ESSAY") {
        q.essay_grading = essay.ai_grading_history;
        applyEssayEvaluation(q);      // rebuilds q.evaluation for the scorecard
      }
    }

    renderExam(exam);
    if (restored) setStatus(`${describeSheet(questions)} · przywrócono ${restored} ${plural(restored, "zapisaną odpowiedź", "zapisane odpowiedzi", "zapisanych odpowiedzi")}.`);

    // An attempt whose clock ran out while the tab was closed is already over.
    if (isExamMode() && !isFrozen() && msLeft() !== null && msLeft() <= 0) {
      await finishExam({ reason: "expired" });
    } else if (isFrozen()) {
      freezeSheet();
      renderSummary();
    } else {
      startClock();
    }
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
  paintStatus();          // the running total moves with every answer and grade
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Analiza — admin-only look inside one question
 * ------------------------------------------------------------------ */

/* The renderer's own debug harness (tools/web-renderer/app.js) has "Pokaż prompt"
 * and "Pokaż JSON" buttons on every card; porting the renderer here dropped
 * them. This puts them back for admins, because when a grade looks wrong the
 * only useful questions are "what exactly was sent" and "what exactly came
 * back", and both were previously invisible. */

let analysisDialog = null;

function buildAnalysisDialog() {
  const dlg = document.createElement("dialog");
  dlg.id = "analysis-modal";
  dlg.className = "backdrop:bg-slate-900/50 rounded-2xl p-0 w-full max-w-4xl shadow-2xl";
  dlg.innerHTML = `
    <div class="p-5 border-b border-slate-100 flex justify-between items-center">
      <div>
        <h3 class="text-lg font-bold text-slate-800">Analiza zadania</h3>
        <p id="an-sub" class="text-xs text-slate-500 font-mono"></p>
      </div>
      <button id="an-close" class="text-slate-400 hover:text-slate-600">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div class="flex gap-2 px-5 pt-4">
      <button data-pane="prompt" class="an-tab px-3 py-1.5 text-xs font-semibold rounded-lg">Prompt</button>
      <button data-pane="json"   class="an-tab px-3 py-1.5 text-xs font-semibold rounded-lg">JSON zadania</button>
      <button data-pane="raw"    class="an-tab px-3 py-1.5 text-xs font-semibold rounded-lg">Odpowiedź AI</button>
      <button id="an-copy" class="ml-auto px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Kopiuj</button>
    </div>
    <div class="p-5">
      <pre id="an-content" class="bg-slate-50 border border-slate-200 rounded-lg p-4 text-[11px] leading-relaxed overflow-auto max-h-[60vh] whitespace-pre-wrap font-mono text-slate-700"></pre>
    </div>`;
  document.body.appendChild(dlg);

  dlg.querySelector("#an-close").addEventListener("click", () => dlg.close());
  dlg.querySelector("#an-copy").addEventListener("click", async () => {
    const btn = dlg.querySelector("#an-copy");
    try {
      await navigator.clipboard.writeText(dlg.querySelector("#an-content").textContent);
      btn.textContent = "Skopiowano";
    } catch {
      btn.textContent = "Nie udało się";
    }
    setTimeout(() => { btn.textContent = "Kopiuj"; }, 1500);
  });
  return dlg;
}

function paintAnalysis(panes, active) {
  const dlg = analysisDialog;
  dlg.querySelectorAll(".an-tab").forEach(b => {
    const on = b.dataset.pane === active;
    b.className = "an-tab px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors "
      + (on ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100");
  });
  dlg.querySelector("#an-content").textContent = panes[active];
}

function openAnalysis(question) {
  if (!analysisDialog) analysisDialog = buildAnalysisDialog();
  const renderer = RENDERERS[question.type];

  // For the essay this is all eight per-criterion prompts, each with its own
  // header — exactly what the eight separate calls send.
  let prompt = "(ten typ nie ma promptu — oceniany przez porównanie)";
  try {
    if (renderer?.buildPrompt) prompt = renderer.buildPrompt(question);
  } catch (err) {
    prompt = "Błąd budowania promptu: " + err.message;
  }

  const raw = question.grade_result?.raw
    ?? (question.essay_grading?.ai_raw_responses
        ? Object.entries(question.essay_grading.ai_raw_responses)
            .map(([id, text]) => `=== KRYTERIUM ${id} ===\n${text}`).join("\n\n")
        : null);

  const panes = {
    prompt,
    json: JSON.stringify(question, null, 2),
    raw: raw || "(brak — zadanie nie było jeszcze oceniane przez AI)",
  };

  analysisDialog.querySelector("#an-sub").textContent =
    `${question.id || question.number} · ${question.type} · ${question.scoring?.max_points ?? "?"} pkt`;

  analysisDialog.querySelectorAll(".an-tab").forEach(b => {
    b.onclick = () => paintAnalysis(panes, b.dataset.pane);
  });
  paintAnalysis(panes, "prompt");
  analysisDialog.showModal();
}

/* Turn the stored raw per-criterion values into the examiner's table.
 *
 * Deliberately recomputed from ai_raw_results rather than read back from the
 * stored table: the aggregation is deterministic and free, so a correction to
 * the matrix or the gating rules fixes old attempts too, instead of leaving
 * them frozen with a score the current rules would not give.
 *
 * The computed table is also written into the history object, which is what
 * P-ESSAY_projekt_oceniania.md §22 asks to store — the same three fields that
 * were deliberately left empty until the aggregator existed. */
function applyEssayEvaluation(question) {
  const history = question.essay_grading;
  if (!history?.ai_raw_results || !Object.keys(history.ai_raw_results).length) return;

  const evaluation = aggregateEssay(question, history.ai_raw_results);
  question.evaluation = evaluation;

  history.raw_table_fill = evaluation.raw_table_fill;
  history.effective_table_fill = evaluation.effective_table_fill;
  history.totals = evaluation.totals;
  history.applied_gating_rules = evaluation.applied_gating_rules;
}

/* Small inline notice inside a question card. */
function note(text, bad = false) {
  return `<div class="q-result-box${bad ? " result-error" : ""}">${esc(text)}</div>`;
}


function renderCard(question, { alone = false } = {}) {
  const renderer = RENDERERS[question.type];
  const card = document.createElement("section");
  // Without the stack the card gives back its left gutter: nothing is sitting
  // in it, so the text should not be indented past an empty margin.
  card.className = alone ? "q-card q-card-plain" : "q-card";
  card.dataset.questionId = question.id || question.number || "";

  const points = question.scoring?.max_points ?? "";
  const answerHtml = renderer
    ? renderer.render(question)
    : `<div class="q-unsupported">Nieobsługiwany typ: ${esc(question.type)}</div>`;

  // Three kinds of question: graded by comparison, graded by one AI call, or
  // the wypracowanie, which takes eight. The renderer says which.
  // Not "does this type have grade()" — P-TABLE-MATCH has one but only claims
  // questions whose key it can settle exactly, and the rest still cost a call.
  const deterministic = gradesDeterministically(question);
  const isEssay = question.type === "P-ESSAY";
  const aiGraded = !deterministic && !!renderer?.buildPrompt;

  // The foot of the card carries a labelled button in two cases: the essay
  // always, because eight paid calls should not be spendable from an unlabelled
  // 55px box; and any question rendered without the stack, which would
  // otherwise have no way to be graded at all.
  const footLabel = isEssay ? "Oceń wypracowanie (8 zapytań AI)"
    : deterministic ? "Sprawdź"
    : "Sprawdź (AI — 1 zapytanie)";

  // Laid out like the printed arkusz: a lavender bar reading
  // "Zadanie 3. (0–2)" across the text column, and beside it the examiner's
  // stack — number, every attainable score, and the box the mark goes in.
  //
  // On paper that box is empty for the examiner to write in. Here it IS the
  // marker: it carries the button, and the score it produces lands in the same
  // place the button was.
  const maxPoints = Number(question.scoring?.max_points ?? 0);
  const range = scoreRange(maxPoints);
  const gradeable = deterministic || aiGraded;

  const stack = alone ? "" : `
      <div class="q-score-stack">
        <div class="q-score-num" aria-hidden="true">${esc(question.number)}.</div>
        <div class="q-score-range" aria-hidden="true">${esc(range)}</div>
        ${gradeable
          ? `<button type="button" class="q-score-box" data-score data-action="grade"
                     title="${esc(gradeHint(deterministic, isEssay))}"
                     aria-label="${esc(gradeHint(deterministic, isEssay))}">${gradeMark(deterministic)}</button>`
          : `<div class="q-score-box" data-score></div>`}
      </div>`;

  card.innerHTML = `
    <header class="q-header">
      <div class="q-head-bar">Zadanie ${esc(question.number)}. (0–${esc(maxPoints)})</div>${stack}
    </header>
    ${renderReference(question.reference_data)}
    <p class="q-prompt">${esc(question.question || "")}</p>
    <div class="q-answer">${answerHtml}</div>
    <div class="q-result"></div>
    <footer class="q-actions">
      ${(isEssay || alone) && gradeable
          ? `<button type="button" data-action="grade">${esc(footLabel)}</button>` : ""}
      ${adminMode ? `<button type="button" data-action="analyse">Analiza</button>` : ""}
    </footer>`;

  if (renderer?.mount) renderer.mount(question, card);

  // A grade restored from a previous session should be on screen straight
  // away, not only after the student clicks Sprawdź again. Ask the renderer
  // rather than testing for grade_result: the essay keeps its result in
  // q.evaluation instead, so checking one field silently hid the scorecard.
  // Both the margin box and the essay's footer button carry data-action="grade".
  const triggers = [...card.querySelectorAll('[data-action="grade"]')];
  const footBtn = card.querySelector('.q-actions [data-action="grade"]');
  const resultBox = card.querySelector(".q-result");

  // Every result goes through here, so the margin box can never fall out of
  // step with the text below it — one path, not four.
  const showResult = html => {
    resultBox.innerHTML = html || "";
    paintScoreBox(question, card);
  };

  if (renderer?.renderResult) {
    const restored = renderer.renderResult(question);
    if (restored) showResult(restored);
  }

  // One guard for both grade paths: an exam is not a place to check answers.
  const refuseIfLocked = () => {
    if (!gradingLocked()) return false;
    resultBox.innerHTML = note("Sprawdzanie jest wyłączone w trybie egzaminacyjnym — "
      + "zakończ arkusz, aby zobaczyć wynik.");
    return true;
  };

  // P-TF and P-CHOICE compare against scoring.correct_answers — exact, instant,
  // free, and never a model (CLAUDE.md rule 3).
  const gradeDeterministic = () => {
    if (refuseIfLocked()) return;
    renderer.collect(question, card);
    question.grade_result = { ...renderer.grade(question), source: "auto" };
    showResult(renderer.renderResult ? renderer.renderResult(question) : "");
    persist();
  };

  const gradeWithAI = async () => {
    if (refuseIfLocked()) return;
    renderer.collect(question, card);

    if (!isAnswered(question.user_answer)) {
      resultBox.innerHTML = note("Najpierw odpowiedz na zadanie.");
      return;
    }

    triggers.forEach(t => { t.disabled = true; });
    const footLabel = footBtn?.textContent;
    try {
      if (isEssay) {
        // Eight calls spaced for the 5/min limit, so show movement.
        resultBox.innerHTML = note("Ocenianie: 0/8 kryteriów…");
        paintScoreBox(question, card, "0/8");
        question.essay_grading = await gradeEssay(question, apiKey, (done, total) => {
          if (footBtn) footBtn.textContent = `Ocenianie… ${done}/${total}`;
          paintScoreBox(question, card, `${done}/${total}`);
          resultBox.innerHTML = note(`Ocenianie: ${done}/${total} kryteriów…`);
        });
        applyEssayEvaluation(question);
        showResult(renderer.renderResult(question));
      } else {
        resultBox.innerHTML = note("Ocenianie przez AI…");
        paintScoreBox(question, card, "…");
        question.grade_result = await gradeQuestion(question, apiKey);
        showResult(renderer.renderResult ? renderer.renderResult(question) : "");
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
      paintScoreBox(question, card);        // back to the mark, ready to retry
    } finally {
      triggers.forEach(t => { t.disabled = false; });
      if (footBtn && footLabel !== undefined) footBtn.textContent = footLabel;
      paintScoreBox(question, card);        // graded boxes re-disable themselves
    }
  };

  // The box and (for the essay) the labelled footer button run the same path,
  // so there is one grading routine per question however it was started.
  if (deterministic || aiGraded) {
    const run = deterministic ? gradeDeterministic : gradeWithAI;
    triggers.forEach(t => t.addEventListener("click", run));
  }

  const analyseBtn = card.querySelector('[data-action="analyse"]');
  if (analyseBtn) {
    analyseBtn.addEventListener("click", () => {
      renderer?.collect?.(question, card);   // analyse what is on screen right now
      openAnalysis(question);
    });
  }

  return card;
}

function renderExam(loadedExam) {
  const host = document.getElementById("exam-host");
  host.innerHTML = "";

  const questions = loadedExam.questions || [];
  // A one-question sheet is the rozszerzony paper: a single wypracowanie. There
  // is nothing to number it against and its footer button already says what
  // grading costs, so it goes without the margin stack entirely.
  const alone = questions.length <= 1;
  questions.forEach(question => {
    try {
      host.appendChild(renderCard(question, { alone }));
    } catch (err) {
      const box = document.createElement("pre");
      box.className = "q-unsupported";
      box.textContent = `Błąd renderowania zadania ${question.number}: ${err.message}`;
      host.appendChild(box);
      console.error("Render error", question, err);
    }
  });

  // Foot of the sheet: check everything at once, as an alternative to the
  // per-question buttons rather than a replacement for them.
  const foot = document.createElement("div");
  foot.className = "q-sheet-foot";
  foot.innerHTML = `
    ${gradingLocked() ? "" : `<button type="button" data-action="grade-all">Sprawdź cały arkusz</button>`}
    <button type="button" data-action="finish">${isExamMode() ? "Zakończ egzamin" : "Podsumowanie"}</button>
    <span class="q-sheet-foot-note">${gradingLocked()
      ? "W trybie egzaminacyjnym wynik zobaczysz po zakończeniu."
      : "Zadania zamknięte sprawdzają się bez zapytań do AI."}</span>`;
  foot.querySelector("[data-action='grade-all']")
      ?.addEventListener("click", event => gradeWholeSheet(event.currentTarget));
  foot.querySelector("[data-action='finish']").addEventListener("click", () => {
    if (isExamMode() && !confirm("Zakończyć egzamin? Odpowiedzi zostaną zamknięte i nie da się ich zmienić."))
      return;
    finishExam();
  });
  host.appendChild(foot);

  setStatus(`${describeSheet(questions)}.`);

  // One delegated listener for the whole sheet rather than one per field:
  // renderers own their markup, and this stays correct whatever they emit.
  // `input` covers typing and `change` covers radios and selects.
  host.addEventListener("input", persist);
  host.addEventListener("change", persist);
}

/* ------------------------------------------------------------------ *
 * Exam mode: the clock, freezing, and the summary
 * ------------------------------------------------------------------ */

/* attempt = how this sheet is being sat. `mode` is fixed when the attempt is
   created; `deadline` is an absolute time, so the clock keeps running while the
   tab is closed rather than politely pausing. */
let attempt = { mode: "practice", deadline: null, status: "in_progress" };
let clockTimer = null;

const isExamMode = () => attempt.mode === "exam";
const isFrozen = () => attempt.status === "submitted";

/** Grading is refused while an exam clock is running — you cannot check your
 *  answers mid-exam. Practice mode never locks. */
const gradingLocked = () => isExamMode() && !isFrozen();

function msLeft() {
  return attempt.deadline ? attempt.deadline - Date.now() : null;
}

function formatClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const pad = n => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function stopClock() {
  clearInterval(clockTimer);
  clockTimer = null;
}

function paintClock() {
  const el = document.getElementById("exam-subtitle-display");
  if (!el || !isExamMode()) return;
  const left = msLeft();
  if (left === null) return;

  if (left <= 0) {
    el.innerHTML = `<span class="text-red-600 font-semibold">Czas minął</span>`;
    return;
  }
  const warn = left < 15 * 60_000;
  el.innerHTML = `<span class="${warn ? "text-red-600" : "text-slate-700"} font-semibold">`
    + `⏱ ${formatClock(left)}</span>`;
}

function startClock() {
  stopClock();
  if (!isExamMode() || isFrozen() || attempt.deadline === null) return;
  paintClock();
  clockTimer = setInterval(() => {
    paintClock();
    if (msLeft() <= 0) {
      stopClock();
      finishExam({ reason: "expired" });
    }
  }, 1000);
}

/** Disable every input in the sheet — actually disabled, not merely dimmed. */
function freezeSheet() {
  // Answers only. Grading is NOT frozen: gradingLocked() already says a
  // submitted attempt may be marked — that is the whole point of finishing —
  // and disabling the buttons here contradicted it, leaving a student who had
  // just ended their exam clicking a dead "Sprawdź". Each grade path calls
  // refuseIfLocked() at click time, which is the single source of that rule.
  document.querySelectorAll("#exam-host input, #exam-host textarea, #exam-host select")
    .forEach(el => { el.disabled = true; });
}

/**
 * End the sheet.
 *
 * In exam mode this freezes the attempt for good. In practice mode it only
 * summarises — a student revising should be free to fix an answer and try
 * again. Expiry never triggers grading: eight or twenty-three calls is the
 * student's money and must follow a click, not a clock.
 */
async function finishExam({ reason = "manual" } = {}) {
  collectAll();
  stopClock();

  if (isExamMode()) {
    attempt.status = "submitted";
    await submitAttempt(snapshot());
    freezeSheet();
    paintClock();
  } else {
    persist();
  }

  renderSummary({ reason });
  document.getElementById("exam-summary")?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function summaryHost() {
  let box = document.getElementById("exam-summary");
  if (!box) {
    box = document.createElement("div");
    box.id = "exam-summary";
    box.className = "max-w-4xl mx-auto mb-6";
    const host = document.getElementById("exam-host");
    host.parentNode.insertBefore(box, host);
  }
  return box;
}

/* Points split the way the paper is printed: Arkusz 1 is the test, the
   wypracowanie is its own booklet worth 35 of the 60. */
function summaryParts() {
  const questions = exam?.questions || [];
  const split = { test: { got: 0, max: 0 }, essay: { got: 0, max: 0 } };
  for (const q of questions) {
    const bucket = q.type === "P-ESSAY" ? split.essay : split.test;
    bucket.max += Number(q.scoring?.max_points ?? 0);
    bucket.got += Number(q.grade_result?.points ?? (q.evaluation?.totals?.official_points ?? 0));
  }
  return split;
}

function renderSummary({ reason = "manual" } = {}) {
  const box = summaryHost();
  const { totals } = snapshot();
  const parts = summaryParts();
  const pending = pendingWork();
  const calls = pending.ai.length + (pending.essay ? 8 : 0);

  const headline = reason === "expired"
    ? `<span class="text-red-600">Czas minął — arkusz zamknięty</span>`
    : isExamMode() ? "Arkusz zakończony" : "Podsumowanie";

  box.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div class="flex items-baseline gap-3 mb-4">
        <h3 class="text-lg font-bold text-slate-800">${headline}</h3>
        ${isExamMode() ? "" : `<span class="text-xs text-slate-400">tryb nauki — nic nie jest zablokowane</span>`}
      </div>

      <div class="flex flex-wrap items-end gap-8 mb-4">
        <div>
          <div class="text-3xl font-bold text-slate-900">${esc(totals.points)}<span class="text-slate-400 text-xl">/${esc(totals.maxPoints)}</span></div>
          <div class="text-xs text-slate-500">punktów</div>
        </div>
        <!-- Only the parts this paper actually has. The rozszerzony sheet is a
             wypracowanie and nothing else, so "Arkusz 1 (test): 0/0" there is
             a row about a booklet that was never printed. -->
        <div class="text-sm text-slate-600">
          ${parts.test.max ? `<div>Arkusz 1 (test): <strong>${esc(parts.test.got)}/${esc(parts.test.max)}</strong></div>` : ""}
          ${parts.essay.max ? `<div>Wypracowanie: <strong>${esc(parts.essay.got)}/${esc(parts.essay.max)}</strong></div>` : ""}
        </div>
        <div class="text-sm text-slate-600">
          <div>Sprawdzone: <strong>${esc(totals.graded)}</strong> z ${esc((exam?.questions || []).length)}</div>
          ${pending.unanswered.length
            ? `<div class="text-amber-600">Bez odpowiedzi: ${esc(pending.unanswered.length)}</div>` : ""}
        </div>
      </div>

      ${calls ? `<p class="text-xs text-slate-500 mb-4">
         Nie wszystko jest sprawdzone — brakuje ${esc(calls)}
         ${plural(calls, "zapytania", "zapytań", "zapytań")} do AI.</p>` : ""}

      <div class="flex flex-wrap gap-2">
        ${calls ? `<button type="button" data-summary="grade"
          class="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
          Sprawdź cały arkusz</button>` : ""}
        <button type="button" data-summary="retake"
          class="px-4 py-2 text-sm font-semibold border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
          Rozwiąż ponownie</button>
      </div>
    </div>`;

  box.querySelector('[data-summary="grade"]')
     ?.addEventListener("click", e => gradeWholeSheet(e.currentTarget).then(() => renderSummary({ reason })));
  box.querySelector('[data-summary="retake"]')
     ?.addEventListener("click", retakeExam);
}

async function retakeExam() {
  if (!exam) return;
  if (!confirm("Rozpocząć ten arkusz od nowa? Obecne odpowiedzi i oceny zostaną zarchiwizowane.")) return;

  try {
    await startOver(exam.id);
  } catch (err) {
    // startOver archives a copy first and then blanks the live attempt. If the
    // rules refuse the second step the archive is already written -- nothing is
    // lost, but the exam stays frozen, and saying so beats leaving the student
    // clicking a button that appears to do nothing.
    setStatus("Nie udało się rozpocząć od nowa: " + (err.code || err.message)
      + ". Odpowiedzi są bezpieczne.");
    return;
  }

  document.getElementById("exam-summary")?.remove();
  await loadExam(exam.id, attempt.mode);
}

/* ------------------------------------------------------------------ *
 * Grading the whole sheet
 * ------------------------------------------------------------------ */

/* What the marker button says before it has marked anything.
 *
 * Two marks, because there are two mechanisms and conflating them would be a
 * lie to the student. P-TF and P-CHOICE are compared against
 * scoring.correct_answers — CKE's own key, no model involved (CLAUDE.md rule 3)
 * — so they say so. Everything else is graded by a model, which is ours, not
 * CKE's; branding that "CKE" would imply the Komisja stands behind a score it
 * has never seen.
 *
 * Change the wording here and it changes everywhere; nothing else spells it. */
const GRADE_MARK = {
  key: { top: "klucz", bottom: "CKE", tm: "" },
  ai:  { top: "punkt", bottom: "AI",  tm: "™" },
};

function gradeMark(deterministic) {
  const m = deterministic ? GRADE_MARK.key : GRADE_MARK.ai;
  return `<span class="q-mark" aria-hidden="true"
    ><span class="q-mark-top">${esc(m.top)}</span
    ><span class="q-mark-bot">${esc(m.bottom)}<sup>${esc(m.tm)}</sup></span></span>`;
}

/** The accessible name and tooltip — says which mechanism, and what it costs. */
function gradeHint(deterministic, isEssay) {
  if (deterministic) return "Sprawdź — porównanie z kluczem odpowiedzi CKE, bez AI";
  if (isEssay) return "Oceń wypracowanie — 8 zapytań do AI";
  return "Sprawdź — ocena przez AI (1 zapytanie)";
}

/**
 * Paint the margin box: the awarded points once they exist, otherwise whatever
 * state the marker is in.
 *
 * On paper this box is where the examiner writes the score. Here the button
 * that asks for the score occupies it until there is one, so the mark lands
 * exactly where the student clicked.
 */
function paintScoreBox(question, card, state = null) {
  const box = card?.querySelector("[data-score]");
  if (!box) return;

  const points = question.grade_result?.points
    ?? question.evaluation?.totals?.official_points
    ?? null;

  if (points !== null) {
    box.textContent = String(points);
    box.classList.add("q-score-box-filled");
    box.classList.remove("q-score-box-busy");
    if ("disabled" in box) box.disabled = true;   // marked; nothing left to ask
    return;
  }

  box.classList.remove("q-score-box-filled");
  if (state) {
    box.textContent = state;                       // "3/8" while the model works
    box.classList.add("q-score-box-busy");
  } else {
    box.innerHTML = box.tagName === "BUTTON"
      ? gradeMark(gradesDeterministically(question))
      : "";
    box.classList.remove("q-score-box-busy");
  }
}

/** Redraw one question's result box from whatever the renderer now reports. */
function paintResult(question) {
  const card = document.querySelector(
    `.q-card[data-question-id="${CSS.escape(String(question.id || question.number))}"]`);
  if (!card) return;
  paintScoreBox(question, card);
  const renderer = RENDERERS[question.type];
  if (!renderer?.renderResult) return;
  card.querySelector(".q-result").innerHTML = renderer.renderResult(question) || "";
}

/** What still needs doing, split by what it costs. */
function pendingWork() {
  const questions = exam?.questions || [];
  const ungraded = questions.filter(q => isAnswered(q.user_answer) && !q.grade_result);
  return {
    free: ungraded.filter(q => gradesDeterministically(q)),
    ai: ungraded.filter(q => !gradesDeterministically(q) && RENDERERS[q.type]?.buildPrompt
                             && q.type !== "P-ESSAY"),
    essay: questions.find(q => q.type === "P-ESSAY"
                               && isAnswered(q.user_answer)
                               && !q.essay_grading) || null,
    unanswered: questions.filter(q => !isAnswered(q.user_answer)),
  };
}

/**
 * Grade everything outstanding in one go.
 *
 * The closed questions are free and instant. The rest costs one API call each,
 * plus eight for the wypracowanie, so the count is stated and confirmed before
 * anything is spent — an accidental click here is real money.
 */
async function gradeWholeSheet(button) {
  collectAll();
  const work = pendingWork();
  const calls = work.ai.length + (work.essay ? 8 : 0);

  if (!work.free.length && !calls) {
    setStatus(work.unanswered.length
      ? `Brak nowych odpowiedzi do sprawdzenia (${work.unanswered.length} bez odpowiedzi).`
      : "Wszystko już sprawdzone.");
    return;
  }

  if (calls) {
    const parts = [
      `${work.ai.length} ${plural(work.ai.length, "zadanie otwarte", "zadania otwarte", "zadań otwartych")}`,
      work.essay ? "wypracowanie (8 zapytań)" : null,
    ].filter(Boolean).join(" + ");
    const ok = confirm(
      `Sprawdzenie całego arkusza wyśle ${calls} ${plural(calls, "zapytanie", "zapytania", "zapytań")} do AI.\n\n`
      + `${parts}\n\nZadania zamknięte sprawdzają się bez zapytań.\n\nKontynuować?`);
    if (!ok) return;
  }

  // Free first, so something is on screen immediately.
  for (const q of work.free) {
    q.grade_result = { ...RENDERERS[q.type].grade(q), source: "auto" };
    paintResult(q);
  }
  persist();

  if (!calls) {
    setStatus(`Sprawdzono ${work.free.length} ${plural(work.free.length, "zadanie", "zadania", "zadań")}.`);
    return;
  }

  const label = button?.textContent;
  if (button) button.disabled = true;
  let graded = 0;

  try {
    if (work.ai.length) {
      const outcome = await runConcurrently(work.ai, async q => {
        q.grade_result = await gradeQuestion(q, apiKey);
        paintResult(q);
        persist();                       // store each as it lands; it is paid for
      }, done => {
        graded = done;
        if (button) button.textContent = `Sprawdzanie… ${done}/${work.ai.length}`;
        setStatus(`Sprawdzanie zadań otwartych: ${done}/${work.ai.length}`);
      });

      if (outcome.fatal && !graded) throw outcome.fatal;
      outcome.failures.forEach(f => {
        const card = document.querySelector(
          `.q-card[data-question-id="${CSS.escape(String(f.item.id || f.item.number))}"]`);
        if (card) card.querySelector(".q-result").innerHTML = note(f.err.message, true);
      });
    }

    if (work.essay) {
      if (button) button.textContent = "Ocenianie wypracowania…";
      work.essay.essay_grading = await gradeEssay(work.essay, apiKey, (done, total) => {
        setStatus(`Ocenianie wypracowania: ${done}/${total} kryteriów`);
      });
      applyEssayEvaluation(work.essay);
      paintResult(work.essay);
    }

    persist();
    setStatus("Sprawdzono cały arkusz.");
  } catch (err) {
    setStatus(err instanceof GradingError ? err.message : String(err));
  } finally {
    if (button) { button.disabled = false; button.textContent = label; }
  }
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
  renderBuildStamp();
  console.info(`zdamtoio build ${BUILD}`);

  // The catalogue and the admin role both need a signed-in user, which arrives
  // after the first auth callback — later than this function runs.
  userReady.then(async user => {
    if (!user) return;
    renderHistory();
    catalog = await loadCatalog();
    const admin = await isAdmin();
    adminMode = admin;
    renderMenu(admin);
    await mountAdminButton({
      examIndex, catalog, describeExam,
      onCatalogChange: () => renderMenu(true),
    });
  });
}

init();
