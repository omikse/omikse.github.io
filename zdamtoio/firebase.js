/*
 * firebase.js — one Firebase app, shared by every module that needs it.
 *
 * auth.js and progress.js both talk to Firebase; calling initializeApp twice
 * is asking for trouble, so it happens exactly once, here.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// Public identifiers, not secrets. They name the project; they do not grant
// access to it -- that is what firestore.rules and the authorized-domain list
// are for. Safe in a public repo. (GEMINI_API_KEY is a real secret and never
// belongs in a file here.)
export const firebaseConfig = {
  apiKey: "AIzaSyBzT-F9c04FgucX-wx2E82WQp6U_ntChSo",
  authDomain: "zdamto-demo.firebaseapp.com",
  projectId: "zdamto-demo",
  storageBucket: "zdamto-demo.firebasestorage.app",
  messagingSenderId: "165740984586",
  appId: "1:165740984586:web:7b3231e3b11bf0c49e62f3",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
