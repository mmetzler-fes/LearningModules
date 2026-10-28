"""Beschnittene Bilder einzeln mit Transparenz (tools/pdf_clips.py) – für Schaubilder als Zeichnung."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from PIL import Image  # noqa: E402

from pdf_clips import clipped_images  # noqa: E402


def _pdf() -> bytes:
    """Eine Seite 400 × 300 pt: ein rotes Bild, zum Achteck beschnitten (wie eine Plakette aus
    PowerPoint), daneben ein blaues mit rechteckigem Ausschnitt."""
    red = b"\xff\x00\x00" * 4
    blue = b"\x00\x00\xff" * 4
    octagon = b"130 100 m 170 100 l 200 130 l 200 170 l 170 200 l 130 200 l 100 170 l 100 130 l h W n "
    content = (b"q " + octagon + b"100 0 0 100 100 100 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID " + red + b" EI Q "
               b"q 250 100 100 100 re W n 100 0 0 100 250 100 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID " + blue + b" EI Q")
    objs = [b"<</Type/Catalog/Pages 2 0 R>>", b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
            b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 300]/Contents 4 0 R/Resources<<>>>>",
            b"<</Length %d>>stream\n" % len(content) + content + b"\nendstream"]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % n + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


class ClippedImages(unittest.TestCase):
    def test_achteck_mit_transparenz_rechteck_nicht(self):
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "s.pdf"
            pdf.write_bytes(_pdf())
            found = clipped_images(pdf, 0, [[0, 0, 400, 300]], Path(tmp) / "out")
            self.assertEqual(len(found), 1)  # nur das beschnittene, nicht das rechteckige
            self.assertEqual([round(v) for v in found[0]["box"]], [100, 100, 200, 200])
            img = Image.open(found[0]["png"]).convert("RGBA")
            self.assertEqual(img.getpixel((1, 1))[3], 0)                       # Ecke: durchsichtig
            r, g, b, a = img.getpixel((img.width // 2, img.height // 2))
            self.assertEqual(a, 255)
            self.assertGreater(r, 200)
            self.assertLess(g, 60)

    def test_ausserhalb_des_bereichs_nicht(self):
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "s.pdf"
            pdf.write_bytes(_pdf())
            self.assertEqual(clipped_images(pdf, 0, [[240, 0, 400, 300]], Path(tmp) / "out"), [])


if __name__ == "__main__":
    unittest.main()
