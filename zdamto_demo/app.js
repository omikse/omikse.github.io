// Demo: Google sign-in (Firebase Auth) + per-user exam history (Cloud Firestore).
// Static site -- no server. Everything below runs in the browser.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, increment, serverTimestamp,
  collection, addDoc, query, orderBy, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

/* ------------------------------------------------------------------ *
 * The demo "exam". Shaped like the real thing: questions keyed by the
 * number CKE prints, one answer per key, closed types graded by
 * comparison and open ones left for a human (or a model) later.
 * ------------------------------------------------------------------ */

const EXAM = {
  id: "DEMO-POL-1",
  title: "Mini-arkusz: jezyk polski",
  questions: [
    {
      n: "1",
      type: "P-TF",
      text: "Fraszka „Na dom w Czarnolesie” to utwór Jana Kochanowskiego.",
      options: [["P", "Prawda"], ["F", "Fałsz"]],
      key: "P",
    },
    {
      n: "2",
      type: "P-CHOICE",
      text: "Które z podanych dzieł powstało w epoce romantyzmu?",
      options: [
        ["A", "„Dziady” cz. III — Adam Mickiewicz"],
        ["B", "„Lalka” — Bolesław Prus"],
        ["C", "„Ferdydurke” — Witold Gombrowicz"],
        ["D", "„Potop” — Henryk Sienkiewicz"],
      ],
      key: "A",
    },
    {
      n: "3",
      type: "P-OPEN",
      text: "Wyjaśnij jednym zdaniem, czym jest oksymoron.",
      key: null, // graded by a human / model later -- never by string compare
    },
  ],
};

const MAX_SCORE = EXAM.questions.length;
const AUTO_MAX = EXAM.questions.filter((q) => q.key !== null).length;

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const CONFIGURED = !String(firebaseConfig.apiKey).startsWith("PASTE_");

let auth = null;
let db = null;

if (!CONFIGURED) {
  $("setup-banner").hidden = false;
  showSignedOut();
  for (const b of document.querySelectorAll(".btn-google")) b.disabled = true;
} else {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    start();
  } catch (err) {
    fail("Nie udało się zainicjować Firebase: " + err.message);
  }
}

function start() {
  // If the popup was blocked we fall back to a redirect; collect its result.
  getRedirectResult(auth).catch((err) => showAuthError(err));

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      showSignedOut();
      return;
    }
    showSignedIn(user);
    try {
      const profile = await ensureUserDoc(user);
      renderProfile(user, profile);
      await loadHistory(user);
    } catch (err) {
      fail(firestoreMessage(err));
    }
  });

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  const doSignIn = async () => {
    $("auth-error").hidden = true;
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(auth, provider);
      } else if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
        showAuthError(err);
      }
    }
  };

  $("signin-hero").addEventListener("click", doSignIn);
  $("signin-top").addEventListener("click", doSignIn);
  $("signout").addEventListener("click", () => signOut(auth));
  $("submit-quiz").addEventListener("click", submitAttempt);
  $("reset-quiz").addEventListener("click", () => renderQuiz());
  $("refresh-history").addEventListener("click", () => loadHistory(auth.currentUser));
}

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

function showSignedOut() {
  $("view-signedout").hidden = false;
  $("view-signedin").hidden = true;
  $("signin-top").hidden = true;      // the hero already has a big one
  $("user-chip").hidden = true;
}

function showSignedIn(user) {
  $("view-signedout").hidden = true;
  $("view-signedin").hidden = false;
  $("signin-top").hidden = true;
  $("user-chip").hidden = false;
  $("chip-avatar").src = user.photoURL || "";
  $("chip-name").textContent = user.displayName || user.email || "";
  $("quiz-points").textContent = MAX_SCORE + " pkt";
  renderQuiz();
}

function fail(msg) {
  const el = $("boot-error");
  el.textContent = msg;
  el.hidden = false;
}

function showAuthError(err) {
  if (!err) return;
  const el = $("auth-error");
  el.textContent = authMessage(err);
  el.hidden = false;
}

function authMessage(err) {
  if (err.code === "auth/unauthorized-domain") {
    return "Ta domena nie jest na liście autoryzowanych w Firebase Auth "
      + "(Authentication → Settings → Authorized domains). Dodaj: "
      + location.hostname;
  }
  if (err.code === "auth/configuration-not-found") {
    return "Włącz dostawcę Google w Firebase: Authentication → Sign-in method.";
  }
  return "Błąd logowania: " + (err.message || err.code);
}

function firestoreMessage(err) {
  if (err.code === "permission-denied") {
    return "Firestore odmówił dostępu — opublikuj reguły z pliku firestore.rules.";
  }
  if (err.code === "unavailable") {
    return "Brak połączenia z Firestore. Sprawdź sieć i czy baza została utworzona.";
  }
  return "Błąd bazy: " + (err.message || err.code);
}

/* ------------------------------------------------------------------ *
 * users/{uid}
 * ------------------------------------------------------------------ */

async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const fresh = {
      uid: user.uid,
      displayName: user.displayName || null,
      email: user.email || null,
      photoURL: user.photoURL || null,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      loginCount: 1,
      attemptCount: 0,
    };
    await setDoc(ref, fresh);
    return { ...fresh, createdAt: new Date(), lastLoginAt: new Date() };
  }

  const prev = snap.data();
  await updateDoc(ref, {
    displayName: user.displayName || null,
    email: user.email || null,
    photoURL: user.photoURL || null,
    lastLoginAt: serverTimestamp(),
    loginCount: increment(1),
  });
  return { ...prev, loginCount: (prev.loginCount || 0) + 1 };
}

function renderProfile(user, data) {
  $("p-avatar").src = user.photoURL || "";
  $("p-name").textContent = user.displayName || "(bez nazwy)";
  $("p-email").textContent = user.email || "";
  $("p-uid").textContent = user.uid;
  $("p-created").textContent = fmtDate(toDate(data.createdAt)) || "—";
  $("p-logins").textContent = data.loginCount ?? 1;
  $("p-attempts").textContent = data.attemptCount ?? 0;
}

/* ------------------------------------------------------------------ *
 * Quiz
 * ------------------------------------------------------------------ */

function renderQuiz() {
  const form = $("quiz");
  form.innerHTML = "<fieldset>" + EXAM.questions.map(questionHtml).join("") + "</fieldset>";
  $("submit-quiz").hidden = false;
  $("submit-quiz").disabled = false;
  $("reset-quiz").hidden = true;
  setStatus("", "");
}

function questionHtml(q) {
  const head = '<div class="q-head"><span class="q-num">' + q.n + ".</span>"
    + '<span class="q-text">' + esc(q.text) + "</span></div>";

  if (q.type === "P-OPEN") {
    return '<div class="q">' + head
      + '<input type="text" name="q' + q.n + '" maxlength="200" placeholder="Wpisz odpowiedź…">'
      + "</div>";
  }

  const opts = q.options.map(([val, label]) =>
    '<label class="opt"><input type="radio" name="q' + q.n + '" value="' + val + '">'
    + "<span>" + esc(label) + "</span></label>").join("");
  return '<div class="q">' + head + '<div class="opts">' + opts + "</div></div>";
}

async function submitAttempt() {
  const user = auth.currentUser;
  if (!user) return;

  const form = $("quiz");
  const answers = {};
  for (const q of EXAM.questions) {
    const field = form.elements["q" + q.n];
    const value = (q.type === "P-OPEN"
      ? field.value.trim()
      : (form.querySelector('input[name="q' + q.n + '"]:checked') || {}).value) || "";
    if (!value) {
      setStatus("Odpowiedz na wszystkie zadania (brakuje " + q.n + ").", "err");
      return;
    }
    answers[q.n] = value;
  }

  // Closed types: graded by comparison, never by a model.
  const correctness = {};
  let score = 0;
  for (const q of EXAM.questions) {
    if (q.key === null) { correctness[q.n] = null; continue; }
    const ok = answers[q.n] === q.key;
    correctness[q.n] = ok;
    if (ok) score++;
  }

  $("submit-quiz").disabled = true;
  setStatus("Zapisywanie…", "");

  try {
    await addDoc(collection(db, "users", user.uid, "attempts"), {
      examId: EXAM.id,
      examTitle: EXAM.title,
      answers,
      correctness,
      score,
      autoMax: AUTO_MAX,
      maxScore: MAX_SCORE,
      pending: MAX_SCORE - AUTO_MAX,
      finishedAt: serverTimestamp(),
      finishedAtLocal: Date.now(),
    });
    await updateDoc(doc(db, "users", user.uid), { attemptCount: increment(1) });

    form.querySelector("fieldset").disabled = true;
    $("submit-quiz").hidden = true;
    $("reset-quiz").hidden = false;
    setStatus("Zapisano: " + score + "/" + AUTO_MAX + " pkt z zadań zamkniętych.", "ok");
    await loadHistory(user);
  } catch (err) {
    $("submit-quiz").disabled = false;
    setStatus(firestoreMessage(err), "err");
  }
}

function setStatus(text, cls) {
  const el = $("quiz-status");
  el.textContent = text;
  el.className = "status" + (cls ? " " + cls : "");
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

async function loadHistory(user) {
  if (!user) return;
  const box = $("history");
  box.innerHTML = '<p class="muted">Wczytywanie…</p>';

  try {
    const snap = await getDocs(query(
      collection(db, "users", user.uid, "attempts"),
      orderBy("finishedAtLocal", "desc"),
      limit(20),
    ));

    if (snap.empty) {
      box.innerHTML = '<p class="muted">Brak podejść. Rozwiąż mini-arkusz powyżej — '
        + "pojawi się tutaj razem z odpowiedziami.</p>";
      return;
    }

    box.innerHTML = snap.docs.map((d) => attemptHtml(d.data())).join("");
    $("p-attempts").textContent = snap.size;
  } catch (err) {
    box.innerHTML = '<p class="error">' + esc(firestoreMessage(err)) + "</p>";
  }
}

function attemptHtml(a) {
  const when = fmtDateTime(toDate(a.finishedAt) || toDate(a.finishedAtLocal)) || "—";
  const pending = a.pending
    ? '<span class="attempt-exam">+' + a.pending + " do sprawdzenia</span>"
    : "";

  const rows = Object.keys(a.answers || {}).sort(byQuestionNumber).map((n) => {
    const ok = (a.correctness || {})[n];
    const mark = ok === true ? '<span class="mark ok">✓</span>'
      : ok === false ? '<span class="mark no">✗</span>'
      : '<span class="mark man">do sprawdzenia</span>';
    return '<div class="ans"><span class="ans-n">' + esc(n) + ".</span>"
      + '<span class="ans-v">' + esc(String(a.answers[n])) + "</span>" + mark + "</div>";
  }).join("");

  return "<details class=\"attempt\"><summary>"
    + '<span class="attempt-when">' + esc(when) + "</span>"
    + '<span class="attempt-exam">' + esc(a.examTitle || a.examId || "") + "</span>"
    + '<span class="attempt-score">' + (a.score ?? "?") + "/" + (a.autoMax ?? a.maxScore ?? "?") + " pkt</span>"
    + pending + "</summary>"
    + '<div class="answers">' + rows + "</div></details>";
}

const byQuestionNumber = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();   // Firestore Timestamp
  if (typeof v === "number") return new Date(v);
  if (v instanceof Date) return v;
  return null;
}

const dateFmt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" });
const fmtDate = (d) => (d ? dateFmt.format(d) : "");
const fmtDateTime = (d) => (d ? dateTimeFmt.format(d) : "");

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
