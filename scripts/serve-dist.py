#!/usr/bin/env python3
"""Static server for Ghost Gift dist/. Explicit media MIME types, Range support, no frame-blocking headers."""

from __future__ import annotations

import argparse
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

mimetypes.init()
mimetypes.add_type("video/webm", ".webm")
mimetypes.add_type("video/mp4", ".mp4")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/wasm", ".wasm")


def make_handler(root: Path):
    class DistHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def end_headers(self):
            path = self.path.split("?", 1)[0]
            if path.endswith((".webm", ".mp4", ".webp", ".jpg", ".jpeg", ".png", ".svg", ".woff2")):
                self.send_header("Cache-Control", "public, max-age=86400")
            else:
                self.send_header("Cache-Control", "no-cache")
            # Telegram WebView may embed the Mini App; do not send X-Frame-Options.
            super().end_headers()

        def log_message(self, fmt, *args):
            super().log_message(fmt, *args)

    return DistHandler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4180)
    args = parser.parse_args()
    root = Path(args.root).resolve()
    if not root.is_dir():
        raise SystemExit(f"dist root not found: {root}")

    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(root))
    print(f"serving {root} on http://{args.host}:{args.port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
