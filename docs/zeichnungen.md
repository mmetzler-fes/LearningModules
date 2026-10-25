# Zeichnungen in LibreOffice Draw bearbeiten

Zeichnungen aus einem Writer-Dokument (Technologieschema, Funktionsbausteine,
Zeitdiagramme …) übernimmt die App so, wie LibreOffice sie zeichnet. Damit
man sie später ändern kann, legt sie jede Zeichnung zusätzlich als
**.odg** (LibreOffice Draw) in deine Nextcloud – neben das Bild, das die
Dokumente zeigen.

## Wann das passiert

Beim Übernehmen einer **.odt/.docx** als Dokument (📥 Importieren oder
„📄 Übernehmen“ im Dokument-Editor), wenn

- der Renderer eingerichtet ist (er zeichnet mit LibreOffice),
- eine Nextcloud verbunden ist und
- das Dokument in einem eigenen Lernthema liegt.

Dann liegen im Ordner des Lernthemas (`Bilder/<Lernthema>/`) je Zeichnung
`<Dokument>-Zeichnung-<n>.odg` und `<Dokument>-Zeichnung-<n>.svg`. Ohne
Nextcloud stehen die Zeichnungen nur im Dokument, bearbeiten lassen sie sich
dann nicht.

## Bearbeiten mit dem Nextcloud-Sync-Client

1. Am PC ist der Nextcloud-Ordner der App mit dem Sync-Client
   synchronisiert.
2. Die .odg im Ordner des Lernthemas mit LibreOffice Draw öffnen, ändern,
   **speichern** (im Format .odg). Der Sync-Client lädt sie hoch.
3. Beim nächsten Öffnen des Dokuments in der Notebook-Vorschau sieht die App
   die geänderte .odg, lässt sie vom Renderer neu zeichnen und ersetzt das
   Bild – in allen eigenen Dokumenten, die es zeigen, auch bei den Schülern.

Sofort geht es mit **🖍 Zeichnungen → 🔄 Jetzt abgleichen** (in der
Notebook-Vorschau eines Dokuments) – oder im Dokument-Editor: Bild anklicken,
in der Bildleiste **🖍 In Draw bearbeiten**.

## Ohne Sync-Client

**🖍 Zeichnungen** zeigt alle Zeichnungen des Lernthemas mit Vorschau und
Ablageort. **⬇ .odg** lädt eine herunter; nach dem Ändern **⬆ Geänderte
.odg hochladen** – die App ersetzt die Datei in der Nextcloud und zeichnet
gleich neu.

## Gut zu wissen

- Alles, was auf der ersten Seite der .odg steht, wird das neue Bild –
  knapp zugeschnitten. Neue Formen dürfen dazukommen.
- Name und Ordner der Datei nicht ändern – sonst findet die App sie nicht
  mehr (das Bild bleibt dann, wie es ist).
- Gedrehter Text in eingebetteten Grafiken (SVM/WMF, z. B. ein senkrechtes
  „Druckleiste“) setzt LibreOffice im SVG an die falsche Stelle; der Renderer
  korrigiert das. Bei früher übernommenen Zeichnungen hilft: die .odg
  unverändert wieder hochladen (⬆) oder das Dokument neu übernehmen.

## Technik

- Renderer: `POST /export-drawings` liefert je Zeichnung SVG und .odg
  (Zwischenablage von LibreOffice in ein neues Draw-Dokument, Seite auf die
  Zeichnung zugeschnitten); `POST /render-drawing` zeichnet eine .odg neu.
- App: Tabelle `drawing_sources` (Ordner, Dateinamen, Links, ETag der .odg,
  Fassung). Im Dokument steht am Bild `source` (Link der .odg).
  `POST /api/drawings/sync` vergleicht die ETags im Ordner (höchstens alle
  20 s je Ordner) und setzt in allen eigenen Modulen den Link des SVG auf
  `?v=<Fassung>`; `GET /api/drawings?topicId=…`,
  `POST /api/drawings/:id/odg`.

Code: `src/drawings/`, `worksheet-renderer/tools/export_drawings.py`,
`src/renderer/js/views/drawings-dialog.js`.
