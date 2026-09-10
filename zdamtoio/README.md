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
  sync.py                  pull generated files from ../tools/*
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

The toolchain upstream of this folder is two separate components:

| | what it owns |
|---|---|
| `../tools/pdf-json` | the **converter** — CKE PDF → structured exam JSON, and the exam data itself |
| `../tools/web-renderer` | the **renderer** — `renderers.js` + `styles.css`: how a question renders, collects an answer, and is graded |

One command pulls from both:

```bash
python sync.py
```

That copies `renderers.js` and `styles.css` (as `exam-styles.css`) from the
renderer, and every in-scope booklet with its images from the converter. Those
files are **derived** — editing them here is pointless, the next sync overwrites
them. Fix a question type or its styling in `web-renderer`; fix the exam data in
`pdf-json`.

**Rozszerzona really is one zadanie.** The poziom rozszerzony paper is a single
wypracowanie worth 35 pkt with no test section — its own instructions say so
(*"W wyznaczonym miejscu zapisz numer tematu… Wypracowanie zapisz w miejscu na
to przeznaczonym"*), and the 18 printed pages are the two topics, the reading
list and lined answer space. Cards therefore say **wypracowanie** rather than
"1 zadanie", which read like a failed import. Podstawowa says "17 zadań +
wypracowanie" for the same reason: its question count includes the essay,
because CKE numbers it straight on from Arkusz 1. The wording comes from `kind`
in the manifest (`describeContents` in `exam.js`) and matches the renderer
harness, so the two cannot drift.

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
cost before spending any — a podstawowa paper is 20–23 depending on the year,
the wypracowanie's eight included.

Each question is headed the way CKE prints it: a lavender bar reading
*Zadanie 3. (0–2)*, and in the left margin the examiner's stack — the number,
the marks available, and the box the score goes in.

**That box is the button.** Click it and the question is marked; the score
appears in the same place. It carries one of two marks, because there are two
mechanisms: **klucz CKE** where the answer is compared against CKE's key (no
model involved), and **punkt AI™** where a model does the grading — ours, not
CKE's. The wypracowanie also keeps its labelled button at the foot of the card,
since that one spends eight API calls.

The rozszerzony paper is the exception: it is one wypracowanie, so it drops the
margin stack entirely and keeps a single button at the foot of the card — the
sheet-level *Sprawdź cały arkusz* is not shown there either, since one question
*is* the whole arkusz. Its summary likewise shows only *Wypracowanie*, not an
empty *Arkusz 1* row.

The sizes and colours are measured off the rendered booklet, not chosen; see
DOCUMENTATION.md §14 before touching them.

## Grading, honestly

- **Questions with an exact key** (`P-TF`, `P-CHOICE`, and `P-TABLE-MATCH`
  wherever its key lines up one-to-one with the rows) — graded by comparison in
  the browser. Exact, instant, free, no model involved. A `P-TABLE-MATCH` whose
  rubric offers partial credit, or whose key cannot be read as pairs, falls back
  to the model rather than guessing.
- **Open questions** — graded by `gemini-2.5-flash` using the prompts the
  renderer generates, with the student's own API key.
- **Wypracowanie** — eight per-criterion AI calls produce *raw* values only
  (error counts, classifications); `aggregateEssay()` turns them into points
  using the matrix, thresholds and gating rules carried in the exam JSON. A
  model is never asked for a total.

⚠️ **One run is not the score.** The same essay graded twice minutes apart came
back 31/35 and then 34/35 — Kryterium 3a flipped between 0 and 3 points. The
aggregator is deterministic, so that spread is entirely what the model reported.
Treat a single essay result as an estimate.

Gemini's free tier is 20 requests/day, so a whole exam cannot be graded in one
sitting. Grading is per question, on demand.
