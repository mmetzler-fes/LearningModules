# Dokumente und PDFs einbinden

Das Modul **Dokument / PDF** zeigt ein Dokument als Information an: eine
eingebettete Vorschau und darunter einen Knopf zum Öffnen in einem neuen Tab.

## Dateien liegen nicht auf dem App-Server

Hochladen ist abgeschaltet. Wer ein Dokument einbindet, gibt dessen
**Adresse** an und ist selbst für Ort und Verfügbarkeit verantwortlich. So
muss sich der Server nicht um die Sicherung von Dateien kümmern.

Geeignet ist jede öffentlich abrufbare Adresse mit `https://`:

- **Schulserver / Webserver:** die direkte Adresse der PDF-Datei.
- **Nextcloud:** Datei teilen → „Link teilen“ und den Link einfügen. Ein
  Freigabelink (`…/s/<Kennung>`) zeigt eine Nextcloud-Seite. Der Editor
  ergänzt ihn deshalb automatisch zum Direkt-Download (`…/s/<Kennung>/download`).
- **WebDAV-Adressen mit Anmeldung** taugen nicht: Schüler haben keine
  Zugangsdaten. Es braucht eine öffentliche Freigabe.

*↗ Testen* öffnet die Adresse in einem neuen Tab, so wie es die Schüler sehen.

## Vorschau

Ob die eingebettete Vorschau erscheint, entscheidet der Server, auf dem die
Datei liegt. Viele Cloud-Dienste, auch Nextcloud, verbieten das Einbetten in
fremde Seiten oder liefern die Datei als Download aus. Dann erscheint statt
der Vorschau ein Hinweis, und der Knopf darunter öffnet das Dokument. Er
funktioniert in jedem Fall.

## Bereits hochgeladene Dateien

Früher hochgeladene PDFs bleiben vorerst abrufbar (`/api/files/…`). Der
Editor weist beim Bearbeiten darauf hin, dass sie durch eine eigene Adresse
ersetzt werden sollen. Sie sind noch im Backup enthalten. Sind alle Module
umgestellt, kann der Admin den Ordner `data/uploads` leeren.
