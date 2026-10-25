# Anhang

Das Modul **📎 Anhang** stellt Dateien bereit – z. B. ein PDF-Aufgabenblatt,
eine Tabelle oder ein Projekt zum Herunterladen. Mehr kann es nicht: Schüler
öffnen PDFs im Browser oder laden die Dateien herunter. In der Auswertung
zählt es nicht mit.

## Dateien hinzufügen (Lehrkraft)

1. Im Lernthema ein Modul **📎 Anhang** anlegen.
2. **📎 Dateien hinzufügen** – auch mehrere auf einmal, je Datei bis 50 MB.
3. Mit ↑ ↓ die Reihenfolge ändern, mit ✕ eine Datei aus dem Modul nehmen.

Anhänge brauchen eine verbundene Nextcloud (☁️ Nextcloud im Home-Menü). Die
Dateien liegen dort neben den Bildern im Ordner des Lernthemas
(`Bilder/<Lernthema>/`). Aus dem Modul entfernt, bleiben sie in der Nextcloud.

Nicht anhängen lassen sich `.json`- und `.lmenc`-Dateien – das sind Daten der
App, die in derselben Freigabe liegen können. Zur Not als `.zip` packen.

## Für Schüler

Jede Datei steht mit Namen und Größe da. Bei PDFs gibt es **Öffnen** (im
Browser) und **⬇ Herunterladen**, bei allen anderen Dateien nur
Herunterladen.

## Gut zu wissen

- Wer den genauen Link einer Datei kennt, kann sie ohne Anmeldung laden –
  wie bei den Bildern. Der Link enthält eine lange zufällige Kennung.
- Zieht die Nextcloud um (andere Freigabe, Übergabe an die Schule), wandern
  die Anhänge mit, und die Links werden umgestellt.
- Beim Export (Moodle, H5P, Shop-Kopie) bleibt es beim Link auf diesen
  Server; die Datei selbst wird nicht mit verpackt.

## Technik

- Hochladen: `POST /api/nextcloud/attachments` (Feld `file`, dazu `topicId`),
  Antwort `{ url, name, size, type }` – das Modul speichert genau das in
  `content.files`.
- Abruf über `/api/nextcloud/files/…` wie Bilder: PDF mit
  `Content-Disposition: inline`, alles andere als Download und mit
  `Content-Security-Policy: sandbox`. Nie ausgeliefert: versteckte Dateien,
  `.json`, `.lmenc` und Nicht-Bilder aus dem früheren Ordner des Admin-Backups.

Code: `src/nextcloud/nextcloud.service.ts` (uploadAttachment, STORED_EXT),
`src/renderer/js/content-editors.js` (renderAttachmentsField),
`src/renderer/lm-editor/src/modules/h5p-renderer.js` (Fall `attachment`).
