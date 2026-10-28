"""Tests für den Renderer-Dienst.

    .venv/bin/python -m unittest discover -s tests

Startet server.py im selben Prozess auf einem freien Port. PDF-Tests laufen nur,
wenn LibreOffice installiert ist.
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path

import yaml

os.environ["WORKSHEET_RENDERER_TOKEN"] = "test-token"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402  (Token muss vorher gesetzt sein)

BEISPIEL = yaml.safe_load((Path(__file__).parent / "beispiel.yaml").read_text(encoding="utf-8"))


class RendererTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def request(self, path, body=None, token="test-token"):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data)
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=180) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def content_xml(self, b64):
        return zipfile.ZipFile(io.BytesIO(base64.b64decode(b64))).read("content.xml").decode()

    def test_health(self):
        status, body = self.request("/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["api"], 2)
        self.assertIn("soffice", body)
        self.assertIn("drawings", body)

    @unittest.skipUnless(server.soffice_available() and Path(server.UNO_PYTHON).exists()
                         and os.system(f"{server.UNO_PYTHON} -c 'import uno' >/dev/null 2>&1") == 0,
                         "LibreOffice bzw. python3-uno nicht installiert")
    def test_zeichnungen_als_svg(self):
        """Eine Form im Text wird lmdraw-1 mit SVG; eine Form in der Kopfzeile bleibt außen vor."""
        ns = ('xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
              'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
              'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
              'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" '
              'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" office:version="1.3"')
        rect = ('<draw:rect text:anchor-type="paragraph" draw:name="{n}" svg:width="4cm" svg:height="2cm" '
                'svg:x="0cm" svg:y="0cm"><text:p>{t}</text:p></draw:rect>')
        content = (f'<?xml version="1.0" encoding="UTF-8"?><office:document-content {ns}><office:body><office:text>'
                   f'<text:p>Vorher{rect.format(n="Form1", t="Kasten")}</text:p></office:text></office:body></office:document-content>')
        styles = (f'<?xml version="1.0" encoding="UTF-8"?><office:document-styles {ns}><office:master-styles>'
                  '<style:master-page style:name="Standard"><style:header>'
                  f'<text:p>Kopf{rect.format(n="Logo", t="Schule")}</text:p></style:header></style:master-page>'
                  '</office:master-styles></office:document-styles>')
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("mimetype", "application/vnd.oasis.opendocument.text", compress_type=zipfile.ZIP_STORED)
            z.writestr("content.xml", content)
            z.writestr("styles.xml", styles)
            z.writestr("META-INF/manifest.xml", '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest '
                       'xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">'
                       '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>'
                       '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
                       '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>')
        status, body = self.request("/export-drawings", {"odt": base64.b64encode(buf.getvalue()).decode()})
        self.assertEqual(status, 200, body)
        self.assertEqual([d["name"] for d in body["drawings"]], ["lmdraw-1"])
        self.assertIn(b"<svg", base64.b64decode(body["drawings"][0]["svg"]))
        self.assertAlmostEqual(body["drawings"][0]["width_mm"], 40, delta=1)
        self.assertIn('draw:name="lmdraw-1"', self.content_xml(body["odt"]))
        # Die .odg zum Bearbeiten – und zurück ins SVG
        odg = body["drawings"][0]["odg"]
        self.assertTrue(zipfile.ZipFile(io.BytesIO(base64.b64decode(odg))).read("mimetype").startswith(b"application/vnd.oasis.opendocument.graphics"))
        status, back = self.request("/render-drawing", {"odg": odg})
        self.assertEqual(status, 200, back)
        self.assertIn(b"<svg", base64.b64decode(back["svg"]))
        self.assertAlmostEqual(back["width_mm"], 40, delta=1)

    def test_ohne_token_abgelehnt(self):
        status, _ = self.request("/render", {"spec": BEISPIEL}, token="falsch")
        self.assertEqual(status, 401)

    def test_odt_und_loesung(self):
        status, body = self.request("/render", {"spec": BEISPIEL, "outputs": ["odt", "loesung"]})
        self.assertEqual(status, 200, body)
        self.assertEqual(set(body["files"]), {"odt", "loesung"})
        blatt = self.content_xml(body["files"]["odt"])
        self.assertIn("Ohmsches Gesetz", blatt)
        self.assertNotIn("{{INHALT}}", blatt)

    def test_titel_aus_kurs(self):
        spec = {k: v for k, v in BEISPIEL.items() if k not in ("kurs", "titelmuster")}
        course = {"kurs": "Physik", "titelmuster": "{kurs} {nummer} – {titel}"}
        status, body = self.request("/render", {"spec": spec, "course": course, "outputs": ["odt"]})
        self.assertEqual(status, 200, body)
        styles = zipfile.ZipFile(io.BytesIO(base64.b64decode(body["files"]["odt"]))).read("styles.xml").decode()
        self.assertIn("Physik 1 – Beispielblatt", styles)

    def test_mitgeschickte_datei(self):
        spec = {"titel": "Code", "content": [{"type": "code", "file": "quellcodes/a.ino"}]}
        files = {"quellcodes/a.ino": base64.b64encode(b"void setup() {}").decode()}
        status, body = self.request("/render", {"spec": spec, "files": files, "outputs": ["odt"]})
        self.assertEqual(status, 200, body)
        self.assertIn("void setup() {}", self.content_xml(body["files"]["odt"]))

    def test_bilder_in_tabellenzellen(self):
        """Baustein links, Diagramm rechts: Die Bilder stehen in ihren Zellen, die Spalten passen dazu."""
        bild = base64.b64encode((Path(__file__).parent / "bild.png").read_bytes()).decode()
        spec = {"titel": "Zeitglieder", "content": [{"type": "table", "rows": [[
            {"text": "Netzwerk 1:", "images": [{"file": "bilder/ton.png", "width": "6cm"}]},
            {"text": "", "images": [{"file": "bilder/diagramm.png", "width": "9cm"}]},
        ]]}]}
        files = {"bilder/ton.png": bild, "bilder/diagramm.png": bild}
        status, body = self.request("/render", {"spec": spec, "files": files, "outputs": ["odt"]})
        self.assertEqual(status, 200, body)
        xml = self.content_xml(body["files"]["odt"])
        cells = xml.split("<table:table-cell")[1:]
        self.assertEqual(len(cells), 2)
        self.assertIn("Netzwerk 1:", cells[0])
        self.assertIn("<draw:frame", cells[0])
        self.assertIn("<draw:frame", cells[1])
        self.assertIn('svg:width="9.00cm"', cells[1])

    def test_dateiname_mit_punkten_abgelehnt(self):
        files = {"../x.txt": base64.b64encode(b"x").decode()}
        status, body = self.request("/render", {"spec": BEISPIEL, "files": files})
        self.assertEqual(status, 400)
        self.assertIn("Unzulässiger Dateiname", body["error"])

    def test_kein_zugriff_ausserhalb(self):
        spec = {"titel": "X", "content": [{"type": "code", "file": "/etc/hostname"}]}
        status, body = self.request("/render", {"spec": spec, "outputs": ["odt"]})
        self.assertEqual(status, 422)
        self.assertIn("außerhalb", body["error"])

    def test_fehlende_datei(self):
        spec = {"titel": "X", "content": [{"type": "code", "file": "fehlt.txt"}]}
        status, body = self.request("/render", {"spec": spec, "outputs": ["odt"]})
        self.assertEqual(status, 422)
        self.assertIn("Datei nicht gefunden: fehlt.txt", body["error"])

    def test_spec_ohne_content(self):
        status, body = self.request("/render", {"spec": {"titel": "leer"}})
        self.assertEqual(status, 400)

    def test_unbekannte_ausgabe(self):
        status, _ = self.request("/render", {"spec": BEISPIEL, "outputs": ["docx"]})
        self.assertEqual(status, 400)

    def test_eigene_vorlage(self):
        vorlage = (server.GEN / "templates" / "Grundvorlage.ott").read_bytes()
        status, body = self.request("/render", {"spec": BEISPIEL, "outputs": ["odt"],
                                                "template": base64.b64encode(vorlage).decode()})
        self.assertEqual(status, 200, body)

    def test_inspect(self):
        vorlage = (server.GEN / "templates" / "Grundvorlage.ott").read_bytes()
        status, body = self.request("/inspect", {"template": base64.b64encode(vorlage).decode()})
        self.assertEqual(status, 200, body)
        self.assertTrue(body["hasTitle"] and body["hasContent"])
        self.assertIn("Heading_20_1", body["paragraphStyles"])
        status, _ = self.request("/inspect", {"template": base64.b64encode(b"kein zip").decode()})
        self.assertEqual(status, 400)

    def test_skript(self):
        sheets = [{"titel": "Erstes Blatt", "spec": BEISPIEL}, {"titel": "Zweites Blatt", "spec": {"content": [{"type": "section", "text": "Nur Text"}]}}]
        status, body = self.request("/render-script", {"sheets": sheets, "course": {"kurs": "Probe", "autor": "M. M."},
                                                       "skript": {"titel": "Probe-Skript"}, "outputs": ["odt", "loesung"]})
        self.assertEqual(status, 200, body)
        content = self.content_xml(body["files"]["odt"])
        self.assertIn("Erstes Blatt", content)
        self.assertIn("Zweites Blatt", content)
        self.assertIn("Inhaltsverzeichnis", content)
        status, _ = self.request("/render-script", {"sheets": []})
        self.assertEqual(status, 400)

    @unittest.skipUnless(server.soffice_available(), "LibreOffice nicht installiert")
    def test_pdf(self):
        status, body = self.request("/render", {"spec": BEISPIEL, "outputs": ["pdf", "loesung_pdf"]})
        self.assertEqual(status, 200, body)
        for key in ("pdf", "loesung_pdf"):
            self.assertTrue(base64.b64decode(body["files"][key]).startswith(b"%PDF"))


    # ---- PDF-Import ----

    def test_import_kein_pdf(self):
        status, body = self.request("/import-pdf", {"pdf": base64.b64encode(b"hallo").decode(), "mode": "text"})
        self.assertEqual(status, 422)
        self.assertIn("kein PDF", body["error"])

    def test_import_seiten_als_bilder(self):
        import pypdfium2 as pdfium
        doc = pdfium.PdfDocument.new()
        doc.new_page(595, 842)
        doc.new_page(595, 842)
        buf = io.BytesIO()
        doc.save(buf)
        status, body = self.request("/import-pdf", {"pdf": base64.b64encode(buf.getvalue()).decode(), "mode": "pages"})
        self.assertEqual(status, 200, body)
        self.assertEqual([b["type"] for b in body["spec"]["content"]], ["image", "pagebreak", "image"])
        self.assertTrue(body["spec"]["content"][0]["src"].startswith("data:image/jpeg;base64,"))

    @unittest.skipUnless(server.soffice_available(), "LibreOffice nicht installiert")
    def test_import_hin_und_zurueck(self):
        """Beispielblatt drucken und wieder einlesen: Gliederung und Code kommen zurück."""
        status, body = self.request("/render", {"spec": BEISPIEL, "outputs": ["pdf"]})
        self.assertEqual(status, 200, body)
        status, body = self.request("/import-pdf", {"pdf": body["files"]["pdf"], "mode": "text"})
        self.assertEqual(status, 200, body)
        blocks = body["spec"]["content"]
        titles = [b.get("text") or b.get("title") for b in blocks if b["type"] in ("section", "task")]
        self.assertIn("Worum es geht", titles)
        self.assertIn("Ohmsches Gesetz", titles)
        self.assertTrue(any(b["type"] == "karo" for b in blocks))


    def test_pdf_zeichnungen_braucht_bereiche(self):
        status, body = self.request("/export-pdf-figures", {"pdf": base64.b64encode(b"%PDF").decode(), "page": 0, "figures": []})
        self.assertEqual(status, 400)

    @unittest.skipUnless(server.soffice_available() and Path(server.UNO_PYTHON).exists()
                         and os.system(f"{server.UNO_PYTHON} -c 'import uno' >/dev/null 2>&1") == 0,
                         "LibreOffice bzw. python3-uno nicht installiert")
    def test_pdf_bereich_als_gruppierte_zeichnung(self):
        """Ein in Kacheln zerlegtes Bild einer Folie wird EINE Gruppe in einer .odg (und ein SVG)."""
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from test_pdf_import import _slides
        pdf = base64.b64encode(_slides(1)).decode()
        status, body = self.request("/export-pdf-figures", {"pdf": pdf, "page": 0, "figures": [
            {"id": "f1", "box": [197, 232, 443, 398]}]})
        self.assertEqual(status, 200, body)
        self.assertEqual([f["id"] for f in body["figures"]], ["f1"])
        fig = body["figures"][0]
        self.assertAlmostEqual(fig["width_mm"], 240 * 25.4 / 72, delta=3)
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(fig["odg"]))) as z:
            content = z.read("content.xml").decode("utf-8")
        self.assertEqual(content.count("<draw:g"), 1)  # gruppiert – das Logo daneben ist nicht dabei
        self.assertIn("<svg", base64.b64decode(fig["svg"]).decode("utf-8", "replace"))

    def test_querformat_breite(self):
        """Vorlage A4 quer: „ganze Breite“ (16,5 cm) und Schreibfelder füllen die Zeile, nichts wird breiter als die Seite."""
        import re
        from odf.opendocument import load
        from odf.style import PageLayout, PageLayoutProperties
        doc = load(str(Path(server.__file__).parent / "templates" / "Grundvorlage.ott"))
        for pl in doc.getElementsByType(PageLayout):
            for p in pl.getElementsByType(PageLayoutProperties):
                p.setAttribute("pagewidth", "29.7cm")
                p.setAttribute("pageheight", "21.001cm")
        buf = io.BytesIO()
        doc.save(buf)
        from PIL import Image
        wide = io.BytesIO()
        Image.new("RGB", (400, 100), "white").save(wide, "PNG")  # flach: passt in der Höhe
        png = base64.b64encode(wide.getvalue()).decode()
        spec = {"content": [{"type": "image", "file": "bild.png", "width": "16.5cm"},
                            {"type": "image", "file": "bild.png", "width": "8cm"},
                            {"type": "image", "file": "bild.png", "width": "40cm"},
                            {"type": "karo", "lines": 2}]}
        status, body = self.request("/render", {"spec": spec, "outputs": ["odt"], "files": {"bild.png": png},
                                                "template": base64.b64encode(buf.getvalue()).decode()})
        self.assertEqual(status, 200, body)
        content = zipfile.ZipFile(io.BytesIO(base64.b64decode(body["files"]["odt"]))).read("content.xml").decode()
        self.assertEqual(re.findall(r'draw:name="Bild\d+"[^>]*?svg:width="([\d.]+cm)"', content), ["25.00cm", "8.00cm", "25.00cm"])
        self.assertIn('style:width="25.000cm"', content)  # Karo über die ganze Zeile
        # Tabellen und Kästen ebenso; eine feste Breite bleibt.
        status, body = self.request("/render", {"spec": {"content": [
            {"type": "table", "header": ["A", "B"], "rows": [["1", "2"]]},
            {"type": "table", "width": 22, "rows": [["x", "y"]]},
            {"type": "box", "title": "Merke", "blocks": [{"type": "text", "text": "K"}]}]},
            "outputs": ["odt"], "template": base64.b64encode(buf.getvalue()).decode()})
        self.assertEqual(status, 200, body)
        content = zipfile.ZipFile(io.BytesIO(base64.b64decode(body["files"]["odt"]))).read("content.xml").decode()
        widths = re.findall(r'style:family="table"[^>]*>\s*<style:table-properties[^>]*?style:width="([\d.]+)cm"', content)
        self.assertEqual(sorted(float(w) for w in widths), [22.0, 25.0, 25.0])

    def test_bildgruppe(self):
        """Bildgruppe: eine echte Gruppe (draw:g) im Textfluss, Bilder an ihrer Stelle in Prozent der Gruppe."""
        import re
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (200, 100), "red").save(buf, "PNG")
        png = base64.b64encode(buf.getvalue()).decode()
        spec = {"content": [{"type": "group", "width": "16cm", "ratio": 0.5, "caption": "Zwei Bilder", "items": [
            {"file": "a.png", "x": 0, "y": 0, "w": 50, "h": 50},
            {"file": "b.png", "x": 50, "y": 50, "w": 50, "h": 50}]}]}
        status, body = self.request("/render", {"spec": spec, "outputs": ["odt"], "files": {"a.png": png, "b.png": png}})
        self.assertEqual(status, 200, body)
        content = self.content_xml(body["files"]["odt"])
        self.assertEqual(len(re.findall(r'<draw:g [^>]*text:anchor-type="as-char"', content)), 1)
        frames = re.findall(r'draw:name="Bildgruppe1_\d"[^>]*', content)
        self.assertEqual(len(frames), 2)
        self.assertIn('svg:x="8.000cm"', frames[1])
        self.assertIn('svg:y="4.000cm"', frames[1])
        self.assertIn('svg:width="8.000cm"', frames[1])
        self.assertIn("Zwei Bilder", content)

    def test_zeichenrahmen_textfenster_und_lage(self):
        """Textfenster als Form mit Text in der Gruppe (Schrift der Vorlage, Größe, Farbe); Rahmen rechtsbündig."""
        import re
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (200, 100), "red").save(buf, "PNG")
        png = base64.b64encode(buf.getvalue()).decode()
        spec = {"content": [{"type": "group", "width": "16cm", "ratio": 0.5, "align": "right", "border": True, "items": [
            {"file": "a.png", "x": 0, "y": 0, "w": 50, "h": 100},
            {"text": "Wechsel**richter**\nzweite Zeile", "x": 55, "y": 0, "w": 40, "h": 30, "size": 14, "color": "weiss", "fill": "gelb"}]},
            {"type": "image", "file": "a.png", "width": "4cm", "align": "center", "caption": "Mitte"}]}
        status, body = self.request("/render", {"spec": spec, "outputs": ["odt"], "files": {"a.png": png}})
        self.assertEqual(status, 200, body)
        content = self.content_xml(body["files"]["odt"])
        self.assertEqual(content.count("<draw:custom-shape"), 1)
        self.assertEqual(content.count("<draw:rect"), 1)  # Rand des Rahmens
        self.assertIn("Wechsel", content)
        self.assertIn("zweite Zeile", content)
        style = re.search(r'<style:style style:name="AB_Rahmen_[^"]*"[^>]*>.*?</style:style>', content, re.S).group(0)
        self.assertIn('fo:font-size="14.0pt"', style)
        self.assertIn('style:font-name="Arial"', style)
        self.assertIn('fo:color="#ffffff"', style)
        self.assertIn('fo:text-align="right"', re.search(r'<style:style style:name="AB_Right_Standard".*?</style:style>', content, re.S).group(0))
        # Bild mittig samt Unterschrift: Die Vorlage „zusammenhalten“ behält die Ausrichtung.
        keep = re.search(r'<style:style style:name="AB_Zusammenhalten_AB_Center_Standard".*?</style:style>', content, re.S).group(0)
        self.assertIn('fo:text-align="center"', keep)
        self.assertIn('fo:keep-with-next="always"', keep)

    # ---- Word nach .odt ----

    def test_umwandeln_nur_word(self):
        status, body = self.request("/convert-odt", {"file": base64.b64encode(b"x").decode(), "name": "a.exe"})
        self.assertEqual(status, 400)
        self.assertIn(".docx", body["error"])

    @unittest.skipUnless(server.soffice_available(), "LibreOffice nicht installiert")
    def test_umwandeln_docx(self):
        """Beispielblatt als .odt erzeugen, mit LibreOffice nach .docx – und über den Dienst zurück."""
        import shutil, subprocess, tempfile
        status, body = self.request("/render", {"spec": BEISPIEL, "outputs": ["odt"]})
        self.assertEqual(status, 200, body)
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "blatt.odt").write_bytes(base64.b64decode(body["files"]["odt"]))
            soffice = shutil.which("soffice") or shutil.which("libreoffice")
            subprocess.run([soffice, f"-env:UserInstallation={(tmp / 'profil').as_uri()}", "--headless",
                            "--convert-to", "docx", "--outdir", str(tmp), str(tmp / "blatt.odt")],
                           check=True, capture_output=True, timeout=120)
            docx = (tmp / "blatt.docx").read_bytes()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        status, body = self.request("/convert-odt", {"file": base64.b64encode(docx).decode(), "name": "Blatt.DOCX"})
        self.assertEqual(status, 200, body)
        self.assertIn("Ohmsches Gesetz", self.content_xml(body["odt"]))


if __name__ == "__main__":
    unittest.main()
