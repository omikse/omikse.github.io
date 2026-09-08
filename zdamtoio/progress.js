/*
 * progress.js — attempts: save, resume, list.
 *
 * One live attempt per exam, stored at users/{uid}/attempts/{examId}. The
 * predictable id is deliberate: resuming is a single getDoc rather than a
 * query, which keeps Firestore from needing a composite index for
 * (examId, status, updatedAt). Starting over archives the current attempt to
 * {examId}__{timestamp}, so history still accumulates.
 *
 * `answers` stores each question's `user_answer` verbatim -- exactly the shape
 * renderers.js produces and consumes -- so resuming is just putting it back on
 * the question before render(). Nothing here knows about question types.
 */

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  serverTimestamp, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import { auth, db } from "./firebase.js?v=f100896e";

const SAVE_DELAY_MS = 2000;

let currentAttempt = null;   // { examId, ref }
let saveTimer = null;
let pending = null;          // newest unsaved payload

/* Save state, surfaced to the UI. Silent autosave is a trap: a student who
   cannot see whether their work is safe has to guess, and so does anyone
   debugging it. States: idle | dirty | saving | saved | error. */
let onState = () => {};
export function onSaveState(cb) { onState = cb; }
function setState(state, detail) { onState(state, detail); }

/* Resolves once Firebase has decided whether anybody is signed in. Without
   this, code that runs before the first auth callback sees a null user and
   wrongly concludes the visitor is anonymous. */
export const userReady = new Promise(resolve => {
  const stop = onAuthStateChanged(auth, user => {
    stop();
    resolve(user);
  });
});

function attemptsCol(uid) {
  return collection(db, "users", uid, "attempts");
}

/* ------------------------------------------------------------------ *
 * Start / resume
 * ------------------------------------------------------------------ */

/**
 * Open the live attempt for an exam, creating it if there is none.
 * Returns { answers, grades } — empty objects for a fresh attempt.
 */
export async function startOrResume(examId, examName) {
  const user = auth.currentUser || (await userReady);
  if (!user) return { answers: {}, grades: {}, essay: null };

  flushNow();                       // don't let a previous exam's save land here
  const ref = doc(attemptsCol(user.uid), examId);
  currentAttempt = { examId, ref };

  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      examId,
      examName: examName || "",
      status: "in_progress",
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      answers: {},
      grades: {},
      totals: { points: 0, maxPoints: 0, graded: 0, pending: 0 },
    });
    return { answers: {}, grades: {}, essay: null };
  }

  const data = snap.data();
  return { answers: data.answers || {}, grades: data.grades || {}, essay: data.essay || null };
}

/* ------------------------------------------------------------------ *
 * Saving
 * ------------------------------------------------------------------ */

/**
 * Queue a save. Called on every keystroke, so it is debounced — a student
 * typing a wypracowanie would otherwise generate a write per character.
 */
export function save(payload) {
  if (!currentAttempt) {
    setState("error", "brak sesji");     // signed out, or the attempt failed to open
    return;
  }
  pending = payload;
  setState("dirty");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushNow, SAVE_DELAY_MS);
}

/** Write whatever is queued immediately. */
export async function flushNow() {
  clearTimeout(saveTimer);
  if (!currentAttempt || !pending) return;

  const payload = pending;
  const ref = currentAttempt.ref;
  pending = null;
  setState("saving");

  try {
    await updateDoc(ref, {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    setState("saved", new Date());
  } catch (err) {
    // Losing a save should never cost the student their work on screen -- but
    // it must not be silent either. That silence is exactly what hid a failed
    // save once already.
    console.warn("Nie udało się zapisać postępu:", err.code || err.message);
    setState("error", err.code || err.message);
  }
}

// A closed tab must not swallow the last two seconds of typing.
window.addEventListener("beforeunload", () => { flushNow(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushNow();
});

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

/** Most recently touched attempts first. Single-field order — no index needed. */
export async function listAttempts(max = 20) {
  const user = auth.currentUser || (await userReady);
  if (!user) return [];
  try {
    const snap = await getDocs(query(attemptsCol(user.uid), orderBy("updatedAt", "desc"), limit(max)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("Nie udało się wczytać historii:", err.code || err.message);
    return [];
  }
}

/** Archive the live attempt so the student can start the exam again. */
export async function startOver(examId) {
  const user = auth.currentUser || (await userReady);
  if (!user) return;

  const ref = doc(attemptsCol(user.uid), examId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await setDoc(doc(attemptsCol(user.uid), `${examId}__${stamp}`), {
    ...snap.data(),
    status: "submitted",
    submittedAt: serverTimestamp(),
  });
  await updateDoc(ref, {
    answers: {},
    grades: {},
    totals: { points: 0, maxPoints: 0, graded: 0, pending: 0 },
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
