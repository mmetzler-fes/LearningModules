"""PDF-Import (tools/pdf_import.py): Bildbereiche gedruckter Präsentationen."""
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

import pypdfium2 as pdfium  # noqa: E402
import pypdfium2.raw as pdfium_c  # noqa: E402
from PIL import Image  # noqa: E402

from pdf_import import text_to_spec  # noqa: E402


def _jpeg(color: str) -> io.BytesIO:
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), color).save(buf, format="JPEG")
    buf.seek(0)
    return buf


def _image(doc, page, color: str, x: float, y: float, w: float, h: float) -> None:
    img = pdfium.PdfImage.new(doc)
    img.load_jpeg(_jpeg(color), inline=False)
    img.set_matrix(pdfium.PdfMatrix().scale(w, h).translate(x, y))
    page.insert_obj(img)


def _slides(pages: int = 3) -> bytes:
    """Folien im Querformat: ein Bild in vier Kacheln (wie „Microsoft Print to PDF“), oben rechts ein Logo."""
    doc = pdfium.PdfDocument.new()
    for _ in range(pages):
        page = doc.new_page(842, 595)
        for i, color in enumerate(("red", "green", "blue", "orange")):
            _image(doc, page, color, 200 + (i % 2) * 120, 200 + (i // 2) * 80, 120, 80)
        _image(doc, page, "gray", 660, 480, 100, 35)  # Logo, auf jeder Seite gleich
        page.gen_content()
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


class SlideFigures(unittest.TestCase):
    def test_kacheln_werden_ein_bild_logo_faellt_weg(self):
        spec, _warnings, _title = text_to_spec(_slides(3))
        images = [b for b in spec["content"] if b["type"] == "image"]
        # Je Seite genau ein Bild: die vier Kacheln zusammen, ohne das Logo der Vorlage.
        self.assertEqual(len(images), 3)
        self.assertEqual(images[0]["width"], "8.5cm")  # 240 pt breit


if __name__ == "__main__":
    unittest.main()
