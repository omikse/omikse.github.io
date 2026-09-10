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

import { RENDERERS, ESSAY_CRITERIA, buildEssayCriterionPrompt } from "./renderers.js?v=7b8ffaf6";

export const MODEL_NAME = "gemini-2.5-flash";   // pinned; newer models are worse here

// The eight essay criteria are independent, so they go out together: the run
// then costs one call's latency (~20 s) rather than eight calls plus spacing
// (~4 min, measured).
//
// That suits a paid key and is too fast for the free tier, which allows five
// requests a minute. Rather than pick one and be wrong for half the users,
// anything rejected with 429 is retried afterwards at the slow pace — so a
// paid key is fast and a free key still finishes.
const RATE_LIMIT_PAUSE_MS = 20000;   // settle before retrying what was throttled
const RETRY_GAP_MS = 13000;          // between those retries: 5/minute

const ENDPOINT = model =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/* ------------------------------------------------------------------ *
 * The call
 * ------------------------------------------------------------------ */

export class GradingError extends Error {
  constructor(message, { quota = false, raw = "", transient = false, fatal = false } = {}) {
    super(message);
    this.quota = quota;         // 429 — stop, the rest would fail too
    this.transient = transient; // 5xx / overload — worth one retry
    this.fatal = fatal;         // misconfigured (no key, bad key) — stop, and say why
    this.raw = raw;
  }
}

/** Is this worth trying again? Overload is temporary; quota and bad keys are not. */
function isTransient(status, message = "") {
  return status === 503 || status === 500
      || /high demand|overloaded|unavailable|try again later/i.test(message);
}

/**
 * One model call, with a single retry for transient overload.
 *
 * `gemini-2.5-flash` really does answer "This model is currently experiencing
 * high demand" now and then — it happened on the very first live call — and a
 * few seconds later the same request succeeds. Surfacing that to a student as
 * a failure would be misleading. Quota (429) and a bad key are NOT retried:
 * they will not fix themselves and each attempt costs.
 */
export async function callGemini(prompt, apiKey, { retries = 1 } = {}) {
  try {
    return await callOnce(prompt, apiKey);
  } catch (err) {
    if (retries > 0 && err instanceof GradingError && err.transient) {
      await new Promise(r => setTimeout(r, 4000));
      return callGemini(prompt, apiKey, { retries: retries - 1 });
    }
    throw err;
  }
}

async function callOnce(prompt, apiKey) {
  if (!apiKey) throw new GradingError("Brak klucza API — otwórz Ustawienia.", { fatal: true });

  let res;
  try {
    res = await fetch(`${ENDPOINT(MODEL_NAME)}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
  } catch (err) {
    throw new GradingError("Brak połączenia z API: " + err.message, { transient: true });
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.error?.message || `${res.status} ${res.statusText}`;
    // 429 is the daily/minute quota. Say so plainly -- "20 per day" is the
    // single most surprising thing about this free tier.
    throw new GradingError(
      res.status === 429
        ? "Wyczerpany limit API (darmowy plan: 20 zapytań dziennie, 5 na minutę). Spróbuj później."
        : isTransient(res.status, msg)
          ? "Model chwilowo przeciążony. Spróbuj ponownie za chwilę."
          : "Błąd API: " + msg,
      {
        quota: res.status === 429,
        transient: isTransient(res.status, msg),
        fatal: res.status === 400 || res.status === 401 || res.status === 403,
      },
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
 * Running many calls at once
 * ------------------------------------------------------------------ */

/**
 * Run `task(item)` for every item concurrently, then retry whatever the API
 * throttled, slowly.
 *
 * Independent calls should not queue behind each other: grading eight essay
 * criteria one at a time took 243 s, concurrently it takes 22 s. But a free key
 * allows five requests a minute and rejects the rest with 429, so anything
 * throttled is redone afterwards at that pace instead of being lost. Fast on a
 * paid key, still correct on a free one.
 *
 * Shared by the essay and by whole-sheet grading so the retry behaviour cannot
 * drift between them.
 *
 * Returns `{ failures: [{ item, err }], fatal }` — `fatal` is a misconfiguration
 * (no key, bad key) that would defeat every item equally, so the caller can
 * report the cause instead of a pile of identical failures.
 */
export async function runConcurrently(items, task, onProgress = () => {}) {
  const total = items.length;
  let done = 0;

  const attempt = async item => {
    try {
      await task(item);
      return null;
    } catch (err) {
      return { item, err };
    } finally {
      onProgress(++done, total, item);
    }
  };

  onProgress(0, total, null);
  const errors = (await Promise.all(items.map(attempt))).filter(Boolean);

  const fatal = errors.find(e => e.err.fatal)?.err || null;
  const throttled = errors.filter(e => e.err.quota).map(e => e.item);
  const failures = errors.filter(e => !e.err.quota);

  if (throttled.length && !fatal) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_PAUSE_MS));
    for (let i = 0; i < throttled.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, RETRY_GAP_MS));
      done--;                                     // this one is being redone
      const again = await attempt(throttled[i]);
      if (again) failures.push(again);
    }
  }

  onProgress(total, total, null);
  return { failures, fatal };
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
 * Deliberately does NOT compute a score. This module only collects what the
 * model observed; turning that into points is `aggregateEssay()` in
 * renderers.js, which applies the matrix, the thresholds and the gating rules
 * from the exam JSON. Asking a model for the total instead is exactly the
 * mistake the grading design forbids, so the fills below are left empty here
 * and populated by the caller from the aggregator.
 *
 * `onProgress(done, total, criterionId)` fires as each call lands, so the UI
 * can show progress; the eight run concurrently, so they finish out of order.
 */
export async function gradeEssay(question, apiKey, onProgress = () => {}) {
  const results = {};
  const responses = {};
  const failures = [];

  const gradeOne = async id => {
    const raw = await callGemini(buildEssayCriterionPrompt(question, id), apiKey)
      .catch(err => {
        if (err.raw) responses[id] = err.raw;    // even a refusal is evidence
        throw err;
      });
    responses[id] = raw;                         // kept even if unparseable
    const parsed = parseJsonReply(raw);
    if (parsed) results[id] = parsed;
    else failures.push({ id, error: "nie udało się odczytać odpowiedzi modelu" });
  };

  const outcome = await runConcurrently(ESSAY_CRITERIA.map(c => c.id), gradeOne, onProgress);

  // A missing or invalid key fails every criterion identically, so report that
  // reason rather than eight anonymous failures.
  if (outcome.fatal && !Object.keys(results).length) throw outcome.fatal;
  outcome.failures.forEach(f => failures.push({ id: f.item, error: f.err.message }));

  return {
    ai_raw_results: results,        // parsed per-criterion values (§22)
    ai_raw_responses: responses,    // verbatim model output, kept because paid for
    failed_criteria: failures,
    // Left empty here on purpose: the caller runs aggregateEssay() over
    // ai_raw_results and writes these four in, so points are never decided by
    // anything that talked to a model.
    raw_table_fill: {},
    effective_table_fill: {},
    totals: {},
    applied_gating_rules: [],
    answer_snapshot: question.user_answer,
    model: MODEL_NAME,
    created_at: new Date().toISOString(),
  };
}
