"""Schrift nach den Zeichenbreiten (tools/pdf_fonts.py) – für Schaubilder ohne echte Schriftnamen."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

import pdf_fonts  # noqa: E402


def _chars(path: str, text: str, name: str, size: float = 12.0) -> list[dict]:
    """Zeichen, wie pdfplumber sie liefert – Breiten aus der Schriftdatei `path`."""
    font = pdf_fonts._font(path)
    return [{"text": ch, "fontname": name, "size": size, "upright": True, "width": font.getlength(ch) / 1000 * size}
            for ch in text if ch.strip()]


@unittest.skipUnless(("Liberation Sans", False) in pdf_fonts._font_files() and ("Liberation Serif", False) in pdf_fonts._font_files(),
                     "Liberation nicht installiert")
class GuessFonts(unittest.TestCase):
    TEXT = "Stromkasten mit Sicherungen – Leitung in der Wand, Leitungsquerschnitt 1,5 mm²"

    def test_breiten_verraten_die_schrift(self):
        files = pdf_fonts._font_files()
        chars = (_chars(files[("Liberation Sans", False)], self.TEXT, "CIDFont+F2")
                 + _chars(files[("Liberation Serif", False)], self.TEXT, "CIDFont+F3"))
        found = pdf_fonts.guess_fonts(chars)
        self.assertEqual(found["CIDFont+F2"]["family"], "Liberation Sans")
        self.assertEqual(found["CIDFont+F3"]["family"], "Liberation Serif")
        self.assertFalse(found["CIDFont+F2"]["bold"])
        self.assertLess(found["CIDFont+F2"]["error"], 0.002)

    def test_unpassend_bleibt_ohne_vorschlag(self):
        chars = [{"text": c, "fontname": "Seltsam", "size": 10, "upright": True, "width": 9.0} for c in "iiiiillll"]
        self.assertEqual(pdf_fonts.guess_fonts(chars), {})


if __name__ == "__main__":
    unittest.main()
