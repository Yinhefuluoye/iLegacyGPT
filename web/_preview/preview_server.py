#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tiny static server for previewing the built Web UI + saving screenshots.

It serves the repo's ``web/`` directory (so /dist/index.html works) and adds the
two endpoints the capture page uses: POST /save?name=... and POST /log.

Usage:
    python web/_preview/preview_server.py 8766
"""

import base64
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
SHOTS = os.path.join(WEB, "prototypes", "shots")
LOG = os.path.join(SHOTS, "preview.log")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        os.makedirs(SHOTS, exist_ok=True)

        if parsed.path == "/save":
            name = parse_qs(parsed.query).get("name", ["shot"])[0]
            name = os.path.basename(name)
            path = os.path.join(SHOTS, name + ".png")
            payload = body
            # the capture page posts {"dataUrl": "data:image/png;base64,..."}
            try:
                obj = json.loads(body.decode("utf-8"))
                if isinstance(obj, dict) and isinstance(obj.get("dataUrl"), str):
                    payload = base64.b64decode(obj["dataUrl"].split(",", 1)[1])
            except Exception:
                pass
            with open(path, "wb") as fh:
                fh.write(payload)
            print("SAVED %s %d bytes" % (name, len(payload)), flush=True)
            self._send(200, b"ok")
            return

        if parsed.path == "/log":
            with open(LOG, "a", encoding="utf-8") as fh:
                fh.write(body.decode("utf-8", "replace") + "\n")
            self._send(200, b"ok")
            return

        self._send(404, b"not found")

    def _send(self, code, payload):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("serving %s on http://127.0.0.1:%d" % (WEB, port), flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()