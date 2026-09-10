"""Статический сервер без кэширования — для тестов движка (гарантированно свежие модули)."""
import http.server
import socketserver


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", 8137), NoCacheHandler) as server:
        print("Serving on http://127.0.0.1:8137 (no-cache)")
        server.serve_forever()
