#!/usr/bin/env python3
"""Renderer-Dienst: Arbeitsblatt-Spec rein, .odt/.pdf raus.

    python3 server.py            # lauscht auf RENDERER_HOST:RENDERER_PORT (0.0.0.0:8090)

GET  /health   Version, API-Stand, ob LibreOffice da ist
POST /render   JSON {spec, course?, template?, files?, outputs?}
               → {files: {odt|loesung|pdf|loesung_pdf: base64}, warnings: [...]}

Jeder Auftrag läuft als eigener Prozess von tools/make_worksheet.py in einem
frischen Temp-Verzeichnis (ARBEITSBLATT_ROOT). Der Generator liest nur dort –
Verweise wie `file: quellcodes/x.html` kommen über `files` mit. Höchstens
RENDERER_WORKERS Aufträge laufen gleichzeitig, jeder mit eigenem
LibreOffice-Profil; der Rest wartet.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

GEN = Path(__file__).resolve().parent
TOOL = GEN / "tools" / "make_worksheet.py"
API = 1
VERSION = os.environ.get("RENDERER_VERSION", "dev")
TOKEN = os.environ.get("WORKSHEET_RENDERER_TOKEN", "")
WORKERS = max(1, int(os.environ.get("RENDERER_WORKERS", "2")))
TIMEOUT = int(os.environ.get("RENDERER_TIMEOUT", "120"))
MAX_BODY = int(os.environ.get("RENDERER_MAX_BODY_MB", "40")) * 1024 * 1024
PROFILES = Path(os.environ.get("RENDERER_PROFILE_DIR") or Path(tempfile.gettempdir()) / "worksheet-renderer")

# Ausgabe → Dateiname, den make_worksheet.py mit `-o out` für slug "blatt" schreibt.
OUTPUTS = {
    "odt": "blatt.odt",
    "loesung": "blatt_Lösung.odt",
    "pdf": "blatt.pdf",
    "loesung_pdf": "blatt_Lösung.pdf",
}
# Diese Angaben bestimmt der Dienst selbst, nicht die Spec.
RESERVED = ("template", "slug", "kuerzel")

slots: queue.Queue[int] = queue.Queue()
for _i in range(WORKERS):
    slots.put(_i)


class BadRequest(Exception):
    """Auftrag unvollständig oder unzulässig (HTTP 400)."""


class RenderFailed(Exception):
    """Der Generator ist gescheitert (HTTP 422)."""

    def __init__(self, message: str, warnings: list[str]):
        super().__init__(message)
        self.warnings = warnings


def soffice_available() -> bool:
    return bool(shutil.which("soffice") or shutil.which("libreoffice"))


def decode(value: Any, what: str) -> bytes:
    if not isinstance(value, str):
        raise BadRequest(f"{what}: base64-Text erwartet")
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise BadRequest(f"{what}: kein gültiges base64") from None


def safe_path(root: Path, name: str) -> Path:
    """Relativer Pfad unterhalb von root – nichts Absolutes, kein `..`."""
    rel = PurePosixPath(name)
    if not name or rel.is_absolute() or ".." in rel.parts or "\\" in name:
        raise BadRequest(f"Unzulässiger Dateiname: {name!r}")
    return root.joinpath(*rel.parts)


def warnings_from(stderr: str) -> list[str]:
    """Hinweise des Generators ("  ! …", "  · …") ohne Einrückung."""
    return [line.strip()[2:] for line in stderr.splitlines() if line.strip()[:2] in ("! ", "· ")]


def failure_from(stderr: str) -> str:
    lines = [line.strip() for line in stderr.splitlines() if line.strip()]
    return lines[-1] if lines else "Generator ohne Meldung abgebrochen"


def render(job: dict[str, Any], slot: int) -> tuple[dict[str, str], list[str]]:
    spec = job.get("spec")
    if not isinstance(spec, dict) or not isinstance(spec.get("content"), list):
        raise BadRequest("spec mit content-Liste erwartet")
    course = job.get("course") or {}
    if not isinstance(course, dict):
        raise BadRequest("course muss ein Objekt sein")
    outputs = job.get("outputs") or list(OUTPUTS)
    if not isinstance(outputs, list) or not outputs or any(o not in OUTPUTS for o in outputs):
        raise BadRequest(f"outputs: Auswahl aus {', '.join(OUTPUTS)}")
    files = job.get("files") or {}
    if not isinstance(files, dict):
        raise BadRequest("files muss ein Objekt {Pfad: base64} sein")

    spec = {k: v for k, v in spec.items() if k not in RESERVED}
    course = {k: v for k, v in course.items() if k not in RESERVED}

    root = Path(tempfile.mkdtemp(prefix="auftrag-"))
    try:
        for name, data in files.items():
            target = safe_path(root, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(decode(data, f"files[{name}]"))

        if job.get("template"):
            (root / "vorlage.ott").write_bytes(decode(job["template"], "template"))
            course["template"] = "vorlage.ott"
        else:
            course["template"] = "templates/Grundvorlage.ott"   # findet make_worksheet beim Generator

        (root / "kurs.yaml").write_text(yaml.safe_dump(course, allow_unicode=True), encoding="utf-8")
        (root / "blatt").mkdir(exist_ok=True)
        (root / "blatt" / "arbeitsblatt.yaml").write_text(
            yaml.safe_dump(spec, allow_unicode=True, sort_keys=False), encoding="utf-8")

        want_sheet = any(o in outputs for o in ("odt", "pdf"))
        want_solution = any(o in outputs for o in ("loesung", "loesung_pdf"))
        args = [sys.executable, str(TOOL), "blatt/arbeitsblatt.yaml", "-o", "out"]
        if want_solution:
            args.append("--loesung" if want_sheet else "--nur-loesung")
        if any(o.endswith("pdf") for o in outputs):
            if not soffice_available():
                raise RenderFailed("PDF nicht möglich: LibreOffice fehlt im Renderer", [])
            args.append("--pdf")

        env = dict(os.environ, ARBEITSBLATT_ROOT=str(root), SOFFICE_PROFILE=str(PROFILES / f"lo-{slot}"))
        try:
            proc = subprocess.run(args, cwd=root, env=env, capture_output=True, text=True, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            raise RenderFailed(f"Zeitüberschreitung nach {TIMEOUT} s", []) from None
        warnings = warnings_from(proc.stderr)
        if proc.returncode != 0:
            raise RenderFailed(failure_from(proc.stderr), warnings)

        result = {}
        for out in outputs:
            path = root / "out" / OUTPUTS[out]
            if not path.exists():
                raise RenderFailed(f"{OUTPUTS[out]} wurde nicht erzeugt", warnings)
            result[out] = base64.b64encode(path.read_bytes()).decode("ascii")
        return result, warnings
    finally:
        shutil.rmtree(root, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "worksheet-renderer"

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
        self.send_json(200, {"ok": True, "api": API, "version": VERSION,
                             "soffice": soffice_available(), "workers": WORKERS})

    def do_POST(self) -> None:
        if self.path != "/render":
            self.send_json(404, {"error": "Unbekannter Pfad"})
            return
        if TOKEN and not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {TOKEN}"):
            self.send_json(401, {"error": "Nicht berechtigt"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.send_json(413, {"error": f"Auftrag zu groß (höchstens {MAX_BODY // 1024 // 1024} MB)"})
            return
        try:
            job = json.loads(self.rfile.read(length) or b"null")
            if not isinstance(job, dict):
                raise BadRequest("JSON-Objekt erwartet")
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Kein gültiges JSON"})
            return
        except BadRequest as e:
            self.send_json(400, {"error": str(e)})
            return

        try:
            slot = slots.get(timeout=TIMEOUT)
        except queue.Empty:
            self.send_json(503, {"error": "Renderer ausgelastet, später erneut versuchen"})
            return
        try:
            files, warnings = render(job, slot)
            self.send_json(200, {"files": files, "warnings": warnings})
        except BadRequest as e:
            self.send_json(400, {"error": str(e)})
        except RenderFailed as e:
            self.send_json(422, {"error": str(e), "warnings": e.warnings})
        finally:
            slots.put(slot)

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write(f"{self.address_string()} {fmt % args}\n")


def main() -> int:
    host = os.environ.get("RENDERER_HOST", "0.0.0.0")
    port = int(os.environ.get("RENDERER_PORT", "8090"))
    if not TOKEN:
        print("! WORKSHEET_RENDERER_TOKEN nicht gesetzt – jeder im Netz kann rendern lassen", file=sys.stderr)
    PROFILES.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"worksheet-renderer {VERSION} auf {host}:{port}, {WORKERS} Arbeitsplätze, "
          f"LibreOffice: {'ja' if soffice_available() else 'nein'}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
