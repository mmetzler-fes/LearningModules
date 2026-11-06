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
from mathml_starmath import NoStarMath, mathml_to_starmath  # noqa: E402


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
        self.assertEqual(mw.karo_columns({"width": "16.5cm"}), mw.KARO_COLUMNS)

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

    def test_absatz_und_tabelle_als_ganzes(self):
        """Absatz: Abstand vor/nach, erste Zeile; Tabelle: Breite, Lage, Abstand, Innenabstand."""
        spec = (
            "titel: A\ncontent:\n"
            "  - {type: text, text: x, spaceBefore: 0.6, spaceAfter: 1, firstLine: -0.5}\n"
            "  - {type: table, width: 8, position: center, spaceBefore: 1, padding: 0.3, rows: [[a, b]]}\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "sp.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/sp.yaml",
                            "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            self.assertIn('fo:text-indent="-0.5cm" fo:margin-top="0.6cm" fo:margin-bottom="1cm"', content)
            self.assertRegex(content, r'style:width="8.000cm" fo:margin-top="1cm" fo:margin-bottom="0.2cm" table:align="center"')
            self.assertIn('fo:padding="0.3cm"', content)


class FormelTest(unittest.TestCase):
    MATHML = ('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" '
              'style="display:block math;"><semantics><mrow><mi>I</mi><mo>=</mo><mfrac><mi>U</mi>'
              '<mrow><mi>R</mi><mo>+</mo><mn>1</mn></mrow></mfrac></mrow>'
              '<annotation encoding="application/x-tex">I = \\frac{U}{R+1}</annotation></semantics></math>')

    def test_mathml_als_text(self):
        root = mw.parse_mathml(self.MATHML)
        self.assertEqual(mw.mathml_as_text(root), "I = U / (R + 1)")
        self.assertIsNone(mw.parse_mathml("<math"))
        self.assertIsNone(mw.parse_mathml("<svg/>"))

    def test_latex_formeln_im_dokument(self):
        """LaTeX mit MathML wird Formelobjekt, ohne MathML Text; StarMath wie bisher."""
        import json
        spec = {"titel": "F", "content": [
            {"type": "formula", "latex": "I = \\frac{U}{R+1}", "mathml": self.MATHML},
            {"type": "formula", "latex": "\\frac{"},
            {"type": "formula", "math": "a over b"},
            {"type": "solution", "blocks": [{"type": "formula", "latex": "x", "mathml": self.MATHML}]},
        ]}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "f.json").write_text(json.dumps(spec), encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/f.json",
                            "--loesung", "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            ab = zipfile.ZipFile(root / "out" / "blatt.odt")
            self.assertIn("\\frac{", ab.read("content.xml").decode())
            # LaTeX-Formel: als StarMath übersetzt (LibreOffice setzt seine Sprache vollständig)
            erste = ab.read("Object 1/content.xml").decode()
            self.assertIn('encoding="StarMath 5.0">{I = {U} over {{R + 1}}}<', erste)
            self.assertIn('encoding="StarMath 5.0">a over b<', ab.read("Object 2/content.xml").decode())
            lo = zipfile.ZipFile(root / "out" / "blatt_Lösung.odt")
            rot = lo.read("Object 3/content.xml").decode()
            self.assertIn(">color red {{I = {U} over {{R + 1}}}}<", rot)

    def test_temml_als_starmath(self):
        """Echtes MathML von Temml (tests/temml_formeln.json) → StarMath, wie LibreOffice es setzt."""
        import json
        erwartet = [
            "{I = {U} over {R}}",
            "{{{U}_{a}} over {{U}_{e}} = {{X}_{C}} over {sqrt {{{R}^{2} + {X}_{C}^{2}}}}}",
            '{{f}_{g} = {1} over {{2 %ipi RC}} approx "1,6" ` "kHz"}',
            "{vec {F} = m cdot vec {a}}",
            "{A = {left ( matrix{{1} # {2} ## {3} # {4}} right )}}",
            "{left lline x right rline = {left lbrace matrix{alignl {x} # alignl {{x >= 0}} ## alignl {{- x}} # alignl {{x < 0}}} right none}}",
            'matrix{alignr {U} # alignl {{"" = R cdot I}} ## alignr {""} # alignl {{"" = 12 ` "V"}}}',
            "{int from {0} to {T} u {left ( t right )} ` dt = lim from {{n toward infinity}} ` sum from {{k = 1}} to {n} {u}_{k} {%DELTA } t}",
            '{a {{"="} csup {!}} {{{b + c}} underbrace {"Summe"}}}',
            "{overstrike {x} + color hex 0000FF {y}}",
            "{bar {x} = overline {{AB}} + dot {x} + hat {y}}",
            "{t = {Alarm} over {{f}_{{Tick}}}}",
            "{nroot {3} {{x }} cdot {( binom {n} {k} )} - {left [ a , b right )}}",
            '{- x = +- 5 "%"}',
        ]
        formeln = json.loads((GEN / "tests" / "temml_formeln.json").read_text(encoding="utf-8"))
        self.assertEqual(len(formeln), len(erwartet))
        for f, star in zip(formeln, erwartet):
            self.assertEqual(mathml_to_starmath(mw.parse_mathml(f["mathml"])), star, f["latex"])

    def test_unbekanntes_bleibt_mathml(self):
        root = mw.parse_mathml('<math xmlns="http://www.w3.org/1998/Math/MathML"><mmultiscripts><mi>C</mi>'
                               '<mn>6</mn><none/><mprescripts/><mn>12</mn><none/></mmultiscripts></math>')
        with self.assertRaises(NoStarMath):
            mathml_to_starmath(root)
        self.assertIn("<mmultiscripts>", mw.formula_object(root))
        self.assertIn("StarMath 5.0", mw.formula_object(mw.parse_mathml(self.MATHML)))

    def test_formeln_im_text(self):
        """$…$ im Text: Formelobjekt in der Zeile; ohne MathML die Quelle; Dollarbeträge bleiben Text."""
        import json
        self.assertEqual(mw.parse_inline("a $x$ b"), [("text", "a "), ("math", "x"), ("text", " b")])
        self.assertEqual(mw.parse_inline("5 $ bis 7 $"), [("text", "5 $ bis 7 $")])
        self.assertEqual(mw.parse_inline("$5 bis $10"), [("text", "$5 bis $10")])
        self.assertEqual(mw.parse_inline(r"\$x\$"), [("text", "$x$")])
        spec = {"titel": "F", "inlineMathml": {"I = U": self.MATHML}, "content": [
            {"type": "text", "text": "Es gilt $I = U$ und $y$."},
            {"type": "karo", "lines": 2},
            {"type": "solution", "blocks": [{"type": "text", "text": "Also $I = U$."}]},
        ]}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "f.json").write_text(json.dumps(spec), encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/f.json",
                            "--loesung", "-o", "out"], cwd=root, env=env, check=True, capture_output=True)
            ab = zipfile.ZipFile(root / "out" / "blatt.odt")
            content = ab.read("content.xml").decode()
            self.assertIn('draw:name="Formel1"', content)
            self.assertIn("$y$", content)  # ohne MathML: die Quelle
            self.assertIn('encoding="StarMath 5.0">{I = {U} over {{R + 1}}}<', ab.read("Object 1/content.xml").decode())
            lo = zipfile.ZipFile(root / "out" / "blatt_Lösung.odt").read("content.xml").decode()
            self.assertIn("Also I = U / (R + 1).", lo)  # im Lösungsrahmen über dem Karo als Text


class SpaltenbreiteTest(unittest.TestCase):
    def test_code_in_zellen_zaehlt_mit(self):
        """Code-Bausteine in Zellen bestimmen die Spaltenbreite mit – sonst zerfällt der Code in Bruchstücke."""
        self.assertEqual(mw.measured_cell_text("", [{"type": "code", "code": "int x = 1;\nfoo"}]), "000 0 0 00")
        self.assertEqual(mw.measured_cell_text("Text", None), "Text")
        rows = [[("Array Größe", False), ("Anzahl der Elemente ermitteln", False),
                 (mw.measured_cell_text("", [{"type": "code", "code": "for(int i=0; i<5; i++) { Serial.println(zahlen[i]); }"}]), False)]]
        _size, widths = mw.table_layout(rows)
        self.assertGreater(widths[2], widths[0] + widths[1])


class CodeGroesseTest(unittest.TestCase):
    def test_code_mit_size(self):
        """size am Code-Baustein: eigene Absatzvorlage mit dieser Schriftgröße; ohne Angabe die der Vorlage."""
        spec = "titel: C\ncontent:\n  - {type: code, code: a}\n  - {type: code, size: 8, code: b}\n  - {type: code, size: 99, code: c}\n"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "c.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/c.yaml", "-o", "out"],
                           cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            self.assertRegex(content, r'style:name="Quelltext_8pt"[^>]*><style:text-properties fo:font-size="8pt"/>')
            self.assertIn('text:style-name="Quelltext_8pt">b<', content)
            self.assertIn('text:style-name="Quelltext">a<', content)
            self.assertIn('text:style-name="Quelltext">c<', content)  # unbekannte Größe: wie ohne Angabe

    def test_codeblock_bleibt_zusammen(self):
        """Ein kurzer Codeblock bricht nicht über die Seite: alle Zeilen bis auf die letzte kleben an der nächsten."""
        lang = "\\n".join(f"z{i}" for i in range(mw.CODE_KEEP_MAX_LINES + 1))
        spec = ("titel: C\ncontent:\n  - {type: code, code: \"x1\\nx2\\nx3\"}\n"
                f"  - {{type: code, code: \"{lang}\"}}\n")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "c.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/c.yaml", "-o", "out"],
                           cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            self.assertRegex(content, r'style:name="AB_Zusammenhalten_Quelltext"[^>]*>.*?fo:keep-with-next="always"')
            self.assertIn('text:style-name="AB_Zusammenhalten_Quelltext">x1<', content)
            self.assertIn('text:style-name="AB_Zusammenhalten_Quelltext">x2<', content)
            self.assertIn('text:style-name="Quelltext">x3<', content)
            # Zu lang für eine Seite: darf umbrechen, keine Zeile klebt.
            self.assertIn('text:style-name="Quelltext">z0<', content)
            self.assertNotIn('text:style-name="AB_Zusammenhalten_Quelltext">z', content)

    def test_doppelpunkt_bleibt_beim_folgenden(self):
        """Ein Absatz, der mit „:“ endet, klebt am folgenden Baustein; andere nicht."""
        spec = ("titel: C\ncontent:\n  - {type: text, text: \"**Beispiel:**\"}\n  - {type: code, code: a}\n"
                "  - {type: text, text: \"Ein Satz.\"}\n")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "c.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/c.yaml", "-o", "out"],
                           cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            self.assertRegex(content, r'<text:p text:style-name="AB_Zusammenhalten_[^"]+"><text:span[^>]*>Beispiel:')
            self.assertNotRegex(content, r'<text:p text:style-name="AB_Zusammenhalten_[^"]+">Ein Satz')

    def test_spalten_bleiben_beim_raster(self):
        """Aufgabe in Spalten mit Raster darunter: die Spalten-Tabelle klebt am Raster, andere nicht."""
        spalten = "{type: columns, blocks: [{type: column, blocks: [{type: text, text: links}]}, {type: column, blocks: [{type: text, text: rechts}]}]}"
        spec = (f"titel: C\ncontent:\n  - {spalten}\n  - {{type: karo, lines: 4}}\n"
                f"  - {spalten}\n  - {{type: text, text: danach}}\n")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "c.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/c.yaml", "-o", "out"],
                           cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            self.assertRegex(content, r'style:name="ABNeben_MitFolgendem"[^>]*><style:table-properties[^>]*fo:keep-with-next="always"')
            self.assertEqual(content.count('table:style-name="ABNeben_MitFolgendem"'), 1)
            self.assertEqual(content.count('table:style-name="ABNeben"'), 1)
            # Die Zeile der Spalten bricht nicht über die Seite.
            self.assertRegex(content, r'style:name="ABNeben.R"[^>]*><style:table-row-properties fo:keep-together="always"')
            self.assertEqual(content.count('<table:table-row table:style-name="ABNeben.R">'), 2)

    def test_satz_vor_code_bleibt_beim_code(self):
        """Ein Absatz direkt vor einem Codeblock klebt an ihm, auch ohne Doppelpunkt."""
        spec = "titel: C\ncontent:\n  - {type: text, text: \"Ein Beispiel.\"}\n  - {type: code, code: a}\n"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "blatt").mkdir()
            (root / "blatt" / "c.yaml").write_text(spec, encoding="utf-8")
            env = dict(os.environ, ARBEITSBLATT_ROOT=str(root))
            subprocess.run([sys.executable, str(GEN / "tools" / "make_worksheet.py"), "blatt/c.yaml", "-o", "out"],
                           cwd=root, env=env, check=True, capture_output=True)
            content = zipfile.ZipFile(root / "out" / "blatt.odt").read("content.xml").decode()
            self.assertRegex(content, r'<text:p text:style-name="[^"]+_MitFolgendem">Ein Beispiel\.')


if __name__ == "__main__":
    unittest.main()
