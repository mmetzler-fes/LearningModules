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


def _text(doc, page, text: str, x: float, y: float, size: float = 18) -> None:
    import ctypes
    obj = pdfium_c.FPDFPageObj_NewTextObj(doc.raw, b"Helvetica", ctypes.c_float(size))
    data = (text + "\0").encode("utf-16-le")
    pdfium_c.FPDFText_SetText(obj, ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_ushort)))
    pdfium_c.FPDFPageObj_Transform(obj, 1, 0, 0, 1, x, y)
    pdfium_c.FPDFPage_InsertObject(page.raw, obj)


def _photo_slide(text_between: bool) -> bytes:
    """Eine Folie mit drei Fotos (zwei oben, eins unten rechts versetzt) – auf Wunsch Text zwischen den oberen."""
    doc = pdfium.PdfDocument.new()
    page = doc.new_page(842, 595)
    _text(doc, page, "Titel der Folie", 80, 520, 24)
    _image(doc, page, "red", 100, 250, 200, 150)       # oben links (y von unten)
    _image(doc, page, "green", 420, 250, 200, 150)     # oben rechts
    _image(doc, page, "blue", 300, 60, 180, 120)       # unten in der Mitte
    if text_between:
        _text(doc, page, "Text", 330, 320, 18)
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


    def test_fotos_ohne_text_dazwischen_werden_bildgruppe(self):
        spec, _warnings, _title = text_to_spec(_photo_slide(False))
        groups = [b for b in spec["content"] if b["type"] == "group"]
        self.assertEqual(len(groups), 1)
        self.assertFalse([b for b in spec["content"] if b["type"] == "image"])
        g = groups[0]
        self.assertEqual(len(g["items"]), 3)
        # 520 × 340 pt: zwei oben nebeneinander, eins darunter – Lage in Prozent der Gruppe.
        self.assertAlmostEqual(g["ratio"], 346 / 526, places=2)
        first = g["items"][0]
        self.assertAlmostEqual(first["x"], 0, delta=0.5)
        self.assertAlmostEqual(first["y"], 0, delta=0.5)
        self.assertAlmostEqual(first["w"], 206 / 526 * 100, delta=1)
        self.assertTrue(all(it["src"].startswith("data:image/png;base64,") for it in g["items"]))

    def test_text_zwischen_fotos_trennt(self):
        spec, _warnings, _title = text_to_spec(_photo_slide(True))
        groups = [b for b in spec["content"] if b["type"] == "group"]
        images = [b for b in spec["content"] if b["type"] == "image"]
        # Links oben bleibt für sich; rechts oben und unten in der Mitte (nichts dazwischen) zusammen.
        self.assertEqual(len(images), 1)
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]["items"]), 2)


if __name__ == "__main__":
    unittest.main()
