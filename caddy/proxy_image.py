#!/usr/bin/env python3
"""轻量图片代理：通过 Clash 转发 Google CDN 图片（国内 CDN 被墙）。"""
import os, urllib.request, http.server

PORT = int(os.environ.get("PORT", "18888"))
UPSTREAM = os.environ.get("UPSTREAM", "https://lh3.googleusercontent.com")
TRUSTED = ("lh3.googleusercontent.com", "lh3.ggpht.com", "work.fife.usercontent.google.com")

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        # GET /proxy-image?src=https://lh3.googleusercontent.com/gg-dl/...
        if not self.path.startswith("/proxy-image"):
            self.send_error(404)
            return
        src = urllib.parse.urlparse(self.path.split("?", 1)[1]).query.split("=", 1)[-1]
        host = urllib.parse.urlparse(src).hostname or ""
        if host not in TRUSTED:
            self.send_error(403, "untrusted host")
            return
        try:
            req = urllib.request.Request(
                src,
                headers={"Referer": "https://gemini.google.com/", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"},
            )
            resp = urllib.request.urlopen(req, timeout=30)
            data = resp.read()
            self.send_response(200)
            self.send_header("Content-Type", resp.headers.get("Content-Type", "image/jpeg"))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_error(502, str(e))
    def log_message(self, fmt, *args):
        pass  # quiet

if __name__ == "__main__":
    http.server.HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
