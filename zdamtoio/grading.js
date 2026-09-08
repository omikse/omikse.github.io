/*
 * grading.js — the AI grading boundary.
 *
 * The prompts are NOT written here. Every one comes from renderers.js
 * (`buildPrompt` per type, `buildEssayCriterionPrompt` per essay criterion), so
 * question-type knowledge stays in one place. This module only calls the model,
 * parses what comes back, and hands it up.
 *
 * Two rules shape everything below:
 *
 *   - Closed types are never sent to a model. P-TF and P-CHOICE have one
 *     correct answer and are graded by comparison in renderers.js.
 *   - Every response is kept, verbatim. A model call costs money and quota, so
 *     the raw text is stored even when parsing it fails -- the same reason
 *     pdf-json keeps each booklet's `work` directory out of .gitignore.
 */

import { RENDERERS, ESSAY_CRITERIA, buildEssayCriterionPrompt } from "./renderers.js";

export const MODEL_NAME = "gemini-2.5-flash";   // pinned; newer models are worse here

// Free tier is 5 requests/minute. Spacing the essay's eight calls this far
// apart keeps a full grading run inside the limit instead of half-failing.
const MIN_GAP_MS = 13000;

const ENDPOINT = model =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/* ------------------------------------------------------------------ *
 * The call
 * ------------------------------------------------------------------ */

export class GradingError extends Error {
  constructor(message, { quota = false, raw = "" } = {}) {
    super(message);
    this.quota = quota;
    this.raw = raw;
  }
}

/** One model call. Returns the raw text; never parses. */
export async function callGemini(prompt, apiKey) {
  if (!apiKey) throw new GradingError("Brak klucza API — otwórz Ustawienia.");

  let res;
  try {
    res = await fetch(`${ENDPOINT(MODEL_NAME)}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
  } catch (err) {
    throw new GradingError("Brak połączenia z API: " + err.message);
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.error?.message || `${res.status} ${res.statusText}`;
    // 429 is the daily/minute quota. Say so plainly -- "20 per day" is the
    // single most surprising thing about this free tier.
    throw new GradingError(
      res.status === 429
        ? "Wyczerpany limit API (darmowy plan: 20 zapytań dziennie, 5 na minutę). Spróbuj później."
        : "Błąd API: " + msg,
      { quota: res.status === 429 },
    );
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    // A blocked or empty candidate still consumed quota, so surface the body.
    throw new GradingError("Model nie zwrócił treści (możliwa blokada odpowiedzi).",
                           { raw: JSON.stringify(data) });
  }
  return text;
}

/** Pull a JSON object out of a model reply, tolerating ```json fences and prose. */
export function parseJsonReply(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    // Fall back to the outermost {...}: models like to add a sentence first.
    const braced = candidate.match(/\{[\s\S]*\}/);
    if (braced) {
      try { return JSON.parse(braced[0]); } catch { /* give up below */ }
    }
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Open questions — one call, one grade
 * ------------------------------------------------------------------ */

/**
 * Grade one AI-graded question (P-TEXT, P-TABLE-TEXT, P-TABLE-MATCH).
 * Returns the object to store under grades[questionId].
 */
export async function gradeQuestion(question, apiKey) {
  const renderer = RENDERERS[question.type];
  if (!renderer?.buildPrompt) throw new GradingError("Ten typ nie ma promptu.");

  const raw = await callGemini(renderer.buildPrompt(question), apiKey);
  const parsed = parseJsonReply(raw);
  const max = Number(question.scoring?.max_points ?? 0);

  // Clamp: a model that returns 7/2 is wrong, and storing it would corrupt the
  // running total. The raw text keeps the evidence of what it actually said.
  const points = parsed && Number.isFinite(Number(parsed.points))
    ? Math.max(0, Math.min(max, Number(parsed.points)))
    : null;

  return {
    points,
    max_points: max,
    explanation: parsed?.explanation ?? "",
    parsed_ok: parsed !== null && points !== null,
    raw,                                   // paid for; always kept
    answer_snapshot: question.user_answer, // what was actually graded
    source: "ai",
    model: MODEL_NAME,
    gradedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Essay — eight calls, raw values only
 * ------------------------------------------------------------------ */

/**
 * Grade the wypracowanie: one focused call per criterion, per
 * P-ESSAY_projekt_oceniania.md. Returns the ai_grading_history object.
 *
 * Deliberately does NOT compute a score. The deterministic aggregator that maps
 * these raw values onto the examiner's table (matrix, thresholds, gating rules)
 * is not built, and asking a model for the total instead is exactly the mistake
 * the grading design forbids. raw_table_fill / effective_table_fill / totals
 * stay empty until that aggregator exists.
 *
 * `onProgress(done, total, criterionId)` is called around each call so the UI
 * can show movement -- eight spaced calls take over a minute.
 */
export async function gradeEssay(question, apiKey, onProgress = () => {}) {
  const results = {};
  const responses = {};
  const failures = [];

  for (let i = 0; i < ESSAY_CRITERIA.length; i++) {
    const { id } = ESSAY_CRITERIA[i];
    onProgress(i, ESSAY_CRITERIA.length, id);

    if (i > 0) await new Promise(r => setTimeout(r, MIN_GAP_MS));   // 5/min limit

    try {
      const raw = await callGemini(buildEssayCriterionPrompt(question, id), apiKey);
      responses[id] = raw;                       // kept even if unparseable
      const parsed = parseJsonReply(raw);
      if (parsed) results[id] = parsed;
      else failures.push(id);
    } catch (err) {
      failures.push(id);
      if (err.raw) responses[id] = err.raw;
      // Quota is terminal: the remaining calls would all fail too, and each
      // attempt still counts. Stop and keep what was already paid for.
      if (err.quota) {
        onProgress(i, ESSAY_CRITERIA.length, id);
        break;
      }
    }
  }

  onProgress(ESSAY_CRITERIA.length, ESSAY_CRITERIA.length, null);

  return {
    ai_raw_results: results,        // parsed per-criterion values (§22)
    ai_raw_responses: responses,    // verbatim model output, kept because paid for
    failed_criteria: failures,
    raw_table_fill: {},             // ← unbuilt: needs the aggregator
    effective_table_fill: {},       // ←
    totals: {},                     // ←
    applied_gating_rules: [],       // ←
    answer_snapshot: question.user_answer,
    model: MODEL_NAME,
    created_at: new Date().toISOString(),
  };
}
