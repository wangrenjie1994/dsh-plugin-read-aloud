#!/usr/bin/env python3
"""Local read-aloud service: turns text into a streaming mp3 with edge-tts voices.

Binds 127.0.0.1 only. The DSH read-aloud plugin starts it and proxies it on the
DSH origin; it can also be queried directly on /health and /tts.
"""

import argparse
import asyncio
import json
import queue
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

try:
    import edge_tts
except ImportError:  # pragma: no cover - reported to the caller, not raised
    sys.stderr.write("[read-aloud] edge-tts is not installed for this Python\n")
    raise SystemExit(2)

VOICES = [
    ("zh-CN-XiaoxiaoNeural", "晓晓"),
    ("zh-CN-XiaoyiNeural", "晓伊"),
    ("zh-CN-YunxiNeural", "云希"),
    ("zh-CN-YunjianNeural", "云健"),
    ("zh-CN-YunyangNeural", "云扬"),
    ("zh-CN-liaoning-XiaobeiNeural", "晓北"),
]
DEFAULT_VOICE = VOICES[0][0]
MAX_TEXT = 4000
# Box-drawing rules, ASCII art and pure punctuation carry nothing to say and make
# the synthesizer fail, so they are refused before any synthesis work starts.
SPEAKABLE = re.compile(r"[^\W_]", re.UNICODE)


async def audio_chunks(text, voice, rate, volume, pitch):
    """Yield encoded audio pieces as edge-tts produces them."""
    communicate = edge_tts.Communicate(text, voice, rate=rate, volume=volume, pitch=pitch)
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio":
            yield chunk["data"]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "dsh-read-aloud/0.3"

    def log_message(self, fmt, *args):
        sys.stderr.write("[read-aloud] " + (fmt % args) + "\n")

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and (origin.startswith("http://127.0.0.1")
                       or origin.startswith("http://localhost")
                       or origin.startswith("http://[::1]")):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802 - http.server API
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):  # noqa: N802 - http.server API
        url = urlparse(self.path)
        query = parse_qs(url.query)
        if url.path == "/health":
            self._json(200, {"ok": True, "voices": [{"id": v, "label": l} for v, l in VOICES]})
            return
        if url.path != "/tts":
            self._json(404, {"error": "not found"})
            return
        text = query.get("text", [""])[0].strip()
        if not text:
            self._json(400, {"error": "text is required"})
            return
        if SPEAKABLE.search(text) is None:
            self._json(400, {"error": "text has no speakable characters"})
            return
        voice = query.get("voice", [DEFAULT_VOICE])[0]
        if voice not in {v for v, _ in VOICES}:
            voice = DEFAULT_VOICE
        rate = query.get("rate", ["+0%"])[0]
        volume = query.get("volume", ["+0%"])[0]
        pitch = query.get("pitch", ["+0Hz"])[0]
        self._stream(text[:MAX_TEXT], voice, rate, volume, pitch)

    def _stream(self, text, voice, rate, volume, pitch):
        """Send headers once the first audio piece exists, then stream the rest."""
        pieces = queue.Queue()

        def worker():
            async def run():
                async for piece in audio_chunks(text, voice, rate, volume, pitch):
                    pieces.put(piece)

            try:
                asyncio.run(run())
            except Exception as error:  # noqa: BLE001 - forwarded to the caller
                pieces.put(error)
            finally:
                pieces.put(None)

        threading.Thread(target=worker, daemon=True).start()
        headers_sent = False
        try:
            while True:
                item = pieces.get()
                if item is None:
                    break
                if isinstance(item, Exception):
                    raise item
                if not headers_sent:
                    self.send_response(200)
                    self._cors()
                    self.send_header("Content-Type", "audio/mpeg")
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    self.close_connection = True
                    headers_sent = True
                self.wfile.write(item)
                self.wfile.flush()
        except Exception as error:  # noqa: BLE001 - reported to the caller
            sys.stderr.write("[read-aloud] synthesis failed: %r\n" % (error,))
            if not headers_sent:
                self._json(502, {"error": "synthesis failed", "detail": str(error)})
            return
        if not headers_sent:
            self._json(502, {"error": "empty audio"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=17865)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    sys.stderr.write("[read-aloud] listening on http://127.0.0.1:%d\n" % args.port)
    sys.stderr.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
