"""Статический сервер без кэширования + POST /save для сохранения спрайтшитов
из редактора (engine/editor.html). Только стандартная библиотека.

POST /save  JSON {"name": "knight_64.png", "data": "data:image/png;base64,..."}
→ пишет файл в images/sprites/<name> (имя строго ограничено, без путей).
"""
import base64
import json
import re
import socketserver
from http.server import SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SPRITES_DIR = ROOT / "images" / "sprites"
SAFE_NAME = re.compile(r"^[\w\-]+\.png$")


class EditorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/save":
            self._json(404, {"error": "unknown endpoint"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length))
            name = payload.get("name", "")
            data = payload.get("data", "")
            if not SAFE_NAME.match(name):
                self._json(400, {"error": "bad name"})
                return
            base64_data = data.split(",", 1)[-1]
            SPRITES_DIR.mkdir(parents=True, exist_ok=True)
            target = SPRITES_DIR / name
            target.write_bytes(base64.b64decode(base64_data))
            self._json(200, {"saved": f"images/sprites/{name}", "bytes": target.stat().st_size})
        except Exception as error:  # noqa: BLE001 — серверу отвечаем JSON-ом на любую ошибку
            self._json(500, {"error": str(error)})


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", 8137), EditorHandler) as server:
        print("Serving on http://127.0.0.1:8137 (no-cache + POST /save)")
        server.serve_forever()
