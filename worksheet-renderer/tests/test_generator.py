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

    def test_tabelle_breiten_und_hoehen(self):
        """`widths` legt Spalten fest (leer = automatisch), `heights` die Mindesthöhe je Zeile."""
        spec = (
            "titel: Tabellen\ncontent:\n"
            "  - {type: table, header: [A, B, C], rows: [[a, b, c]], widths: [4cm, '', 30mm], heights: ['', 2cm]}\n"
            "  - {type: table, rows: [[x, {text: y, colspan: 1}]], widths: [3cm, 5cm]}\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "tab.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/tab.yaml",
                            "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            self.assertRegex(content, r'style:name="ABTabelle.Sp\d+.0"[^>]*>\s*<style:table-column-properties style:column-width="4.000cm"')
            self.assertRegex(content, r'style:name="ABTabelle.Sp\d+.2"[^>]*>\s*<style:table-column-properties style:column-width="3.000cm"')
            self.assertIn('style:min-row-height="2.00cm"', content)
            # alle Spalten fest: Tabelle so breit wie die Summe, linksbündig
            self.assertRegex(content, r'style:name="ABTabelle.B\d+"[^>]*>\s*<style:table-properties style:width="8.000cm"')
        widths, total = mw.fixed_widths([5.0, 5.0], {"widths": ["", "2cm"]})
        self.assertEqual(widths[1], 2.0)
        self.assertAlmostEqual(sum(widths), mw.TABLE_WIDTH_CM)
        self.assertIsNone(total)
        self.assertEqual(mw.fixed_widths([5.0], {})[0], [5.0])

    def test_spalten(self):
        """`type: columns`: randlose Tabelle, je Spalte eine Zelle; feste Breite und Rest."""
        spec = (
            "titel: Spalten\ncontent:\n"
            "  - type: columns\n"
            "    blocks:\n"
            "      - {type: column, width: 9cm, blocks: [Links steht die Schaltung]}\n"
            "      - {type: column, blocks: [{type: table, header: [C, X], rows: [['', '']]}]}\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "sp.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/sp.yaml",
                            "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            self.assertIn('table:name="Neben1" table:style-name="ABNeben"', content)
            self.assertRegex(content, r'style:name="ABNeben.Sp1.0"[^>]*>\s*<style:table-column-properties style:column-width="9.400cm"')
            self.assertRegex(content, r'table:name="Neben1".*Links steht die Schaltung.*<table:table table:name="Tab\d+"')

    def test_beschriftung_aus_dem_stift_editor(self):
        """`ink` an einem Baustein: Rahmen mit dem SVG an einem winzigen Absatz davor,
        y um den oberen Abstand des Karos (0,2 cm) verschoben."""
        spec = (
            "titel: Stift\ncontent:\n"
            "  - {type: karo, lines: 4, ink: {file: stift/a.svg, x: 1, y: 0.5, width: 3, height: 1}}\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt" / "stift").mkdir(parents=True)
            (root / "blatt" / "sp.yaml").write_text(spec, encoding="utf-8")
            (root / "blatt" / "stift" / "a.svg").write_text(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 85 28" width="85pt" height="28pt"><path d="M0,0L85,28" stroke="#000"/></svg>',
                encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/sp.yaml",
                            "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            z = zipfile.ZipFile(root / "out" / "blatt.odt")
            content = z.read("content.xml").decode()
            self.assertRegex(content, r'<text:p text:style-name="AB_Stift[^"]*"><draw:frame draw:style-name="AB_StiftRahmen" draw:name="Stift1" '
                                      r'text:anchor-type="paragraph" svg:x="1.000cm" svg:y="0.700cm" svg:width="3.000cm" svg:height="1.000cm"')
            self.assertIn('style:horizontal-rel="paragraph"', content)
            self.assertIn('style:name="AB_Stift"', z.read("styles.xml").decode())
            self.assertTrue(any(n.endswith(".svg") for n in z.namelist()))

    def test_bild_neben_text_in_der_zelle(self):
        """`beside: true`: Text und Bild in einem Absatz, Bild mittig zur Zeile."""
        spec = (
            "titel: Neben\ncontent:\n"
            "  - type: table\n"
            "    rows:\n"
            "      - [{text: Schließer, beside: true, images: [{file: k.svg, width: 0.6cm}]}, betätigt]\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "sp.yaml").write_text(spec, encoding="utf-8")
            (root / "blatt" / "k.svg").write_text(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 30" width="10pt" height="30pt"><path d="M5,0L5,30" stroke="#000"/></svg>',
                encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/sp.yaml",
                            "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            self.assertRegex(content, r'Schließer<text:s/><draw:frame draw:style-name="AB_BildMitte"')
            self.assertIn('style:vertical-pos="middle" style:vertical-rel="line"', content)

    def test_tabelle_in_der_tabelle(self):
        """Bausteine in einer Zelle (`blocks`): die innere Tabelle steht in der Zelle."""
        spec = (
            "titel: Geschachtelt\ncontent:\n"
            "  - type: table\n"
            "    rows:\n"
            "      - [Links, {text: Rechts, blocks: [{type: table, header: [C, X], rows: [['', '']]}]}]\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "sp.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/sp.yaml",
                            "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            self.assertRegex(content, r'Rechts</text:p><table:table table:name="Tab\d+"')

    def test_tabelle_ausrichtung(self):
        """`align` an der Tabelle (auch ohne Linien) und an einer Zelle."""
        spec = (
            "titel: Ausrichtung\ncontent:\n"
            "  - {type: table, border: false, align: left, rows: [[links, {text: rechts, align: right}]]}\n"
            "  - {type: table, border: false, rows: [[mittig]]}\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "sp.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/sp.yaml",
                            "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            self.assertRegex(content, r'<text:p text:style-name="[^"_]*Tabelleninhalt[^"]*">links</text:p>|<text:p text:style-name="(?!AB_Center)[^"]*">links</text:p>')
            self.assertRegex(content, r'<text:p text:style-name="AB_Right_[^"]*">rechts</text:p>')
            self.assertRegex(content, r'<text:p text:style-name="AB_Center_[^"]*">mittig</text:p>')

    def test_tabelle_linien(self):
        """`lineWidth` und `lineStyle`: eigene Zellvorlage mit dieser Linie."""
        spec = "titel: Linien\ncontent:\n  - {type: table, lineWidth: 1.5, lineStyle: dashed, rows: [[a, b]]}\n"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "sp.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/sp.yaml",
                            "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            self.assertIn('fo:border="1.5pt dashed #000000"', content)

    def test_formatleiste(self):
        """Farbe im Text, Einzug/Zeilenabstand, Listenarten, Rahmenfarbe, Zellenhintergrund."""
        spec = (
            "titel: Format\ncontent:\n"
            "  - {type: text, text: 'a [b]{blau,hl-gelb} c', indent: 2, lineHeight: 1.5}\n"
            "  - {type: list, marker: check, items: [x]}\n"
            "  - {type: list, ordered: true, numbering: a, items: [y]}\n"
            "  - {type: table, lineColor: blau, rows: [[{text: z, background: gelb}]]}\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "sp.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/sp.yaml",
                            "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            z = zipfile.ZipFile(root / "out" / "blatt.odt")
            content = z.read("content.xml").decode()
            styles = z.read("styles.xml").decode()
            self.assertIn('fo:color="#1d4ed8" fo:background-color="#fef08a"', content)
            self.assertIn('fo:margin-left="2cm" fo:line-height="150%"', content)
            self.assertIn('text:bullet-char="☐"', content + styles)
            self.assertRegex(content + styles, r'style:num-format="a" style:num-suffix="\)"|style:num-suffix="\)" style:num-format="a"')
            self.assertIn('#1d4ed8"', content)
            self.assertIn('fo:background-color="#fef08a"', content)

    def test_tabelle_senkrecht(self):
        """`valign` an Tabelle und Zelle: Zellvorlagen mit style:vertical-align."""
        spec = "titel: V\ncontent:\n  - {type: table, valign: middle, rows: [[a, {text: b, valign: bottom}]]}\n"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "sp.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/sp.yaml",
                            "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            self.assertIn('style:vertical-align="middle"', content)
            self.assertIn('style:vertical-align="bottom"', content)


if __name__ == "__main__":
    unittest.main()
