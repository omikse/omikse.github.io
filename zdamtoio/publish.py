"""Mirror this folder into the GitHub Pages repo and push it.

    python publish.py -m "what changed"
    python publish.py --dry-run

This folder is a strict 1:1 copy of https://omikse.github.io/zdamtoio/, so
publishing is a mirror, not a merge: files removed here are removed there. Only
the `zdamtoio/` subtree of the Pages repo is ever touched.

Everything is published, including CLAUDE.md and these scripts. The repo is
public already and Pages serves them as inert text. To stop publishing a file,
add it to EXCLUDE.

The Pages repo holds the history -- there is deliberately no second git repo
here, because two repos tracking identical files only drift.
"""

import argparse
import filecmp
import hashlib
import io
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PAGES = Path(os.environ.get("PAGES_REPO", r"E:\Files\Coding\2026\omikse.github.io"))
DEST = PAGES / "zdamtoio"
PIPELINE = HERE.parent / "tools" / "pdf-json"


def reindex():
    """Rebuild exams/index.json from whatever is sitting in exams/.

    Adding an exam is meant to be "drop the folder into exams/ and publish" --
    no admin panel, no upload form. That cannot work on its own, because a
    static host cannot list a directory: the browser has no way to discover
    files, so something must write a manifest.

    This is that step, and it runs automatically on every publish. The grouping
    rules are NOT reimplemented here -- pipeline/assemble.py already knows that
    P1 + P2 of one variant and date are a single 60-point exam and R0 stands
    alone, so it is imported. Two copies of that logic would drift.
    """
    if not (PIPELINE / "pipeline" / "assemble.py").is_file():
        return None                        # pipeline absent; keep the manifest as-is
    sys.path.insert(0, str(PIPELINE))
    try:
        from pipeline.assemble import build_index
        from pipeline.common import write_json
    finally:
        sys.path.pop(0)

    index = build_index(HERE)
    write_json(HERE / "exams" / "index.json", index)
    return [e["id"] for e in index.get("exams", [])]

# Never mirrored: local noise with no business on a web server.
EXCLUDE_DIRS = {"__pycache__", ".git", ".claude", "node_modules"}
EXCLUDE_FILES = {".gitignore"}
EXCLUDE_SUFFIXES = {".pyc"}


# Every local script and stylesheet gets a ?v= stamp. This is DERIVED, never a
# hand-written list: grading.js was added after the first version of this file
# and silently went unstamped, so it imported an unstamped renderers.js (a
# second copy of the module) and edits to it did not move the hash at all --
# the precise staleness this function exists to prevent.
def stamped_files():
    return sorted(p for p in HERE.glob("*") if p.suffix in (".js", ".css"))


# `from "./progress.js"` / `import "./x.js"`, with or without an existing stamp.
IMPORT_RE = re.compile(r'(from\s+["\']\./(?:[\w.-]+)\.(?:js|css))(\?v=[0-9a-f]+)?(["\'])')


def html_re(names):
    """src="exam.js" / href="exam-styles.css" in index.html."""
    alt = "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))
    return re.compile(r'((?:src|href)="(?:' + alt + r'))(\?v=[0-9a-f]+)?(")')


def stamp_version(dry_run=False):
    """Give every module URL a content hash, so a deploy is never half-cached.

    GitHub Pages serves assets with a ten-minute max-age and offers no way to
    change it, so for ten minutes after a push a browser can be running the old
    exam.js against the new progress.js. That is not theoretical: it silently
    ate a student's answers once, and cost an hour of chasing a bug that was
    not in the code.

    The stamp is written into the SOURCE files, not injected on the way out, so
    this folder stays a byte-exact mirror of what is served. It is a content
    hash, so it only changes when the code does.
    """
    js_css = stamped_files()
    HTML_RE = html_re(p.name for p in js_css)

    digest = hashlib.sha256()
    for path in js_css:
        text = io.open(path, encoding="utf-8").read()
        # Hash the code with stamps stripped, so the version tracks content
        # rather than chasing its own tail.
        digest.update(IMPORT_RE.sub(r"\1\3", text).encode("utf-8"))
    version = digest.hexdigest()[:8]

    changed = []
    for path in js_css:
        text = io.open(path, encoding="utf-8").read()
        new = IMPORT_RE.sub(rf"\1?v={version}\3", text)
        if new != text:
            if not dry_run:
                io.open(path, "w", encoding="utf-8", newline="\n").write(new)
            changed.append(path.name)

    index = HERE / "index.html"
    if index.is_file():
        text = io.open(index, encoding="utf-8").read()
        new = HTML_RE.sub(rf"\1?v={version}\3", text)
        if new != text:
            if not dry_run:
                io.open(index, "w", encoding="utf-8", newline="\n").write(new)
            changed.append(index.name)

    return version, changed


def wanted(path):
    rel = path.relative_to(HERE)
    if any(part in EXCLUDE_DIRS for part in rel.parts):
        return False
    if path.name in EXCLUDE_FILES or path.suffix in EXCLUDE_SUFFIXES:
        return False
    return True


def mirror(dry_run):
    added, updated, removed = [], [], []

    sources = {p.relative_to(HERE): p for p in HERE.rglob("*") if p.is_file() and wanted(p)}

    for rel, src in sorted(sources.items()):
        dst = DEST / rel
        if not dst.exists():
            added.append(rel)
        elif not filecmp.cmp(src, dst, shallow=False):
            updated.append(rel)
        else:
            continue
        if not dry_run:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    if DEST.is_dir():
        for dst in sorted(p for p in DEST.rglob("*") if p.is_file()):
            rel = dst.relative_to(DEST)
            if rel not in sources:
                removed.append(rel)
                if not dry_run:
                    dst.unlink()

        # Drop directories the deletions just emptied.
        if not dry_run:
            for d in sorted((p for p in DEST.rglob("*") if p.is_dir()), reverse=True):
                if not any(d.iterdir()):
                    d.rmdir()

    return added, updated, removed


def git(*args, check=True):
    return subprocess.run(["git", "-C", str(PAGES), *args],
                          check=check, capture_output=True, text=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-m", "--message", help="commit message")
    ap.add_argument("--dry-run", action="store_true", help="show what would change")
    ap.add_argument("--no-push", action="store_true", help="commit but do not push")
    args = ap.parse_args()

    if not DEST.parent.is_dir():
        sys.exit(f"Pages repo not found at {PAGES}\nSet PAGES_REPO to override.")

    ids = reindex()
    if ids is None:
        print("  index    (pominięty — brak pdf-json obok)")
    else:
        print(f"  index    {len(ids)} arkusz(y): {', '.join(ids)}")

    version, stamped = stamp_version(args.dry_run)
    print(f"  version {version}" + (f" — restamped {', '.join(stamped)}" if stamped else " (unchanged)"))

    added, updated, removed = mirror(args.dry_run)

    for label, items in (("add", added), ("update", updated), ("remove", removed)):
        for rel in items:
            print(f"  {label:6} {rel.as_posix()}")

    if not (added or updated or removed):
        print("Already in sync — nothing to publish.")
        return

    print(f"\n{len(added)} added, {len(updated)} updated, {len(removed)} removed")

    if args.dry_run:
        print("(dry run — nothing written)")
        return

    if not args.message:
        sys.exit("Mirrored, but not committed: pass -m \"message\" to commit and push.")

    git("add", "-A", "zdamtoio")
    if not git("diff", "--cached", "--quiet", check=False).returncode:
        print("Nothing staged — working tree already matched.")
        return

    git("commit", "-m", args.message)
    print(f"Committed: {args.message}")

    if args.no_push:
        print("Not pushed (--no-push).")
        return

    git("push", "origin", "main")
    print("Pushed. https://omikse.github.io/zdamtoio/ updates in a minute or two.")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
