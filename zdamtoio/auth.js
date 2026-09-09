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

import { auth, db } from "./firebase.js?v=daf02fb4";

const root = document.documentElement;

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

/* ------------------------------------------------------------------ *
 * Ekran logowania -- budowany w JS, żeby nie ruszać index.html
 * ------------------------------------------------------------------ */

/* Logowanie jest opcjonalne. Bez konta aplikacja działa w całości — arkusze,
   ocenianie zadań zamkniętych i AI — tyle że postęp nie jest nigdzie
   zapisywany. Konto służy wyłącznie do tego, żeby wrócić do swoich odpowiedzi.
   Dlatego zamiast ekranu blokującego jest przycisk w nagłówku. */

const slot = document.getElementById("auth-slot");

const signInBtn = document.createElement("button");
signInBtn.id = "auth-signin-btn";
signInBtn.className = "hidden items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 "
  + "text-white px-3 py-1.5 rounded-full text-xs font-semibold transition-colors";
signInBtn.innerHTML = `<span class="material-symbols-outlined text-sm">login</span> Zaloguj się`;

const errorBox = document.createElement("p");
errorBox.id = "auth-error";
errorBox.className = "hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-red-50 "
  + "border border-red-200 text-red-700 text-xs px-4 py-2 rounded-lg shadow";
document.body.appendChild(errorBox);


/* ------------------------------------------------------------------ *
 * Chip użytkownika w nagłówku -- ten sam styl co pigułka „API”
 * ------------------------------------------------------------------ */

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
if (slot) { slot.appendChild(signInBtn); slot.appendChild(chip); }

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
    root.classList.remove("auth-unknown");
    signInBtn.classList.remove("hidden");
    signInBtn.classList.add("flex");
    chip.classList.add("hidden");
    return;
  }

  root.classList.remove("auth-unknown");
  signInBtn.classList.add("hidden");
  signInBtn.classList.remove("flex");
  chip.classList.remove("hidden");

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
