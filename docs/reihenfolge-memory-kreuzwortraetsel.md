# Reihenfolge, Memory und Kreuzworträtsel

Drei Aufgabentypen zum Sortieren, Aufdecken und Rätseln. Man legt sie im
Modul-Editor an wie alle anderen.

| Typ | Bewertet | Lernbegleitung und Quiz-Arena | Export |
|---|---|---|---|
| ↕️ Reihenfolge | ja, mit Teilpunkten | ja | Moodle und H5P |
| 🔠 Kreuzworträtsel | ja, je Wort | ja | als Lückentext |
| 🧠 Memory | nein (Übungsspiel) | nein | – |

## ↕️ Reihenfolge

Die Schüler bringen Elemente in die richtige Reihenfolge, z. B. Arbeitsschritte,
Zeitabschnitte oder Entwicklungsstadien.

**Anlegen:** Die Elemente in der **richtigen Reihenfolge** eingeben. Jedes
Element hat Text, ein Bild oder beides. Die Schüler sehen sie gemischt, und
zwar nie schon richtig sortiert.

| Feld | Bedeutung |
|---|---|
| Elemente | Text und/oder Bild, in der richtigen Reihenfolge |
| Anordnung | **Untereinander** (Vorgabe) oder **Nebeneinander**, gut für Bilder |

**Bedienung:** Elemente ziehen (Maus, Finger, Stift) oder mit den Pfeilknöpfen
eins nach vorn bzw. hinten schieben. Die Pfeile gehen auch mit der Tastatur.

**Bewertung:** Volle Punkte für die richtige Reihenfolge. Sonst gibt es
Teilpunkte für jedes Paar, das wie in der Lösung direkt aufeinander folgt.
Wer bei vier Schritten nur den ersten ans Ende setzt (2-3-4-1), hat zwei von
drei Paaren richtig und bekommt 2/3 der Punkte. Nach Positionen gezählt wäre
alles falsch.

Elemente mit gleichem Text und Bild sind untereinander vertauschbar.

## 🧠 Memory

Karten aufdecken, je zwei zur Zeit. Passen sie zusammen, bleiben sie offen.

**Anlegen:** Je Paar Karte A und Karte B, jede mit Text und/oder Bild.

- **Karte B leer:** Beide Karten sind gleich (klassisches Memory).
- **Karte B ausgefüllt:** Zwei verschiedene Karten gehören zusammen, z. B.
  Bild ↔ Begriff, Wort ↔ Übersetzung, Formel ↔ Name.

Memory ist ein **Übungsspiel** und zählt in der Auswertung nicht mit, wie ein
Arbeitsblatt. Wie viele Züge es braucht, hängt zu sehr vom Glück ab. In der
Ergebnisliste steht „Gelöst in 14 Zügen“ bzw. wie viele Paare gefunden wurden.
In Lernbegleitung und Quiz-Arena kommt es nicht vor.

Mit **🔁 Nochmal** wird neu gemischt.

## 🔠 Kreuzworträtsel

**Anlegen:** Je Wort das Lösungswort und einen Hinweis, auf Wunsch mit Bild.
Das Gitter ordnet die App selbst an.

- **Umlaute und ß** sind je ein Feld. **Leerzeichen, Bindestriche und
  Satzzeichen** fallen weg: „New York“ wird NEWYORK.
- Wörter mit weniger als zwei Buchstaben fallen weg; beim Speichern kommt ein
  Hinweis.
- **🎲 Neu anordnen** würfelt eine andere Anordnung. Die Vorschau darunter
  zeigt das Gitter. Alle Schüler sehen dasselbe Gitter.
- Ein Wort ohne gemeinsamen Buchstaben mit den anderen steht frei unter dem
  Gitter. Die Vorschau sagt, wie viele das sind.

**Bedienung:** Feld anklicken und tippen, der Cursor springt weiter. Ein
zweiter Klick auf ein Kreuzungsfeld wechselt zwischen waagerecht und senkrecht.
Pfeiltasten bewegen, die Rücktaste löscht rückwärts. Dasselbe macht der Knopf
**⌫** neben dem Hinweis – für Tablets und Handys, deren Tastatur die Rücktaste
in einem leeren Feld nicht meldet. Ein Klick auf einen
Hinweis springt zum Wort. Über dem Gitter steht der Hinweis zum aktiven Wort,
das hilft auf dem Handy.

**Bewertung:** Teilpunkte je richtigem Wort, Groß- und Kleinschreibung zählt
nicht. In der Ergebnisliste steht je Wort, was eingetragen wurde.

**Quiz-Arena:** Ein Kreuzworträtsel bekommt 5 Minuten statt der Standardzeit
der Freigabe, solange weder eine eigene Zeit eingetragen ist noch genug
Messungen aus Übungsdurchläufen vorliegen (dann gilt die gemessene Zeit).

## Export

- **JSON** (Export und 📥 Import) übernimmt alle drei Typen vollständig, beim
  Kreuzworträtsel samt Anordnung. Auch der [KI-Prompt](ki-prompt.md) kann
  alle drei erzeugen.
- **Reihenfolge** wird in Moodle eine Anordnungsfrage (*Ordering*), in H5P ein
  Drag and Drop mit nummerierten Plätzen. Moodle-Anordnungsfragen lassen sich
  auch einlesen.
- **Kreuzworträtsel** wird in Moodle und H5P ein Lückentext mit je einer Zeile
  „Hinweis: Lücke“. Kreuzworträtsel gibt es in beiden Fragensammlungen nicht.
- **Memory** wird nicht exportiert.

Siehe auch [Austausch mit Moodle und H5P](moodle-und-h5p.md).

Code: `src/renderer/js/puzzles.js` (Logik: Mischen, Bewertung, Gitter),
`src/renderer/js/puzzle-views.js` (Anzeige), Bewertung in
`src/renderer/js/answer-eval.js`, Tests in `src/core/puzzles/puzzles.spec.ts`.
