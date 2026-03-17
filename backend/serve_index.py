#!/usr/bin/env python3
"""
Minimal development server for the LobbyDog index file.

Serves the pre-built lobby-index.json with proper CORS and caching headers.
For production, use a CDN (Cloudflare R2, S3+CloudFront, etc.) instead.

Usage:
    python serve_index.py [--port 8080] [--index lobby-index.json]
"""

import argparse
import json
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler


class CORSHandler(SimpleHTTPRequestHandler):
    index_data = None
    index_path = None

    def do_GET(self):
        if self.path == "/index":
            self._serve_index()
        elif self.path == "/index/version":
            self._serve_version()
        elif self.path.startswith("/entity/"):
            self._serve_entity_redirect()
        else:
            self.send_error(404, "Not found")

    def _serve_index(self):
        self._load_index()
        data = json.dumps(self.index_data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self._cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "public, max-age=3600")
        self.send_header("Content-Length", len(data))
        self.end_headers()
        self.wfile.write(data)

    def _serve_version(self):
        mtime = os.path.getmtime(self.index_path)
        data = json.dumps({"version": str(int(mtime))}).encode("utf-8")
        self.send_response(200)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", len(data))
        self.end_headers()
        self.wfile.write(data)

    def _serve_entity_redirect(self):
        # Redirect entity detail requests to the official API
        parts = self.path.split("/")
        if len(parts) >= 3:
            entity_info = "/".join(parts[2:])
            redirect_url = f"https://www.lobbyregister.bundestag.de/sucheDetailJson?id={entity_info}"
            self.send_response(302)
            self._cors_headers()
            self.send_header("Location", redirect_url)
            self.end_headers()
        else:
            self.send_error(400, "Missing entity ID")

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _load_index(self):
        if CORSHandler.index_data is None:
            with open(CORSHandler.index_path, "r", encoding="utf-8") as f:
                CORSHandler.index_data = json.load(f)

    def log_message(self, format, *args):
        print(f"[LobbyDog] {args[0]}")


def main():
    parser = argparse.ArgumentParser(description="LobbyDog dev server")
    parser.add_argument("--port", "-p", type=int, default=8080)
    parser.add_argument("--index", "-i", default="lobby-index.json")
    args = parser.parse_args()

    CORSHandler.index_path = args.index

    if not os.path.exists(args.index):
        print(f"Error: Index file '{args.index}' not found.")
        print("Run index_builder.py first to generate it.")
        return

    server = HTTPServer(("", args.port), CORSHandler)
    print(f"LobbyDog dev server running on http://localhost:{args.port}")
    print(f"  GET /index         → lobby index")
    print(f"  GET /index/version → index version")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
