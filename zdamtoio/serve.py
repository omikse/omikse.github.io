"""Dev server for the app: `python serve.py` then http://localhost:8000

Same reason as tools/pdf-json/serve.py. `python -m http.server` sends
Last-Modified but no Cache-Control, so Chrome applies *heuristic freshness* and
serves exam.js / renderers.js from cache without revalidating. Edits then appear
to do nothing, and a normal reload does not help because the HTTP cache is
shared across tabs.

`Cache-Control: no-store` removes the whole class of problem. Nothing here is
for production — GitHub Pages serves the real thing.
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, test
from pathlib import Path

# Serve this folder, not the shell's working directory, so `python
# path/to/serve.py` does the right thing from anywhere.
ROOT = Path(__file__).resolve().parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    test(HandlerClass=partial(NoCacheHandler, directory=str(ROOT)), port=port, bind="127.0.0.1")
