"""PDF -> Spec (Dokument-Format von LearningModules) mit docling.

docling erkennt mit trainierten Modellen, die hier im Container laufen, das
Layout einer Seite (Überschriften, Absätze, Listen, Tabellen, Bilder,
Formeln) und rekonstruiert Tabellen. Optional erkennt es den Text gescannter
Seiten (OCR). Kein externer Dienst, kein Token eines Anbieters.

Das Ergebnis ist dasselbe Format wie beim Import im Renderer
(worksheet-renderer/tools/pdf_import.py): ``{"content": [...]}``.
"""

from __future__ import annotations

import base64
import io
import re
from typing import Any

PT_TO_CM = 2.54 / 72
TEXT_WIDTH_CM = 16.5
MAX_PAGES = 40

# „2.1 Bauteile suchen“ → Aufgabe; die Nummern setzt die App selbst.
OUTLINE_RE = re.compile(r"^(\d+(?:\.\d+){0,2})\.?\s+(?=\S)")

GREEK = {"α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon", "η": "eta", "θ": "theta",
         "λ": "lambda", "μ": "mu", "ν": "nu", "π": "pi", "ρ": "rho", "σ": "sigma", "τ": "tau", "φ": "phi",
         "ω": "omega", "Δ": "DELTA", "Ω": "OMEGA", "Φ": "PHI"}
MATH_OPS = {"·": " cdot ", "×": " times ", "÷": " div ", "−": " - ", "±": " +- ", "≈": " approx ", "≠": " <> ",
            "≤": " <= ", "≥": " >= ", "→": " -> ", "∞": " infinity ", "°": " degree ", "²": "^2", "³": "^3"}
STARMATH_OK_RE = re.compile(r'^[A-Za-z0-9 .,=+\-*/()%^_{}<>"]*$')


class ConvertError(Exception):
    pass


def to_starmath(text: str) -> str | None:
    """Einfache Formel als StarMath – oder None, wenn etwas unbekannt ist."""
    out = "".join(f" %{GREEK[c]} " if c in GREEK else MATH_OPS.get(c, c) for c in text)
    out = re.sub(r"\s+", " ", out).strip()
    return out if out and "=" in out and STARMATH_OK_RE.match(out) else None


def _png_data_uri(image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _width_cm(item) -> str | None:
    try:
        bbox = item.prov[0].bbox
        width = abs(bbox.r - bbox.l)
    except (AttributeError, IndexError):
        return None
    return f"{min(TEXT_WIDTH_CM, max(1.0, width * PT_TO_CM)):.1f}cm"


def _in_margin(item, doc) -> bool:
    """Ganz im oberen bzw. unteren Seitenrand – Kopf- und Fußzeile der Vorlage (Logo, Titel, Seite)."""
    try:
        prov = item.prov[0]
        height = doc.pages[prov.page_no].size.height
        box = prov.bbox.to_top_left_origin(page_height=height)
    except (AttributeError, IndexError, KeyError):
        return False
    return box.b < 0.11 * height or box.t > 0.94 * height


def _heading(text: str, level: int) -> tuple[str, str]:
    """Abschnitt / Aufgabe / Teilaufgabe – bevorzugt aus der Gliederungsnummer."""
    m = OUTLINE_RE.match(text)
    clean = OUTLINE_RE.sub("", text).strip() or text
    if m:
        depth = m.group(1).count(".")
        kind = ("section", "task", "subtask")[min(depth, 2)]
    else:
        kind = ("section", "task", "subtask")[min(max(level, 1), 3) - 1]
    return kind, clean


def _table(item, doc) -> dict[str, Any] | None:
    try:
        grid = item.data.grid
    except AttributeError:
        return None
    rows = [[re.sub(r"\s+", " ", (cell.text or "")).strip() for cell in row] for row in grid]
    rows = [r for r in rows if any(r)]
    if not rows:
        return None
    block: dict[str, Any] = {"type": "table", "header": rows[0], "rows": rows[1:]} if len(rows) > 1 else {"type": "table", "rows": rows}
    caption = _caption(item, doc)
    if caption:
        block["caption"] = caption
    return block


def _caption(item, doc) -> str:
    try:
        return (item.caption_text(doc) or "").strip()
    except Exception:  # noqa: BLE001 – ältere docling-Fassungen
        return ""


def document_to_spec(doc) -> tuple[dict[str, Any], list[str], str]:
    from docling_core.types.doc import DocItemLabel  # noqa: PLC0415

    content: list[dict[str, Any]] = []
    warnings: list[str] = []
    title = ""
    captions: set[str] = set()
    pictures = formulas_as_text = 0

    def add_text(text: str) -> None:
        last = content[-1] if content else None
        if last and last.get("type") == "text" and not last.get("_closed"):
            last["text"] += "\n\n" + text
        else:
            content.append({"type": "text", "text": text})

    def close() -> None:
        if content:
            content[-1]["_closed"] = True

    for item, level in doc.iterate_items():
        label = getattr(item, "label", None)
        text = (getattr(item, "text", "") or "").strip()
        if label in (DocItemLabel.PAGE_HEADER, DocItemLabel.PAGE_FOOTER) or _in_margin(item, doc):
            continue
        if label == DocItemLabel.CAPTION:
            if text in captions:
                continue
            close()
            content.append({"type": "note", "text": text})
            continue
        if label == DocItemLabel.TITLE:
            title = title or text
            continue
        if label == DocItemLabel.SECTION_HEADER:
            close()
            kind, clean = _heading(text, getattr(item, "level", level) or 1)
            content.append({"type": kind, ("text" if kind == "section" else "title"): clean})
            continue
        if label == DocItemLabel.LIST_ITEM:
            ordered = bool(getattr(item, "enumerated", False))
            last = content[-1] if content else None
            if last and last.get("type") == "list" and bool(last.get("ordered")) == ordered and not last.get("_closed"):
                last["items"].append(text)
            else:
                block: dict[str, Any] = {"type": "list", "items": [text]}
                if ordered:
                    block["ordered"] = True
                content.append(block)
            continue
        if label == DocItemLabel.PICTURE:
            close()
            image = None
            try:
                image = item.get_image(doc)
            except Exception:  # noqa: BLE001
                image = None
            if image is None:
                continue
            block = {"type": "image", "src": _png_data_uri(image)}
            width = _width_cm(item)
            if width:
                block["width"] = width
            caption = _caption(item, doc)
            if caption:
                block["caption"] = caption
                captions.add(caption)
            content.append(block)
            pictures += 1
            continue
        if label == DocItemLabel.TABLE:
            close()
            block = _table(item, doc)
            if block:
                if block.get("caption"):
                    captions.add(block["caption"])
                content.append(block)
            continue
        if label == DocItemLabel.CODE:
            close()
            content.append({"type": "code", "code": getattr(item, "text", "") or ""})
            continue
        if label == DocItemLabel.FORMULA:
            close()
            math = to_starmath(text) if text else None
            if math:
                content.append({"type": "formula", "math": math})
            elif text:
                content.append({"type": "text", "text": text})
                formulas_as_text += 1
            continue
        if label == DocItemLabel.FOOTNOTE:
            close()
            content.append({"type": "note", "text": text})
            continue
        if text:
            add_text(text)

    for block in content:
        block.pop("_closed", None)
    if formulas_as_text:
        warnings.append(f"{formulas_as_text} Formel(n) als Text übernommen – im Editor über ➕ Einfügen → Formel neu setzen.")
    warnings.append("KI-Erkennung: Karos, Lösungen und Formeln bitte im Editor prüfen.")
    return {"content": content}, warnings, title


_converters: dict[bool, Any] = {}


def converter(ocr: bool):
    """Ein Konverter je OCR-Einstellung – die Modelle werden nur einmal geladen."""
    if ocr not in _converters:
        from docling.datamodel.base_models import InputFormat  # noqa: PLC0415
        from docling.datamodel.pipeline_options import PdfPipelineOptions  # noqa: PLC0415
        from docling.document_converter import DocumentConverter, PdfFormatOption  # noqa: PLC0415

        opts = PdfPipelineOptions()
        opts.do_ocr = ocr
        if ocr:
            # Tesseract mit deutschem Sprachpaket (im Image) statt EasyOCR – kleiner, ohne Nachladen.
            from docling.datamodel.pipeline_options import TesseractCliOcrOptions  # noqa: PLC0415
            opts.ocr_options = TesseractCliOcrOptions(lang=["deu", "eng"])
        opts.do_table_structure = True
        opts.generate_picture_images = True
        opts.images_scale = 2.0
        _converters[ocr] = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
    return _converters[ocr]


def warm_up() -> None:
    """Modelle laden (beim Bauen des Images: herunterladen)."""
    from docling.datamodel.base_models import InputFormat  # noqa: PLC0415

    converter(False).initialize_pipeline(InputFormat.PDF)


def pdf_to_spec(data: bytes, ocr: bool = False) -> tuple[dict[str, Any], list[str], str]:
    from docling.datamodel.base_models import DocumentStream  # noqa: PLC0415

    if not data.startswith(b"%PDF"):
        raise ConvertError("Das ist kein PDF.")
    try:
        result = converter(ocr).convert(DocumentStream(name="import.pdf", stream=io.BytesIO(data)), max_num_pages=MAX_PAGES)
    except Exception as e:  # noqa: BLE001 – docling meldet sehr unterschiedlich
        raise ConvertError(f"Das PDF ließ sich nicht erkennen ({e}).") from e
    spec, warnings, title = document_to_spec(result.document)
    if not spec["content"]:
        raise ConvertError("Im PDF wurde nichts erkannt." + ("" if ocr else " Bei gescannten Seiten „Text erkennen (OCR)“ anhaken."))
    return spec, warnings, title


if __name__ == "__main__":  # python convert.py datei.pdf [--ocr]
    import json
    import sys

    spec, warns, ttl = pdf_to_spec(open(sys.argv[1], "rb").read(), "--ocr" in sys.argv)
    for b in spec["content"]:
        if b.get("type") == "image":
            b["src"] = b["src"][:40] + "…"
    print(json.dumps({"title": ttl, "warnings": warns, "spec": spec}, ensure_ascii=False, indent=1))
