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

Einzelne Formen, die sich berühren oder fast berühren (z. B. ein Schaltzeichen
aus losen Linien, jede an einem anderen Absatz einer Tabellenzelle verankert),
werden zu einer Zeichnung zusammengefasst: Die erste heißt ``lmdraw-<n>``, die
übrigen ``lmdraw-<n>-teil<k>`` – der Importer lässt diese Teile weg.

Mit ``--render`` wird eine (bearbeitete) .odg wieder ein SVG: alle Formen der
ersten Seite, knapp zugeschnitten – ``drawing.svg`` und ``result.json`` mit
``{"width_mm", "height_mm"}``.

Der Importer (src/core/interchange/odt/odt.ts) setzt für Elemente mit diesen
Namen das SVG ein, statt die Zeichnung selbst nachzubauen.
"""
from __future__ import annotations

import json
import os
import re
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
# Formen mit höchstens diesem Abstand (1/100 mm) gehören zu einer Zeichnung.
CLUSTER_GAP = 150
# Nur kleine, lose Formen (Linien, Kreise eines Schaltzeichens) – fertige
# Gruppen und große Zeichnungen bleiben für sich, auch wenn sie aneinanderstoßen.
CLUSTER_MAX = 3000


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


def layout_box(shape, view_cursor) -> tuple[str, tuple[int, int, int, int]] | None:
    """Gruppe und Rechteck (1/100 mm) einer frei am Absatz bzw. Zeichen verankerten
    Form im Layout – oder None, wenn sie nicht zusammengefasst werden soll.

    Writer liefert die Lage relativ zum Absatz; dessen Höhe im Dokument kommt vom
    View-Cursor. Waagerecht zählt die Lage im Absatz – vergleichbar nur in derselben
    Spalte einer Tabelle bzw. im selben Text, daher die Gruppe."""
    try:
        if shape.AnchorType.value not in ("AT_PARAGRAPH", "AT_CHARACTER"):
            return None
        if shape.getShapeType() == "com.sun.star.drawing.GroupShape":
            return None
        if max(shape.getSize().Width, shape.getSize().Height) > CLUSTER_MAX:
            return None
        if shape.VertOrient != 0 or shape.HoriOrient != 0 or shape.VertOrientRelation not in (0, 1, 2, 9):
            return None
        anchor = shape.getAnchor()
        text = anchor.getText()
        if text.getImplementationName() == "SwXCell":
            column = re.sub(r"\d+$", "", text.getPropertyValue("CellName"))
            group = f"{anchor.TextTable.getName()}:{column}"
        elif text.getImplementationName() == "SwXBodyText":
            group = "body"
        else:
            return None
        view_cursor.gotoRange(anchor.getStart(), False)
        top = view_cursor.getPosition().Y
        size = shape.getSize()
        x, y = shape.HoriOrientPosition, top + shape.VertOrientPosition
        return group, (x, y, x + size.Width, y + size.Height)
    except Exception:  # noqa: BLE001 – dann bleibt die Form für sich
        return None


def anchor_name(shape) -> str:
    """Wo eine Form verankert ist: Tabelle und Zelle, sonst der Text."""
    try:
        anchor = shape.getAnchor()
        text = anchor.getText()
        if text.getImplementationName() == "SwXCell":
            return f"{anchor.TextTable.getName()}:{text.getPropertyValue('CellName')}"
        return text.getImplementationName()
    except Exception:  # noqa: BLE001
        return ""


def clusters(boxes: dict[int, tuple[str, tuple[int, int, int, int]]]) -> list[list[int]]:
    """Formen (Index → Gruppe, Rechteck) zu Haufen, die sich bis auf CLUSTER_GAP nahekommen."""
    parent = {i: i for i in boxes}

    def root(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    items = list(boxes.items())
    for k, (i, (gi, a)) in enumerate(items):
        for j, (gj, b) in items[k + 1:]:
            if gi == gj and a[0] - CLUSTER_GAP <= b[2] and b[0] - CLUSTER_GAP <= a[2] \
                    and a[1] - CLUSTER_GAP <= b[3] and b[1] - CLUSTER_GAP <= a[3]:
                parent[root(i)] = root(j)
    out: dict[int, list[int]] = {}
    for i in boxes:
        out.setdefault(root(i), []).append(i)
    return [sorted(c) for c in out.values() if len(c) > 1]


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

ROTATED_TEXT = re.compile(r'(<text[^>]*transform=")rotate\(([-\d.]+) [-\d.]+ [-\d.]+\)("[^>]*>(?:\s*<tspan[^>]*>)*)')
TEXT_POS = re.compile(r'x="([-\d.]+)" y="([-\d.]+)"')


def fix_rotated_text(svg: str) -> str:
    """Gedrehter Text aus eingebetteten Grafiken (SVM/WMF): LibreOffice dreht ihn im
    SVG um einen falschen Punkt, er landet weit neben der Stelle. Richtig ist die
    Drehung um den Anfang des Textes – dort setzt LibreOffice den Text vor dem Drehen hin."""
    def repl(m: re.Match) -> str:
        pos = TEXT_POS.search(m.group(3))
        return f'{m.group(1)}rotate({m.group(2)} {pos.group(1)} {pos.group(2)}){m.group(3)}' if pos else m.group(0)
    return ROTATED_TEXT.sub(repl, svg)


_IMAGE_RE = re.compile(r'<image x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*/>')
_BITMAP_USE_RE = re.compile(r'<use transform="translate\((-?[\d.]+), (-?[\d.]+)\)" xlink:href="#bitmap\((\d+)\)"/>')


def fix_bitmap_uses(svg: str) -> str:
    """LibreOffice legt ein Bild, das inhaltsgleich schon vorkam, nicht noch einmal ab,
    sondern schreibt `<use href="#bitmap(N)">` – ohne das Ziel `bitmap(N)` je zu
    definieren; das Bild fehlt dann (z. B. die zweite von zwei gleichen Plaketten).
    Ziel ist das Bild direkt vor dem ersten Verweis; die Verschiebung steht mit
    umgekehrtem Vorzeichen da (Lage = Original − translate). Der Verweis wird eine
    Kopie des Bildes an seiner Stelle."""
    if "#bitmap(" not in svg:
        return svg
    out: list[str] = []
    last: re.Match | None = None
    target: dict[str, re.Match] = {}
    pos = 0
    events = sorted([*_IMAGE_RE.finditer(svg), *_BITMAP_USE_RE.finditer(svg)], key=lambda m: m.start())
    for m in events:
        if m.re is _IMAGE_RE:
            last = m
            continue
        key = m.group(3)
        if f'id="bitmap({key})"' in svg:
            continue  # das Ziel gibt es doch – nichts zu tun
        ref = target.setdefault(key, last) if last is not None else target.get(key)
        if ref is None:
            continue
        x = float(ref.group(1)) - float(m.group(1))
        y = float(ref.group(2)) - float(m.group(2))
        tag = ref.group(0)
        copy = tag[:ref.start(1) - ref.start()] + f"{x:g}" + tag[ref.end(1) - ref.start():ref.start(2) - ref.start()] + f"{y:g}" + tag[ref.end(2) - ref.start():]
        out.append(svg[pos:m.start()])
        out.append(copy)
        pos = m.end()
    out.append(svg[pos:])
    return "".join(out)


def write_fixed(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    fixed = fix_bitmap_uses(fix_rotated_text(text))
    if fixed != text:
        path.write_text(fixed, encoding="utf-8")


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
            write_fixed(target)
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
            kinds = [kind_of(shape, tables) for shape in shapes]
            # Lose Formen, die zusammen ein Bild ergeben: gemeinsam exportieren.
            view_cursor = doc.getCurrentController().getViewCursor()
            boxes = {i: box for i, shape in enumerate(shapes)
                     if kinds[i] == "drawing" and (box := layout_box(shape, view_cursor))}
            parts: dict[int, list[int]] = {}
            for members in clusters(boxes):
                # Die Zeichnung steht dort, wo die meisten Teile verankert sind.
                anchors = [anchor_name(shapes[i]) for i in members]
                counts = [anchors.count(a) for a in anchors]
                head = members[counts.index(max(counts))]
                parts[head] = [i for i in members if i != head]
            absorbed = {i for rest in parts.values() for i in rest}
            n = 0
            for index, shape in enumerate(shapes):
                kind = kinds[index]
                if not kind or index in absorbed:
                    continue
                if n >= MAX_DRAWINGS:
                    warnings.append(f"Mehr als {MAX_DRAWINGS} Zeichnungen – der Rest wird nachgebaut.")
                    break
                n += 1
                name = f"lmdraw-{n}"
                target = out / f"{name}.svg"
                members = [shape] + [shapes[i] for i in parts.get(index, [])]
                source = shape
                if len(members) > 1:
                    source = smgr.createInstanceWithContext("com.sun.star.drawing.ShapeCollection", ctx)
                    for m in members:
                        source.add(m)
                try:
                    flt = smgr.createInstanceWithContext("com.sun.star.drawing.GraphicExportFilter", ctx)
                    flt.setSourceDocument(source)
                    flt.filter((prop("URL", target.resolve().as_uri()), prop("MediaType", "image/svg+xml")))
                    if not target.exists() or target.stat().st_size == 0:
                        raise RuntimeError("leer")
                    write_fixed(target)
                    shape.Name = name
                    for k, m in enumerate(members[1:], start=1):
                        m.Name = f"{name}-teil{k}"
                    if len(members) > 1:
                        left, top, right, bottom = (min(boxes[i][1][0] for i in [index, *parts[index]]),
                                                    min(boxes[i][1][1] for i in [index, *parts[index]]),
                                                    max(boxes[i][1][2] for i in [index, *parts[index]]),
                                                    max(boxes[i][1][3] for i in [index, *parts[index]]))
                        width, height = right - left, bottom - top
                    else:
                        size = shape.getSize()
                        width, height = size.Width, size.Height
                    entry = {"name": name, "file": target.name, "kind": kind,
                             "width_mm": round(width / 100, 2), "height_mm": round(height / 100, 2)}
                    try:
                        to_odg(smgr, ctx, desktop, doc, source, out / f"{name}.odg")
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
