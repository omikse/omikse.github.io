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

import { RENDERERS, ESSAY_CRITERIA, buildEssayCriterionPrompt } from "./renderers.js?v=2886e41b";

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
      failures.push({ id, error: err.message });
      if (err.raw) responses[id] = err.raw;
      // A missing or invalid key, and an exhausted quota, will fail identically
      // for every remaining criterion. Grinding through the other seven only
      // buys eight copies of "nie udało się ocenić" with the reason thrown
      // away -- which is exactly what it did the first time this ran for real.
      if (err.quota || err.fatal) {
        onProgress(ESSAY_CRITERIA.length, ESSAY_CRITERIA.length, id);
        if (!Object.keys(results).length) throw err;   // nothing salvaged: say why
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
