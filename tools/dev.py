#!/usr/bin/env python3
"""Local preview server with in-page editing. Not part of the deployed site.

Usage: python3 tools/dev.py [port]

Serves the repo like `python3 -m http.server`, with two additions:
- the home page gets tools/edit.js added, which puts an "Edit" button on it
- POST /__save takes the edited contents of <main> and writes them back into
  index.html, then rebuilds index.md

Nothing in index.html refers to this. On GitHub Pages the page has no editor.
"""
import json, os, re, subprocess, sys, tempfile, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / 'index.html'
BACKUPS = Path(os.environ.get('EDIT_BACKUPS') or Path(tempfile.gettempdir()) / 'homepage-edit-backups')
MAIN = re.compile(r'(<main id="content">).*?(</main>)', re.S)
INJECT = '<script type="module" src="/tools/edit.js"></script>\n</body>'
last_backup = 0


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.path.split('?')[0].split('#')[0] in ('/', '/index.html'):
            rev = f'<meta name="edit-rev" content="{INDEX.stat().st_mtime_ns}">\n'
            body = INDEX.read_text().replace('</body>', rev + INJECT).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        global last_backup
        try:
            # the custom header keeps other websites from posting here
            if self.path != '/__save' or self.headers.get('X-Edit') != '1':
                raise ValueError('not found')
            n = int(self.headers.get('Content-Length', 0))
            if not 0 < n < 400_000:
                raise ValueError('bad size')
            req = json.loads(self.rfile.read(n))
            main = req['main']
            # someone else (another tab, or an agent) changed index.html after this page loaded it
            if str(req.get('rev')) != str(INDEX.stat().st_mtime_ns):
                raise ValueError('index.html changed since this page loaded. Reload, then redo the edit.')
            if 'class="card"' not in main or '</main>' in main or '<script' in main.lower():
                raise ValueError('that does not look like the page')
            old = INDEX.read_text()
            new, count = MAIN.subn(lambda m: m.group(1) + main + m.group(2), old)
            if count != 1:
                raise ValueError('no <main id="content"> in index.html')
            if new != old:
                if time.time() - last_backup > 120:
                    BACKUPS.mkdir(parents=True, exist_ok=True)
                    (BACKUPS / time.strftime('index-%Y%m%d-%H%M%S.html')).write_text(old)
                    last_backup = time.time()
                tmp = INDEX.with_suffix('.html.tmp')
                tmp.write_text(new)
                tmp.replace(INDEX)
                subprocess.run([sys.executable, str(ROOT / 'tools' / 'build_md.py')], check=True, capture_output=True)
            out, code = {'ok': True, 'rev': str(INDEX.stat().st_mtime_ns)}, 200
        except Exception as e:  # report it to the page
            out, code = {'ok': False, 'error': str(e)}, 400
        body = json.dumps(out).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5211
    print(f'http://localhost:{port}/  (editing on, backups in {BACKUPS})')
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
