#!/usr/bin/env python3
"""Passende Schrift für die Texte einer PDF-Seite – nach den Zeichenbreiten.

Gedruckte Präsentationen („Microsoft Print to PDF“ & Co.) nennen ihre
Schriften oft nur „CIDFont+F2“, und auch die eingebettete Datei trägt keinen
Namen mehr. LibreOffice nimmt dann Times – die Texte einer Zeichnung laufen zu
breit. Die Breiten der Zeichen stehen aber im PDF: Sie werden mit den Schriften
verglichen, die der Renderer hat (Carlito ist so breit wie Calibri, Caladea wie
Cambria, Liberation wie Arial/Times …); die beste gewinnt.
"""
from __future__ import annotations

import statistics
import subprocess
from functools import lru_cache
from typing import Any

# Schrift im Renderer → gleich breite Schrift unter Windows (für die Anzeige im Browser)
CANDIDATES = {
    "Carlito": "Calibri",
    "Caladea": "Cambria",
    "Liberation Sans": "Arial",
    "Liberation Serif": "Times New Roman",
    "Liberation Sans Narrow": "Arial Narrow",
    "Liberation Mono": "Courier New",
    "Open Sans": "Open Sans",
    "DejaVu Sans": "Verdana",
}
GOOD_ENOUGH = 0.05      # mittlere Abweichung der Breite in Geviert (1 = Schriftgröße)
SAMPLE = 400


@lru_cache(maxsize=1)
def _font_files() -> dict[tuple[str, bool], str]:
    """(Familie, fett) → Datei der installierten Kandidaten (fc-list)."""
    try:
        listing = subprocess.run(["fc-list", "--format", "%{family[0]}|%{style[0]}|%{file}\n"],
                                 capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.TimeoutExpired):
        return {}
    files: dict[tuple[str, bool], str] = {}
    for line in listing.splitlines():
        family, style, path = (line.split("|", 2) + ["", ""])[:3]
        if family in CANDIDATES and style in ("Regular", "Book", "Bold"):
            files.setdefault((family, style == "Bold"), path)
    return files


@lru_cache(maxsize=None)
def _font(path: str):
    from PIL import ImageFont  # kommt mit pdfplumber
    return ImageFont.truetype(path, 1000)


def guess_fonts(chars: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Zeichen einer Seite (pdfplumber `page.chars`) → {PDF-Schriftname: {"family", "bold", "error"}}."""
    by_font: dict[str, list[dict[str, Any]]] = {}
    for ch in chars:
        if ch.get("upright", True) and len(ch.get("text", "")) == 1 and ch["text"].strip() and float(ch.get("size") or 0) > 0:
            by_font.setdefault(ch["fontname"], []).append(ch)
    files = _font_files()
    out: dict[str, dict[str, Any]] = {}
    for name, sample in by_font.items():
        sample = sample[:SAMPLE]
        best = None
        for (family, bold), path in files.items():
            try:
                font = _font(path)
            except OSError:
                continue
            error = statistics.mean(abs(float(ch["width"]) / float(ch["size"]) - font.getlength(ch["text"]) / 1000) for ch in sample)
            if best is None or error < best[0]:
                best = (error, family, bold)
        if best and best[0] <= GOOD_ENOUGH:
            out[name] = {"family": best[1], "bold": best[2], "error": round(best[0], 4)}
    return out


def page_fonts(pdf_path: str, page_index: int) -> dict[str, dict[str, Any]]:
    import pdfplumber
    with pdfplumber.open(pdf_path) as pdf:
        return guess_fonts(pdf.pages[page_index].chars)
