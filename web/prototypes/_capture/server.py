"""Local capture helper for the iPad chat prototypes.

Serves ../ (the prototypes directory) over http://127.0.0.1:PORT and accepts
POST /save?name=<shot-name> with a JSON body {"dataUrl": "data:image/png;base64,..."}
written to ../shots/<name>.png.

Only used during development to take screenshots from an unsandboxed browser.
"""
import base64
import http.server
import json
import os
import sys
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, 'shots')
LOG_PATH = os.path.join(HERE, 'server.log')


def log(line):
    try:
        with open(LOG_PATH, 'a', encoding='utf-8') as fh:
            fh.write(line + '\n')
    except Exception:
        pass


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        log('HTTP ' + (fmt % args))

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            length = int(self.headers.get('Content-Length', '0') or 0)
            raw = self.rfile.read(length) if length else b''
            if parsed.path == '/save':
                name = parse_qs(parsed.query).get('name', ['unknown'])[0]
                payload = json.loads(raw.decode('utf-8'))
                data_url = payload.get('dataUrl', '')
                if ',' not in data_url:
                    raise ValueError('dataUrl missing')
                blob = base64.b64decode(data_url.split(',', 1)[1])
                os.makedirs(SHOTS, exist_ok=True)
                out = os.path.join(SHOTS, name + '.png')
                with open(out, 'wb') as fh:
                    fh.write(blob)
                log('SAVED {} {} bytes'.format(name, len(blob)))
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(b'ok')
                return
            if parsed.path == '/log':
                log('PAGE ' + raw.decode('utf-8', 'replace'))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'ok')
                return
            self.send_response(404)
            self.end_headers()
        except Exception as exc:  # noqa: BLE001 - dev helper
            log('ERROR {} {!r}'.format(parsed.path, exc))
            try:
                self.send_response(500)
                self.end_headers()
            except Exception:
                pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print('serving {} on http://127.0.0.1:{}'.format(ROOT, port), flush=True)
    server.serve_forever()
