#!/usr/bin/env python3
"""Bildbereiche eines PDFs als bearbeitbare Zeichnungen (.odg) – mit LibreOffice (UNO).

Aufruf (mit dem Python von LibreOffice bzw. python3-uno):

    python3 pdf_figures.py eingabe.pdf ausgabe-ordner profil-ordner bereiche.json

``bereiche.json``: ``[{"id": "f1", "page": 0, "box": [x0, top, x1, bottom], "skip": [[…], …]}]`` –
Seite ab 0, Rechtecke in pt von oben links, wie sie der Import (pdf_import.py,
``_fig``) liefert; ``skip``: was im Rechteck liegt, aber nicht dazugehört.

LibreOffice öffnet das PDF in Draw: Text wird zu Textformen, Linien und
Flächen zu Vektorformen, Bilder bleiben Bilder – alles an seiner Stelle. Je
Bereich kommen die Formen darin in ein neues Draw-Dokument, werden
**gruppiert** und gespeichert. Ergebnis im Ausgabeordner:

    <id>.odg     die Gruppe, Seite so groß wie die Zeichnung
    <id>.svg     so, wie LibreOffice sie zeichnet (fürs Dokument)
    result.json  {"figures": [{"id", "odg", "svg", "width_mm", "height_mm"}], "warnings": [...]}
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from export_drawings import MARGIN, bounds, prop, start_office, write_fixed

PT = 2540 / 72          # 1 pt in 1/100 mm
PAD = 6 * PT            # so weit darf eine Form über den Bereich hinausragen (Textrahmen sind etwas größer als die Schrift)


def shapes_in(page, box: list[float], skip: list[list[float]] | None = None) -> list:
    """Formen der Seite, die ganz im Bereich liegen – ohne Hintergrund, Ränder und Streifen der
    Vorlage und ohne, was der Import nicht zur Zeichnung zählt (`skip`: Titel, Aufzählung, Logo)."""
    x0, top, x1, bottom = (v * PT for v in box)
    area, w, h = page.Width * page.Height, page.Width, page.Height
    holes = [[v * PT for v in r] for r in (skip or [])]
    found = []
    for i in range(page.getCount()):
        s = page.getByIndex(i)
        p, z = s.getPosition(), s.getSize()
        if s.getShapeType().endswith("GraphicObjectShape"):
            # Ein Bild gehört dazu, auch wenn es groß ist (Schaubild als Foto) – nur das
            # Hintergrundbild der Folie nicht.
            if z.Width * z.Height > 0.85 * area:
                continue
        elif z.Width * z.Height > 0.3 * area or z.Width > 0.75 * w or z.Height > 0.6 * h:
            continue
        if not (p.X >= x0 - PAD and p.Y >= top - PAD and p.X + z.Width <= x1 + PAD and p.Y + z.Height <= bottom + PAD):
            continue
        cx, cy = p.X + z.Width / 2, p.Y + z.Height / 2
        if any(r[0] - 3 * PT <= cx <= r[2] + 3 * PT and r[1] - 3 * PT <= cy <= r[3] + 3 * PT for r in holes):
            continue
        # Textrahmen sind breiter als die Wörter im PDF: ein Text, der Ausgelassenes berührt, bleibt weg.
        if s.getShapeType().endswith("TextShape") and any(
                p.X < r[2] and p.X + z.Width > r[0] and p.Y < r[3] and p.Y + z.Height > r[1] for r in holes):
            continue
        found.append(s)
    return found


def figure_to_files(smgr, ctx, desktop, doc, shapes: list, odg: Path, svg: Path) -> tuple[float, float]:
    """Formen über die (prozessinterne) Zwischenablage in ein neues Draw-Dokument,
    dort gruppieren, an den Rand schieben, speichern; die Gruppe als SVG."""
    collection = smgr.createInstanceWithContext("com.sun.star.drawing.ShapeCollection", ctx)
    for s in shapes:
        collection.add(s)
    ctrl = doc.getCurrentController()
    ctrl.select(collection)
    disp = smgr.createInstanceWithContext("com.sun.star.frame.DispatchHelper", ctx)
    # Draw bietet keine getTransferable() wie Writer – also wie Strg+C.
    disp.executeDispatch(ctrl.getFrame(), ".uno:Copy", "", 0, ())
    draw = desktop.loadComponentFromURL("private:factory/sdraw", "_blank", 0, (prop("Hidden", True),))
    try:
        disp.executeDispatch(draw.getCurrentController().getFrame(), ".uno:Paste", "", 0, ())
        page = draw.getDrawPages().getByIndex(0)
        if page.getCount() == 0:
            raise RuntimeError("nichts eingefügt")
        # Eine Gruppe: in Draw als Ganzes zu verschieben, mit Doppelklick einzeln zu bearbeiten.
        if page.getCount() > 1:
            pasted = smgr.createInstanceWithContext("com.sun.star.drawing.ShapeCollection", ctx)
            for i in range(page.getCount()):
                pasted.add(page.getByIndex(i))
            page.group(pasted)
        left, top, right, bottom = bounds(page)
        everything = smgr.createInstanceWithContext("com.sun.star.drawing.ShapeCollection", ctx)
        for i in range(page.getCount()):
            s = page.getByIndex(i)
            pos = s.getPosition()
            pos.X += MARGIN - left
            pos.Y += MARGIN - top
            s.setPosition(pos)
            everything.add(s)
        for name in ("BorderLeft", "BorderRight", "BorderTop", "BorderBottom"):
            page.setPropertyValue(name, 0)
        page.Width = right - left + 2 * MARGIN
        page.Height = bottom - top + 2 * MARGIN
        draw.storeToURL(odg.resolve().as_uri(), (prop("FilterName", "draw8"),))
        flt = smgr.createInstanceWithContext("com.sun.star.drawing.GraphicExportFilter", ctx)
        flt.setSourceDocument(everything)
        flt.filter((prop("URL", svg.resolve().as_uri()), prop("MediaType", "image/svg+xml")))
        if not svg.exists() or svg.stat().st_size == 0:
            raise RuntimeError("LibreOffice hat kein SVG geschrieben")
        write_fixed(svg)
        return round((right - left) / 100, 2), round((bottom - top) / 100, 2)
    finally:
        draw.close(True)


def export(src: Path, out: Path, profile: Path, figures: list[dict]) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []
    done: list[dict] = []
    proc, ctx = start_office(profile)
    try:
        smgr = ctx.ServiceManager
        desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
        doc = desktop.loadComponentFromURL(src.resolve().as_uri(), "_blank", 0,
                                           (prop("Hidden", True), prop("FilterName", "draw_pdf_import")))
        if doc is None:
            raise RuntimeError("Das PDF ließ sich in LibreOffice nicht öffnen.")
        try:
            pages = doc.getDrawPages()
            for n, fig in enumerate(figures, start=1):
                fid = str(fig.get("id") or f"f{n}")
                try:
                    page = pages.getByIndex(int(fig["page"]))
                    shapes = shapes_in(page, fig["box"], fig.get("skip"))
                    if not shapes:
                        raise RuntimeError("keine Formen im Bereich")
                    width, height = figure_to_files(smgr, ctx, desktop, doc, shapes, out / f"{fid}.odg", out / f"{fid}.svg")
                    done.append({"id": fid, "odg": f"{fid}.odg", "svg": f"{fid}.svg", "width_mm": width, "height_mm": height})
                except Exception as err:  # noqa: BLE001 – ein Bereich, nicht alle
                    warnings.append(f"Bereich auf Seite {int(fig.get('page', 0)) + 1}: keine Zeichnung ({err}).")
                print(f"progress {n} {len(figures)}", flush=True)
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
    result = {"figures": done, "warnings": warnings}
    (out / "result.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


def main() -> int:
    if len(sys.argv) < 5:
        print(__doc__, file=sys.stderr)
        return 2
    src, out, profile, spec = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]).resolve(), Path(sys.argv[4])
    try:
        figures = json.loads(spec.read_text(encoding="utf-8"))
        result = export(src, out, profile, figures if isinstance(figures, list) else [])
    except Exception as err:  # noqa: BLE001
        print(f"Fehler: {err}", file=sys.stderr)
        return 1
    print(json.dumps({"figures": len(result["figures"]), "warnings": result["warnings"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
