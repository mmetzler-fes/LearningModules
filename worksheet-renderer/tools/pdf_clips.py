#!/usr/bin/env python3
"""Beschnittene Bilder einer PDF-Seite einzeln als PNG mit Transparenz (pypdfium2).

PowerPoint legt Plaketten, Pfeile oder runde Fotos oft als rechteckiges Bild
(z. B. einen Farbverlauf) an, das erst ein Beschneidungspfad zum Kreis oder
Pfeil macht. Der PDF-Import von LibreOffice übernimmt das Bild, aber nicht den
Pfad – in der Zeichnung stünde das ganze Rechteck. Hier zeichnet pdfium jedes
solche Bild allein (alles andere entfernt) mit durchsichtigem Hintergrund;
pdf_figures.py setzt das PNG an die Stelle des Bildes in LibreOffice.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c

MAX_EDGE = 800          # Pixel, längste Kante eines PNG
MAX_PATCHES = 120       # je Seite
RESOLUTION = 300        # dpi


def _shaped_clip(obj) -> bool:
    """Beschnitten mit mehr als einem Rechteck (ein Rechteck hat höchstens 5 Segmente)?"""
    clip = pdfium_c.FPDFPageObj_GetClipPath(obj.raw)
    if not clip:
        return False
    return any(pdfium_c.FPDFClipPath_CountPathSegments(clip, k) > 6 for k in range(pdfium_c.FPDFClipPath_CountPaths(clip)))


def _inside(box: tuple[float, float, float, float], area: list[float], pad: float = 6.0) -> bool:
    return box[0] >= area[0] - pad and box[1] >= area[1] - pad and box[2] <= area[2] + pad and box[3] <= area[3] + pad


def clipped_images(pdf: Path, page_index: int, areas: list[list[float]], out: Path) -> list[dict[str, Any]]:
    """PNGs der beschnittenen Bilder in den Bereichen `areas` ([x0, top, x1, bottom] in pt von oben links).
    Ergebnis: [{"box": [x0, top, x1, bottom], "png": Pfad}] in der Reihenfolge der Seite."""
    out.mkdir(parents=True, exist_ok=True)
    doc = pdfium.PdfDocument(str(pdf))
    try:
        page = doc[page_index]
        height = page.get_height()
        targets = []
        for i, obj in enumerate(page.get_objects(max_depth=1)):
            if obj.type != pdfium_c.FPDF_PAGEOBJ_IMAGE:
                continue
            left, bottom, right, top = obj.get_bounds()
            box = (left, height - top, right, height - bottom)
            if any(_inside(box, a) for a in areas) and _shaped_clip(obj):
                targets.append((i, box))
        page.close()
    finally:
        doc.close()
    found: list[dict[str, Any]] = []
    for i, box in targets[:MAX_PATCHES]:
        png = out / f"clip-{i}.png"
        try:
            _render_alone(pdf, page_index, i, box, png)
        except Exception:  # noqa: BLE001 – dieses Bild bleibt, wie LibreOffice es hat
            continue
        found.append({"box": [round(v, 2) for v in box], "png": str(png)})
    return found


def _render_alone(pdf: Path, page_index: int, keep: int, box: tuple[float, float, float, float], target: Path) -> None:
    """Nur das Objekt `keep` der Seite zeichnen – mit Beschneidung, ohne Hintergrund."""
    doc = pdfium.PdfDocument(str(pdf))
    page = doc[page_index]
    try:
        objs = list(page.get_objects(max_depth=1))
        for i, obj in enumerate(objs):
            if i != keep:
                page.remove_obj(obj)
                obj.close()
        page.gen_content()
        width, height = page.get_width(), page.get_height()
        edge = max(box[2] - box[0], box[3] - box[1], 1.0)
        scale = min(RESOLUTION / 72, MAX_EDGE / edge)
        bitmap = page.render(scale=scale, crop=(box[0], height - box[3], width - box[2], box[1]),
                             fill_color=(255, 255, 255, 0), force_bitmap_format=pdfium_c.FPDFBitmap_BGRA,
                             rev_byteorder=True)
        bitmap.to_pil().save(target, "PNG")
        bitmap.close()
    finally:
        page.close()
        doc.close()
