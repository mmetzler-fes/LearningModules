"""HTTP-Dienst: PDF -> Dokument mit KI-Erkennung (docling), für LearningModules.

GET  /health   -> {"ok": true, "version": "...", "ocr": true, "busy": false}
POST /convert  {"pdf": "<base64>", "ocr": false}
               -> {"spec": {...}, "title": "...", "warnings": [...]} | {"error": "..."}

Die Modelle werden einmal geladen und bleiben im Speicher; gerechnet wird
immer nur ein Auftrag zur Zeit (PDF_AI_WORKERS), weitere warten bis zu
PDF_AI_WAIT Sekunden. Gehört ins interne Netz, ohne Port nach außen.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import convert

VERSION = os.environ.get("PDF_AI_VERSION", "dev")
TOKEN = os.environ.get("PDF_AI_TOKEN", "")
WORKERS = max(1, int(os.environ.get("PDF_AI_WORKERS", "1")))
WAIT = int(os.environ.get("PDF_AI_WAIT", "300"))
MAX_BODY = int(os.environ.get("PDF_AI_MAX_BODY_MB", "60")) * 1024 * 1024

slots = threading.BoundedSemaphore(WORKERS)
busy = 0


class Handler(BaseHTTPRequestHandler):
    server_version = "pdf-ai"

    def send_json(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(404, {"error": "Unbekannter Pfad"})
            return
        self.send_json(200, {"ok": True, "version": VERSION, "ocr": True, "busy": busy >= WORKERS})

    def do_POST(self) -> None:
        global busy
        if self.path != "/convert":
            self.send_json(404, {"error": "Unbekannter Pfad"})
            return
        if TOKEN and not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {TOKEN}"):
            self.send_json(401, {"error": "Nicht berechtigt"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.send_json(413, {"error": f"PDF zu groß (höchstens {MAX_BODY // 1024 // 1024} MB)"})
            return
        try:
            job = json.loads(self.rfile.read(length) or b"null")
            data = base64.b64decode(job["pdf"], validate=True)
        except (json.JSONDecodeError, UnicodeDecodeError, KeyError, TypeError, binascii.Error, ValueError):
            self.send_json(400, {"error": "Erwartet: {\"pdf\": \"<base64>\"}"})
            return
        if not slots.acquire(timeout=WAIT):
            self.send_json(503, {"error": "Die KI-Erkennung ist ausgelastet – bitte gleich noch einmal."})
            return
        busy += 1
        try:
            spec, warnings, title = convert.pdf_to_spec(data, bool(job.get("ocr")))
            self.send_json(200, {"spec": spec, "title": title, "warnings": warnings})
        except convert.ConvertError as e:
            self.send_json(422, {"error": str(e)})
        except Exception as e:  # noqa: BLE001 – der Dienst soll weiterlaufen
            print(f"! {type(e).__name__}: {e}", file=sys.stderr)
            self.send_json(422, {"error": "Das PDF ließ sich nicht erkennen."})
        finally:
            busy -= 1
            slots.release()

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write(f"{self.address_string()} {fmt % args}\n")


def main() -> int:
    host = os.environ.get("PDF_AI_HOST", "0.0.0.0")
    port = int(os.environ.get("PDF_AI_PORT", "8091"))
    if not TOKEN:
        print("! PDF_AI_TOKEN nicht gesetzt – jeder im Netz kann den Dienst nutzen", file=sys.stderr)
    if os.environ.get("PDF_AI_PRELOAD", "1") == "1":
        # Modelle vorab laden – sonst dauert der erste Auftrag spürbar länger.
        convert.converter(False)
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"pdf-ai auf {host}:{port} ({WORKERS} Platz/Plätze)", file=sys.stderr)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
