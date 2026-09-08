// Paste the config object from:
//   Firebase console -> Project settings -> General -> Your apps -> Web app -> SDK setup
//
// These values are PUBLIC by design. They identify the project, they do not
// grant access to it -- access is controlled by Firestore security rules
// (see firestore.rules) and by the authorized-domains list in Firebase Auth.
// It is safe to commit this file to a public repository.

export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};
