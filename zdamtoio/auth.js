// Logowanie Google + profil użytkownika w Firestore.
//
// Dokłada się do istniejącej aplikacji i nie zmienia jej wyglądu: dopóki nikt
// nie jest zalogowany, <main> jest ukryty i widać ekran logowania; po
// zalogowaniu wszystko wygląda jak wcześniej, plus chip użytkownika w nagłówku.

import {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, increment, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { auth, db } from "./firebase.js?v=f100896e";

const root = document.documentElement;

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

/* ------------------------------------------------------------------ *
 * Ekran logowania -- budowany w JS, żeby nie ruszać index.html
 * ------------------------------------------------------------------ */

const gate = document.createElement("div");
gate.id = "auth-gate-screen";
// Klasa `hidden`, nie atrybut: `.flex` z Tailwinda wygrywa z [hidden],
// więc atrybut nic by nie dał (tak samo robi #back-btn w index.html).
gate.className = "hidden fixed inset-0 z-40 bg-slate-100 items-center justify-center p-4 flex";
gate.innerHTML = `
  <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-10 max-w-md w-full text-center fade-in">
    <div class="flex items-center justify-center gap-2 text-indigo-700 mb-6">
      <span class="material-symbols-outlined text-4xl">school</span>
      <div class="text-left">
        <h2 class="font-bold leading-none text-xl">Matura Tutor</h2>
        <p class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Symulacja &amp; Analiza AI</p>
      </div>
    </div>

    <h3 class="text-lg font-bold text-slate-800 mb-2">Zaloguj się, aby rozwiązywać arkusze</h3>
    <p class="text-sm text-slate-500 mb-8">
      Twoje konto pozwala zapisać postępy i wrócić do nich na innym urządzeniu.
    </p>

    <button id="auth-signin-btn"
      class="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-lg font-semibold shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2">
      <span class="material-symbols-outlined">login</span>
      Zaloguj się przez Google
    </button>

    <p id="auth-error" class="hidden text-xs text-red-600 mt-4"></p>
  </div>
`;
document.body.appendChild(gate);

const signInBtn = gate.querySelector("#auth-signin-btn");
const errorBox = gate.querySelector("#auth-error");

/* ------------------------------------------------------------------ *
 * Chip użytkownika w nagłówku -- ten sam styl co pigułka „API”
 * ------------------------------------------------------------------ */

const slot = document.getElementById("auth-slot");
const chip = document.createElement("div");
chip.className = "flex items-center gap-2 bg-slate-50 px-2 py-1 rounded-full border border-slate-200 text-xs";
chip.innerHTML = `
  <img id="auth-avatar" alt="" width="22" height="22" class="rounded-full bg-slate-200">
  <span id="auth-name" class="font-medium text-slate-600 max-w-[9rem] truncate"></span>
  <button id="auth-signout" title="Wyloguj"
    class="text-slate-400 hover:text-indigo-600 transition-colors flex items-center">
    <span class="material-symbols-outlined text-sm">logout</span>
  </button>
`;
if (slot) slot.appendChild(chip);

/* ------------------------------------------------------------------ *
 * Logowanie
 * ------------------------------------------------------------------ */

getRedirectResult(auth).catch(showError);

// ?auth=redirect forces the redirect flow instead of a popup. Popups are the
// better default -- they keep the page state -- but some environments kill them
// outright (Claude's browser pane does, and strict popup blockers do too), and
// then there is no way to sign in at all. This makes that case testable.
const forceRedirect = new URLSearchParams(location.search).get("auth") === "redirect";

signInBtn.addEventListener("click", async () => {
  errorBox.classList.add("hidden");
  signInBtn.disabled = true;
  try {
    if (forceRedirect) {
      await signInWithRedirect(auth, provider);
      return;
    }
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
    } else if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
      showError(err);
    }
  } finally {
    signInBtn.disabled = false;
  }
});

chip.querySelector("#auth-signout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    root.classList.add("auth-gate");
    root.classList.remove("auth-unknown");
    gate.classList.remove("hidden");
    return;
  }

  gate.classList.add("hidden");
  root.classList.remove("auth-gate", "auth-unknown");

  chip.querySelector("#auth-avatar").src = user.photoURL || "";
  chip.querySelector("#auth-name").textContent = user.displayName || user.email || "";

  try {
    await ensureUserDoc(user);
  } catch (err) {
    // Profil to nie jest powód, żeby blokować naukę -- aplikacja działa dalej.
    console.warn("Nie udało się zapisać profilu:", err.code || err.message);
  }
});

/* ------------------------------------------------------------------ *
 * users/{uid} -- ten sam kształt dokumentu co w /zdamto_demo/
 * ------------------------------------------------------------------ */

async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      displayName: user.displayName || null,
      email: user.email || null,
      photoURL: user.photoURL || null,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      loginCount: 1,
      attemptCount: 0,
    });
    return;
  }

  await updateDoc(ref, {
    displayName: user.displayName || null,
    email: user.email || null,
    photoURL: user.photoURL || null,
    lastLoginAt: serverTimestamp(),
    loginCount: increment(1),
  });
}

function showError(err) {
  if (!err) return;
  errorBox.textContent =
    err.code === "auth/unauthorized-domain"
      ? "Domena " + location.hostname + " nie jest autoryzowana w Firebase Auth."
      : "Błąd logowania: " + (err.message || err.code);
  errorBox.classList.remove("hidden");
}
