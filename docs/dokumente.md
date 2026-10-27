# Dokumente: Arbeitsblätter, Klassenarbeiten, Texte

Der Modultyp **📄 Dokument** verbindet beides: Ein Dokument ist in der App eine
gut lesbare Seite (auch auf dem Handy) und lässt sich als **druckfertiges
Arbeitsblatt mit Lösungsblatt** ausgeben – als LibreOffice-Datei (.odt) oder
PDF, in deiner Schulvorlage. Ein Dokument ist ein Modul wie jedes andere: Es
steht in einem Lernthema, lässt sich teilen, sichern und Schülern zeigen.

Dokumente sind eine Funktion in Entwicklung. Sie erscheinen erst, wenn der
Admin sie freigeschaltet hat (siehe [Benutzerverwaltung](benutzerverwaltung.md#funktionen-in-entwicklung)).

## Ein Dokument anlegen

**➕ Neues Modul** → Modultyp **📄 Dokument**, dazu die Art:

- **Arbeitsblatt** – nummeriert (1.1, 1.2 …), mit Karopapier und Lösungen,
- **Klassenarbeit** – ohne Nummer, eigene Vorlage möglich,
- **Text** – zum Lesen, ohne Nummer.

Der Editor startet im Modus **✏️ Bearbeiten** – wie ein Textprogramm:

- **Absatzart** links in der Leiste: Text, **Abschnitt** (1.), **Aufgabe** (1.1),
  **Teilaufgabe** (1.1.1), Überschrift ohne Nummer, Hinweis.
- **Fett, kursiv, unterstrichen, durchgestrichen, hoch/tief**, Listen,
  Ausrichtung, Links, **🖼 Bild** (Größe, Lage, Rahmen per Klick aufs Bild).
- **➕ Einfügen …**: Schreibfeld (Platz zum Schreiben – Karo, Linien, leer mit
  Rahmen oder unsichtbar; Höhe, Breite und Muster in einem kleinen Formular,
  wieder per Doppelklick auf das Feld), Quiz aus dem Lernthema,
  **📄 PDF an dieser Stelle** (mit Freischaltung „PDF-Import“: das PDF wird
  wie bei „Übernehmen“ umgewandelt, aber eingefügt statt ersetzt), Lösung,
  Formel, Code, Tabelle, Kasten, Platz (ein unsichtbares Schreibfeld; ältere
  „Platz“-Bausteine werden beim Bearbeiten dazu), Seitenumbruch – an der
  Schreibmarke bzw. hinter dem gewählten Baustein.
- Graue **Bausteine** wählt ein Klick (blauer Rahmen). Die Leiste daran
  verschiebt (**↑ ↓**, auch Alt+↑/↓), verdoppelt (**⧉**), bearbeitet (**✏️**,
  auch Doppelklick oder Enter) und löscht (**✕**, auch Entf). **Strg+C / X**
  kopiert den gewählten Baustein als YAML; **Strg+V** setzt kopierte Bausteine
  (auch aus dem YAML-Reiter) hinter den gewählten.
- Eine **Lösung** gehört hinter ein Karo: Im Arbeitsblatt ist sie
  ausgeblendet, im Lösungsblatt steht sie rot über dem Karo.

Rechts steht die **Vorschau**, darüber die Kopfzeile, wie sie gedruckt wird.
**🖨 PDF**, **⬇ .odt**, **🖨 Lösung** und **⬇ Lösung .odt** erzeugen die
Dateien vom aktuellen Stand, auch ungespeichert.

**⌨ YAML** zeigt dasselbe Dokument als Text – praktisch zum schnellen Ändern
vieler Stellen oder für Antworten einer KI. Das Format beschreibt die Datei
`worksheet-renderer/SPEC.md`. Hilfen beim Einrücken: **Enter** übernimmt die
Einrückung (nach `- ` und `:` eine Stufe tiefer), **Tab / Umschalt+Tab**
rücken markierte Zeilen ein und aus, **Strg+V** passt die Einrückung des
Eingefügten an die Schreibmarke an. Das eigene **➕ Einfügen …** setzt einen
Baustein hinter den Block, in dem die Schreibmarke steht.

**📄 Übernehmen (.odt, .docx, .pdf)** liest ein Writer-Dokument ein:
Überschriften, Absätze, Listen, Tabellen (auch verbundene Zellen), Bilder mit
ihrer Lage und Textrahmen. Formeln aus dem Formeleditor und Bilder in Tabellen
kommen nicht mit; der Editor nennt, was fehlt. Ausgeblendeter Text – so stehen die Lösungen im Arbeitsblatt – wird eine
**Lösung**, bleibt also im Blatt verborgen. **Word-Dateien** (.docx, auch
.doc und .rtf) wandelt der Renderer vorher mit LibreOffice in eine .odt um –
das dauert einige Sekunden länger, und was LibreOffice anders darstellt als
Word, kommt so auch hier an.

Ein **PDF** kennt keine Struktur, nur Zeichen an Positionen – der Import
erschließt sie. PDFs nimmt der Knopf nur an, wenn der Admin zusätzlich die
Funktion **🧪 PDF-Import** freigeschaltet hat (wie die Dokumente: aus, nur
ausgewählte Konten oder alle); sonst heißt er „Übernehmen (.odt, .docx)“. Zur Wahl
stehen:

| Art | Was | Braucht |
|---|---|---|
| 📝 Text mit Struktur | Überschriften (Größe, Fettdruck, Nummern wie 2.1), Absätze, Listen, Tabellen, Code, Karos, Bilder und Zeichnungen mit Unterschrift, einfache Formeln; rote Schrift (Lösungsblatt) wird zur Lösung | Renderer |
| 🖼 Seiten als Bilder | jede Seite als Bild – sieht aus wie das PDF, nicht bearbeitbar | Renderer |
| 🤖 KI-Erkennung | trainierte Modelle (docling) auf dem eigenen Server: besser bei Tabellen, Spalten und gescannten Seiten (OCR), langsamer | Dienst `pdf-ai` |

Gibt es das Writer-Original noch, ist dessen Import immer genauer. Danach im
Editor prüfen: Formeln, Karos und Lösungsfelder lassen sich aus einem PDF nur
ungefähr erkennen; mehrzeilige Formeln kommen als Bild.

### Formatierung im Text

Im YAML-Modus (und wenn eine KI schreibt) gilt diese Schreibweise:

| Schreibweise | Ergebnis |
|---|---|
| `**fett**`, `*kursiv*`, `***beides***` | **fett**, *kursiv* |
| `++unterstrichen++`, `~~durchgestrichen~~` | unterstrichen, durchgestrichen |
| `` `code` `` | Code im Text |
| `x^{2}`, `CO_{2}`, `U_R` | hoch- und tiefgestellt |
| `[Text](https://…)` | Link |
| `\` am Zeilenende | Zeilenumbruch erzwingen |

Die Zeichen wirken nur am Wortrand: Rechnungen wie `8*7` oder `10^9` bleiben,
wie sie sind.

### Aus Writer, Word oder PDF

Schneller als anlegen und hineinladen: **📥 Importieren** (Notebook-Ansicht,
Lernthemen, oder im Lernthema **📥 Module importieren**) nimmt auch
**.odt, .docx, .doc, .rtf** und – mit Freischaltung „PDF-Import“ – **.pdf**
an, auch **mehrere Dateien auf einmal** (wählen oder hineinziehen). Jede Datei
wird ein Modul **📄 Dokument**: im geöffneten Lernthema, sonst in einem neuen
(benannt nach der Datei bzw. „Dokumente“). Word-Dateien wandelt LibreOffice
um, PDFs der Renderer bzw. die KI-Erkennung – gefragt wird einmal, wie.

Im Editor geht es weiter wie bisher: **📄 Übernehmen (.odt, .docx)** über dem
Inhalt ersetzt den Inhalt des geöffneten Dokuments. Ein PDF-**Anhang** lässt
sich nachträglich umwandeln, siehe [Anhang](anhang.md#in-ein-dokument-umwandeln).

## Nummern und Kopfzeile

Die Nummer eines Arbeitsblatts ergibt sich aus seinem Platz im
[Notebook](notebooks.md): Jeder Abschnitt zählt neu, die Nummer trägt die
Ordner davor mit – **„Arduino 2.1 – Der AD-Wandler“** ist das erste Blatt im
zweiten Abschnitt. Wer ein Lernthema verschiebt, bekommt die neue Nummer
sofort; der Baum zeigt die Nummern grau vor dem Namen.

Im Ordnermenü (⋯) unter **📄 Dokument-Einstellungen…**:

- **Kursname**, **Kopfzeile** (Titelmuster mit `{kurs}`, `{pfad}` = 2.1,
  `{nummer}` = nur die letzte Stelle, `{titel}`, `{abschnitt}`, `{autor}`),
  **Autor** – sie gelten für alles darunter.
- **Zählung beginnt hier** – Ordner darüber erscheinen nicht in der Nummer.
- **Darunter durchzählen** – keine weiteren Ebenen; am Book eingestellt zählt
  alles von 1 bis n durch.
- **Vorlage** je Art, **Dateien in der Nextcloud** und **KI-Vorgaben**.

### Verweise auf andere Blätter

`{{blatt:06_verzweigungen}}` wird zur aktuellen Nummer des Blatts,
`{{blatt:13_ad..18_us}}` zu einem Bereich („2.1–2.6“), `{{titel:…}}` zum
Titel. Nummern im Text veralten so nicht, wenn sich die Reihenfolge ändert.
Der Kurzname steht im Dokument (`slug`); fehlt ein Blatt, meldet der Editor es.

## Vorlagen

**🖨 Vorlagen** über dem Notebook-Baum: LibreOffice-Vorlagen (.ott) für
Arbeitsblatt, Klassenarbeit und Skript hochladen. Die Vorlage braucht
`{{TITEL}}` in der Kopfzeile und einen Absatz `{{INHALT}}` – beim Hochladen
prüft die App beides. **★** macht eine Vorlage zum Standard ihrer Art,
**🖨 Probeblatt** zeigt, wie ein Blatt darin aussieht.

Welche Vorlage gilt: die am Ordner gewählte → dein Standard → der Standard
der Schule → die neutrale Grundvorlage. Schulvorlagen legt der Schuladmin an.

## Mit einer KI erstellen

**🤖 KI-Prompt** → Reiter **📄 Dokument**: Zielordner wählen – dessen Kurs,
KI-Vorgaben und vorhandene Blätter (für Verweise) fließen in den Prompt –,
Fragestellung, Art, Umfang und Anzahl der Blätter angeben, auf Wunsch
passende Quiz-Module dazu. Den Prompt im KI-Chat einfügen, die Antwort im
Notebook am Zielordner über **⋯ → 📥 Hier importieren** einlesen.

**Vorhandene Blätter als Vorbild:** Unter dem Zielordner stehen die Blätter
seines Books zum Ankreuzen. Ihr Inhalt kommt in den Prompt – im selben
Format, das die KI liefern soll –, damit Stil, Niveau, Aufbau und Art der
Aufgaben passen. Anhängen im Chat ist dafür nicht nötig. Eingebettete Bilder
fallen dabei weg; Bilder aus der Nextcloud bleiben als Name stehen. Unter dem
Prompt steht seine ungefähre Größe: Wird er sehr lang (über etwa 30 000
Tokens) und bricht der Chat ab, weniger Vorbilder wählen. Vorhandene
Arbeitsblätter holst du vorher über **📄 Übernehmen (.odt, .docx)**, den
PDF-Import oder als Kurs (unten) in die App.

## Kurse aus dem Arbeitsblatt-Generator

**📥 Hier importieren** nimmt auch ein ZIP mit einem Kursordner (`kurs.yaml`,
`NN_thema/arbeitsblatt.yaml`, `skripte/`). Daraus wird ein Book (bzw. ein
Bereich) mit einem Abschnitt je Skript; jedes Blatt wird ein Lernthema mit
einem Dokument, Code und Bilder aus den Dateien werden eingesetzt. Die
`CLAUDE.md` des Kurses wird zu den KI-Vorgaben.

**⬇️ Als Kurs exportieren** schreibt den Ordner zurück – er lässt sich im
Kurs-Projekt mit `make` bauen.

## Skripte und OneNote

- **📚 Als Skript (PDF)** fasst alle Arbeitsblätter eines Ordners zu einem
  Skript mit Inhaltsverzeichnis zusammen – zum Nachlesen, ohne Karopapier.
  **📚 Skript als .odt / Lösung** liefert die LibreOffice-Fassung und die mit
  sichtbaren Lösungen.
- **📓 Dokumente als OneNote-Seite** legt die Gliederung der Dokumente mit
  einem Klassenlink und QR-Code in die Zwischenablage.

## Quiz im Dokument

Im Editor (Reiter **✏️ Bearbeiten**) stehen unter **➕** bzw. per Rechtsklick in den Text die Module
desselben Lernthemas (z. B. Multiple Choice oder Lückentext) – ein Klick setzt das Quiz ein. Es steht als
Baustein an der Schreibmarke im Blatt (`type: quiz`, `module: <Modul-ID>`).

- **Im Durchlauf** bearbeiten Schüler das Quiz direkt im Blatt; die Antworten
  zählen beim Weiterblättern mit ins Ergebnis. Als eigener Schritt kommt es
  dann nicht noch einmal – außer in der Lernbegleitung, die jede Aufgabe
  einzeln begleitet (dort steht im Blatt ein Hinweis).
- **Im Druck** (PDF, .odt, Nextcloud-Abbild, Schüler-PDF) steht ein Kasten mit
  QR-Code und Adresse über den [Quick-Link](quick-link.md) des Lernthemas
  (`?l=<token>&mod=<modul>`): Wer scannt, bearbeitet genau dieses Quiz. Ohne
  Quick-Link steht dort ein Hinweis. Wird der Quick-Link zurückgezogen oder neu
  erstellt, druckt das Nextcloud-Abbild die Blätter neu.
- **Größe:** Quizze sind für die App gestaltet und wirken auf dem Blatt (vor allem
  im Stift-Editor) oft zu groß. **A− / A+** oben rechts am Quiz stellt es kleiner
  oder größer (50–150 %); das Gerät merkt es sich je Quiz. Vorgaben für alle,
  auch die Schüler: im Notizbuch an Book, Bereich oder Abschnitt **⋯ → 📄
  Dokument-Einstellungen → Quizze im Blatt – Größe**, je Art (Drag and Drop,
  Drag the Words, übrige). Sie erben sich nach unten wie Kursname und Kopfzeile;
  ein einzelnes Quiz weicht ab mit Doppelklick im Dokument-Editor → **Größe im Blatt**.
- Ist das Modul nicht freigegeben, sehen Schüler im Blatt einen Hinweis.
- Im Kurs-Export und im Generator wird daraus ein Hinweis
  („[Quiz: … – online in LearningModules]“) – Module gibt es dort nicht.

## Für Schüler

Dokumente erscheinen in Themen-Links und Quick-Links wie andere Module, als
Lese-Seite. Mit **⬇ Als PDF** holen sich Schüler das Blatt – ohne Lösungen.
Der Knopf steht (wie **✍️ Mit Stift bearbeiten**) rechts in der festen
Titelleiste der Aufgabe und scrollt nicht mit dem Blatt weg.
Bei **Lernen mit Lösungen** und in der Vorschau lassen sich die Lösungen
aufdecken, im Quiz bleiben sie verborgen.

## Mit Stift bearbeiten (in Erprobung)

**✍️ Mit Stift bearbeiten** über einem Dokument (in der Notebook-Vorschau auch **✍️ Stift** oben in der Kopfzeile) öffnet das Blatt so, wie es gedruckt
wird – zum Beschriften mit Stift (iPad mit Apple Pencil), Finger oder Maus.
Der Knopf erscheint erst mit der Freischaltung **🧪 Stift-Editor**
([Benutzerverwaltung](benutzerverwaltung.md#funktionen-in-entwicklung)):
für die Lehrkraft in Vorschau und Notebooks, für Schüler über ihren Link,
wenn die Lehrkraft des Lernthemas freigeschaltet ist.

- **💾 Speichern:** Gespeichert wird automatisch kurz nach jeder Änderung und
  wenn das iPad in eine andere App wechselt; der Knopf neben ✕ speichert sofort.
  Ein oranger Punkt daran heißt „noch nicht gespeichert“, grün „eben
  gespeichert“. Ist die Leiste zu schmal (iPad hochkant), lässt sie sich zur
  Seite wischen.
- **Werkzeugleiste:** oben die Werkzeuge (Auswahl, Stift, Textmarker,
  Radierer, Text, Geodreieck), Rückgängig, Finger, Hintergrund, Lösung und
  Zoom; darunter schwebend die Einstellungen des gewählten Werkzeugs –
  Strichstärken und Farben, beim Text die Schriftgröße, bei der Auswahl
  „Löschen“.
- **Werkzeuge:** ✏️ Stift (mit Druck), 🖍️ Textmarker (unter der Schrift),
  🧽 Radierer (ganze Striche; auch das Radierer-Ende eines Windows-Stifts),
  ⬚ Auswählen (einen Strich antippen oder ein Rechteck aufziehen, dann
  verschieben oder 🗑 löschen), **T** Textfeld (auf die Seite tippen und
  schreiben). Dazu Farben, drei Strichstärken, ↶ ↷ und Zoom.
- **▭ Feld:** Ein Rechteck aufziehen – an der Stelle liegt dann ein weißes Feld
  mit Karo, Linien oder leer und deckt ab, was darunter steht. So lässt sich
  z. B. auf einer PDF-Seite eine ausgefüllte Tabelle durch frisches Karo
  ersetzen. Danach ist das Feld gewählt: an den Ecken größer oder kleiner
  ziehen, oben in der Leiste das Muster wechseln. Darauf schreibt man wie sonst.
- **Auswahl bearbeiten:** Gewähltes lässt sich kopieren, ausschneiden,
  einfügen und duplizieren (Strg/⌘+C, X, V, D) sowie gruppieren (Strg+G) und
  wieder trennen (Strg+Umschalt+G). Dieselben Befehle hat das Menü der Auswahl:
  Rechtsklick, auf dem iPad lange auf die Auswahl drücken, oder der Knopf **⋯**.
  Eine Gruppe wird immer ganz gewählt und verschoben. Eingefügt wird leicht
  versetzt – oder mitten ins Sichtfeld, wenn das Original gerade nicht zu sehen
  ist; Kopiertes lässt sich auch in ein anderes Blatt einfügen.
- **Gerade Linien:** Am Ende eines Strichs den Stift (oder die Maus) kurz
  stillhalten – der Strich wird zur geraden Linie vom Anfang bis dorthin;
  solange man noch drückt, folgt das Ende dem Stift. Auch ein Strich am
  Geodreieck wird zur Linie. Eine angetippte Linie zeigt im Auswahl-Modus
  **zwei Anfasser** an den Enden zum Verschieben; am Geodreieck rastet ein
  Ende auf der Kante ein.
- **Hintergrund:** 🧾 **Dokument** (Vorgabe) – das Dokument selbst auf einem
  A4-Blatt, ohne Umweg über ein PDF. Dazu 📄 das PDF, ▦ Karo, ☰ Linien, ▢ Leer
  oder ein eigenes Bild oder PDF. Bei Karo, Linien und Leer fügt **＋📄** Seiten
  an. Die Beschriftung des Dokuments und die der übrigen Hintergründe werden
  getrennt gespeichert; beim Wechsel bleibt beides erhalten.
- **Im Dokument** gehört jeder Strich zu dem Baustein, in dem er beginnt
  (Absatz, Karo, Aufgabe …). Ändert sich etwas darüber – ein Karo wird länger,
  ein Bild lädt nach, ein Quiz klappt auf –, rutschen die Striche mit. Das Blatt
  ist immer 21 cm breit und nutzt mitgelieferte Schriften (Liberation, so breit
  wie Arial): Auf iPad, PC und Handy bricht der Text an denselben Stellen um.
- **Schreibfelder anpassen:** Unten am Feld sitzt ein blauer Anfasser – nach
  unten ziehen macht es länger (in 0,5-cm-Schritten), nach oben wieder kürzer,
  aber nie kürzer als im Dokument. Mit **⬚ Auswählen** kommen ein Anfasser
  rechts (Breite), einer an der Ecke (beides) und oben im Feld ▦ Karo, ☰ Linien,
  ▢ Leer, ◌ Unsichtbar dazu (unsichtbare Felder sind hier gestrichelt
  angedeutet, im Druck nicht). Schüler ändern damit nur ihre eigene Beschriftung. Die
  Lehrkraft ändert in einem eigenen Lernthema das **Dokument selbst** (oben
  „💾 Im Dokument gespeichert“) – dann darf das Feld auch bis auf eine Zeile
  schrumpfen.
- **⊕ Einfügen:** Links am Rand sitzen kleine ⊕ zwischen den Bausteinen
  (vor dem ersten und hinter jedem). Antippen öffnet ein Menü: **▢ Schreibfeld**
  (unsichtbar, eine Zeile hoch – am Anfasser größer ziehen), **▦ Karo** oder
  **☰ Linien**. Die Lehrkraft fügt das Feld ins Dokument ein (eigene
  Lernthemen), Schüler nur in ihre eigene Beschriftung; ein selbst eingefügtes
  Feld entfernt das **✕** in der Feldleiste (mit ⬚ Auswählen) wieder.
  Lehrkräfte haben im Menü außerdem **🧩 Quiz aus dem Lernthema** und
  **📄 PDF an dieser Stelle** (Text mit Struktur, Seiten als Bilder oder
  KI-Erkennung) – beides landet als Bausteine im Dokument. Das gilt in eigenen
  Lernthemen überall, wo sich der Stift-Editor öffnen lässt: **✍️ Stift** oben
  in der Notebook-Vorschau, **✍️ Mit Stift bearbeiten** am Dokument (Notebook-
  Vorschau, Vollbild, Vorschau aus der Modulliste). Zur Auswahl stehen alle
  Module des Lernthemas außer Dokumenten.
- **👆 Bedienen:** Eingebettete Quizze im Blatt ausfüllen. **Auswählen und
  Bedienen wechseln von selbst:** Wer mit einem der beiden auf ein Quiz tippt,
  füllt es aus; daneben – oder auf einem Strich oder Textfeld über dem Quiz –
  wird ausgewählt. Der Finger bedient Quizze immer (auch mit ☝️). Mit Stift,
  Textmarker und Textfeld schreiben Stift und Maus auch über einem Quiz.
- **⬚ Auswählen** an einem Textfeld: **✏️ Text bearbeiten** im Menü (⋯,
  Rechtsklick, lange drücken) oder Doppelklick – es geht gleich weiter mit dem
  Schreiben. Eine Farbe gilt sofort, auch für das Textfeld, in dem du gerade
  schreibst.
- **💡 Lösungen** einblenden – nur für Lehrkräfte (Vorschau, Notebooks).
- **🖨 Drucken oder als PDF speichern** (Hintergrund „Dokument“): Arbeitsblatt
  oder Lösungsblatt, jeweils mit oder ohne Beschriftung – über den Druckdialog
  des Browsers („Als PDF speichern“; iPad: Teilen → Drucken). Ränder wie die
  Schulvorlage, Seitenumbrüche aus dem Dokument; Schreibfelder, Bilder und
  Formeln werden nicht über zwei Seiten zerrissen. Schüler sehen nur das
  Arbeitsblatt. Quizze erscheinen so, wie sie gerade aussehen.
- **☝️ Finger:** Normalerweise scrollt der Finger, gezeichnet wird mit Stift
  oder Maus – der Apple Pencil verschiebt die Seite nie. Ist ☝️ an, zeichnet
  auch der Finger, und die Seite steht still; scrollen geht dann mit zwei
  Fingern. Solange der Stift schreibt, zählt die aufliegende Hand nicht.
- **In der Ansicht:** Was mit dem Stift beschriftet ist, steht auch in der
  gewöhnlichen Ansicht des Dokuments – das Blatt erscheint dann wie im
  Stift-Editor (A4, auf die Breite verkleinert), nur zum Ansehen.
- **📐 Geodreieck** blendet ein Geodreieck ein und aus. Verschieben: auf das
  Dreieck tippen und ziehen. Drehen: am **⟳** ziehen (in 1°-Schritten, mit
  gedrückter Umschalttaste in 5°-Schritten), mit zwei Fingern oder mit dem
  Mausrad; der Winkel steht darunter. Vergrößern und verkleinern: am **⤢** in
  der Ecke – die Skala bleibt in echten Zentimetern, ein größeres Dreieck hat
  nur mehr Striche. **Setzt der Stift an einer Kante an**, läuft der Strich
  genau an ihr entlang – an der langen Kante wie an den Schenkeln, mit Stift,
  Maus oder (mit ☝️) Finger. Neben dem Dreieck scrollt der Finger weiter.

Die Leiste bleibt immer oben: Solange der Editor offen ist, zoomt der
Browser die Seite nicht (iPad: Zwei-Finger-Geste); Strg+Mausrad bzw. das
Trackpad zoomt stattdessen das Blatt.

Gespeichert wird vorerst **nur auf diesem Gerät** (im Browser) – getrennt für
Schüler und Lehrkräfte. Abgeben und Auswerten kommen später. Für das PDF als
Hintergrund braucht es den Renderer; das Dokument, Karo, Linien und eigene
Bilder gehen ohne.

Technik: Der Editor gehört zu [lm-editor](https://github.com/mmetzler-fes/lm-editor)
(Submodul `src/renderer/lm-editor`): `src/ink/ink-editor.js`, Geometrie in
`ink-geometry.js` (getestet), Geodreieck in `ink-ruler.js`, das A4-Blatt in
`src/css/paper.css`, PDFs mit pdf.js (`src/vendor/pdfjs/`, legacy build für
ältere iPads). Hier in der App: `js/ink/ink-open.js`. Koordinaten in Punkten –
die Striche bleiben bei jedem Zoom an derselben Stelle des Blatts.

## In der Nextcloud

Mit verbundener [Nextcloud](nextcloud.md) liegen alle Dokumente zusätzlich
als Dateien im Ordner **Arbeitsblätter** – in derselben Ordnerstruktur wie
im Notebook, mit den Nummern im Namen: Blatt und Lösung als .odt und PDF,
dazu die Quelle unter `_Quellen/`.

- Die App ist führend: Ändert sich ein Dokument, druckt sie neu; verschiebt
  man es, ziehen die Dateien mit.
- Sie **überschreibt nie** eine Datei, die sie nicht selbst so geschrieben
  hat. Von Hand geänderte oder fremde Dateien wandern vorher nach
  `_Gesichert/<Datum>/`, ebenso die Dateien gelöschter Dokumente. Nach 180
  Tagen räumt die App dort auf.
- **„In der Nextcloud von Hand gepflegt“** (erweiterte Felder des Dokuments):
  Die App schreibt die Dateien dieses Dokuments nicht mehr neu, verschiebt sie
  aber weiter mit.
- Über dem Notebook-Baum steht der Stand; **⟳ Jetzt abgleichen** startet den
  Abgleich sofort, sonst läuft er stündlich und eine Minute nach Änderungen.

## Technik

Plan und Aufbau: `Arbeitsblaetter-Plan.md`, `architecture.txt`. Format und
Renderer: `worksheet-renderer/SPEC.md`, `worksheet-renderer/README.md`.
Code: `src/worksheets/`, `src/features/`, `src/renderer/js/docspec*.js`.
Endpunkte unter `/api/worksheets/…`, `/api/admin/features`,
`/api/admin/doc-migration`, `/api/my-school/features`,
`POST /api/public/document/:id/pdf`.
