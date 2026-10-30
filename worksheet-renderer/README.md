# worksheet-renderer

Erzeugt Arbeitsblätter und Lösungsblätter (.odt, .pdf) aus einer Spec und einer
LibreOffice-Vorlage. Das Layout steckt in der Vorlage, der Inhalt in der Spec.
Das Format beschreibt [SPEC.md](SPEC.md).

Zwei Wege, derselbe Generator:

- **Kommandozeile** in einem Projekt mit Kursen (`kurse/<kurs>/…`), z. B. dem
  privaten Kurs-Repo,
- **HTTP-Dienst** für LearningModules, als eigener Container neben der App.

| Datei | Inhalt |
|---|---|
| `tools/make_worksheet.py` | Spec → Arbeitsblatt + Lösungsblatt (.odt, optional .pdf) |
| `tools/make_script.py` | mehrere Blätter → Skript (Kompendium) |
| `tools/prepare_template.py` | Schulvorlage + `.patch.yaml` → Renderer-Vorlage |
| `tools/inspect_ott.py` | Formatvorlagen einer Vorlage anzeigen |
| `tools/new_course.py` | neuen Kurs mit erstem Blatt anlegen |
| `templates/Grundvorlage.ott` | neutrale Vorlage (ohne Schullogo) |
| `templates/styles.yaml` | Blocktyp → Formatvorlage |
| `server.py` | HTTP-Dienst |

## Einrichtung

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Für PDF muss LibreOffice installiert sein (`soffice`).

## Kommandozeile

Die Werkzeuge arbeiten im **Projekt** – dem aktuellen Verzeichnis oder dem in
`ARBEITSBLATT_ROOT`. Dort liegen `kurse/`, eigene Vorlagen (`templates/`) und
die Ausgabe (`build/`). Vorlagen sucht der Generator erst im Projekt, dann hier
(`templates/Grundvorlage.ott`). Eine `templates/styles.yaml` im Projekt
ergänzt die hiesige.

```bash
cd ~/kurs-projekt
GEN=~/LearningModules/worksheet-renderer
$GEN/.venv/bin/python $GEN/tools/make_worksheet.py kurse/arduino/06_verzweigungen/arbeitsblatt.yaml --loesung --pdf
$GEN/.venv/bin/python $GEN/tools/new_course.py physik "Physik" --template templates/Meine_Vorlage.ott
```

## HTTP-Dienst

```bash
WORKSHEET_RENDERER_TOKEN=geheim .venv/bin/python server.py
```

### `GET /health`

```json
{ "ok": true, "api": 1, "version": "…", "soffice": true, "workers": 2 }
```

### `POST /render`

Header `Authorization: Bearer <WORKSHEET_RENDERER_TOKEN>`.

```json
{
  "spec":     { "nummer": 6, "titel": "Verzweigungen", "content": [ … ] },
  "course":   { "kurs": "Arduino", "titelmuster": "{kurs} {nummer} – {titel}", "meta": {} },
  "template": "<.ott als base64>",
  "files":    { "quellcodes/blink.ino": "<base64>" },
  "outputs":  ["odt", "loesung", "pdf", "loesung_pdf"]
}
```

Nur `spec` ist Pflicht. Ohne `template` gilt die Grundvorlage, ohne `outputs`
alle vier. `files` liefert, worauf die Spec mit `file:` verweist. Gelesen wird
nur, was so mitkommt. `template`, `slug` und `kuerzel` in Spec oder Kurs
übergeht der Dienst.

| Status | Antwort |
|---|---|
| 200 | `{ "files": { "odt": "<base64>", … }, "warnings": [ … ] }` |
| 400 | Auftrag unvollständig oder unzulässig, `{ "error" }` |
| 401 | Token fehlt oder falsch |
| 413 | Auftrag größer als `RENDERER_MAX_BODY_MB` |
| 422 | Generator gescheitert (z. B. Datei fehlt), `{ "error", "warnings" }` |
| 503 | alle Arbeitsplätze länger als `RENDERER_TIMEOUT` belegt |

### `POST /import-pdf`

PDF → Dokument (`tools/pdf_import.py`), ohne trainierte Modelle:

```json
{ "pdf": "<base64>", "mode": "text" }
```

`text` erkennt Überschriften (Größe, Fettdruck, Gliederungsnummern), Absätze,
Listen, Tabellen, Code (Monospace), Karos, Bilder und Zeichnungen samt
Unterschrift, einzeilige Formeln, rote Schrift als Lösung. `pages` liefert
jede Seite als Bild. Antwort `{ "spec", "title", "warnings" }`, bei Fehlern
422 mit `{ "error" }`. Die KI-Erkennung (docling) ist ein eigener Container:
`../pdf-ai/`.

### `POST /convert-odt`

Word-Datei → .odt bzw. PowerPoint → .odg mit LibreOffice, für den Import der App:

```json
{ "file": "<base64>", "name": "Blatt.docx" }
```

Erlaubt sind `.docx`, `.doc` und `.rtf` (Antwort `{ "odt": "<base64>" }`) sowie
`.pptx`, `.ppt`, `.ppsx` und `.pps` (Antwort `{ "odg": "<base64>" }`, Filter
`impress8_draw`: je Folie eine Seite) – an der Endung von `name`. 400 bei
anderer Endung, 422, wenn LibreOffice fehlt oder nichts erzeugt.

### `POST /export-drawings`

Zeichnungen einer .odt so, wie LibreOffice sie zeichnet – für den .odt-Import
der App (sonst baut sie Zeichnungen selbst nach):

```json
{ "odt": "<base64>" }
```

Antwort `{ "odt": "<base64>", "drawings": [{ "name": "lmdraw-1", "svg": "<base64>",
"width_mm": 109.6, "height_mm": 88.0, "kind": "drawing" }], "warnings": [] }`.
`odt` ist das Dokument, in dem jede exportierte Zeichnung `lmdraw-<n>` heißt;
der Importer setzt für diese Namen das SVG ein. Exportiert werden Gruppen,
Formen und Linien sowie Grafiken in SVM/WMF/EMF – keine Textrahmen, keine
gewöhnlichen Bilder, nichts aus Kopf- und Fußzeile. Läuft über
`tools/export_drawings.py` mit dem Python von LibreOffice (`python3-uno`,
`RENDERER_UNO_PYTHON`, Vorgabe `/usr/bin/python3`); `GET /health` meldet es als
`"drawings": true` (API-Stand 2).

Jeder Auftrag läuft als eigener Prozess in einem frischen Temp-Verzeichnis, das
danach gelöscht wird. Gleichzeitig laufen höchstens `RENDERER_WORKERS`
Aufträge, jeder mit eigenem LibreOffice-Profil – sonst gibt ein zweiter
`soffice`-Aufruf an den ersten ab und kehrt ohne Ergebnis zurück.

| Variable | Vorgabe | |
|---|---|---|
| `WORKSHEET_RENDERER_TOKEN` | – | gemeinsames Geheimnis mit LearningModules |
| `RENDERER_HOST` / `RENDERER_PORT` | `0.0.0.0` / `8090` | |
| `RENDERER_WORKERS` | `2` | gleichzeitige Aufträge (je PDF kurz 150–300 MB RAM) |
| `RENDERER_TIMEOUT` | `120` | Sekunden je Auftrag und fürs Warten auf einen Platz |
| `RENDERER_MAX_BODY_MB` | `40` | |
| `RENDERER_PDF_MEM_MB` | `1024` | Speichergrenze je PDF-Import; darüber bricht er mit Meldung ab |
| `RENDERER_PROFILE_DIR` | Temp-Verzeichnis | LibreOffice-Profile je Arbeitsplatz |
| `RENDERER_UNO_PYTHON` | `/usr/bin/python3` | Python mit `uno` (Paket python3-uno) für `/export-drawings` |

## Container

```bash
docker build -t worksheet-renderer .
```

Das Image (`ghcr.io/mmetzler-fes/worksheet-renderer`) baut die CI bei
Änderungen in diesem Ordner. Es enthält LibreOffice Writer und Math sowie die
Liberation-Schriften (metrisch gleich zu Arial). Ein Beispiel für
`docker-compose` steht in `../docker-compose.example.yaml`. Der Dienst gehört
nur ins interne Netz, ohne Port nach außen.

## Tests

```bash
.venv/bin/python -m unittest discover -s tests
```

`tests/beispiel.yaml` enthält alle Blocktypen. Der PDF-Test läuft nur mit
installiertem LibreOffice.

## Grundvorlage

`templates/Grundvorlage.ott` ist aus einer Schulvorlage abgeleitet: gleiche
Formatvorlagen (Überschriften mit Gliederung, Lösung, Quelltext, Codewort …),
Kopfzeile nur mit `{{TITEL}}` und Seitenzahl, ohne Logos und Schulnamen.
Eigene Vorlagen brauchen `{{TITEL}}` in der Kopfzeile und einen Absatz
`{{INHALT}}`. Fehlende Formatvorlagen legt der Generator schlicht an.
