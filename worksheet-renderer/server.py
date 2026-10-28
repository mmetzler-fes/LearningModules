#!/usr/bin/env python3
"""Renderer-Dienst: Arbeitsblatt-Spec rein, .odt/.pdf raus.

    python3 server.py            # lauscht auf RENDERER_HOST:RENDERER_PORT (0.0.0.0:8090)

GET  /health   Version, API-Stand, ob LibreOffice da ist
POST /render   JSON {spec, course?, template?, files?, outputs?}
               → {files: {odt|loesung|pdf|loesung_pdf: base64}, warnings: [...]}
POST /inspect  JSON {template} → Platzhalter und Formatvorlagen einer .ott
POST /render-script  JSON {sheets: [{titel, spec}], course?, skript?, template?, files?, outputs?}
               → Skript (Kompendium) aus mehreren Blättern, wie make_script.py
POST /convert-odt    JSON {file, name} → {odt: base64}: Word-Datei (.docx, .doc, .rtf)
               mit LibreOffice nach .odt – für den .odt-Import der App
POST /export-drawings JSON {odt} → {odt: base64, drawings: [{name, svg, odg, width_mm, height_mm}], warnings}:
               Zeichnungen, wie LibreOffice sie zeichnet; im Dokument heißen sie lmdraw-<n>
               (tools/export_drawings.py, braucht python3-uno) – für den .odt-Import der App
POST /render-drawing JSON {odg} → {svg, width_mm, height_mm}: bearbeitete Zeichnung (LibreOffice Draw)
               wieder als SVG – für Zeichnungen, die Lehrkräfte in der Nextcloud ändern
POST /export-pdf-figures JSON {pdf, page, figures: [{id, box, skip}]} → {figures: [{id, svg, odg, width_mm, height_mm}], warnings}:
               Bildbereiche einer PDF-Seite als gruppierte Zeichnungen (tools/pdf_figures.py) –
               für den PDF-Import mit „Schaubilder als Zeichnung“

Jeder Auftrag läuft als eigener Prozess von tools/make_worksheet.py in einem
frischen Temp-Verzeichnis (ARBEITSBLATT_ROOT). Der Generator liest nur dort –
Verweise wie `file: quellcodes/x.html` kommen über `files` mit. Höchstens
RENDERER_WORKERS Aufträge laufen gleichzeitig, jeder mit eigenem
LibreOffice-Profil; der Rest wartet.
"""

from __future__ import annotations

import base64
import binascii
import io
import re
import zipfile
import hmac
import json
import os
import queue
import resource
import shutil
import subprocess
import sys
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

GEN = Path(__file__).resolve().parent
TOOL = GEN / "tools" / "make_worksheet.py"
SCRIPT_TOOL = GEN / "tools" / "make_script.py"
PDF_TOOL = GEN / "tools" / "pdf_import.py"
DRAWINGS_TOOL = GEN / "tools" / "export_drawings.py"
FIGURES_TOOL = GEN / "tools" / "pdf_figures.py"
# Das Python mit der UNO-Anbindung von LibreOffice (Paket python3-uno) – nicht das des Servers.
UNO_PYTHON = os.environ.get("RENDERER_UNO_PYTHON", "/usr/bin/python3")
MAX_DRAWING_BYTES = 30 * 1024 * 1024
API = 2
VERSION = os.environ.get("RENDERER_VERSION", "dev")
TOKEN = os.environ.get("WORKSHEET_RENDERER_TOKEN", "")
WORKERS = max(1, int(os.environ.get("RENDERER_WORKERS", "2")))
TIMEOUT = int(os.environ.get("RENDERER_TIMEOUT", "120"))
MAX_BODY = int(os.environ.get("RENDERER_MAX_BODY_MB", "40")) * 1024 * 1024
# Obergrenze für den Speicher eines PDF-Imports – ein bösartiges oder riesiges
# PDF soll den Prozess beenden, nicht den Container oder gar den Host.
PDF_MEM = int(os.environ.get("RENDERER_PDF_MEM_MB", "1024")) * 1024 * 1024
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


PLACEHOLDER_RE = re.compile(r"\{\{\s*([A-Za-z0-9_.]+)\s*\}\}")


def inspect_template(data: bytes) -> dict[str, Any]:
    """Platzhalter ({{TITEL}}, {{INHALT}} …) und Absatzvorlagen einer Vorlage."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        styles = z.read("styles.xml").decode("utf-8", "replace")
        content = z.read("content.xml").decode("utf-8", "replace")
    except (zipfile.BadZipFile, KeyError):
        raise BadRequest("Keine LibreOffice-Vorlage (.ott/.odt)")
    # Platzhalter können über mehrere Textstücke verteilt sein – Tags vorher entfernen.
    plain = re.sub(r"<[^>]+>", "", styles + content)
    names = sorted(set(PLACEHOLDER_RE.findall(plain)))
    paragraph = sorted({m.group(1) for tag in re.findall(r"<style:style\b[^>]*>", styles)
                        if 'style:family="paragraph"' in tag for m in [re.search(r'style:name="([^"]+)"', tag)] if m})
    return {"placeholders": names, "hasTitle": "TITEL" in names, "hasContent": "INHALT" in names,
            "paragraphStyles": paragraph}


def render_script(job: dict[str, Any], slot: int) -> tuple[dict[str, str], list[str]]:
    """Mehrere Blätter → Skript. Blatt n liegt in NN/arbeitsblatt.yaml; seine
    Dateien kommen über files als „NN/…“ mit."""
    sheets = job.get("sheets")
    if not isinstance(sheets, list) or not sheets or not all(isinstance(x, dict) and isinstance(x.get("spec"), dict) for x in sheets):
        raise BadRequest("sheets: Liste von {titel, spec} erwartet")
    course = job.get("course") or {}
    skript = job.get("skript") or {}
    outputs = job.get("outputs") or list(OUTPUTS)
    if not isinstance(outputs, list) or any(o not in OUTPUTS for o in outputs):
        raise BadRequest(f"outputs: Auswahl aus {', '.join(OUTPUTS)}")
    files = job.get("files") or {}
    course = {k: v for k, v in course.items() if k not in RESERVED and k != "skript_template"} if isinstance(course, dict) else {}
    root = Path(tempfile.mkdtemp(prefix="skript-"))
    try:
        for name, data in (files.items() if isinstance(files, dict) else []):
            target = safe_path(root, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(decode(data, f"files[{name}]"))
        if job.get("template"):
            (root / "vorlage.ott").write_bytes(decode(job["template"], "template"))
            course["skript_template"] = "vorlage.ott"
        (root / "kurs.yaml").write_text(yaml.safe_dump(course, allow_unicode=True), encoding="utf-8")
        folders = []
        for i, sheet in enumerate(sheets, start=1):
            folder = f"{i:02d}"
            folders.append(folder)
            spec = {k: v for k, v in sheet["spec"].items() if k not in RESERVED}
            spec["titel"] = str(sheet.get("titel") or spec.get("titel") or folder)
            (root / folder).mkdir(exist_ok=True)
            (root / folder / "arbeitsblatt.yaml").write_text(yaml.safe_dump(spec, allow_unicode=True, sort_keys=False), encoding="utf-8")
        (root / "skripte").mkdir()
        sk = {"titel": str(skript.get("titel") or "Skript"), "slug": "skript", "blaetter": folders}
        if skript.get("kopfzeile"):
            sk["kopfzeile"] = str(skript["kopfzeile"])
        (root / "skripte" / "skript.yaml").write_text(yaml.safe_dump(sk, allow_unicode=True), encoding="utf-8")

        args = [sys.executable, str(SCRIPT_TOOL), "skripte/skript.yaml", "-o", "out"]
        if any(o in outputs for o in ("loesung", "loesung_pdf")):
            args.append("--loesung")
        if any(o.endswith("pdf") for o in outputs):
            if not soffice_available():
                raise RenderFailed("PDF nicht möglich: LibreOffice fehlt im Renderer", [])
            args.append("--pdf")
        env = dict(os.environ, ARBEITSBLATT_ROOT=str(root), SOFFICE_PROFILE=str(PROFILES / f"lo-{slot}"))
        try:
            proc = subprocess.run(args, cwd=root, env=env, capture_output=True, text=True, timeout=TIMEOUT * 2)
        except subprocess.TimeoutExpired:
            raise RenderFailed(f"Zeitüberschreitung nach {TIMEOUT * 2} s", []) from None
        warnings = warnings_from(proc.stderr)
        if proc.returncode != 0:
            raise RenderFailed(failure_from(proc.stderr), warnings)
        names = {"odt": "skript.odt", "loesung": "skript_Lösung.odt", "pdf": "skript.pdf", "loesung_pdf": "skript_Lösung.pdf"}
        result = {}
        for out in outputs:
            path = root / "out" / names[out]
            if not path.exists():
                raise RenderFailed(f"{names[out]} wurde nicht erzeugt", warnings)
            result[out] = base64.b64encode(path.read_bytes()).decode("ascii")
        return result, warnings
    finally:
        shutil.rmtree(root, ignore_errors=True)


# Was /convert-odt annimmt – LibreOffice erkennt das Format am Inhalt, die
# Endung entscheidet nur, welche Dateien wir überhaupt hineinlassen.
CONVERT_EXT = (".docx", ".doc", ".rtf")


def convert_odt(job: dict[str, Any], slot: int) -> dict[str, str]:
    """Word-Datei → .odt (soffice --convert-to odt) mit eigenem Profil je Arbeitsplatz."""
    data = decode(job.get("file"), "file")
    ext = Path(str(job.get("name") or "")).suffix.lower()
    if ext not in CONVERT_EXT:
        raise BadRequest(f"Umwandeln nur für {', '.join(CONVERT_EXT)}")
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise RenderFailed("Umwandeln nicht möglich: LibreOffice fehlt im Renderer", [])
    root = Path(tempfile.mkdtemp(prefix="umwandeln-"))
    try:
        src = root / f"dokument{ext}"
        src.write_bytes(data)
        profile = (PROFILES / f"lo-{slot}").resolve().as_uri()
        try:
            proc = subprocess.run([soffice, f"-env:UserInstallation={profile}", "--headless",
                                   "--convert-to", "odt", "--outdir", str(root / "out"), str(src)],
                                  capture_output=True, text=True, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            raise RenderFailed(f"Umwandeln braucht zu lange (über {TIMEOUT} s).", []) from None
        out = root / "out" / "dokument.odt"
        if not out.exists():
            sys.stderr.write(f"Umwandeln gescheitert, Rückgabe {proc.returncode}:\n{proc.stderr[-2000:]}\n")
            raise RenderFailed("Die Datei ließ sich nicht umwandeln – ist es ein Word-Dokument?", [])
        return {"odt": base64.b64encode(out.read_bytes()).decode("ascii")}
    finally:
        shutil.rmtree(root, ignore_errors=True)


def export_drawings(job: dict[str, Any], slot: int) -> dict[str, Any]:
    """Zeichnungen einer .odt als SVG – so, wie LibreOffice sie zeichnet (tools/export_drawings.py)."""
    data = decode(job.get("odt"), "odt")
    if not Path(UNO_PYTHON).exists():
        raise RenderFailed("Zeichnungen exportieren nicht möglich: python3-uno fehlt im Renderer", [])
    root = Path(tempfile.mkdtemp(prefix="zeichnungen-"))
    try:
        src = root / "dokument.odt"
        src.write_bytes(data)
        out = root / "out"
        try:
            proc = subprocess.run([UNO_PYTHON, str(DRAWINGS_TOOL), str(src), str(out), str((PROFILES / f"uno-{slot}").resolve())],
                                  capture_output=True, text=True, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            raise RenderFailed(f"Zeichnungen exportieren braucht zu lange (über {TIMEOUT} s).", []) from None
        result_file = out / "result.json"
        marked = out / "marked.odt"
        if proc.returncode != 0 or not result_file.exists() or not marked.exists():
            sys.stderr.write(f"Zeichnungen exportieren gescheitert, Rückgabe {proc.returncode}:\n{proc.stderr[-2000:]}\n")
            raise RenderFailed(failure_from(proc.stderr) or "Zeichnungen ließen sich nicht exportieren", [])
        result = json.loads(result_file.read_text(encoding="utf-8"))
        drawings, total = [], 0
        warnings = list(result.get("warnings") or [])
        for d in result.get("drawings") or []:
            svg = (out / d["file"]).read_bytes()
            odg = (out / d["odg"]).read_bytes() if d.get("odg") else b""
            total += len(svg) + len(odg)
            if total > MAX_DRAWING_BYTES:
                warnings.append("Zu viele bzw. zu große Zeichnungen – der Rest wird nachgebaut.")
                break
            entry = {"name": d["name"], "kind": d.get("kind"), "width_mm": d["width_mm"], "height_mm": d["height_mm"],
                     "svg": base64.b64encode(svg).decode("ascii")}
            if odg:
                entry["odg"] = base64.b64encode(odg).decode("ascii")
            drawings.append(entry)
        return {"odt": base64.b64encode(marked.read_bytes()).decode("ascii"), "drawings": drawings, "warnings": warnings}
    finally:
        shutil.rmtree(root, ignore_errors=True)


def render_drawing(job: dict[str, Any], slot: int) -> dict[str, Any]:
    """Bearbeitete .odg (LibreOffice Draw) → SVG aller Formen (tools/export_drawings.py --render)."""
    data = decode(job.get("odg"), "odg")
    if not Path(UNO_PYTHON).exists():
        raise RenderFailed("Zeichnungen umwandeln nicht möglich: python3-uno fehlt im Renderer", [])
    root = Path(tempfile.mkdtemp(prefix="zeichnung-"))
    try:
        src = root / "zeichnung.odg"
        src.write_bytes(data)
        out = root / "out"
        try:
            proc = subprocess.run([UNO_PYTHON, str(DRAWINGS_TOOL), "--render", str(src), str(out), str((PROFILES / f"uno-{slot}").resolve())],
                                  capture_output=True, text=True, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            raise RenderFailed(f"Zeichnung umwandeln braucht zu lange (über {TIMEOUT} s).", []) from None
        svg, result = out / "drawing.svg", out / "result.json"
        if proc.returncode != 0 or not svg.exists() or not result.exists():
            sys.stderr.write(f"Zeichnung umwandeln gescheitert, Rückgabe {proc.returncode}:\n{proc.stderr[-2000:]}\n")
            raise RenderFailed(failure_from(proc.stderr) or "Die Zeichnung ließ sich nicht umwandeln – ist es eine .odg?", [])
        size = json.loads(result.read_text(encoding="utf-8"))
        return {"svg": base64.b64encode(svg.read_bytes()).decode("ascii"), **size}
    finally:
        shutil.rmtree(root, ignore_errors=True)


def export_pdf_figures(job: dict[str, Any], slot: int) -> dict[str, Any]:
    """Bildbereiche einer PDF-Seite als gruppierte Zeichnungen (.odg + .svg) – tools/pdf_figures.py.

    `{pdf, page, figures: [{id, box, skip}]}`. LibreOffice bekommt nur die eine
    Seite (schnell, auch bei langen Präsentationen); die App ruft Seite für
    Seite auf und zeigt dazwischen den Fortschritt.
    """
    data = decode(job.get("pdf"), "pdf")
    figures = job.get("figures")
    if not isinstance(figures, list) or not figures:
        raise BadRequest("figures: Liste der Bereiche erwartet")
    if not Path(UNO_PYTHON).exists():
        raise RenderFailed("Zeichnungen aus dem PDF nicht möglich: python3-uno fehlt im Renderer", [])
    try:
        page = int(job.get("page") or 0)
    except (TypeError, ValueError):
        raise BadRequest("page: Seitenzahl ab 0") from None
    import pypdfium2 as pdfium  # mit pdfplumber installiert
    root = Path(tempfile.mkdtemp(prefix="pdf-zeichnungen-"))
    try:
        try:
            src = pdfium.PdfDocument(data)
            if not 0 <= page < len(src):
                raise BadRequest(f"page: das PDF hat {len(src)} Seiten")
            one = pdfium.PdfDocument.new()
            one.import_pages(src, [page])
            one.save(str(root / "seite.pdf"))
        except BadRequest:
            raise
        except Exception as e:  # noqa: BLE001
            raise RenderFailed(f"Kein lesbares PDF ({e})", []) from e
        spec = [{"id": str(f.get("id") or f"f{i}"), "page": 0, "box": f.get("box"), "skip": f.get("skip") or []}
                for i, f in enumerate(figures[:50], start=1) if isinstance(f, dict) and isinstance(f.get("box"), list)]
        # Zu Kreis, Pfeil … beschnittene Bilder: pdfium zeichnet sie einzeln (LibreOffice ließe das Rechteck stehen).
        try:
            if str(GEN / "tools") not in sys.path:
                sys.path.insert(0, str(GEN / "tools"))
            from pdf_clips import clipped_images
            boxes = [[float(v) for v in f["box"]] for f in spec]
            patches = clipped_images(root / "seite.pdf", 0, boxes, root / "clips")
            for f in spec:
                f["patches"] = [q for q in patches if q["box"][0] >= f["box"][0] - 6 and q["box"][1] >= f["box"][1] - 6
                                and q["box"][2] <= f["box"][2] + 6 and q["box"][3] <= f["box"][3] + 6]
        except Exception as e:  # noqa: BLE001 – dann wie bisher
            sys.stderr.write(f"Beschnittene Bilder nicht gezeichnet: {e}\n")
        # Schriften ohne echten Namen („CIDFont+F2“): passende nach den Zeichenbreiten statt Times.
        try:
            from pdf_fonts import page_fonts
            fonts = page_fonts(str(root / "seite.pdf"), 0)
            for f in spec:
                f["fonts"] = fonts
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f"Schriften nicht bestimmt: {e}\n")
        (root / "bereiche.json").write_text(json.dumps(spec), encoding="utf-8")
        out = root / "out"
        try:
            proc = subprocess.run([UNO_PYTHON, str(FIGURES_TOOL), str(root / "seite.pdf"), str(out),
                                   str((PROFILES / f"uno-{slot}").resolve()), str(root / "bereiche.json")],
                                  capture_output=True, text=True, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            raise RenderFailed(f"Zeichnungen aus dem PDF brauchen zu lange (über {TIMEOUT} s).", []) from None
        result_file = out / "result.json"
        if proc.returncode != 0 or not result_file.exists():
            sys.stderr.write(f"PDF-Zeichnungen gescheitert, Rückgabe {proc.returncode}:\n{proc.stderr[-2000:]}\n")
            raise RenderFailed(failure_from(proc.stderr) or "Zeichnungen aus dem PDF ließen sich nicht erzeugen", [])
        result = json.loads(result_file.read_text(encoding="utf-8"))
        warnings = list(result.get("warnings") or [])
        done, total = [], 0
        for f in result.get("figures") or []:
            svg, odg = (out / f["svg"]).read_bytes(), (out / f["odg"]).read_bytes()
            total += len(svg) + len(odg)
            if total > MAX_DRAWING_BYTES:
                warnings.append("Zu große Zeichnungen – die übrigen Bereiche bleiben Bilder.")
                break
            done.append({"id": f["id"], "width_mm": f["width_mm"], "height_mm": f["height_mm"],
                         "svg": base64.b64encode(svg).decode("ascii"), "odg": base64.b64encode(odg).decode("ascii")})
        return {"figures": done, "warnings": warnings}
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _limit_memory() -> None:
    resource.setrlimit(resource.RLIMIT_AS, (PDF_MEM, PDF_MEM))


def import_pdf(job: dict[str, Any]) -> dict[str, Any]:
    """PDF → Spec (tools/pdf_import.py) in einem eigenen Prozess mit Zeit- und Speichergrenze."""
    data = decode(job.get("pdf"), "pdf")
    mode = job.get("mode") or "text"
    if mode not in ("text", "pages"):
        raise BadRequest("mode: text oder pages")
    try:
        proc = subprocess.run([sys.executable, str(PDF_TOOL), "-", mode], input=data,
                              capture_output=True, timeout=TIMEOUT, preexec_fn=_limit_memory)
    except subprocess.TimeoutExpired as e:
        raise RenderFailed(f"Das PDF braucht zu lange (über {TIMEOUT} s).", []) from e
    try:
        result = json.loads(proc.stdout.decode("utf-8") or "null")
    except (json.JSONDecodeError, UnicodeDecodeError):
        result = None
    if not isinstance(result, dict):
        stderr = proc.stderr.decode("utf-8", "replace")
        sys.stderr.write(f"PDF-Import ({mode}) gescheitert, Rückgabe {proc.returncode}:\n{stderr[-4000:]}\n")
        if "MemoryError" in stderr or "Cannot allocate memory" in stderr or proc.returncode in (-9, 137):
            raise RenderFailed(f"Das PDF braucht zu viel Speicher (über {PDF_MEM // 1024 // 1024} MB).", [])
        if proc.returncode < 0:
            raise RenderFailed(f"PDF-Import abgestürzt (Signal {-proc.returncode}).", [])
        raise RenderFailed(failure_from(stderr) or "PDF-Import gescheitert", [])
    if result.get("error"):
        raise RenderFailed(str(result["error"]), [])
    return result


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
                             "soffice": soffice_available(), "workers": WORKERS,
                             "drawings": Path(UNO_PYTHON).exists()})

    def do_POST(self) -> None:
        if self.path not in ("/render", "/inspect", "/render-script", "/import-pdf", "/convert-odt", "/export-drawings", "/render-drawing", "/export-pdf-figures"):
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

        if self.path == "/inspect":
            try:
                self.send_json(200, inspect_template(decode(job.get("template"), "template")))
            except BadRequest as e:
                self.send_json(400, {"error": str(e)})
            return
        try:
            slot = slots.get(timeout=TIMEOUT)
        except queue.Empty:
            self.send_json(503, {"error": "Renderer ausgelastet, später erneut versuchen"})
            return
        try:
            if self.path == "/import-pdf":
                self.send_json(200, import_pdf(job))
                return
            if self.path == "/convert-odt":
                self.send_json(200, convert_odt(job, slot))
                return
            if self.path == "/export-drawings":
                self.send_json(200, export_drawings(job, slot))
                return
            if self.path == "/render-drawing":
                self.send_json(200, render_drawing(job, slot))
                return
            if self.path == "/export-pdf-figures":
                self.send_json(200, export_pdf_figures(job, slot))
                return
            files, warnings = (render_script if self.path == "/render-script" else render)(job, slot)
            self.send_json(200, {"files": files, "warnings": warnings})
        except BadRequest as e:
            self.send_json(400, {"error": str(e)})
        except RenderFailed as e:
            self.send_json(422, {"error": str(e), "warnings": e.warnings})
        except Exception as e:  # noqa: BLE001 – Antwort statt abgerissener Verbindung
            traceback.print_exc()
            self.send_json(500, {"error": f"Interner Fehler im Renderer: {type(e).__name__}: {e}"})
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
