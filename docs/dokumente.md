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
- **➕ Einfügen …**: Karo (Platz zum Schreiben), Lösung, Formel, Code, Tabelle,
  Kasten, Platz, Seitenumbruch. Graue **Bausteine** öffnen sich mit einem
  Doppelklick.
- Eine **Lösung** gehört hinter ein Karo: Im Arbeitsblatt ist sie
  ausgeblendet, im Lösungsblatt steht sie rot über dem Karo.

Rechts steht die **Vorschau**, darüber die Kopfzeile, wie sie gedruckt wird.
**🖨 PDF**, **⬇ .odt**, **🖨 Lösung** und **⬇ Lösung .odt** erzeugen die
Dateien vom aktuellen Stand, auch ungespeichert.

**⌨ YAML** zeigt dasselbe Dokument als Text – praktisch zum schnellen Ändern
vieler Stellen oder für Antworten einer KI. Das Format beschreibt die Datei
`worksheet-renderer/SPEC.md`.

**📄 Aus .odt übernehmen** liest ein Writer-Dokument ein: Überschriften,
Absätze, Listen, Tabellen (auch verbundene Zellen), Bilder mit ihrer Lage und
Textrahmen. Formeln aus dem Formeleditor und Bilder in Tabellen kommen nicht
mit; der Editor nennt, was fehlt.

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

## Für Schüler

Dokumente erscheinen in Themen-Links und Quick-Links wie andere Module, als
Lese-Seite. Mit **⬇ Als PDF** holen sich Schüler das Blatt – ohne Lösungen.
Bei **Lernen mit Lösungen** und in der Vorschau lassen sich die Lösungen
aufdecken, im Quiz bleiben sie verborgen.

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
