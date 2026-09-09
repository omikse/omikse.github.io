"""Pull generated artefacts from the toolchain into this folder.

    python sync.py

Two upstream components, each the owner of what it produces:

    renderers.js            <- tools/web-renderer/renderers.js
    exam-styles.css         <- tools/web-renderer/styles.css
    exams/index.json        <- tools/pdf-json/exams/index.json
    exams/<part>/*.json     <- the booklet deliverables it lists
    exams/<part>/assets/    <- the extracted illustrations

The renderer renders; the converter owns the exam data. Direction is deliberate:
neither knows anything about this folder, so both can keep moving on their own
branch. Everything copied here is DERIVED -- never edit it in place, fix it
upstream and re-run this.

Scope is the standard `100` papers only, matching pdf-json/CLAUDE.md. Any part
whose id carries an adapted-variant code is skipped loudly rather than silently.

UTF-8 is pinned on every read, write and on stdout: Windows still defaults to
cp1252 and the Polish exam text is full of characters it cannot encode.
"""

import io
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent / "tools"
SRC = TOOLS / "pdf-json"          # the converter: exam data
RENDERER = TOOLS / "web-renderer" # the renderer: renderers.js + styles.css

IN_SCOPE_VARIANT = "100"


def read_json(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def is_in_scope(part_id):
    """MPOP-P1-100-2305 -> in scope. MPOP-P1-200-700-2505 -> adapted, skip.

    The variant sits in the third segment; adapted papers add further codes, so
    a standard id is exactly four segments ending in the session date.
    """
    bits = part_id.split("-")
    return len(bits) == 4 and bits[2] == IN_SCOPE_VARIANT


def copy_file(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return src.stat().st_size


def copy_tree(src, dst):
    if not src.is_dir():
        return 0, 0
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    files = [p for p in dst.rglob("*") if p.is_file()]
    return sum(p.stat().st_size for p in files), len(files)


def main():
    if not SRC.is_dir():
        sys.exit(f"the converter is not at {SRC}")
    if not RENDERER.is_dir():
        sys.exit(f"the renderer is not at {RENDERER}")

    total = 0

    for src_name, dst_name in (("renderers.js", "renderers.js"),
                               ("styles.css", "exam-styles.css")):
        src = RENDERER / src_name
        if not src.is_file():
            sys.exit(f"missing {src}")
        total += copy_file(src, HERE / dst_name)
        print(f"  {dst_name:24} <- {src_name}")

    index_src = SRC / "exams" / "index.json"
    if not index_src.is_file():
        sys.exit(f"missing {index_src}\nRun `python -m pipeline index` in pdf-json first.")

    # The manifest is deliberately NOT copied: publish.py rebuilds it by
    # scanning exams/, so copying the pipeline's version over the top would
    # delete any exam dropped in by hand. It silently did exactly that once.
    # The pipeline's copy is still read, to know which booklets to pull.
    index = read_json(index_src)

    kept = skipped = 0
    for exam in index.get("exams", []):
        for part in exam.get("parts", []):
            part_id = part.get("id", "")
            if not is_in_scope(part_id):
                print(f"  SKIP {part_id} (adapted variant, out of scope)")
                skipped += 1
                continue

            # Paths in index.json are relative to the pdf-json root, and this
            # folder mirrors that layout, so they stay valid unrewritten.
            total += copy_file(SRC / part["path"], HERE / part["path"])
            size, count = copy_tree(SRC / part["assets"], HERE / part["assets"])
            total += size
            print(f"  {part_id:24} json + {count} asset file(s)")
            kept += 1

    print(f"\nSynced {kept} booklet(s), {total / 1024 / 1024:.2f} MB"
          + (f", skipped {skipped} out of scope" if skipped else ""))

    # Leave the manifest describing what is actually on disk here, including
    # anything added by hand -- the same rebuild publish.py performs, so the
    # two paths always agree.
    from publish import reindex
    ids = reindex()
    if ids is not None:
        print(f"Manifest: {len(ids)} arkusz(y) — {', '.join(ids)}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
