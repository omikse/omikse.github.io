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

## Deploying

```bash
python publish.py --dry-run          # see exactly what would change
python publish.py -m "what changed"  # mirror, commit, push
```

It mirrors this folder into the `zdamtoio/` subtree of the `omikse.github.io`
clone, so deletions here become deletions there. The Pages repo holds the
history; there is deliberately no second git repo in this folder.

GitHub Pages takes a minute or two to rebuild after the push.

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
