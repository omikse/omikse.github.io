# CLAUDE.md — read this first

The student-facing web app: **https://omikse.github.io/zdamtoio/**

Google sign-in, real CKE exams, and per-user progress (answers + grading)
stored in Firestore.

It is the third of three components and owns none of the other two:

```
../tools/pdf-json/      the converter — PDF -> exam JSON
../tools/web-renderer/  the renderer  — exam JSON -> page, answers, grades
./                      the site       — auth, persistence, exam mode, admin
```

**This folder is a strict 1:1 copy of what is served at `/zdamtoio/`.** No build
step, no `src/`. What you see here is what is live. Deploy with `python publish.py`.

## Serve over HTTP, never `file://`

ES modules fail silently otherwise. Use **`python serve.py`**, then
http://localhost:8000 — not `python -m http.server`, which sends no
`Cache-Control` and lets Chrome pin `exam.js`/`renderers.js` from cache, so your
edits appear to do nothing. Same trap as `tools/web-renderer`.

## Where the answers are

| Question | File |
|---|---|
| How does a question type render / grade? | `renderers.js` — **generated, see below** |
| What shape is an exam JSON? | `../tools/pdf-json/qtypes-POLSKI.jsonc` |
| Deeper renderer / grading docs | `../tools/web-renderer/DOCUMENTATION.md` (§8 types, §11 grading, §14 the arkusz header) |
| Attempt-history shape for the essay | `../tools/web-renderer/P-ESSAY_projekt_oceniania.md` §22 |
| Who can read/write what | `firestore.rules` |
| How exams get here | `sync.py` |
| How the site goes live | `publish.py` |

## Rules that cost real money or damage to break

1. **`renderers.js`, `exam-styles.css` and `exams/` are GENERATED.** Never edit
   them here — `sync.py` overwrites them without asking. `renderers.js` and
   `exam-styles.css` come from `../tools/web-renderer/` (as `styles.css`);
   `exams/` comes from `../tools/pdf-json/`. Fix it there, then re-run
   `python sync.py`.
2. **Type logic lives only in `renderers.js`.** Do not special-case a question
   type in `exam.js`; that is what the `RENDERERS` registry is for. Adding a
   type means adding it in `../tools/web-renderer` and re-syncing.
3. **`P-TF` and `P-CHOICE` are graded by comparison, never by an AI prompt.**
   `renderer.grade(q)` already does it — exact, instant and free.
4. **Gemini is pinned to `gemini-2.5-flash`.** Newer models are worse here; see
   `../tools/pdf-json/CLAUDE.md` rule 5. Free tier is **20 requests/day, 5/minute**, so a
   full exam (17 open questions + 8 essay criteria = 25 calls) does not fit in
   one day. Grade per question on demand, never "grade everything".
5. **The essay has no official score yet.** The deterministic aggregator (raw AI
   values → points via matrix/thresholds/gating) is unbuilt. Store the raw
   per-criterion output per §22 and label it *diagnostyka, nie wynik oficjalny*.
   Never let a model produce the total itself.
6. **Firebase config values are public identifiers, not secrets** — safe in this
   repo. `GEMINI_API_KEY` is a real secret and never goes in a file here.
7. **Scope is the standard `100` papers only.** Everything else is an *arkusz
   dostosowany*; `sync.py` skips them.
8. **There are exactly two roles: admin and uczeń. There is no teacher.**
   This is a product decision, not an omission — do not add a teacher tier, a
   class, a group, or per-teacher seats, and do not describe the admin panel as
   a "teacher view". Admin is the project owner; everyone else is a student.
   Anything that would need a third role needs an explicit decision first.
9. **Adding an exam = dropping a folder into `exams/`, then `publish.py`.**
   No upload form, no admin-panel button. `publish.py` rebuilds
   `exams/index.json` by scanning the folder, reusing `build_index` from
   `pipeline/assemble.py` rather than reimplementing the P1+P2 grouping. The
   manifest is unavoidable: a static host cannot list a directory, so the
   browser cannot discover files by itself.
10. **Exams come from the pipeline, never from hand-written objects.** The
   original site carried three exams hardcoded into `index.html` in a different,
   ad-hoc shape (bare `questions[]` with a `rubric` string, essay topics as
   plain text). They were deleted, deliberately — they cannot be graded by
   `renderers.js` and were never real CKE data. Do not resurrect them or add an
   exam by typing it into a file: convert the paper in `tools/pdf-json`, then
   `python sync.py`.

## Two modes, one clock

An attempt is sat in **tryb nauki** (default) or **tryb egzaminacyjny**, chosen
on the exam card and fixed for the life of the attempt — switching mid-exam
would be a way to stop the clock. "Rozwiąż ponownie" is the way out.

- Practice: grade anything whenever; "Podsumowanie" summarises without freezing.
- Exam: a countdown runs, per-question grading is refused until the sheet is
  finished, and finishing (or expiry) sets `status: "submitted"`, which the
  rules then enforce.

**Durations are not in the exam JSON** — booklets carry only `id`, `name` and
the questions. They live in `EXAM_MINUTES` in `exam.js`, keyed by the formula
code (`P0` 240 min, `R0` 210 min). If a paper ever needs its own, move it into
the pipeline rather than special-casing an id.

**The clock is not enforceable.** `deadline` is an absolute timestamp checked in
the browser; someone who changes their system clock defeats it. It is a practice
aid, not invigilation — do not describe it as anything else.

**Expiry never grades.** Freezing is free; grading a sheet costs up to 23 API
calls, so it always follows a click.

## Browser gotchas that already bit us

- **Use the `hidden` class, not the `[hidden]` attribute.** Tailwind's `.flex`
  sets `display:flex` and beats the browser's `[hidden]` rule, so the element
  stays visible. `#back-btn` in `index.html` has always done it the right way.
- **Google sign-in popups do not work inside Claude's browser pane** — the popup
  is killed and Firebase reports `auth/popup-closed-by-user`, which is swallowed
  by design. Test sign-in in a real browser; verify the data in the Firebase
  console.
- The Firestore database is in **europe-central2** and its location **cannot be
  changed**.

## Firebase project

`zdamto-demo` — console: https://console.firebase.google.com/project/zdamto-demo

> ⚠️ **Anonymous sign-in is currently ENABLED, for testing only.** Neither the
> Google popup nor the redirect flow works inside Claude's browser pane (the
> popup is killed; the redirect loses its credential to storage partitioning
> because the app is not on `authDomain`). `signInAnonymously()` is a plain API
> call and works, which is the only way an agent can exercise the write path.
> **Turn it off before real students use this** — Authentication → Sign-in
> method → Anonymous → disable — and delete the leftover anonymous users.

- Auth: Google provider, public name "zdamto.io demo"
- Authorized domains: `localhost`, `omikse.github.io`
- Rules live in `firestore.rules` **in this folder** and are published by pasting
  them into the console. Nothing publishes them automatically — if you edit that
  file, publish it, or the live rules silently disagree with the repo.
- Admin is a Firestore document: `admins/{uid}`. No client can create it; add it
  by hand in the console. Granted to `9jNK3WKkURYgegsY2rknFBMGnQy1` (Thomas).
- **A submitted attempt is frozen by the rules**, not just by the UI. The single
  exception is `isReset()`: an owner may blank their own finished attempt to sit
  the paper again, and only if the incoming answers and grades are both empty.
  "Rozwiąż ponownie" archives a copy first, so nothing is lost.
- **Unpublishing an exam hides it, it does not protect it.** The catalogue
  (`catalog/{examId}`) filters the menu, but every exam JSON is a static file on
  GitHub Pages and stays fetchable by URL. Only a server could actually refuse
  the request, and there is none. "Not ready yet" — never "secret".

## Verify before and after any change

```bash
python serve.py            # then http://localhost:8000
python sync.py             # re-pull pipeline output; must stay clean
python publish.py --dry-run  # show exactly what would go live
```

Sign-in, answer a `P-TF` and a `P-CHOICE`, reload mid-exam and confirm the
answers come back. Then check the `attempts` document in the Firebase console —
the UI showing a value is not proof it was stored.
