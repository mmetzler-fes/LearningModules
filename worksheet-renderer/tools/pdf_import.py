"""PDF -> Spec (Dokument-Format, SPEC.md) – für den Import in LearningModules.

Zwei Wege, beide ohne trainierte Modelle:

- ``pages``: jede Seite als Bild. Sieht aus wie das Original, ist aber nicht
  editierbar.
- ``text``: Struktur aus Schriftgröße, Fettdruck, Abständen und Linien
  erraten (pdfplumber). Überschriften, Absätze, Listen, Tabellen, Bilder und
  Zeichnungen; rote Schrift (Lösungsblatt) wird zur Lösung.

Ein PDF kennt keine Struktur, nur Zeichen an Positionen. Was sich nicht
sicher erkennen lässt (mehrspaltiger Satz, Formeln, gescannte Seiten), steht
in den Hinweisen.
"""

from __future__ import annotations

import base64
import io
import re
import statistics
from collections import Counter
from typing import Any

MAX_PAGES = 40
# Seitenbild höchstens so viele Pixel (≈ A4 bei 150 dpi ×1,5) – Plakate und
# falsch angegebene Seitengrößen würden sonst Gigabytes belegen.
MAX_PAGE_PIXELS = 3_000_000
PT_TO_CM = 2.54 / 72
TEXT_WIDTH_CM = 16.5
# Folien (Querformat): Bilder dürfen so breit werden wie die Zeile auf A4 quer –
# im Hochformat druckt der Renderer ohnehin höchstens die Satzbreite.
SLIDE_WIDTH_CM = 25.5

BULLET_RE = re.compile(r"^([•▪●◦■□▶►‣⁃∙·\-–—*✓✔➢➤])\s+(.*)$")
# Nur Nummern – „(a)“ / „a)“ sind in Aufgaben Textzeilen und bleiben es.
ORDERED_RE = re.compile(r"^(\d{1,2}[.)])\s+(.*)$")
# Nummern vor Überschriften setzt die App selbst (1. / 1.1 / 1.1.1).
HEADNUM_RE = re.compile(r"^(\d+(?:\.\d+)*\.?|Aufgabe\s+\d+(?:\.\d+)*:?)\s+(?=\S)")
# „2.1 Bauteile suchen“: Gliederungsnummer mit Punkt dazwischen → Aufgabe/Teilaufgabe
OUTLINE_RE = re.compile(r"^(\d+)((?:\.\d+){1,2})\.?\s+\S")
PAGE_NO_RE = re.compile(r"^(Seite\s+)?\d+(\s*(/|von)\s*\d+)?$", re.I)


# Formeln: Zeichen → StarMath (wie im Formeleditor); was hier fehlt, bleibt Text.
GREEK = {"α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon", "η": "eta", "θ": "theta",
         "λ": "lambda", "μ": "mu", "ν": "nu", "π": "pi", "ρ": "rho", "σ": "sigma", "τ": "tau", "φ": "phi",
         "ω": "omega", "Δ": "DELTA", "Ω": "OMEGA", "Φ": "PHI"}
MATH_OPS = {"·": " cdot ", "×": " times ", "÷": " div ", "−": " - ", "±": " +- ", "≈": " approx ", "≠": " <> ",
            "≤": " <= ", "≥": " >= ", "→": " -> ", "∞": " infinity ", "°": " degree ", "²": "^2", "³": "^3"}
MATH_HINT_RE = re.compile(r"[=·×÷√∑∫±≈≤≥≠^²³αβγδεηθλμνπρστφωΔΩΦ]")
STARMATH_OK_RE = re.compile(r"^[A-Za-z0-9 .,=+\-*/()%^_{}<>\"]*$")


def to_starmath(text: str) -> str | None:
    """Einzeilige Formel als StarMath – oder None, wenn ein Zeichen unbekannt ist."""
    out = ""
    for ch in text:
        if ch in GREEK:
            out += f" %{GREEK[ch]} "
        elif ch in MATH_OPS:
            out += MATH_OPS[ch]
        else:
            out += ch
    out = re.sub(r"\s+", " ", out).strip()
    return out if out and STARMATH_OK_RE.match(out) and "=" in out else None


class PdfImportError(Exception):
    pass


# ==================== Seiten als Bilder ====================

def _jpeg_data_uri(image, quality: int = 82) -> str:
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _png_data_uri(image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def pages_to_spec(data: bytes, dpi: int = 150) -> tuple[dict[str, Any], list[str], str]:
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(data)
    except Exception as e:  # noqa: BLE001 – pdfium meldet sehr unterschiedlich
        raise PdfImportError(f"Kein lesbares PDF ({e})") from e
    warnings: list[str] = []
    count = len(pdf)
    if count > MAX_PAGES:
        warnings.append(f"Nur die ersten {MAX_PAGES} von {count} Seiten übernommen.")
    content: list[dict[str, Any]] = []
    for i in range(min(count, MAX_PAGES)):
        page = pdf[i]
        w, h = page.get_size()
        scale = min(dpi / 72, (MAX_PAGE_PIXELS / max(w * h, 1.0)) ** 0.5)
        image = page.render(scale=scale).to_pil()
        if i:
            content.append({"type": "pagebreak"})
        content.append({"type": "image", "src": _jpeg_data_uri(image), "width": f"{TEXT_WIDTH_CM}cm",
                        "alt": f"Seite {i + 1}", "_pos": [i, 0]})
    title = (pdf.get_metadata_dict().get("Title") or "").strip()
    return {"content": content}, warnings, title


# ==================== Text mit Struktur ====================

def _is_bold(fontname: str) -> bool:
    f = (fontname or "").lower()
    return any(k in f for k in ("bold", "black", "heavy", "semibold", "demi"))


def _is_red(color: Any) -> bool:
    """Rot wie im Lösungsblatt (RGB oder CMYK)."""
    if not isinstance(color, (list, tuple)):
        return False
    c = [float(x) for x in color]
    if len(c) == 3:
        r, g, b = c
        return r > 0.6 and g < 0.35 and b < 0.35
    if len(c) == 4:
        cy, m, y, k = c
        return cy < 0.2 and m > 0.6 and y > 0.5 and k < 0.3
    return False


def _is_mono(fontname: str) -> bool:
    f = (fontname or "").lower()
    return any(k in f for k in ("mono", "courier", "consol", "menlo", "typewriter"))


def _code_text(words: list[dict[str, Any]]) -> str:
    """Monospace-Wörter → Codezeilen; die Einrückung aus der x-Position."""
    lines = _group_lines(words)
    if not lines:
        return ""
    left = min(ln["x0"] for ln in lines)
    out = []
    prev_bottom = None
    for ln in lines:
        char = 0.6 * ln["size"]
        # Leerzeilen im Code: größerer Abstand zur Zeile davor
        if prev_bottom is not None and ln["top"] - prev_bottom > 0.9 * ln["size"]:
            out.extend([""] * max(1, round((ln["top"] - prev_bottom) / (1.2 * ln["size"]))))
        out.append(" " * max(0, round((ln["x0"] - left) / char)) + ln["text"])
        prev_bottom = ln["bottom"]
    return "\n".join(out)


def _inside(obj: dict[str, Any], box: tuple[float, float, float, float], pad: float = 1.0) -> bool:
    x0, top, x1, bottom = box
    cx = (obj["x0"] + obj["x1"]) / 2
    cy = (obj["top"] + obj["bottom"]) / 2
    return x0 - pad <= cx <= x1 + pad and top - pad <= cy <= bottom + pad


def _row_text(row: list[dict[str, Any]], size: float) -> str:
    """Wörter einer Zeile; kleinere, versetzte direkt dahinter als _{tief} bzw. ^{hoch}."""
    base = statistics.median([w["top"] + w["bottom"] for w in row if float(w.get("size") or size) >= 0.85 * size] or [0]) / 2
    out = ""
    prev = None
    for w in row:
        t = w["text"]
        small = float(w.get("size") or size) < 0.85 * size
        if small and prev is not None and w["x0"] - prev["x1"] < 1.5 and base:
            mid = (w["top"] + w["bottom"]) / 2
            out += ("_{" if mid > base else "^{") + t + "}"
        else:
            out += (" " if out else "") + t
        prev = w
    return out


def _group_lines(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    words = sorted(words, key=lambda w: (round(w["top"], 1), w["x0"]))
    rows: list[list[dict[str, Any]]] = []
    for w in words:
        size = float(w.get("size") or 10)
        tol = max(2.0, 0.35 * size)
        if rows and abs(w["top"] - rows[-1][0]["top"]) <= tol:
            rows[-1].append(w)
            continue
        # Kleinere Schrift, die in eine Zeile hineinragt (Index, Exponent), gehört zu ihr.
        mid = (w["top"] + w["bottom"]) / 2
        host = next((r for r in reversed(rows[-3:]) if size < 0.85 * float(r[0].get("size") or 10)
                     and r[0]["top"] - 0.4 * size <= mid <= r[0]["bottom"] + 0.4 * size), None)
        if host is not None:
            host.append(w)
        else:
            rows.append([w])
    lines = []
    for row in rows:
        row.sort(key=lambda w: w["x0"])
        sizes = [float(w.get("size") or 10) for w in row]
        chars = sum(len(w["text"]) for w in row)
        bold = sum(len(w["text"]) for w in row if _is_bold(w.get("fontname", ""))) > 0.6 * chars
        red = sum(len(w["text"]) for w in row if _is_red(w.get("non_stroking_color"))) > 0.6 * chars
        italic = sum(len(w["text"]) for w in row if re.search(r"italic|oblique", w.get("fontname", ""), re.I)) > 0.6 * chars
        lines.append({
            "italic": italic,
            "kind": "line",
            "text": _row_text(row, max(sizes)),
            "x0": min(w["x0"] for w in row), "x1": max(w["x1"] for w in row),
            "top": min(w["top"] for w in row), "bottom": max(w["bottom"] for w in row),
            "size": statistics.median(sizes), "bold": bold, "red": red,
        })
    return lines


def _merge_boxes(boxes: list[list[float]], gap: float = 6.0) -> list[list[float]]:
    """Überlappende oder nahe Rechtecke zusammenfassen (Zeichnungen aus Linien)."""
    merged = [list(b) + [1] for b in boxes]
    changed = True
    while changed:
        changed = False
        out: list[list[float]] = []
        for b in merged:
            for o in out:
                if b[0] <= o[2] + gap and o[0] <= b[2] + gap and b[1] <= o[3] + gap and o[1] <= b[3] + gap:
                    o[0], o[1], o[2], o[3] = min(o[0], b[0]), min(o[1], b[1]), max(o[2], b[2]), max(o[3], b[3])
                    o[4] += b[4]
                    changed = True
                    break
            else:
                out.append(b)
        merged = out
    return merged


def _crop_image(page, box, resolution: int = 150, blank: list[dict[str, Any]] | None = None):
    """Ausschnitt der Seite als Bild; `blank`: Wörter, die dort weiß übermalt werden (sie bleiben Text)."""
    x0, top, x1, bottom = box
    bbox = (max(0, x0), max(0, top), min(page.width, x1), min(page.height, bottom))
    area = max((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]), 1.0)
    resolution = min(resolution, int(72 * (MAX_PAGE_PIXELS / area) ** 0.5))
    image = page.crop(bbox).to_image(resolution=resolution).original
    if blank:
        from PIL import ImageDraw  # pdfplumber bringt Pillow mit
        image = image.convert("RGB")
        draw = ImageDraw.Draw(image)
        sx, sy = image.width / (bbox[2] - bbox[0]), image.height / (bbox[3] - bbox[1])
        for wd in blank:
            draw.rectangle([(float(wd["x0"]) - bbox[0] - 1) * sx, (float(wd["top"]) - bbox[1] - 1) * sy,
                            (float(wd["x1"]) - bbox[0] + 1) * sx, (float(wd["bottom"]) - bbox[1] + 1) * sy], fill="white")
    return image


def _width_cm(x0: float, x1: float, limit: float = TEXT_WIDTH_CM) -> str:
    return f"{min(limit, max(1.0, (x1 - x0) * PT_TO_CM)):.1f}cm"


def _clean_cell(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


def _box_key(obj: dict[str, Any]) -> tuple[int, ...]:
    """Lage eines Bildes, auf 4 pt gerundet – zum Wiedererkennen auf anderen Seiten."""
    return tuple(round(float(obj[k]) / 4) for k in ("x0", "top", "x1", "bottom"))


def _template_images(pages) -> set[tuple[int, ...]]:
    """Bilder der Vorlage (Logo …): klein, allein stehend und an derselben Stelle auf vielen Seiten.

    Teil eines größeren Bildes (Kachel) ist kein Logo – auch wenn dasselbe
    Schaubild auf mehreren Folien wiederkehrt.
    """
    if len(pages) < 3:
        return set()

    def alone(im: dict[str, Any], others: list[dict[str, Any]], gap: float = 12.0) -> bool:
        return not any(o is not im and float(o["x0"]) <= float(im["x1"]) + gap and float(im["x0"]) <= float(o["x1"]) + gap
                       and float(o["top"]) <= float(im["bottom"]) + gap and float(im["top"]) <= float(o["bottom"]) + gap for o in others)

    counts: Counter = Counter()
    for p in pages:
        area = float(p.width) * float(p.height)
        counts.update({_box_key(im) for im in p.images
                       if (float(im["x1"]) - float(im["x0"])) * (float(im["bottom"]) - float(im["top"])) < 0.05 * area and alone(im, p.images)})
    return {k for k, n in counts.items() if n >= max(3, 0.4 * len(pages))}


def _photo_groups(elements: list[dict[str, Any]], figures: list[tuple[tuple[float, float, float, float], dict[str, Any]]],
                  words: list[dict[str, Any]], taken: list[tuple[float, float, float, float]]) -> None:
    """Fotos einer Folie, zwischen denen kein Text steht, werden eine Bildgruppe (`group`):
    Sie bleiben zueinander, wo sie auf der Folie stehen, und lassen sich in der App
    anordnen oder lösen. Schaubilder (mit `_fig`, als Zeichnung zu holen) bleiben für sich."""
    photos = [(box, el) for box, el in figures if "_fig" not in el["block"]]
    others = [box for box, el in figures if "_fig" in el["block"]] + list(taken)

    def union(boxes):
        return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))

    def overlaps(a, b) -> bool:
        return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]

    def between(a, b) -> tuple[float, float, float, float] | None:
        """Streifen zwischen zwei Bildern (Lücke in x bzw. y, so hoch bzw. breit wie ihre Überlappung)."""
        gx0, gx1 = min(a[2], b[2]), max(a[0], b[0])
        gy0, gy1 = min(a[3], b[3]), max(a[1], b[1])
        apart_x, apart_y = gx0 < gx1, gy0 < gy1
        if apart_x and apart_y:
            return (gx0, gy0, gx1, gy1)
        if apart_x:
            return (gx0, max(a[1], b[1]), gx1, min(a[3], b[3]))
        if apart_y:
            return (max(a[0], b[0]), gy0, min(a[2], b[2]), gy1)
        return None

    def own_text(box, other) -> bool:
        """Steht direkt über oder unter dem Bild Text, der nicht auch über bzw. unter dem anderen
        steht (Überschrift, Unterschrift einer Spalte)? Die Fußzeile zählt nicht – sie ist klein."""
        return any(float(wd.get("size") or 10) >= 9 and float(wd["x0"]) < box[2] and float(wd["x1"]) > box[0]
                   and not (float(wd["x0"]) < other[2] and float(wd["x1"]) > other[0])
                   and (0 <= float(wd["top"]) - box[3] <= 50 or 0 <= box[1] - float(wd["bottom"]) <= 50) for wd in words)

    def text_between(a, b) -> bool:
        r = between(a, b)
        return r is not None and any(float(wd["x0"]) < r[2] and float(wd["x1"]) > r[0] and float(wd["top"]) < r[3] and float(wd["bottom"]) > r[1]
                                     for wd in words)

    def joinable(ca, cb) -> bool:
        # Zwischen keinen zwei Bildern der beiden Gruppen steht Text, und nicht jedes hat seine eigene
        # Überschrift (Spalten). Die ganze Gruppe deckt kein Schaubild, keine Tabelle und höchstens eine
        # kurze Zeile Text (Untertitel neben einem Bild) – Fließtext neben den Bildern bleibt neben ihnen.
        pairs = [(a, b) for a, _ in ca for b, _ in cb]
        if any(text_between(a, b) for a, b in pairs) or all(own_text(a, b) and own_text(b, a) for a, b in pairs):
            return False
        boxes = [b for b, _ in ca + cb]
        u = union(boxes)
        loose = sum(1 for wd in words
                    if overlaps(u, (float(wd["x0"]), float(wd["top"]), float(wd["x1"]), float(wd["bottom"])))
                    and not any(_inside(wd, b, pad=0) for b in boxes))
        return loose <= 4 and not any(overlaps(u, o) for o in others)

    clusters = [[p] for p in photos]
    changed = True
    while changed:
        changed = False
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                if joinable(clusters[i], clusters[j]):
                    clusters[i] += clusters.pop(j)
                    changed = True
                    break
            if changed:
                break
    for members in clusters:
        if len(members) < 2:
            continue
        ux0, ut, ux1, ub = union([b for b, _ in members])
        uw, uh = ux1 - ux0, ub - ut
        items = []
        for (bx0, bt, bx1, bb), el in sorted(members, key=lambda m: (m[0][1], m[0][0])):
            items.append({"src": el["block"]["src"],
                          "x": round((bx0 - ux0) / uw * 100, 3), "y": round((bt - ut) / uh * 100, 3),
                          "w": round((bx1 - bx0) / uw * 100, 3), "h": round((bb - bt) / uh * 100, 3)})
            elements.remove(el)
        elements.append({"kind": "block", "top": ut + 3, "bottom": ub - 3, "x0": ux0 + 3, "x1": ux1 - 3, "page": members[0][1]["page"],
                         "block": {"type": "group", "width": _width_cm(ux0 + 3, ux1 - 3, SLIDE_WIDTH_CM),
                                   "ratio": round(uh / uw, 4), "items": items}})


def _page_elements(page, index: int, warnings: list[str], template: set[tuple[int, ...]] | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Elemente einer Seite (Zeilen, Tabellen, Bilder, Karo) und ihre Zeilen."""
    elements: list[dict[str, Any]] = []
    taken: list[tuple[float, float, float, float]] = []
    h, w = float(page.height), float(page.width)

    all_words = page.extract_words(extra_attrs=["fontname", "size", "non_stroking_color"], x_tolerance=1.5, y_tolerance=2)

    # Tabellen über Linien. Ein Gitter fast ohne Text ist Karopapier, eine
    # Tabelle in Monospace-Schrift ein Codeblock.
    for t in page.find_tables({"vertical_strategy": "lines", "horizontal_strategy": "lines"}):
        rows = t.extract() or []
        cells = [c for r in rows for c in r]
        filled = [c for c in cells if _clean_cell(c)]
        x0, top, x1, bottom = t.bbox
        taken.append(t.bbox)
        inner = [wd for wd in all_words if _inside(wd, t.bbox)]
        # Lösungsblatt: rote Schrift über dem Karo – das Gitter ist sonst leer.
        red_words = [wd for wd in inner if _is_red(wd.get("non_stroking_color"))]
        if len(rows) >= 3 and red_words and len(red_words) >= 0.8 * len(inner) and w <= 1.15 * h:
            lines_cm = (bottom - top) * PT_TO_CM / 0.5
            elements.append({"kind": "block", "top": top, "bottom": bottom, "x0": x0,
                             "block": {"type": "karo", "lines": max(1, min(60, round(lines_cm)))}})
            text = "\n".join(ln["text"] for ln in _group_lines(red_words))
            elements.append({"kind": "block", "top": top + 0.1, "bottom": bottom, "x0": x0,
                             "block": {"type": "solution", "blocks": [{"type": "text", "text": text}]}})
            continue
        mono = sum(len(wd["text"]) for wd in inner if _is_mono(wd.get("fontname", "")))
        if inner and mono >= 0.7 * sum(len(wd["text"]) for wd in inner) and max(len(r) for r in rows) == 1:
            elements.append({"kind": "block", "top": top, "bottom": bottom, "x0": x0,
                             "block": {"type": "code", "code": _code_text(inner)}})
            continue
        if len(rows) >= 3 and len(filled) <= 0.05 * max(1, len(cells)):
            lines_cm = (bottom - top) * PT_TO_CM / 0.5
            elements.append({"kind": "block", "top": top, "bottom": bottom, "x0": x0,
                             "block": {"type": "karo", "lines": max(1, min(60, round(lines_cm)))}})
            continue
        if len(rows) == 1 and len(rows[0]) == 1:
            text = (rows[0][0] or "").strip()
            if text:
                elements.append({"kind": "block", "top": top, "bottom": bottom, "x0": x0,
                                 "block": {"type": "box", "blocks": [{"type": "text", "text": text}]}})
            continue
        if top < 0.12 * h and len(rows) <= 2:
            # Kopfzeile der Vorlage (Logo, Titel, Seite) – kein Inhalt.
            elements.append({"kind": "header", "top": top, "text": " ".join(filter(None, map(_clean_cell, cells)))})
            continue
        grid = [[_clean_cell(c) for c in r] for r in rows]
        block: dict[str, Any] = {"type": "table", "rows": grid}
        if len(grid) > 1:
            block = {"type": "table", "header": grid[0], "rows": grid[1:]}
        elements.append({"kind": "block", "top": top, "bottom": bottom, "x0": x0, "block": block})

    # Bildbereiche: Rasterbilder und Zeichnungen (Linien, Kurven, Flächen), die
    # beieinander liegen, werden EIN Bild – samt der Beschriftungen darin, an
    # ihrer Stelle. „Microsoft Print to PDF“ & Co. zerlegen ein Bild in viele
    # Streifen, und die Beschriftung eines Schaubilds ist Text daneben; einzeln
    # übernommen fiele beides auseinander.
    def free(box: tuple[float, float, float, float], pad: float = 1.0) -> bool:
        return not any(_inside({"x0": box[0], "x1": box[2], "top": box[1], "bottom": box[3]}, t, pad=pad) for t in taken)

    parts: list[list[float]] = []   # [x0, top, x1, bottom, Rasterbilder, Zeichnungsteile]
    for im in page.images:
        box = (float(im["x0"]), float(im["top"]), float(im["x1"]), float(im["bottom"]))
        if box[2] - box[0] < 2 or box[3] - box[1] < 2 or not free(box):
            continue
        if box[1] < 0.1 * h and box[3] < 0.14 * h and box[2] - box[0] < 0.3 * w:
            continue  # Logo in der Kopfzeile
        if template and _box_key(im) in template:
            continue  # Logo o. Ä. der Vorlage, auf vielen Seiten an derselben Stelle
        parts.append([*box, 1, 0])
    for obj in list(page.lines) + list(page.curves) + list(page.rects):
        box = (float(obj["x0"]), float(obj["top"]), float(obj["x1"]), float(obj["bottom"]))
        bw, bh = box[2] - box[0], box[3] - box[1]
        if bw * bh > 0.3 * w * h:
            continue  # Seitenrahmen, Hintergrund der Folie (gedruckte Präsentation)
        if bw > 0.75 * w or bh > 0.6 * h:
            continue  # Trennlinie, Rand oder Streifen der Vorlage (Kopf-, Fußzeile, Logo-Spalte)
        if box[1] < 0.1 * h and box[3] < 0.14 * h and bw < 0.3 * w:
            continue  # Kopfzeile
        if not free(box, pad=3):
            continue
        parts.append([*box, 0, 1])

    def merge(items: list[list[float]], gap: float) -> list[list[float]]:
        out = [list(b) for b in items]
        changed = True
        while changed:
            changed = False
            merged: list[list[float]] = []
            for b in out:
                for o in merged:
                    if b[0] <= o[2] + gap and o[0] <= b[2] + gap and b[1] <= o[3] + gap and o[1] <= b[3] + gap:
                        o[0], o[1], o[2], o[3] = min(o[0], b[0]), min(o[1], b[1]), max(o[2], b[2]), max(o[3], b[3])
                        o[4] += b[4]
                        o[5] += b[5]
                        changed = True
                        break
                else:
                    merged.append(b)
            out = merged
        return out

    # Nahe Teile gehören zusammen (Bildstreifen, Pfeile, Rahmen um ein Schaubild).
    groups = [g for g in merge(parts, 12.0)
              if (g[4] and g[2] - g[0] >= 18 and g[3] - g[1] >= 18)
              or (g[5] >= 4 and g[2] - g[0] >= 30 and g[3] - g[1] >= 30 and g[1] >= 0.1 * h)]
    # Beschriftungen im Bereich gehören dazu; ragen sie hinaus, wächst der Bereich mit.
    # Große Schrift (Titel, Untertitel, Aufzählung) nur, wenn sie auf einem Bild steht.
    rasters = [(p[0], p[1], p[2], p[3]) for p in parts if p[4]]

    # Wortgruppen: Wörter einer Zeile, die dicht beieinander stehen. Entschieden
    # wird je Gruppe – sonst zerfiele eine Zeile Fließtext am Rand eines Bildes.
    phrase_of: dict[int, list[dict[str, Any]]] = {}
    for wd in sorted(all_words, key=lambda x: (round(float(x["top"])), float(x["x0"]))):
        size = float(wd.get("size") or 10)
        for ph in {id(p): p for p in phrase_of.values()}.values():
            last = ph[-1]
            if abs(float(last["top"]) - float(wd["top"])) < 0.5 * size and 0 <= float(wd["x0"]) - float(last["x1"]) < 1.2 * size:
                ph.append(wd)
                phrase_of[id(wd)] = ph
                break
        else:
            phrase_of[id(wd)] = [wd]

    def label(wd: dict[str, Any], g: list[float]) -> bool:
        ph = phrase_of.get(id(wd), [wd])
        box = {"x0": min(float(x["x0"]) for x in ph), "x1": max(float(x["x1"]) for x in ph),
               "top": min(float(x["top"]) for x in ph), "bottom": max(float(x["bottom"]) for x in ph)}
        if not _inside(box, (g[0], g[1], g[2], g[3]), pad=2):
            return False
        if ph[0]["text"] in ("l", "Ø", "§", "•", "▪") and float(ph[0].get("size") or 0) >= 12:
            return False  # Aufzählungspunkt neben dem Bild
        on_photo = any(_inside(box, r, pad=0) for r in rasters)
        # Beschriftung: kurz (eine Zeile Fließtext ist länger) und klein – oder auf einem Foto.
        return on_photo or (len(ph) <= 6 and float(wd.get("size") or 0) < 15)

    for _ in range(2):
        for g in groups:
            for wd in all_words:
                if label(wd, g):
                    g[0], g[1] = min(g[0], float(wd["x0"])), min(g[1], float(wd["top"]))
                    g[2], g[3] = max(g[2], float(wd["x1"])), max(g[3], float(wd["bottom"]))
        groups = merge(groups, 4.0)
    absorbed: set[int] = set()
    figures: list[tuple[float, float, float, float]] = []
    figure_elements: list[tuple[tuple[float, float, float, float], dict[str, Any]]] = []
    for x0, top, x1, bottom, n_img, n_shape in sorted(groups, key=lambda g: (g[1], g[0])):
        box = (x0 - 3, top - 3, x1 + 3, bottom + 3)
        inside = [wd for wd in all_words if id(wd) not in absorbed and _inside(wd, box, pad=0)]
        mine = [wd for wd in inside if label(wd, [x0, top, x1, bottom])]
        # Große Schrift im Rechteck, aber neben den Bildern (Untertitel neben einer Collage),
        # und Text, der nur hineinragt: bleibt Text und wird im Bild übermalt.
        others = [wd for wd in all_words if id(wd) not in absorbed and wd not in mine
                  and float(wd["x0"]) < box[2] and float(wd["x1"]) > box[0] and float(wd["top"]) < box[3] and float(wd["bottom"]) > box[1]
                  and not any(_inside(wd, r, pad=0) for r in rasters)]
        # Logo o. Ä. der Vorlage, das in den Ausschnitt ragt, gehört nicht ins Bild.
        others += [im for im in page.images if template and _box_key(im) in template]
        try:
            src = _png_data_uri(_crop_image(page, box, blank=others))
        except Exception:  # noqa: BLE001
            warnings.append(f"Seite {index + 1}: ein Bild ließ sich nicht lesen.")
            continue
        absorbed.update(id(wd) for wd in mine)
        figures.append(box)
        block = {"type": "image", "src": src, "width": _width_cm(x0, x1, SLIDE_WIDTH_CM if w > 1.15 * h else TEXT_WIDTH_CM)}
        # Mit Zeichnungsteilen oder Beschriftungen: Lage im PDF (`_fig`), damit die App
        # den Bereich auf Wunsch als bearbeitbare Zeichnung (.odg) holen kann (pdf_figures.py).
        if n_shape or mine:
            # Was im Rechteck nicht dazugehört (Titel, Aufzählung, Logo): bleibt in der Zeichnung weg.
            skip: list[list[float]] = []
            for wd in others:
                ph = phrase_of.get(id(wd), [wd])
                r = [round(min(float(x["x0"]) for x in ph), 1), round(min(float(x["top"]) for x in ph), 1),
                     round(max(float(x["x1"]) for x in ph), 1), round(max(float(x["bottom"]) for x in ph), 1)]
                if r not in skip:
                    skip.append(r)
            block["_fig"] = {"page": index, "box": [round(v, 1) for v in box], "skip": skip}
        element = {"kind": "block", "top": top, "bottom": bottom, "x0": x0, "x1": x1, "page": index, "block": block}
        elements.append(element)
        figure_elements.append((box, element))

    if w > 1.15 * h:
        _photo_groups(elements, figure_elements, [wd for wd in all_words if id(wd) not in absorbed], taken)
    taken.extend(figures)
    # Text: alles außerhalb von Tabellen usw., was nicht als Beschriftung in einem Bild steckt.
    words = [wd for wd in all_words if id(wd) not in absorbed and not any(_inside(wd, t) for t in taken[:len(taken) - len(figures)])]
    lines = _group_lines(words)
    # Folie (Querformat): rote Schrift ist Gestaltung (Titel), keine Lösung.
    slide = w > 1.15 * h
    for ln in lines:
        ln["page"] = index
        ln["h"] = h
        if slide:
            ln["red"] = False
            # Aufzählungszeichen aus Wingdings (PowerPoint) kommen als „l“ bzw. „Ø“ an.
            ln["text"] = re.sub(r"^[lØ§]\s+(?=\S)", "• ", ln["text"])
    lines = _formulas(page, lines, elements, warnings)
    if not all_words and page.images:
        warnings.append(f"Seite {index + 1} enthält keinen Text – gescannt? Dafür „Seiten als Bilder“ oder die KI-Erkennung nehmen.")
    for el in elements:
        el.setdefault("page", index)  # Lage im PDF (_pos) für alle Bausteine
    return elements, lines


def _formulas(page, lines: list[dict[str, Any]], elements: list[dict[str, Any]], warnings: list[str]) -> list[dict[str, Any]]:
    """
    Formeln aus dem Formeleditor: kursive, kurze Zeilen mit Rechenzeichen.
    Einzeilig → Formel-Baustein (wenn alle Zeichen bekannt sind), mehrzeilig
    (Brüche) → Bild des Bereichs. Liefert die übrigen Zeilen.
    """
    cand = [ln for ln in lines if ln.get("italic") and len(ln["text"]) <= 60]
    groups: list[list[dict[str, Any]]] = []
    for ln in sorted(cand, key=lambda l: l["top"]):
        if groups and ln["top"] - groups[-1][-1]["bottom"] < 0.6 * ln["size"]:
            groups[-1].append(ln)
        else:
            groups.append([ln])
    used: set[int] = set()
    as_image = 0
    for g in groups:
        if not any(MATH_HINT_RE.search(ln["text"]) for ln in g):
            continue
        top, bottom = min(l["top"] for l in g), max(l["bottom"] for l in g)
        x0, x1 = min(l["x0"] for l in g), max(l["x1"] for l in g)
        if len(g) == 1:
            math = to_starmath(g[0]["text"])
            if not math:
                continue
            block: dict[str, Any] = {"type": "formula", "math": math}
        else:
            try:
                src = _png_data_uri(_crop_image(page, (x0 - 4, top - 4, x1 + 4, bottom + 4), resolution=200))
            except Exception:  # noqa: BLE001
                continue
            block = {"type": "image", "src": src, "width": _width_cm(x0 - 4, x1 + 4), "alt": "Formel"}
            as_image += 1
        elements.append({"kind": "block", "top": top, "bottom": bottom, "x0": x0, "page": g[0]["page"], "block": block})
        used.update(id(l) for l in g)
    if as_image:
        warnings.append(f"{as_image} mehrzeilige Formel{'n' if as_image > 1 else ''} als Bild übernommen – im Editor über ➕ Einfügen → Formel neu setzen.")
    return [ln for ln in lines if id(ln) not in used]


def _drop_running(pages_lines: list[list[dict[str, Any]]]) -> str:
    """Kopf- und Fußzeilen, die auf mehreren Seiten wiederkehren, entfernen."""
    key = lambda ln: re.sub(r"\d+", "#", ln["text"].strip())  # noqa: E731
    edge = lambda ln: ln["top"] < 0.09 * ln["h"] or ln["bottom"] > 0.93 * ln["h"]  # noqa: E731
    counts = Counter(k for lines in pages_lines for k in {key(ln) for ln in lines if edge(ln)})
    repeated = {k for k, n in counts.items() if n >= 2}
    # Kleine Zeilen, die auf vielen Seiten wiederkehren, auch abseits des Rands:
    # Fußzeile einer auf A4 gedruckten Folie (Datum, Titel, Foliennummer).
    sizes = sorted(ln["size"] for lines in pages_lines for ln in lines)
    small = (sizes[len(sizes) // 2] * 0.8) if sizes else 0
    anywhere = Counter(k for lines in pages_lines for k in {key(ln) for ln in lines if ln["size"] < small})
    footer = {k for k, n in anywhere.items() if len(pages_lines) >= 3 and n >= max(3, 0.4 * len(pages_lines))}
    header = ""
    for lines in pages_lines:
        for ln in list(lines):
            if key(ln) in footer or (edge(ln) and (key(ln) in repeated or PAGE_NO_RE.match(ln["text"].strip()))):
                header = header or ln["text"]
                lines.remove(ln)
    return header


def _two_columns(lines: list[dict[str, Any]], width: float) -> bool:
    right = [ln for ln in lines if ln["x0"] > 0.45 * width]
    left = [ln for ln in lines if ln["x1"] < 0.55 * width]
    if len(right) < 5 or len(left) < 5:
        return False
    overlap = sum(1 for r in right if any(abs(r["top"] - l["top"]) < 3 for l in left))
    return overlap >= 0.5 * len(right)


def text_to_spec(data: bytes) -> tuple[dict[str, Any], list[str], str]:
    import pdfplumber

    warnings: list[str] = []
    try:
        pdf = pdfplumber.open(io.BytesIO(data))
    except Exception as e:  # noqa: BLE001
        raise PdfImportError(f"Kein lesbares PDF ({e})") from e
    with pdf:
        pages = pdf.pages[:MAX_PAGES]
        if len(pdf.pages) > MAX_PAGES:
            warnings.append(f"Nur die ersten {MAX_PAGES} von {len(pdf.pages)} Seiten übernommen.")
        template = _template_images(pages)
        per_page = [_page_elements(p, i, warnings, template) for i, p in enumerate(pages)]
        pages_lines = [lines for _, lines in per_page]
        _drop_running(pages_lines)
        if any(_two_columns(lines, float(p.width)) for lines, p in zip(pages_lines, pages)):
            warnings.append("Mehrspaltiger Satz erkannt – die Reihenfolge der Absätze bitte prüfen.")
        meta_title = ((pdf.metadata or {}).get("Title") or "").strip()

    all_lines = [ln for lines in pages_lines for ln in lines]
    if not all_lines and not any(els for els, _ in per_page):
        raise PdfImportError("Im PDF ist kein Text – vermutlich gescannt. Dafür „Seiten als Bilder“ oder die KI-Erkennung nehmen.")

    # Grundschrift: die häufigste Größe (nach Zeichen gewichtet)
    weight = Counter()
    for ln in all_lines:
        weight[round(ln["size"] * 2) / 2] += len(ln["text"])
    body = weight.most_common(1)[0][0] if weight else 11.0
    big = sorted({round(ln["size"] * 2) / 2 for ln in all_lines if ln["size"] >= body * 1.15 and len(ln["text"]) <= 120}, reverse=True)[:3]
    levels = ["section", "task", "subtask"]

    # Üblicher Abstand zwischen zwei Zeilen eines Absatzes – ein Absatz ist
    # merklich mehr.
    gaps = []
    for lines in pages_lines:
        for a, b in zip(lines, lines[1:]):
            g = b["top"] - a["bottom"]
            if 0 <= g < a["size"] and abs(a["size"] - b["size"]) < 0.5:
                gaps.append(g)
    line_gap = statistics.median(gaps) if gaps else 0.25 * body

    title = meta_title
    headers: list[dict[str, Any]] = [el for els, _ in per_page for el in els if el["kind"] == "header"]

    # Fluss: je Seite nach Position, Seiten nacheinander
    flow: list[dict[str, Any]] = []
    for (els, _), lines in zip(per_page, pages_lines):
        items = [e for e in els if e["kind"] == "block"] + lines
        flow.extend(sorted(items, key=lambda e: (round(e["top"]), e.get("x0", 0))))

    def heading_level(ln: dict[str, Any], prev: dict[str, Any] | None) -> str | None:
        text = ln["text"].strip()
        if len(text) > 120 or text.endswith((",", ";")):
            return None
        size = round(ln["size"] * 2) / 2
        if size in big:
            return levels[big.index(size)]
        outline = OUTLINE_RE.match(text)
        # Nur, wenn die Nummer zum laufenden Abschnitt passt – „3.3 V liegt an“ ist keine Aufgabe.
        if outline and len(text) <= 90 and not text.endswith(".") and int(outline.group(1)) == section_no:
            return "task" if outline.group(2).count(".") == 1 else "subtask"
        if ln["bold"] and len(text) <= 90 and not text.endswith(".") and not BULLET_RE.match(text):
            gap = (ln["top"] - prev["bottom"]) if prev and prev.get("kind") == "line" and prev.get("page") == ln.get("page") else 99
            if gap > 0.35 * ln["size"]:
                return levels[min(len(big), 2)]
        return None

    content: list[dict[str, Any]] = []
    para: dict[str, Any] | None = None   # offener Absatz: {"lines": [...], "red": bool}
    lst: dict[str, Any] | None = None    # offene Liste: {"items": [...], "ordered": bool, "x0": float, "red": bool}
    prev_line: dict[str, Any] | None = None
    max_width = max((ln["x1"] - ln["x0"] for ln in all_lines), default=400)

    def at(src: dict[str, Any] | None) -> list[float] | None:
        """Lage im PDF (Seite, Höhe in pt) – `_pos` am Baustein. Damit legt der .xopp-Import
        die Beschriftung an die passende Stelle; LearningModules entfernt es beim Übernehmen."""
        return [int(src.get("page", 0)), round(float(src.get("top", 0)), 1)] if src else None

    def emit(block: dict[str, Any], red: bool = False, src: dict[str, Any] | None = None) -> None:
        pos = at(src)
        if red:
            last = content[-1] if content else None
            if last and last.get("type") == "solution":
                last["blocks"].append(block)
            else:
                content.append({"type": "solution", "blocks": [block], **({"_pos": pos} if pos else {})})
        else:
            if pos:
                block["_pos"] = pos
            content.append(block)

    def flush() -> None:
        nonlocal para, lst
        if para:
            text = ""
            right = max(ln["x1"] for ln in para["lines"])
            left = min(ln["x0"] for ln in para["lines"])
            for i, ln in enumerate(para["lines"]):
                t = ln["text"]
                before = para["lines"][i - 1] if i else None
                if i == 0:
                    text = t
                elif ln.get("newpara"):
                    text += "\n\n" + t
                elif text.endswith("-") and t[:1].islower():
                    text = text[:-1] + t
                elif (before["text"].rstrip().endswith((".", "!", "?", ":")) and before["x1"] < left + 0.85 * (right - left)
                      and re.match(r"[A-ZÄÖÜ0-9„\"(]", t)):
                    text += "\n\n" + t  # Satzende weit vor dem Rand: neuer Absatz
                elif before["x1"] - before["x0"] < 0.6 * max_width:
                    text += "\n" + t  # kurze Zeile: gewollter Umbruch
                else:
                    text += " " + t
            emit({"type": "text", "text": text}, para["red"], para["lines"][0])
            para = None
        if lst:
            emit({"type": "list", "items": lst["items"], **({"ordered": True} if lst["ordered"] else {})}, lst["red"], lst.get("first"))
            lst = None

    images = [el for el in flow if el["kind"] == "block" and el["block"].get("type") == "image" and el["block"].get("alt") != "Formel"]

    def caption_for(ln: dict[str, Any]) -> dict[str, Any] | None:
        """Bild, unter dem die Zeile als Unterschrift steht – auch wenn daneben Text floss."""
        cx = (ln["x0"] + ln["x1"]) / 2
        limit = 3.2 * body if ln["size"] < 0.9 * body else 1.6 * ln["size"]
        for im in images:
            if im.get("page") != ln.get("page") or im["block"].get("caption"):
                continue
            if 0 <= ln["top"] - im["bottom"] < limit and im["x0"] - 20 <= cx <= im.get("x1", im["x0"]) + 20:
                return im
        return None

    section_no = 0
    for el in flow:
        if el["kind"] == "block":
            # „kreisflaeche.py“ direkt über dem Code ist seine Beschriftung.
            if el["block"].get("type") == "code" and para and len(para["lines"]) == 1 \
                    and re.fullmatch(r"[\w./-]+\.\w{1,5}", para["lines"][0]["text"].strip()) \
                    and el["top"] - para["lines"][0]["bottom"] < 2 * para["lines"][0]["size"]:
                el["block"]["caption"] = para["lines"][0]["text"].strip()
                para = None
            flush()
            emit(el["block"], src=el)
            prev_line = None
            continue
        ln = el
        text = ln["text"].strip()
        if not text:
            continue
        # Bildunterschrift: kurze Zeile unter einem Bild
        im = caption_for(ln) if len(text) <= 160 and round(ln["size"] * 2) / 2 not in big else None
        if im:
            im["block"]["caption"] = text
            im["bottom"] = ln["bottom"]
            continue
        # Ein Aufzählungspunkt bleibt einer, auch in großer Schrift (Folien).
        level = heading_level(ln, prev_line) if not BULLET_RE.match(text) else None
        if level:
            flush()
            clean = HEADNUM_RE.sub("", text).strip() or text
            if not title and level == "section" and not content:
                title = clean
            block = {"type": level, ("text" if level == "section" else "title"): clean}
            if level == "section":
                section_no += 1
            if ln["red"]:
                emit({"type": "text", "text": clean}, True, ln)
            else:
                emit(block, src=ln)
            prev_line = ln
            continue
        bullet = BULLET_RE.match(text)
        ordered = ORDERED_RE.match(text) if not bullet else None
        gap = (ln["top"] - prev_line["bottom"]) if prev_line and prev_line.get("page") == ln.get("page") else 99
        # „– sie steht …“ mitten im Satz ist ein Gedankenstrich, kein Listenpunkt.
        if bullet and bullet.group(1) in "-–—" and para and gap <= line_gap + 0.2 * ln["size"] \
                and not para["lines"][-1]["text"].rstrip().endswith((".", ":", "!", "?")):
            bullet = None
        if bullet or ordered:
            if para:
                flush()
            if lst and (lst["red"] != ln["red"] or bool(ordered) != lst["ordered"]):
                flush()
            if not lst:
                lst = {"items": [], "ordered": bool(ordered), "x0": ln["x0"], "red": ln["red"], "first": ln}
            lst["items"].append((bullet or ordered).group(2).strip())
            lst["last"] = ln
        elif lst and ln["x0"] > lst["x0"] + 4 and gap < 0.8 * ln["size"]:
            # Fortsetzung des letzten Listenpunkts
            lst["items"][-1] += " " + text
        else:
            if lst:
                flush()
            same = para and para["red"] == ln["red"] and gap <= line_gap + 0.3 * ln["size"] and abs(ln["size"] - para["lines"][-1]["size"]) < 1.5
            if para and not same and para["red"] == ln["red"] and gap < 2.2 * ln["size"]:
                ln = {**ln, "newpara": True}  # neuer Absatz im selben Textblock
                para["lines"].append(ln)
            elif same:
                para["lines"].append(ln)
            else:
                flush()
                para = {"lines": [ln], "red": ln["red"]}
        prev_line = ln
    flush()

    if not title and headers:
        title = headers[0]["text"]
    if any(b.get("type") == "solution" for b in content):
        warnings.append("Rote Schrift wurde zur Lösung – bitte prüfen, ob sie hinter dem passenden Karo steht.")
    warnings.append("Formeln, Textrahmen und Karos aus dem PDF bitte prüfen – sie lassen sich nur ungefähr erkennen.")
    return {"content": content}, warnings, title


def pdf_to_spec(data: bytes, mode: str = "text") -> tuple[dict[str, Any], list[str], str]:
    if not data.startswith(b"%PDF"):
        raise PdfImportError("Das ist kein PDF.")
    if mode == "pages":
        return pages_to_spec(data)
    if mode == "text":
        return text_to_spec(data)
    raise PdfImportError(f"Unbekannte Art: {mode}")


if __name__ == "__main__":
    # python tools/pdf_import.py datei.pdf|- [text|pages] [--kurz]
    # „-“ liest das PDF von stdin (so ruft server.py auf); --kurz kürzt Bilder.
    import json
    import sys

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    raw = sys.stdin.buffer.read() if args[0] == "-" else open(args[0], "rb").read()
    try:
        spec, warns, ttl = pdf_to_spec(raw, args[1] if len(args) > 1 else "text")
    except PdfImportError as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(2)
    if "--kurz" in sys.argv:
        for b in spec["content"]:
            if b.get("type") == "image":
                b["src"] = b["src"][:40] + "…"
    print(json.dumps({"title": ttl, "warnings": warns, "spec": spec}, ensure_ascii=False, indent=1 if "--kurz" in sys.argv else None))
