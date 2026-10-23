# Austausch mit Moodle und H5P

Lernthemen lassen sich als **Moodle-XML** (Fragensammlung für Moodle-Tests)
und als **H5P** (Fragenset) ausgeben, und Moodle-XML sowie H5P lassen sich
einlesen. Was dabei nicht oder nur vereinfacht übernommen wird, zeigt ein
**Bericht** nach dem Import bzw. Export.

## Einlesen

**📥 Thema importieren** (Startseite, neues Thema), **📥 Module importieren**
(Modulliste, ins geöffnete Thema) und **📥 Importieren** in den Notebooks
öffnen denselben Dialog. Darin entweder

- **📄 Datei wählen** oder eine Datei in den Dialog ziehen: JSON, Moodle-XML
  (`.xml`), verschlüsselter Export (`.lmenc`); für ein neues Thema auch H5P
  (`.h5p`), in den Notebooks auch eine Notebook-Datei (`.zip`) – oder
- **Text mit Strg+V einfügen**, z. B. die Antwort einer KI. Ein Rahmen
  mit ```` ```json ```` und Text davor oder danach stört nicht; Moodle-XML als
  Text geht auch.

JSON und Moodle-XML prüft der Dialog sofort – ob Datei oder Text: bei einem
Fehler mit Zeile, Spalte und der betroffenen Zeile, bei einer abgeschnittenen
KI-Antwort mit dem Hinweis „unvollständig“; sonst zeigt er, wie viele Module
welchen Typs darin stehen. Erst dann lässt sich importieren. Den Titel eines
Moodle-Imports nimmt der Server aus der Fragenkategorie, sonst aus dem
Dateinamen.

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
| Berechnet (`calculated`, `calculatedsimple`) | Formelaufgabe | siehe [Formelaufgabe](formelaufgabe.md) |
| Anordnung (`ordering`) | Reihenfolge | Teilauswahl entfällt, Bild im Fragetext auch |
| Auswahl mit Formeln, Zufallsfragen | – | im Bericht |

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
| Drag and Drop als Paare | Zuordnung (feste Karte → Antwort, mit Bild) | DragQuestion, je Zeile Karte und Zone |
| Drag and Drop ohne Bild | Zuordnung (Element → Zone) | DragQuestion, je Zeile Zone |
| Drag and Drop mit Bild, eins je Zone | Drag and Drop auf Bild | DragQuestion |
| Drag and Drop mit Bild, mehrere je Zone | Drag and Drop Markierungen | DragQuestion |
| Freitext | Freitext | Essay |
| Formelaufgabe | je Ergebnis eine berechnete Frage | – |
| Arbeitsblatt | Beschreibung | – |
| Reihenfolge | Anordnung (`ordering`) | DragQuestion mit Plätzen 1, 2, 3 … |
| Kreuzworträtsel | Cloze, je Hinweis eine Lücke | Blanks, je Hinweis eine Lücke |
| übrige (Memory, Karteikarten, Diktat, …) | – | – |

Die Anordnung ist in neueren Moodle-Versionen eingebaut, in älteren muss das
Plugin *Ordering* installiert sein. Bewertet wird dort wie in der App über
Nachbarpaare. Ein H5P-Element ist Text oder Bild. Hat ein Element der
Reihenfolge beides, kommt nur das Bild mit.

Bei Lücken mit mehreren richtigen Wörtern (`*a|b*`) nehmen Moodle und H5P nur
das erste. Ablagegruppen gibt es in Moodle nicht (feste Zuordnung); in H5P
nimmt jede Zone der Gruppe alle Elemente der Gruppe an, aber nur eins zur Zeit.

### H5P-Drag-and-Drop

H5P streckt ein Hintergrundbild auf die ganze Fläche. Deshalb liegt das Bild
als feststehendes Element oben, die ziehbaren Elemente starten im Streifen
darunter. Ohne Hintergrundbild (Liste, Gruppen, Paare) bekommt jede Zone eine
eigene Zeile: links eine feststehende Karte mit ihrem Namen oder Bild, rechts
die Zone. Bewertet wird wie bei H5P üblich: +1 je richtig abgelegtem Element,
−1 je falschem (Strafpunkte).

Unser H5P-Import liest solche Pakete wieder ein: Das feststehende Bild oben
wird wieder Hintergrundbild, die Karten links werden Name bzw. Bild ihrer Zone,
und eine Aufgabe mit Karte und einem Element je Zeile wird wieder Paare.

### Bilder bei Drag and Drop

| | App und JSON | H5P | Moodle-XML |
|---|---|---|---|
| Bild an einem ziehbaren Element | ✅ | ✅ als Bild-Element (hat es auch Text, nur das Bild) | ❌ nur der Text – Antworten sind dort reine Auswahl |
| Bild an einer Zone (ohne Hintergrundbild) | ✅ | ✅ als feststehende Karte links | ✅ bei Paaren in der Teilfrage, sonst ❌ |

Was nicht mitkommt, nennt der Export-Dialog.

### Dokumente

Ein [Dokument](dokumente.md) wird in Moodle-XML eine Textseite
(„Beschreibung“) – ohne Lösungen, denn ausblenden kann Moodle sie nicht. Im
H5P-Fragenset gibt es dafür keinen Baustein; es wird übersprungen.

## Drag and Drop: Zuordnung im Editor

Oben wählst du die **Darstellung**:

- **🖼 Frei** – Zonen auf einem Hintergrundbild oder, ohne Bild, als Liste
  untereinander. Ohne Bild eignet sich das zum Einsortieren in Gruppen: Je
  Gruppe eine Zone („Säugetier“, „Vogel“, …), die Elemente zielen darauf (siehe
  [Mehrere Elemente je Zone](#mehrere-elemente-je-zone)).
- **🔗 Paare** – je Zeile eine feste Karte und genau ein Platz daneben (siehe
  [Paare zuordnen](#paare-zuordnen)).

### Paare zuordnen

Für Begriff ↔ Erklärung, Wort ↔ Übersetzung, Bild ↔ Wort. Im Editor steht
eine einfache Liste:

| links (feste Karte) | ↔ | rechts (zum Ziehen) |
|---|---|---|
| Hund | ↔ | dog |
| 🖼 Bild einer Katze | ↔ | cat |
| *(leer)* | ↔ | mouse – ein **Ablenker** |

- Beide Seiten dürfen ein **Bild** haben (🖼: Datei, Nextcloud oder URL).
- **Text verbergen** zeigt nur das Bild – sonst verrät „Katze“ unter dem
  Katzenbild die Lösung. Der Text zählt dann nur für die Auswertung. Eine
  Seite nur mit Bild bekommt dafür einen Namen wie „Bild 2“.
- Bei Schülern stehen die Paare in zwei Spalten. Je Zeile passt genau ein
  Element; ein zweites schiebt das erste zurück in die Ablage.
- Bewertet wird wie sonst bei Drag and Drop: Teilpunkte je richtig
  abgelegtem Element.

Gespeichert wird wie immer als Zonen und Elemente, nur mit der Angabe
`"layout": "pairs"`. Deshalb gelten Export und Import unverändert (siehe
[Bilder bei Drag and Drop](#bilder-bei-drag-and-drop)). Wechselst du von
„Frei“ zu „Paare“, fällt ein Hintergrundbild weg. Was Paare nicht abbilden
können (mehrere Elemente je Zone, Ablagegruppen, „mehrfach“), nennt der Editor
vorher. Zurück zu „Frei“ werden die Paare Zonen und Elemente der Liste.

Jede Zuordnung steht im Editor an zwei Stellen – es ist dieselbe Angabe, von
zwei Seiten gesehen:

- **oben bei der Zone:** „Erwartetes Element“,
- **unten beim ziehbaren Element:** „Ziel“.

Der Editor hält beide gleich: Wählst du oben bei einer Zone ein Element, trägt
er unten dessen Ziel ein, und umgekehrt.

| Was du willst | oben (bei der Zone) | unten (beim Element) |
|---|---|---|
| Ein Begriff je Zone | ✅ | ✅ |
| Derselbe Begriff in mehreren Zonen | ✅ bei jeder Zone wählen, unten „mehrfach“ ankreuzen | ❌ ein Element hat nur ein Ziel |
| Mehrere Begriffe in einer Zone | ❌ oben gibt es nur ein Feld | ✅ bei jedem Element dieselbe Zone als Ziel |

**Empfehlung:** Für einen Begriff je Zone immer **oben** zuordnen. Unten nur,
wenn eine Zone bewusst mehrere Begriffe aufnehmen soll – wählst du unten eine
Zone, die schon einen Begriff erwartet, erwartet sie danach beide („✓ 2
richtig“). Ungewollt? Unten beim falschen Element das Ziel auf „— Keine Zone —“
stellen.

### Ein Begriff je Zone (der Normalfall)

Oben bei **jeder Zone das erwartete Element wählen** – mehr ist nicht nötig.

**Schneller direkt am Bild:** **Doppelklick auf eine Zone** (oder Rechtsklick ›
**🎯 Zuordnen …**) öffnet die Liste aller Begriffe an Ort und Stelle – mit
Suchfeld (tippen, Enter übernimmt den ersten Treffer). Begriffe, die schon
andere Zonen erwarten, stehen mit „schon bei …“ dabei. Am Bild zeigt jede Zone
ihren Begriff („Ablagezone 3 → xBG12“); noch nicht zugeordnete Zonen sind
gestrichelt umrandet. So muss man bei vielen Zonen nicht zwischen Bild und
Liste hin- und herscrollen.
Wechselst du es später, verliert das vorher gewählte Element sein Ziel bei
dieser Zone wieder.

**Derselbe Begriff in mehreren Zonen** (z. B. „#iStep“ an vier Stellen):
unten beim Element **„mehrfach“** ankreuzen. Sonst liegt der Begriff nur
einmal in der Ablage, und die Aufgabe ist nicht lösbar – der Editor warnt dann
an der Zone („⚠ … liegt aber nur 1× in der Ablage“) und beim Speichern.

### Mehrere Elemente je Zone

Eine Zone darf auch mehrere richtige Elemente haben: unten bei weiteren
Elementen **dieselbe Zone als Ziel** wählen. Die Zone ist richtig, wenn alle
drin liegen; an der Zone steht dann „✓ n richtig: …“. Das Erwartete Element
oben muss dabei eines davon sein oder leer bleiben; widersprechen sich beide
Seiten, gilt nur die Zone. Der H5P-Import übernimmt solche Zonen vollständig.

### Vertauschbare Zonen (Ablagegruppen)

Zonen derselben **Gruppe** sind untereinander vertauschbar – etwa die zwei
gleichwertigen Eingänge eines Gatters: Ein Element zählt als richtig, wenn es
in irgendeiner Zone seiner Gruppe liegt.

## Quizzy-Quiz übernehmen

Zuordnungsquizze aus Quizzy (JSON mit `quizname` und `items` aus `query` /
`answer`) wandelt ein Skript in ein importierbares Thema um:

```bash
node scripts/quizzy-to-learningmodules.mjs quiz_SPS_Grundbegriffe.json
```

Es entsteht `SPS Grundbegriffe.learningmodules.json` – einlesen über
**📥 Thema importieren**. Je Quiz eine Drag-and-Drop-Aufgabe in der Darstellung
[Paare](#paare-zuordnen): links die Begriffe, rechts je ein Platz für die
Erklärung, **🔀 Reihenfolge mischen** eingeschaltet (jeder Schüler sieht eine
andere Reihenfolge, wie in Quizzy). Ältere Dateien ohne `"layout": "pairs"`
erscheinen als Liste – im Editor genügt ein Klick auf **🔗 Paare**.

- Mehrere Dateien auf einmal: alle Dateinamen angeben (`quiz_*.json`).
- `--ein-thema "Titel"` legt alle Quizze als Aufgaben eines Themas an.
- `--paket 6` teilt lange Quizze in Aufgaben zu höchstens 6 Paaren.
- `--ausgabe ordner` schreibt die Ergebnisse in einen anderen Ordner.

**🔀 Reihenfolge mischen** gibt es im Drag-and-Drop-Editor für jede Aufgabe:
gemischt werden die ziehbaren Elemente, ohne Hintergrundbild auch die Zonen.

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
`src/renderer/lm-editor/src/modules/answer-eval.js` (`dndExpectedMappings`).
