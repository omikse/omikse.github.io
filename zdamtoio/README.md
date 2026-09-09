# zdamto.io — aplikacja webowa

Student-facing matura trainer, live at **https://omikse.github.io/zdamtoio/**.

Google sign-in → pick a CKE exam → solve it → answers and grading are saved, so
coming back later shows what you wrote and how it scored.

This folder is a **strict 1:1 copy of the deployed site**. No build step: edit
here, run `python publish.py`, done.

```
web_claude/                ==  https://omikse.github.io/zdamtoio/
  index.html               app shell — header, sign-in gate, exam menu
  auth.js                  Google sign-in, writes users/{uid}
  exam.js                  loads exams, drives the renderer registry
  progress.js              attempts: save, resume, history
  admin.js                 exam catalogue (admin only)
  firestore.rules          access rules — published by hand via the console

  renderers.js             GENERATED — question types: render/collect/grade
  exam-styles.css          GENERATED — styling for rendered questions
  exams/                   GENERATED — 6 exams, 9 booklets, ~1.6 MB

  serve.py                 local dev server (no-cache)
  sync.py                  pull generated files from ../tools/pdf-json
  publish.py               mirror to the Pages repo, commit, push
  CLAUDE.md                the rules — read before changing anything
```

## Running it locally

```bash
python serve.py
```

Then http://localhost:8000. Use this, not `python -m http.server` — that one
sends no `Cache-Control` and Chrome will serve you a stale `exam.js` while you
wonder why your edit did nothing.

`localhost` is an authorized Firebase domain, so sign-in works locally.

## Where the exams come from

They are produced by the conversion pipeline in `../tools/pdf-json` (CKE PDF →
structured JSON) and copied here:

```bash
python sync.py
```

That pulls `renderers.js`, `styles.css` and every in-scope booklet with its
images. Those files are **derived** — editing them here is pointless, the next
sync overwrites them. Fix things in `pdf-json` instead.

### Adding one exam by hand

Drop the folder into `exams/` and publish. Nothing else:

```
exams/MPOP-R0-100-2205/
    MPOP-R0-100-2205.json     # named after the folder
    assets/                   # optional, only if the paper has images
```

`publish.py` rebuilds `exams/index.json` from whatever is in `exams/`, so the
sheet appears in the menu on its own. There is no upload form and no "add exam"
button in the admin panel — the folder *is* the interface.

The manifest exists because **a static host cannot list a directory**: the
browser has no way to discover files, so something has to write down what is
there. That something runs on every publish, not on the server.

Two things the folder name has to get right, because the app reads meaning from
it: `<SUBJECT>-<LEVEL>-<VARIANT>-<SESSION>`, and only the standard `100`
variant is listed. `P1` + `P2` of one variant and date are joined into a single
60-point exam; `R0` stands alone.

## Deploying

```bash
python publish.py --dry-run          # see exactly what would change
python publish.py -m "what changed"  # mirror, commit, push
```

It mirrors this folder into the `zdamtoio/` subtree of the `omikse.github.io`
clone, so deletions here become deletions there. The Pages repo holds the
history; there is deliberately no second git repo in this folder.

GitHub Pages takes a minute or two to rebuild after the push.

## Solving an exam

Clicking an exam card opens it in **tryb nauki**: answer in any order, check any
question whenever, and "Podsumowanie" totals it up without locking anything.

The small **⏱ 240 min** button on the card starts **tryb egzaminacyjny** instead:
a countdown runs, checking answers is disabled until you finish, and "Zakończ
egzamin" (or the clock running out) closes the sheet and shows the result. The
countdown is stored as an absolute deadline, so closing the tab does not pause
it — but it is checked in the browser, so it is a practice clock, not
invigilation.

Either way the summary gives the total, split into Arkusz 1 and the
wypracowanie, and **Rozwiąż ponownie** archives the attempt and starts over.

Two ways to be marked: **Sprawdź** under each question, or **Sprawdź cały
arkusz** at the foot of the sheet. The second says how many API calls it will
cost before spending any — a podstawowa paper is about 23.

Each question is headed the way CKE prints it: a lavender bar reading
*Zadanie 3. (0–2)*, and out in the margin the examiner's stack — the number, the
marks available, and an empty box. The box stays empty until that question is
graded, then the points appear in it. The sizes and colours are measured off the
rendered booklet, not chosen; see DOCUMENTATION.md §14 before touching them.

## Grading, honestly

- **Closed questions** (`P-TF`, `P-CHOICE`) — graded by comparison in the
  browser. Exact, instant, free, no model involved.
- **Open questions** — graded by `gemini-2.5-flash` using the prompts the
  pipeline generates, with the student's own API key.
- **Wypracowanie** — eight per-criterion AI calls produce *raw* values only. The
  deterministic aggregator that turns those into an official score does not
  exist yet, so the essay result is labelled diagnostic, not a real score. The
  stored shape already matches the spec, so building the aggregator later fills
  it in without a migration.

Gemini's free tier is 20 requests/day, so a whole exam cannot be graded in one
sitting. Grading is per question, on demand.
