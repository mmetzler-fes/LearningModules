"""Tests für den Generator selbst (Auszeichnung, neue Blöcke).

    .venv/bin/python -m unittest discover -s tests
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

GEN = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(GEN / "tools"))
import make_worksheet as mw  # noqa: E402


class InlineTest(unittest.TestCase):
    def test_auszeichnung(self):
        self.assertEqual(mw.parse_inline("**fett** und *kursiv*"),
                         [("b", [("text", "fett")]), ("text", " und "), ("i", [("text", "kursiv")])])
        self.assertEqual(mw.parse_inline("***x***"), [("b", [("i", [("text", "x")])])])
        self.assertEqual(mw.parse_inline("CO_{2} x^{2}"), [("text", "CO"), ("sub", "2"), ("text", " x"), ("sup", "2")])
        self.assertEqual(mw.parse_inline("[L](https://a.b) `c`"),
                         [("a", ("https://a.b", [("text", "L")])), ("text", " "), ("code", "c")])

    def test_nur_am_wortrand(self):
        for text in ['"8*7 = 56" und "8*7"', "a**b**c", "C++ und i++", "10^9", "__init__"]:
            self.assertEqual(mw.parse_inline(text), [("text", text)], text)

    def test_escape_und_umbruch(self):
        self.assertEqual(mw.parse_inline(r"\*kein\*"), [("text", "*kein*")])
        self.assertEqual(mw.text_lines("eins\\\nzwei"), ["eins", "zwei"])


class RenderTest(unittest.TestCase):
    def test_erweitertes_blatt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "arbeitsblatt.yaml").write_bytes((GEN / "tests" / "erweitert.yaml").read_bytes())
            (root / "blatt" / "bild.png").write_bytes((GEN / "tests" / "bild.png").read_bytes())
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/arbeitsblatt.yaml",
                            "--loesung", "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            for needle in ['style:name="AB_Fett"', 'style:name="AB_Kursiv"', 'style:name="AB_Unterstrichen"',
                           'style:name="AB_Durchgestrichen"', 'style:name="AB_Hoch"', 'xlink:href="https://example.org"',
                           'text:is-list-header="true"', 'table:number-columns-spanned="2"', 'table:number-rows-spanned="2"',
                           '<table:covered-table-cell/>', 'table:name="Kasten1"', 'table:name="Neben1"',
                           'style:name="AB_Bild_Rahmen"', 'fo:text-align="center"', '<text:line-break/>']:
                self.assertIn(needle, content, needle)
            self.assertIn("8*7 bleibt", content)
            styles = zipfile.ZipFile(root / "out" / "blatt.odt").read("styles.xml").decode()
            self.assertIn('style:name="AB_Nummerierung"', styles)

    def test_schreibfelder(self):
        """Block `karo` mit Breite und Muster: schmales Karo, Linien, leeres Feld."""
        spec = (
            "titel: Felder\ncontent:\n"
            "  - {type: karo, lines: 4}\n"
            "  - {type: karo, lines: 4, width: 8cm}\n"
            "  - {type: karo, lines: 6, pattern: linien}\n"
            "  - {type: karo, lines: 5, width: 10cm, pattern: leer}\n"
            "  - {type: karo, lines: 3, width: 99cm}\n"
            "  - {type: karo, lines: 2, pattern: frei}\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "felder.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/felder.yaml",
                            "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            # volles Raster wie bisher, 8 cm = 16 Spalten, Linien je 1 cm (3 Zeilen), leer: ein Feld 2,5 cm
            self.assertIn('table:name="Karo1" table:style-name="Karo"', content)
            self.assertIn('style:name="Karo16"', content)
            self.assertIn('style:width="8.000cm"', content)
            self.assertIn('style:name="FeldLinien33"', content)
            self.assertIn('style:name="Feld.Zeile2"', content)
            self.assertIn('style:name="FeldLeer20"', content)
            self.assertIn('style:name="Feld.Zeile5"', content)
            # zu breit: höchstens die Satzbreite
            self.assertIn('table:name="Karo5" table:style-name="Karo"', content)
            # frei: ein Feld ohne Rahmen
            self.assertIn('style:name="FeldFrei33"', content)
            self.assertRegex(content, r'style:name="FeldFrei33.A1"[^>]*>\s*<style:table-cell-properties[^>]*fo:border="none"')
        self.assertEqual(mw.karo_columns({"width": "8cm"}), 16)
        self.assertEqual(mw.karo_columns({"width": "0.2cm"}), 2)
        self.assertEqual(mw.karo_columns({}), mw.KARO_COLUMNS)


if __name__ == "__main__":
    unittest.main()
