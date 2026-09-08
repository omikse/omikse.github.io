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
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PAGES = Path(os.environ.get("PAGES_REPO", r"E:\Files\Coding\2026\omikse.github.io"))
DEST = PAGES / "zdamtoio"

# Never mirrored: local noise with no business on a web server.
EXCLUDE_DIRS = {"__pycache__", ".git", ".claude", "node_modules"}
EXCLUDE_FILES = {".gitignore"}
EXCLUDE_SUFFIXES = {".pyc"}


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
