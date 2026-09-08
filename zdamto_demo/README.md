# Demo: logowanie Google + baza (Firebase) na GitHub Pages

Statyczna strona — brak backendu. Przeglądarka rozmawia bezpośrednio z Firebase.

- **Firebase Auth** — logowanie kontem Google (`signInWithPopup`).
- **Cloud Firestore** — profil użytkownika + historia podejść z odpowiedziami.
- **GitHub Pages** — hosting, docelowo `https://omikse.github.io/zdamto_demo/`.

```
index.html          UI (wylogowany / zalogowany)
styles.css          wygląd, light + dark
app.js              auth, zapis do bazy, mini-arkusz, historia
firebase-config.js  <- TU wklejasz konfigurację projektu
firestore.rules     <- TO wklejasz w konsoli Firebase
```

---

## Model danych

Uproszczona, ale docelowa struktura — jeden dokument na podejście,
odpowiedzi kluczowane numerem zadania tak, jak drukuje je CKE.

```
users/{uid}
  uid, displayName, email, photoURL
  createdAt, lastLoginAt, loginCount, attemptCount

users/{uid}/attempts/{attemptId}        // append-only
  examId      "DEMO-POL-1"
  examTitle   "Mini-arkusz: język polski"
  answers     { "1": "P", "2": "A", "3": "zestawienie sprzecznych słów" }
  correctness { "1": true, "2": false, "3": null }   // null = do sprawdzenia
  score, autoMax, maxScore, pending
  finishedAt (serverTimestamp), finishedAtLocal (ms)
```

Zadania zamknięte (P-TF, P-CHOICE) sprawdza `===` w przeglądarce — nigdy model.
Zadanie otwarte ma `correctness: null` i czeka na ocenę; to samo miejsce, w które
później wepnie się prawdziwe ocenianie wypracowań.

Reguły w `firestore.rules` robią dwie rzeczy: zamykają wszystko na własny `uid`
i blokują `update`/`delete` na podejściach — historia, którą można nadpisać, nie
jest historią.

---

## Konfiguracja Firebase (jednorazowo, ~10 minut, za darmo)

1. **Projekt** — [console.firebase.google.com](https://console.firebase.google.com/)
   → *Add project*. Google Analytics możesz wyłączyć.

2. **Logowanie Google** — *Authentication* → *Get started* → *Sign-in method*
   → **Google** → *Enable*, ustaw support email → *Save*.

3. **Domeny** — *Authentication* → *Settings* → *Authorized domains*.
   `localhost` jest domyślnie. Dodaj **`omikse.github.io`**
   (sama domena, bez ścieżki `/zdamto_demo/`).

4. **Baza** — *Firestore Database* → *Create database* → **Production mode**
   → region `eur3` lub `europe-central2` (Warszawa).

5. **Reguły** — *Firestore Database* → zakładka *Rules* → wklej całą zawartość
   `firestore.rules` → *Publish*.

6. **Konfiguracja aplikacji** — *Project settings* (⚙) → *General* → *Your apps*
   → ikona `</>` (Web) → zarejestruj → skopiuj obiekt `firebaseConfig`
   → wklej do `firebase-config.js`.

### Czy te klucze to sekret? Nie.

`apiKey` i `appId` **identyfikują** projekt, nie dają do niego dostępu — Google
projektuje je jako publiczne i tak samo widać je w każdej aplikacji webowej
korzystającej z Firebase. Dostępu pilnują reguły Firestore (punkt 5) i lista
autoryzowanych domen (punkt 3). Ten plik można spokojnie wrzucić na publiczne repo.

Prawdziwe sekrety — np. `GEMINI_API_KEY` — nigdy nie trafiają do plików w repo.

---

## Uruchomienie lokalne

ES modules nie działają z `file://` — potrzebny serwer HTTP:

```bash
python -m http.server 8000
```

Potem <http://localhost:8000>. `localhost` jest domyślnie autoryzowany w Firebase,
więc logowanie zadziała od razu.

---

## Publikacja na GitHub Pages

Cały folder trafia do repo `omikse/omikse.github.io` jako `zdamto_demo/`:

```bash
git clone https://github.com/omikse/omikse.github.io.git
cp -r <ten-folder> omikse.github.io/zdamto_demo
cd omikse.github.io
git add zdamto_demo && git commit -m "Add zdamto login demo" && git push
```

Po minucie–dwóch: <https://omikse.github.io/zdamto_demo/>

Wszystkie ścieżki w `index.html` są względne, więc podfolder działa bez zmian.
Jedyne, o czym trzeba pamiętać, to punkt 3 powyżej — bez `omikse.github.io`
na liście autoryzowanych domen logowanie zwróci `auth/unauthorized-domain`
(aplikacja wypisze wtedy dokładnie taki komunikat).

---

## Co dalej

- podmienić `EXAM` w `app.js` na prawdziwy arkusz z `pipeline`
- `attempts` trzyma już `answers` w formacie, który przyjmie prompt oceniający
- dodać `startedAt` i czas rozwiązywania, jeśli ma być limit czasu
