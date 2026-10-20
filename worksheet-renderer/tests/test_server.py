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
        self.assertEqual(body["api"], 1)
        self.assertIn("soffice", body)

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

    @unittest.skipUnless(server.soffice_available(), "LibreOffice nicht installiert")
    def test_pdf(self):
        status, body = self.request("/render", {"spec": BEISPIEL, "outputs": ["pdf", "loesung_pdf"]})
        self.assertEqual(status, 200, body)
        for key in ("pdf", "loesung_pdf"):
            self.assertTrue(base64.b64decode(body["files"][key]).startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()
