# pdf-ai – PDF-Import mit KI-Erkennung

Wandelt ein PDF in ein Dokument von LearningModules um (Format:
`worksheet-renderer/SPEC.md`). Grundlage ist [docling](https://github.com/docling-project/docling)
(MIT-Lizenz): trainierte Modelle für das Seitenlayout (Überschriften, Absätze,
Listen, Bilder, Formeln) und für Tabellen, dazu Tesseract für gescannte
Seiten. **Alles läuft im Container** – kein externer Dienst, kein Token
eines Anbieters, die Inhalte verlassen den Server nicht.

Der Container ist optional. Ohne ihn gibt es im Editor weiterhin
„📝 Text mit Struktur“ und „🖼 Seiten als Bilder“ (beides im Renderer,
`worksheet-renderer/tools/pdf_import.py`). Die KI-Erkennung ist besser bei
Tabellen, mehrspaltigem Satz und Scans, braucht aber mehr Rechenzeit.

| Datei | Inhalt |
|---|---|
| `convert.py` | docling-Ergebnis → Dokument |
| `server.py` | HTTP-Dienst |

## Bedarf

| | ungefähr |
|---|---|
| Image | 3–4 GB (PyTorch für die CPU, Modelle) |
| Arbeitsspeicher | 1,5–2 GB während einer Erkennung |
| Zeit | wenige Sekunden je Seite; mit OCR mehr. Der erste Auftrag nach dem Start lädt die Modelle. |

Auf ARM-Servern rechnet PyTorch langsamer als auf vergleichbaren x86-Rechnern.

## HTTP-Dienst

```bash
PDF_AI_TOKEN=geheim python server.py
```

`GET /health` → `{ "ok": true, "version": "…", "ocr": true, "busy": false }`

`POST /convert` mit `Authorization: Bearer <PDF_AI_TOKEN>`:

```json
{ "pdf": "<base64>", "ocr": false }
```

| Status | Antwort |
|---|---|
| 200 | `{ "spec": { "content": [ … ] }, "title": "…", "warnings": [ … ] }` |
| 400 | Auftrag unvollständig |
| 401 | Token fehlt oder falsch |
| 413 | PDF größer als `PDF_AI_MAX_BODY_MB` |
| 422 | PDF nicht erkannt, `{ "error" }` |
| 503 | ausgelastet (länger als `PDF_AI_WAIT` gewartet) |

| Variable | Vorgabe | |
|---|---|---|
| `PDF_AI_TOKEN` | – | gemeinsames Geheimnis mit LearningModules (`PDF_AI_TOKEN`) |
| `PDF_AI_HOST` / `PDF_AI_PORT` | `0.0.0.0` / `8091` | |
| `PDF_AI_WORKERS` | `1` | gleichzeitige Erkennungen |
| `PDF_AI_WAIT` | `300` | Sekunden Warten auf einen freien Platz |
| `PDF_AI_MAX_BODY_MB` | `60` | |
| `PDF_AI_PRELOAD` | `1` | Modelle beim Start laden |
| `OMP_NUM_THREADS` | `4` | Rechenkerne für PyTorch |

## Container

```bash
docker build -t pdf-ai .
```

Das Image `ghcr.io/mmetzler-fes/pdf-ai` baut die CI bei Änderungen in diesem
Ordner. Die Modelle holt es beim Bauen; im Betrieb braucht es kein Internet.
Beispiel für `docker-compose` in `../docker-compose.example.yaml`. Der Dienst
gehört nur ins interne Netz.

In LearningModules: `PDF_AI_URL=http://pdf-ai:8091` und `PDF_AI_TOKEN`.
