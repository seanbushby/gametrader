#!/usr/bin/env python3
"""Small read-only HTTP server for Bot Lab candle queries."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from candle_api import RequestError, dispatch


class Handler(BaseHTTPRequestHandler):
    server_version = "GameTraderCandleAPI/1.0"

    def _headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()

    def do_OPTIONS(self):
        self._headers(204)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/v1/health":
            self._headers()
            self.wfile.write(b'{"ok":true,"readOnly":true}')
            return
        if parsed.path != "/v1/candles":
            self._headers(404)
            self.wfile.write(b'{"error":"Not found"}')
            return
        try:
            payload = dispatch(parse_qs(parsed.query))
            status = 200
        except RequestError as error:
            payload = {"error": str(error)}
            status = 400
        except Exception:
            payload = {"error": "Candle data is temporarily unavailable"}
            status = 500
        self._headers(status)
        self.wfile.write(json.dumps(payload, separators=(",", ":")).encode("utf-8"))

    def log_message(self, fmt, *args):
        return


def main():
    host = os.environ.get("GAMETRADER_CANDLE_HOST", "0.0.0.0")
    port = int(os.environ.get("GAMETRADER_CANDLE_PORT", "5003"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
