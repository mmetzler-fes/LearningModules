#!/usr/bin/env python3
"""Zeichnungen einer .odt mit LibreOffice als SVG exportieren (UNO).

Aufruf (mit dem Python von LibreOffice bzw. python3-uno, nicht dem des
Servers):

    python3 export_drawings.py eingabe.odt ausgabe-ordner [profil-ordner]
    python3 export_drawings.py --render zeichnung.odg ausgabe-ordner [profil-ordner]

LibreOffice öffnet das Dokument unsichtbar. Jede Zeichnung oben auf der
Zeichenebene (Gruppe, Form, Linie, Grafik in einem Fremdformat wie SVM/WMF)
wird so exportiert, wie LibreOffice sie zeichnet, und bekommt im Dokument den
Namen ``lmdraw-<n>``. Textrahmen und gewöhnliche Bilder (PNG, JPEG …) bleiben
dem Importer überlassen. Ergebnis im Ausgabeordner:

    marked.odt      das Dokument mit den Namen
    lmdraw-<n>.svg  je Zeichnung
    lmdraw-<n>.odg  je Zeichnung ein Draw-Dokument zum Bearbeiten (Seite so groß wie die Zeichnung)
    result.json     {"drawings": [{"name", "file", "odg", "width_mm", "height_mm"}], "warnings": [...]}

Mit ``--render`` wird eine (bearbeitete) .odg wieder ein SVG: alle Formen der
ersten Seite, knapp zugeschnitten – ``drawing.svg`` und ``result.json`` mit
``{"width_mm", "height_mm"}``.

Der Importer (src/core/interchange/odt/odt.ts) setzt für Elemente mit diesen
Namen das SVG ein, statt die Zeichnung selbst nachzubauen.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

import uno  # type: ignore
from com.sun.star.beans import PropertyValue  # type: ignore

# Grafiken in diesen Formaten kann der Browser nicht – LibreOffice zeichnet sie.
METAFILE = ("image/x-svm", "image/x-wmf", "image/x-emf", "image/wmf", "image/emf", "image/x-ms-bmp")
MAX_DRAWINGS = 200


def prop(name: str, value) -> PropertyValue:
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


def start_office(profile: Path) -> tuple[subprocess.Popen, object]:
    """LibreOffice unsichtbar starten und verbinden; eigenes Profil je Aufruf."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise RuntimeError("LibreOffice (soffice) fehlt.")
    pipe = f"lmdraw{uuid.uuid4().hex}"
    proc = subprocess.Popen(
        [soffice, f"-env:UserInstallation={profile.as_uri()}", "--headless", "--invisible", "--nologo",
         "--norestore", "--nodefault", f"--accept=pipe,name={pipe};urp;StarOffice.ComponentContext"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    deadline = time.time() + 45
    while True:
        try:
            ctx = resolver.resolve(f"uno:pipe,name={pipe};urp;StarOffice.ComponentContext")
            return proc, ctx
        except Exception:  # noqa: BLE001 – startet noch
            if proc.poll() is not None or time.time() > deadline:
                proc.kill()
                raise RuntimeError("LibreOffice ließ sich nicht starten.")
            time.sleep(0.3)


def body_tables(doc) -> set[str]:
    """Namen der Tabellen im Text (auch verschachtelte) – Tabellen in Kopf- und Fußzeilen fehlen darin."""
    names: set[str] = set()

    def walk(text, depth=0):
        if depth > 4:
            return
        en = text.createEnumeration()
        while en.hasMoreElements():
            el = en.nextElement()
            if el.supportsService("com.sun.star.text.TextTable"):
                names.add(el.getName())
                for cell in el.getCellNames():
                    walk(el.getCellByName(cell), depth + 1)

    walk(doc.getText())
    return names


def in_header(shape, tables: set[str]) -> bool:
    """Kopf- und Fußzeile übernimmt der Importer nicht – dort kommt die Druckvorlage zum Zug.
    Steht die Form in einer Tabellenzelle (Kopfzeilen sind oft Tabellen), zählt, wo die Tabelle steht."""
    try:
        anchor = shape.getAnchor()
        impl = anchor.getText().getImplementationName()
        if "HeadFoot" in impl:
            return True
        if impl == "SwXCell":
            table = anchor.TextTable
            return bool(table) and table.getName() not in tables
    except Exception:  # noqa: BLE001
        return False
    return False


def kind_of(shape, tables: set[str]) -> str | None:
    """'drawing' für Formen und Gruppen, 'metafile' für Grafiken in Fremdformaten, sonst None."""
    if shape.supportsService("com.sun.star.text.TextFrame") or in_header(shape, tables):
        return None
    if shape.supportsService("com.sun.star.text.TextGraphicObject") or shape.supportsService("com.sun.star.drawing.GraphicObjectShape"):
        try:
            mime = (shape.Graphic.MimeType or "").lower() if shape.Graphic else ""
        except Exception:  # noqa: BLE001
            mime = ""
        return "metafile" if mime in METAFILE else None
    if shape.supportsService("com.sun.star.text.TextEmbeddedObject"):
        return None  # Formeln (StarMath) und andere Objekte bleiben beim Importer
    if shape.supportsService("com.sun.star.drawing.Shape"):
        return "drawing"
    return None


MARGIN = 200  # 1/100 mm Rand um die Zeichnung in der .odg


def to_odg(smgr, ctx, desktop, doc, shape, target: Path) -> None:
    """Die Form über die (prozessinterne) Zwischenablage in ein neues Draw-Dokument;
    die Seite wird so groß wie die Zeichnung."""
    ctrl = doc.getCurrentController()
    ctrl.select(shape)
    clip = smgr.createInstanceWithContext("com.sun.star.datatransfer.clipboard.SystemClipboard", ctx)
    clip.setContents(ctrl.getTransferable(), None)
    draw = desktop.loadComponentFromURL("private:factory/sdraw", "_blank", 0, (prop("Hidden", True),))
    try:
        disp = smgr.createInstanceWithContext("com.sun.star.frame.DispatchHelper", ctx)
        disp.executeDispatch(draw.getCurrentController().getFrame(), ".uno:Paste", "", 0, ())
        page = draw.getDrawPages().getByIndex(0)
        if page.getCount() == 0:
            raise RuntimeError("nichts eingefügt")
        left, top, right, bottom = bounds(page)
        for i in range(page.getCount()):
            s = page.getByIndex(i)
            p = s.getPosition()
            p.X += MARGIN - left
            p.Y += MARGIN - top
            s.setPosition(p)
        for name in ("BorderLeft", "BorderRight", "BorderTop", "BorderBottom"):
            page.setPropertyValue(name, 0)
        page.Width = right - left + 2 * MARGIN
        page.Height = bottom - top + 2 * MARGIN
        draw.storeToURL(target.resolve().as_uri(), (prop("FilterName", "draw8"),))
    finally:
        draw.close(True)


def bounds(page) -> tuple[int, int, int, int]:
    xs, ys, xe, ye = [], [], [], []
    for i in range(page.getCount()):
        s = page.getByIndex(i)
        p, z = s.getPosition(), s.getSize()
        xs.append(p.X); ys.append(p.Y); xe.append(p.X + z.Width); ye.append(p.Y + z.Height)
    return min(xs), min(ys), max(xe), max(ye)


def render_odg(src: Path, out: Path, profile: Path) -> dict:
    """Bearbeitete .odg → SVG aller Formen der ersten Seite."""
    out.mkdir(parents=True, exist_ok=True)
    proc, ctx = start_office(profile)
    try:
        smgr = ctx.ServiceManager
        desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
        doc = desktop.loadComponentFromURL(src.resolve().as_uri(), "_blank", 0, (prop("Hidden", True), prop("ReadOnly", True)))
        if doc is None:
            raise RuntimeError("Die Zeichnung ließ sich nicht öffnen.")
        try:
            page = doc.getDrawPages().getByIndex(0)
            if page.getCount() == 0:
                raise RuntimeError("Die Zeichnung ist leer.")
            shapes = smgr.createInstanceWithContext("com.sun.star.drawing.ShapeCollection", ctx)
            for i in range(page.getCount()):
                shapes.add(page.getByIndex(i))
            left, top, right, bottom = bounds(page)
            flt = smgr.createInstanceWithContext("com.sun.star.drawing.GraphicExportFilter", ctx)
            flt.setSourceDocument(shapes)
            target = out / "drawing.svg"
            flt.filter((prop("URL", target.resolve().as_uri()), prop("MediaType", "image/svg+xml")))
            if not target.exists() or target.stat().st_size == 0:
                raise RuntimeError("LibreOffice hat kein SVG geschrieben.")
            result = {"width_mm": round((right - left) / 100, 2), "height_mm": round((bottom - top) / 100, 2)}
        finally:
            doc.close(True)
    finally:
        try:
            desktop.terminate()  # type: ignore[possibly-undefined]
        except Exception:  # noqa: BLE001
            pass
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
    (out / "result.json").write_text(json.dumps(result), encoding="utf-8")
    return result


def export(src: Path, out: Path, profile: Path) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    proc, ctx = start_office(profile)
    warnings: list[str] = []
    drawings: list[dict] = []
    try:
        smgr = ctx.ServiceManager
        desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
        doc = desktop.loadComponentFromURL(src.resolve().as_uri(), "_blank", 0, (prop("Hidden", True), prop("ReadOnly", False)))
        if doc is None:
            raise RuntimeError("Das Dokument ließ sich nicht öffnen.")
        try:
            page = doc.getDrawPage()
            shapes = [page.getByIndex(i) for i in range(page.getCount())]
            tables = body_tables(doc)
            n = 0
            for shape in shapes:
                kind = kind_of(shape, tables)
                if not kind:
                    continue
                if n >= MAX_DRAWINGS:
                    warnings.append(f"Mehr als {MAX_DRAWINGS} Zeichnungen – der Rest wird nachgebaut.")
                    break
                n += 1
                name = f"lmdraw-{n}"
                target = out / f"{name}.svg"
                try:
                    flt = smgr.createInstanceWithContext("com.sun.star.drawing.GraphicExportFilter", ctx)
                    flt.setSourceDocument(shape)
                    flt.filter((prop("URL", target.resolve().as_uri()), prop("MediaType", "image/svg+xml")))
                    if not target.exists() or target.stat().st_size == 0:
                        raise RuntimeError("leer")
                    shape.Name = name
                    size = shape.getSize()
                    entry = {"name": name, "file": target.name, "kind": kind,
                             "width_mm": round(size.Width / 100, 2), "height_mm": round(size.Height / 100, 2)}
                    try:
                        to_odg(smgr, ctx, desktop, doc, shape, out / f"{name}.odg")
                        entry["odg"] = f"{name}.odg"
                    except Exception as err:  # noqa: BLE001 – dann eben ohne Quelle zum Bearbeiten
                        warnings.append(f"Zeichnung {n}: keine .odg zum Bearbeiten ({err}).")
                    drawings.append(entry)
                except Exception as err:  # noqa: BLE001 – eine Zeichnung, nicht alles
                    warnings.append(f"Zeichnung {n} ließ sich nicht exportieren ({err}).")
            doc.storeToURL((out / "marked.odt").resolve().as_uri(), (prop("FilterName", "writer8"),))
        finally:
            doc.close(True)
    finally:
        try:
            desktop.terminate()  # type: ignore[possibly-undefined]
        except Exception:  # noqa: BLE001
            pass
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
    result = {"drawings": drawings, "warnings": warnings}
    (out / "result.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    args = sys.argv[1:]
    render = args[0] == "--render"
    if render:
        args = args[1:]
    if len(args) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    src, out = Path(args[0]), Path(args[1])
    profile = Path(args[2]) if len(args) > 2 else out / "profile"
    try:
        if render:
            print(json.dumps(render_odg(src, out, profile)))
            return 0
        result = export(src, out, profile)
    except Exception as err:  # noqa: BLE001
        print(f"Fehler: {err}", file=sys.stderr)
        return 1
    print(json.dumps({"drawings": len(result["drawings"]), "warnings": result["warnings"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
