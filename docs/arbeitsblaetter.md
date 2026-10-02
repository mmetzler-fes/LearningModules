# Text / Arbeitsblatt

Der Modultyp **Text / Arbeitsblatt** (📝) zeigt formatierten Text direkt in der
App an: Überschriften, Absätze, Listen, Tabellen, Bilder und Textrahmen. Er
ersetzt das frühere Modul „Dokument / PDF“.

Wie bei allen Informationsmodulen zählt er in der Auswertung nicht als
Aufgabe. Er lässt sich mit Aufgaben wie Lückentext oder Multiple Choice im
selben Thema kombinieren.

## Aus LibreOffice Writer übernehmen

Im Modul-Editor → **📄 Aus LibreOffice Writer (.odt) übernehmen**. Der Server
wandelt das Dokument um und gibt das Ergebnis in den Editor. Dort lässt es sich
vor dem Speichern noch ändern. Ist der Modultitel leer, wird der Titel des
Dokuments übernommen (bzw. die erste Überschrift).

| Im Dokument | In der App |
|---|---|
| Überschrift 1 / 2 / 3+ | Überschrift H2 / H3 / H4 (H1 ist der Modultitel) |
| Titel / Untertitel | H2 / H3 |
| fett, kursiv, unterstrichen, durchgestrichen, hoch/tief | übernommen |
| Ausrichtung zentriert / rechts / Blocksatz | übernommen |
| Aufzählungen und Nummerierungen, auch verschachtelt | übernommen |
| Tabellen inkl. verbundener Zellen | übernommen |
| Bilder (PNG, JPEG, GIF, WebP, SVG) | eingebettet, in Rahmenbreite |
| Frei verankertes Bild mit Textumfluss | links oder rechts umflossen wie im Dokument; breite Bilder in eigener Zeile |
| Textrahmen | als Kasten an ihrer Stelle im Text |
| Zeichnungen (Linien, Pfeile, Rechtecke, Ellipsen, Polygone, Pfade, Gruppen) | als SVG-Bild |
| Bildfüllung einer Form (z. B. Foto in einem Rechteck) | als Bild in der Form |
| Mehrere Leerzeilen | eine Leerzeile |
| Kopf- und Fußzeile, Fußnoten, Kommentare, Verzeichnisse | weggelassen |

**Was verloren geht:** das Seitenlayout. Spalten werden aufgelöst, frei
positionierte Textrahmen stehen an ihrer Stelle im Textfluss. Schriftarten
und -größen des Fließtexts übernimmt die App nicht; sie nutzt ihr eigenes
Design.

**Zeichnungen:** Alle Zeichnungselemente eines Absatzes werden zu einem Bild
zusammengefasst, zusammen mit den frei verankerten Bildern und Textrahmen
desselben Absatzes. So bleiben Beschriftungen auf Fotos, Bilder nebeneinander
und Ablaufpläne mit ihren Schrittkästen erhalten. Textrahmen behalten Rand,
Hintergrund, Ausrichtung und Schriftgröße; als Schrift dient Arial.

Formen aus der Formen-Palette (Sterne, Sprechblasen, Blockpfeile) werden nur
originalgetreu übernommen, wenn LibreOffice ihren Umriss ohne Formeln
gespeichert hat. Sonst erscheinen sie als Rechteck oder Ellipse mit ihrem
Text.

**Nicht übernommen** werden Grafiken in Fremdformaten (SVM, WMF, EMF, OLE-
Objekte), wenn das Dokument kein PNG-Ersatzbild dazu enthält, nur verknüpfte
statt eingebettete Bilder und Bilder über 4 MB (insgesamt 20 MB). Der Editor
nennt nach der Übernahme, was fehlt.

## Bilder im Editor bearbeiten

- **🖼 Bild** in der Werkzeugleiste fügt ein Bild an der Schreibmarke ein.
  Ebenso geht Einfügen aus der Zwischenablage (Screenshot) und Hineinziehen
  einer Datei. Große Fotos werden auf 1600 px verkleinert.
- **Bild anklicken** öffnet die Bildleiste: Breite (Schieberegler), Lage
  (im Text · links umflossen · eigene Zeile mittig · rechts umflossen),
  Rahmen, Beschreibung für Screenreader, eine Position nach oben/unten,
  ersetzen, löschen (auch mit Entf).
- Gespeichert werden nur Breite und diese festen Lage-Klassen
  (`ws-float-left`, `ws-float-right`, `ws-img-center`, `ws-img-border`) –
  kein freies CSS.

## Speicherung

Der Inhalt steht als bereinigtes HTML im Modul, Bilder als eingebettete
Daten. Damit ist er im Backup, lässt sich über den Shop teilen (mit dir als
Creator) und verschlüsselt exportieren. Beim H5P-Export wird er zu einem
`H5P.AdvancedText`-Baustein.

Angezeigt wird nur, was die Bereinigung erlaubt: Text-Tags, Tabellen, Links
(http, https, mailto) und Bilder als `data:`-Bild oder von `https://`. Skripte
und Ereignisattribute werden entfernt.

## Technisch

| Datei | Zweck |
|---|---|
| `src/core/interchange/odt/odt.ts` | .odt → HTML, ohne Fremdbibliothek; Zeichnungen → SVG |
| `POST /api/interchange/odt-to-html` | Datei hochladen, HTML + Warnungen zurück (nichts wird gespeichert) |
| `src/renderer/js/content-editors.js` | Feldtyp `worksheet`: Editor + Übernahme |
| `src/renderer/js/worksheet-image-tools.js` | Bildwerkzeuge im Editor |
| `src/renderer/js/utils.js` | `sanitizeWorksheetHtml()` |
