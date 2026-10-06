# Austausch mit Moodle und H5P

Lernthemen lassen sich als **Moodle-XML** (Fragensammlung für Moodle-Tests)
und als **H5P** (Fragenset) ausgeben, und Moodle-XML sowie H5P lassen sich
einlesen. Was dabei nicht oder nur vereinfacht übernommen wird, zeigt ein
**Bericht** nach dem Import bzw. Export.

## Einlesen

**📥 Thema importieren** (neues Thema) und **📥 Module importieren** (ins
geöffnete Thema) nehmen neben JSON auch `.xml`-Dateien aus Moodle an. Der
Server erkennt das Format selbst (Wurzelelement `<quiz>`). Den Titel nimmt er
aus der Fragenkategorie, sonst aus dem Dateinamen.

In Moodle: **Fragensammlung → Export → Moodle-XML-Format**. Eine Kurssicherung
(`.mbz`, früher `moodle.xml` im ZIP) ist etwas anderes und wird nicht gelesen.

| Moodle | wird zu | Hinweis |
|---|---|---|
| Multiple-Choice | Multiple Choice | Feedback je Antwort wird zum Tipp |
| Wahr/Falsch | Wahr/Falsch | |
| Kurzantwort, Numerisch | Lückentext | Toleranz bei Zahlen und Platzhalter `*` entfallen |
| Lückentext (Cloze) | Lückentext | Auswahllücken werden Eingabelücken |
| Drag and Drop in Text, Auswahl in Text | Drag the Words | Wortgruppen werden zusammengefasst |
| Zuordnung | Drag and Drop ohne Bild | |
| Drag and Drop auf Bild | Drag and Drop mit Bild | Zonengröße geschätzt; Bild-Elemente als Text |
| Drag and Drop Markierungen | Drag and Drop mit Bild | gleiche Marker → Ablagegruppe; Vielecke als Rechteck |
| Freitext | Freitext | |
| Beschreibung | Arbeitsblatt | |
| Berechnet, Zufallsfragen | – | im Bericht |

Bilder kommen aus der Datei mit (Moodle bettet sie als Base64 ein), auch das
alte Bildfeld aus Moodle 1.9. Verweise auf andere Anhänge (Audio, PDF)
entfallen, ihr Linktext bleibt.

## Ausgeben

Im Export-Dialog eines Themas (nur selbst verfasste, aktive Module):

- **🎓 Moodle-XML** – in Moodle unter **Fragensammlung → Import →
  Moodle-XML-Format** einlesen.
- **📦 H5P** – ein H5P-Fragenset mit einer Frage je Aufgabe, samt allen
  nötigen H5P-Bibliotheken. Läuft in Moodle (H5P-Aktivität), WordPress, Lumi,
  h5p.com usw., auch wenn dort die Inhaltstypen noch nicht installiert sind.

| Unser Modul | Moodle-XML | H5P |
|---|---|---|
| Multiple Choice | Multiple-Choice (falsche Kreuze kosten Punkte) | MultiChoice |
| Wahr/Falsch | je Aussage eine Frage | je Aussage eine TrueFalse-Frage |
| Lückentext | Cloze mit Kurzantwort-Lücken | Blanks |
| Drag the Words | Drag and Drop in Text | DragText |
| Mark the Words | – | MarkTheWords |
| Drag and Drop ohne Bild | Zuordnung (Element → Zone) | DragQuestion |
| Drag and Drop mit Bild, eins je Zone | Drag and Drop auf Bild | DragQuestion |
| Drag and Drop mit Bild, mehrere je Zone | Drag and Drop Markierungen | DragQuestion |
| Freitext | Freitext | Essay |
| Arbeitsblatt | Beschreibung | – |
| übrige (Karteikarten, Diktat, …) | – | – |

Bei Lücken mit mehreren richtigen Wörtern (`*a|b*`) nehmen Moodle und H5P nur
das erste. Ablagegruppen gibt es in Moodle nicht (feste Zuordnung); in H5P
nimmt jede Zone der Gruppe alle Elemente der Gruppe an, aber nur eins zur Zeit.

### H5P-Drag-and-Drop

H5P streckt ein Hintergrundbild auf die ganze Fläche. Deshalb liegt das Bild
als feststehendes Element oben, die ziehbaren Elemente starten im Streifen
darunter. Bewertet wird wie bei H5P üblich: +1 je richtig abgelegtem Element,
−1 je falschem (Strafpunkte).

## Drag and Drop: mehrere Elemente je Zone

Eine Zone darf mehrere richtige Elemente haben: alle, deren **Ziel** sie ist.
Die Zone ist richtig, wenn alle drin liegen. Das **Erwartete Wort** der Zone
muss dabei eines davon sein oder leer bleiben; widersprechen sich beide Seiten,
gilt wie früher nur die Zone. Der Editor hält beide Seiten gleich und zeigt
„✓ n richtig: …“ an der Zone. Der H5P-Import übernimmt solche Zonen jetzt
vollständig.

## H5P-Bibliotheken aktualisieren

Die Bibliotheken liegen in `assets/h5p/libraries.zip` und kommen vom
offiziellen H5P-Hub:

```bash
./scripts/update-h5p-libraries.sh
npx jest src/core/interchange
```

Die Tests prüfen unter anderem, dass das Fragenset die Versionen der
Fragetypen annimmt. Felder, die unsere Module nicht kennen, füllt der Export
aus `semantics.json`, Texte aus der deutschen Sprachdatei der Bibliothek.

Code: `src/core/interchange/moodle/` (Import, Export, XML-Leser),
`src/core/interchange/h5p/h5p-export.ts`, Bewertung in
`src/renderer/js/answer-eval.js` (`dndExpectedMappings`).
