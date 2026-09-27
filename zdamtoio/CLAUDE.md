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
| Why is that arkusz greyed out? | `exams/papers.json` — **generated**, see below |
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
3. **Questions with an exact key are graded by comparison, never by a prompt.**
   `P-TF`, `P-CHOICE` and most `P-TABLE-MATCH` — exact, instant and free. Ask
   **`gradesDeterministically(q)`**, not `RENDERERS[q.type].grade`: the type
   having a `grade()` does not mean this question is settleable, and the cost
   estimate, the button's mark and the grading path must all agree.
4. **Gemini is pinned to `gemini-2.5-flash`.** Newer models are worse here; see
   `../tools/pdf-json/CLAUDE.md` rule 5. Free tier is **20 requests/day, 5/minute**, so a
   full exam (17 open questions + 8 essay criteria = 25 calls) does not fit in
   one day. Grade per question on demand, never "grade everything".
5. **The essay total is computed here, never by a model.** `gradeEssay()`
   collects raw per-criterion values (error counts, classifications);
   `aggregateEssay()` in `renderers.js` turns them into points using the matrix,
   thresholds and gating rules carried in the exam JSON. Both halves are built.
   Asking a model for the total instead is the one thing the grading design
   forbids, so `grading.js` deliberately returns empty fills and the caller
   fills them from the aggregator.
6. **Firebase config values are public identifiers, not secrets** — safe in this
   repo. `GEMINI_API_KEY` is a real secret and never goes in a file here.
7a. **The picker shows papers we do not have, on purpose.** `exams/papers.json`
   comes from the pipeline (`python -m pipeline index`) and carries a state for
   every paper CKE ever printed — 364 rows, 34 subjects. Six states
   (`converted / held / no_scheme / published / partial / absent`) plus a
   seventh the renderer adds, `poza stroną`: converted upstream but not served
   here, because `sync.py` copies only the standard `100` papers and "gotowy"
   on a card that does not open is a bug report waiting to happen. Six rather
   than one because "not converted yet", "held but CKE published no marking
   scheme", "published but never fetched" and "never printed" are different
   facts, and a single greyed card asserts the same wrong thing about most of
   them. It is generated — fix it in
   `../tools/pdf-json/pipeline/assemble.py`, never here. Scope in rule 7 still
   governs what gets *converted*; this only governs what gets *listed*.

7b. **The picker is a matrix: subjects down, sessions across, adapted papers
   one level in.** Subject names come from papers.json's `subjects` map — never
   hardcode a code table here, see the pipeline's CLAUDE.md for why. Order is
   polski, matematyka, angielski, then alphabetical under `Intl.Collator("pl")`,
   because ASCII collation puts *łaciński* after *z*. Four things about this
   are deliberate and will otherwise get "tidied" back:
   - **One card design for every paper**, openable or not. A smaller tile for
     the greyed ones says "different kind of thing", when a 2026 arkusz sitting
     unconverted on our disk is the same exam at an earlier stage.
   - **All subjects start collapsed.** Expanded, it is ~200 cards and the six
     you can actually sit are buried. The summary carries the openable count so
     a shut section still says whether it holds anything. Open sections survive
     a re-render (`openSubjects`) because `renderMenu` re-runs when the attempt
     history lands from Firestore, a second after paint.
   - **One scroll container per subject, not per level row**, so Podstawowa and
     Rozszerzona cannot drift apart and put 2023 above 2025.
   - **The sticky level label needs `z-20`, not `z-10`.** The cards are
     `position: relative` with an inner `z-10`, and `relative` + `z-index: auto`
     creates no stacking context, so at `z-10` the label loses the tie to
     later-in-DOM cards and they paint straight over it.
   - **The strip's scrollbar is hidden and the wheel scrolls it sideways**
     (`bindSidewaysWheel`), page gutters excepted. Two traps live in that
     function and both were hit: writing `scrollLeft` straight from `deltaY`
     chops a notch at a time, and easing toward a target with
     `scrollWidth - clientWidth` never converges — `scrollWidth` rounds up, so
     the real maximum is a pixel or two short (measured 274 against 276) and
     the `requestAnimationFrame` loop spins for the life of the page. It stops
     when a step fails to move the strip, not only when it reaches the target.

7c. **A card shows a score only once every question is marked.**
   `totals.points` accumulates per question as each is checked, so a
   half-marked paper holds a real number that is not the student's result;
   showing it reads as "you scored 12/60" to someone who simply has not
   finished. The test is `totals.graded > 0 && totals.pending === 0` — **not**
   `status === "submitted"`, because submitting in exam mode grades nothing.
   Before that the card states what the paper is worth. The question line
   counts the wypracowanie as a question (`0/20 zadań`) because CKE numbers it
   as one, and reads "zadań" at every value: Polish takes the genitive plural
   after a fraction, so `0/1 zadanie` on a rozszerzony sheet would be wrong.

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

**Freezing freezes answers, not grading.** `freezeSheet()` disables the inputs
and nothing else. Whether a sheet may be graded is `gradingLocked()` alone —
exam mode and not yet submitted — checked at click time by `refuseIfLocked()`.
`freezeSheet` used to disable the grade buttons too, which contradicted it:
finishing an exam is the exact moment grading becomes allowed, and the student
was left clicking a dead button. One rule, one place.

> ⚠️ **Exam mode silently degrades to practice when logged out.**
> `startOrResume()` (`progress.js`) returns `mode: "practice"` for a visitor
> with no account, ignoring the requested mode — so the "⏱ 240 min" button
> starts no clock, locks nothing, and looks like it worked. Login is optional by
> design, so this is a real decision, not a typo: either exam mode works without
> an account (a local deadline, no persistence) or the button says it needs one.
> Until it is settled, exam-mode behaviour cannot be exercised without signing
> in — worth knowing before you conclude a lock is broken.

## Browser gotchas that already bit us

- **Use the `hidden` class, not the `[hidden]` attribute.** Tailwind's `.flex`
  sets `display:flex` and beats the browser's `[hidden]` rule, so the element
  stays visible. `#back-btn` in `index.html` has always done it the right way.
- **Google sign-in popups do not work inside Claude's browser pane** — the popup
  is killed and Firebase reports `auth/popup-closed-by-user`, which is swallowed
  by design. Test sign-in in a real browser; verify the data in the Firebase
  console.
- **The two views share one scroll offset.** `#view-menu` and `#view-exam` are
  siblings in the scrolling document, so hiding one does not move the page:
  reading an arkusz down to zadanie 12 and pressing *Wybór Arkusza* left the
  picker scrolled to the same offset. `showExam` parks `window.scrollY` in
  `menuScrollY` (only when the menu is the visible view, so returning from the
  admin panel cannot clobber it) and opens the sheet at the top; `showMenu`
  restores it **after** `renderHistory()`, which appends to `#view-menu` — restore
  first and the offset is clamped to the shorter page.
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
