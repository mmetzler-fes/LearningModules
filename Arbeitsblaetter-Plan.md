# Arbeitsblätter in LearningModules – Umsetzungsplan (Entwurf 2)

Ziel: Ein neuer Modultyp **📄 Arbeitsblatt**, dessen Inhalt eine generische
Block-Spec ist (das Format des bisherigen `arbeitsblatt-generator`). Aus
demselben Inhalt entstehen

- eine **Web-Ansicht** im Design der App (Vorschau, Schüler über Themen-Links,
  OneNote),
- ein **druckreifes Arbeitsblatt + Lösungsblatt** als .odt/.pdf über den
  Generator mit der LibreOffice-Vorlage,
- ein **Abbild in der Nextcloud** in der Ordnerstruktur des Notebooks.

Erstellt per KI-Prompt (Fragestellung + Format → Spec), zunächst nur für
freigeschaltete Lehrkräfte.

Änderung gegenüber Entwurf 1: Das Arbeitsblatt ist **kein eigenes
Notebook-Element** mehr, sondern ein Modul in einem Lernthema. Dadurch gibt es
Themen-Links, Quick-Link, OneNote-Seite, Backup, Bilder in der Nextcloud,
Shop und Vernetzung ohne zusätzlichen Aufwand.

---

## 1. Der Modultyp „Arbeitsblatt“

```
📓 Arduino                         ← Kurs-Einstellungen: Titelmuster, Vorlage, KI-Vorgaben
 └─ 📂 Grundlagen
     └─ 📑 Digitale Ausgänge
         └─ 📘 Erste LED            ← Lernthema
              ├─ 📄 Erste LED        ← Modul „Arbeitsblatt“ (Nr. 1, dynamisch)
              ├─ ☑️ Quiz zur LED     ← normale Module daneben, wie bisher
              └─ 🧩 Lückentext …
```

- Modulinhalt = `{ spec: { content: [ …Blöcke… ] }, kind: 'arbeitsblatt' | 'klassenarbeit' | 'info' }`.
  Die Blöcke sind die des Generators: `section, task, subtask, text, list, code,
  image, table, formula, note, solution, karo, spacer, pagebreak`.
- Zählt in der Auswertung **nicht** als Aufgabe (wie „Text / Arbeitsblatt“).
- Ein Lernthema kann mehrere Arbeitsblätter enthalten (z. B. Kapitel mit
  Blatt + Zusatzblatt).

### Ein Format für alles: „Dokument“ geht darin auf

Der bisherige Typ „Text / Arbeitsblatt“ (HTML) wird **nicht** daneben
weitergeführt, sondern geht im neuen Typ auf. Am Ende gibt es **einen**
Modultyp **📄 Dokument** mit den Arten *Arbeitsblatt*, *Klassenarbeit* und
*Text*. Sein Inhalt ist immer die generische Spec:

```
           .odt-Import ─┐
           KI-Prompt ───┼──►  Spec (Blöcke)  ──┬──► Web-Ansicht (Browser)
           Editor ──────┘                      ├──► .odt + Lösung (Renderer)
                                               └──► .pdf (Renderer)
```

Damit ein importiertes Dokument verlustarm in die Spec passt, braucht das
Format mehr als der Generator heute:

| Neu in der Spec | Wofür (heute im .odt-Import vorhanden) |
|---|---|
| **Inline-Formatierung** im Text: `**fett**`, `*kursiv*`, `__unterstrichen__`, `~~durchgestrichen~~`, `^hoch^`, `~tief~`, `` `code` ``, `[Link](https://…)` | Zeichenformate; KIs schreiben diese Markdown-Teilmenge ohnehin sicher |
| `align: left/center/right/justify` an `text` | Ausrichtung |
| `heading` (Ebene 1–3, **ohne** Nummer) neben `section/task` (mit Nummer) | Überschriften freier Dokumente |
| `list` verschachtelt, `ordered: true` | Aufzählungen und Nummerierungen |
| `table` mit `span`/`rowspan` je Zelle und optional ohne berechnete Breiten | verbundene Zellen |
| `image` mit `float: left/right/center`, `border` | umflossene Bilder (heute `ws-float-*`) |
| `box` (Kasten mit Blöcken, Rand/Hintergrund) | Textrahmen |
| Zeichnungen | werden wie heute zu einem SVG-Bild → `image` |

Was sich nicht abbilden lässt (Spalten, Kopf-/Fußzeile, Fußnoten), fällt wie
heute weg, und der Import-Bericht nennt es. Der Generator lernt die neuen
Blöcke und die Inline-Formatierung. Das ist der größte Umbau in
`make_worksheet.py`.

**Bearbeiten:** Der heutige Rich-Text-Editor mit den Bildwerkzeugen bleibt die
Oberfläche, speichert aber die Spec statt HTML. Der Editor arbeitet auf einem
festen, eingeschränkten HTML, das sich 1:1 in Blöcke übersetzen lässt (HTML ↔
Spec). Karo, Lösung, Code und Formel sind darin nicht direkt editierbare
Bausteine mit eigenem kleinen Dialog. Für dich gibt es zusätzlich die
YAML-Ansicht.

**Übergang ohne Risiko für andere:** Der alte Typ bleibt für alle unverändert,
bis der neue fertig ist. Erst dann wandelt eine Migration vorhandene
HTML-Module in Specs um (HTML → Blöcke, mit Bericht), und der alte Typ
verschwindet. Bis dahin sehen nur freigeschaltete Lehrkräfte den neuen Typ.

### Web-Ansicht (`h5p-renderer.js` / eigener `worksheet-view.js`)

| Block | Online |
|---|---|
| section/task/subtask | Überschriften mit Gliederungsnummer 1. / 1.1 / 1.1.1 |
| text, list, note, table | im App-Design, Tabellen scrollbar auf dem Handy |
| code | Monospace, grau, Zeilennummern optional |
| image | Bild aus der Nextcloud (vorhandene Bild-Links) |
| formula | StarMath → **MathML** (kleiner Übersetzer für die gängige Teilmenge; Browser stellen MathML nativ dar) |
| karo | Karofläche in der Höhe des Rasters; später optional als Eingabefeld |
| solution | ausgeblendet; „💡 Lösung zeigen“ je nach Modus des Links (Lernen mit Lösungen ja, Quiz nein); Lehrkraft-Vorschau: Schalter |
| pagebreak, spacer | online ignoriert bzw. kleiner Abstand |

Dazu oben am Modul: **⬇ PDF** (und für die Lehrkraft ⬇ .odt, ⬇ Lösung).

### Dynamische Nummerierung

- Gezählt wird **je Ordner**: im nächsten Abschnitt (bzw. Bereich oder Book,
  wenn das Lernthema direkt dort liegt). Jeder Ordner beginnt bei 1.
- Innerhalb des Ordners zählen die Dokumente in Baumreihenfolge durch:
  Lernthemen in ihrer Notebook-Reihenfolge, darin die Dokumente in ihrer
  Modulreihenfolge. Ein Lernthema mit drei Dokumenten belegt drei Nummern.
- Wird ein Lernthema (oder ein Dokument) in einen anderen Abschnitt
  verschoben, bekommt es dort die passende Nummer, und der alte Abschnitt
  rückt auf.

```
📑 Digitale Ausgänge
   📘 Erste LED        → 📄 1 Erste LED
                         📄 2 LED blinken
   📘 Lauflicht        → 📄 3 Lauflicht
📑 Eingänge
   📘 Taster           → 📄 1 Taster        (neuer Abschnitt: wieder ab 1)
```

- **Kopfzeile:** Die Nummer trägt die Positionen der Ordner davor mit:
  `{pfad}` → „2.1“ (Ordner 2, Blatt 1), bei tieferer Verschachtelung
  „2.1.3“. Standard-Titelmuster: `{kurs} {pfad} – {titel}` →
  **„Arduino 2.1 – Der AD-Wandler“**. `{nummer}` (nur die letzte Stelle)
  bleibt fürs eigene Muster verfügbar.
- **Zwei Schalter je Ordner** (Book, Bereich, Abschnitt) legen die Tiefe fest:
  - **„Zählung beginnt hier“:** Ordner darüber erscheinen nicht in der Nummer.
    Die Kinder dieses Ordners werden 1, 2, 3, deren Inhalt 1.1, 1.2 …
    Ohne Einstellung beginnt die Zählung am nächsten Ordner mit
    Kurs-Einstellungen, sonst am Book.
  - **„Darunter durchzählen“:** Unterhalb dieses Ordners entstehen keine
    weiteren Ebenen. Alle Dokumente darunter zählen auf dieser Ebene
    fortlaufend, die Unterordner gliedern nur noch.
  - Beides am Book = durchgehend 1 bis n wie heute im Generator
    („Arduino 13 – Der AD-Wandler“).
- **Regeln:** Lernthemen sind keine Ebene, ihre Dokumente zählen einzeln im
  Ordner. In einem Ordner zählen wie im Baum erst die Unterordner, dann die
  Lernthemen (Unterordner 1 mit 1.1, 1.2, danach Dokument 2). Ordner ohne Dokumente
  bekommen keine Nummer (keine Lücken). Der Notebook-Baum zeigt die
  Ordnernummern grau vor dem Namen. Die Nextcloud-Ordner tragen dieselben.

```
📓 Informatik
 └─ 📂 Arduino              [Zählung beginnt hier]
     ├─ 📑 Grundlagen         1
     │    📄 Erste LED          1.1
     │    📄 Digitale Ausgänge  1.2
     ├─ 📂 Sensoren           2      ← mit „Darunter durchzählen“:
     │   ├─ 📑 Analog          2.1        AD-Wandler 2.1, PWM 2.2,
     │   │    📄 AD-Wandler       2.1.1    LC-Display 2.3
     │   │    📄 PWM              2.1.2
     │   └─ 📑 I²C             2.2
     │        📄 LC-Display       2.2.1
     └─ 📑 IoT                3
          📄 WLAN und MQTT      3.1
```

Beispiel Arduino-Kurs nach dem Import (Standard):

| Blatt | Kopfzeile | durchgehend |
|---|---|---|
| 01 | Arduino 1.1 – Der Mikrocontroller und die erste LED | Arduino 1 – … |
| 12 | Arduino 1.12 – 7-Segment-Anzeige und Projekt Countdown | Arduino 12 – … |
| 13 | Arduino 2.1 – Der AD-Wandler | Arduino 13 – … |
| 23 | Arduino 3.1 – WLAN und MQTT | Arduino 23 – … |

„Pulsweitenmodulation“ (2.3) ganz nach vorn in *IoT* gezogen: Sie wird 3.1,
2.4–2.10 rücken auf 2.3–2.9, und 3.1–3.6 werden 3.2–3.7. Teil 1 bleibt
unverändert.

### Verweise auf andere Blätter

Nummern im Text („siehe Blatt 6“, „Klassenarbeit zu den Blättern 13–18“)
würden beim Umsortieren veralten. Deshalb gibt es in der Spec Verweise:

- `{{blatt:06_verzweigungen}}` → aktuelle Nummer, z. B. „1.6“
- `{{blatt:13_ad_wandler..18_ultraschallsensor}}` → „2.1–2.6“
- `{{titel:06_verzweigungen}}` → „Verzweigungen“

Der Schlüssel ist der `slug` des Dokuments (beim Import der Ordnername, in
der App aus dem Titel, eindeutig im Book). Die Web-Ansicht und der Renderer
setzen die Nummer ein. Ändert sich eine Nummer, werden auch alle Blätter neu
gebaut, die auf sie verweisen. Ein Verweis auf ein gelöschtes Blatt
erscheint als „⚠ Blatt fehlt“ und steht im Prüfbericht. Der KI-Prompt kennt
die Slugs des Kurses und nutzt die Verweise. Beim Import wandelt die App
Nummern im Text nicht automatisch um, meldet aber Stellen wie „Blatt 13“
als Vorschlag.

- Ziehen per Drag and Drop (Lernthemen im Notebook, Module im Thema) ändert die
  Nummern. Die betroffenen Blätter werden im Hintergrund neu gerendert (die
  Nummer steht in der Kopfzeile), und die Dateien in der Nextcloud werden
  umbenannt.
- Gesammelt wird verzögert: etwa 1 Minute nach der letzten Änderung ein Lauf,
  nicht bei jedem einzelnen Zug.
- Optional je Blatt: „Nicht nummerieren“ (Infoblatt, Klassenarbeit).

---

## 2. Renderer als eigener Container

Der Generator (Code und Grundvorlage, **nicht** die Kursinhalte) zieht als
Unterordner `worksheet-renderer/` ins LearningModules-Repo und läuft als
eigener Dienst.

```
docker-compose:
  learningmodules      (wie bisher, unverändert)
  worksheet-renderer   Python + odfpy + LibreOffice, kleiner HTTP-Dienst
                       nur im internen Docker-Netz erreichbar, kein Port nach außen
```

### Ein oder zwei Container?

Hier geht es um zwei verschiedene Fragen:

- **Entwickeln:** Dafür braucht man gar keinen Container. Lokal laufen
  `bun run start:dev` und der Python-Dienst (venv) nebeneinander, LibreOffice
  hast du ohnehin installiert. Docker brauchst du erst zum Testen des fertigen
  Images.
- **Betreiben:** Hier fällt die eigentliche Entscheidung.

| | Ein Container (alles im Hauptimage) | Zwei Container (Empfehlung) |
|---|---|---|
| Installation | nichts Neues | ein zusätzlicher Block in `docker-compose` |
| Hauptimage | **+600–800 MB für alle Schulen**, auch ohne Arbeitsblätter | unverändert |
| Aufruf | Node startet Python direkt (kein HTTP) | HTTP im internen Netz |
| Ausfall/Speicher | LibreOffice-Spitzen und Hänger treffen die App selbst | bleiben im Renderer, die App läuft weiter |
| Updates | immer beides zusammen | Renderer lässt sich einzeln neu starten oder austauschen |
| Testphase | jede Schule bekommt den Code mit | nur Server mit eingetragenem Renderer |
| CI-Bauzeit | länger bei jedem Build | zweites Image, nur bei Änderungen in `worksheet-renderer/` |

**Empfehlung: zwei Container, ein Repo.** Gerade in der Testphase ist das
sauberer, weil das öffentliche Image für alle anderen unverändert bleibt.

### Konsequenzen

| Thema | Was das bedeutet |
|---|---|
| Hauptimage | bleibt so groß wie heute. Schulen ohne Arbeitsblätter merken nichts. |
| Renderer-Image | ca. 600–800 MB (LibreOffice). Wird nur gezogen, wer den Dienst einträgt. |
| Betrieb | ein zusätzlicher Block in `docker-compose.yaml` + `WORKSHEET_RENDERER_URL` und ein gemeinsames Geheimnis (`WORKSHEET_RENDERER_TOKEN`). |
| Ohne Renderer | Der Modultyp lässt sich nicht freischalten. Die Web-Ansicht vorhandener Blätter funktioniert trotzdem (sie braucht den Renderer nicht), nur die Downloads nicht. |
| Speicher (RAM) | LibreOffice braucht je PDF-Umwandlung kurz 150–300 MB. Der Dienst arbeitet höchstens 2 Aufträge gleichzeitig ab, der Rest wartet in der Schlange. |
| Geschwindigkeit | .odt ca. 0,5 s, PDF 1–3 s je Blatt (LibreOffice-Start). Das reicht, weil Umnummerieren im Hintergrund läuft. |
| Sicherheit | Der Dienst hat keinen Zugang zur DB und kein Internet. Er bekommt nur Spec + Vorlage + Dateien, arbeitet in einem Temp-Verzeichnis je Auftrag und löscht es danach. |
| Versionen | Gleiches Repo, gleiche Version: Die CI (`docker-build.yml`) baut zusätzlich `ghcr.io/mmetzler-fes/worksheet-renderer`. Die App prüft beim Start `/health` (Version, LibreOffice vorhanden). |
| Entwicklung lokal | `worksheet-renderer` mit venv starten (oder `docker run`), `WORKSHEET_RENDERER_URL=http://localhost:8090`. |
| Moodle-Compose | bekommt denselben optionalen Block. |

### Repo-Aufteilung

- **LearningModules (öffentlich, AGPL):** `worksheet-renderer/` mit
  `tools/*.py`, HTTP-Dienst, Dockerfile, neutraler Grundvorlage, Tests.
  Der Generator-Code wird damit öffentlich und AGPL – bitte bestätigen.
- **arbeitsblatt-generator (privat):** behält `kurse/` und die
  **FES-Schulvorlagen mit Logo**. Die gehören nicht ins öffentliche Repo,
  sondern werden in der App als Schulvorlage hochgeladen. Das `Makefile` ruft
  den Generator künftig aus `../LearningModules/worksheet-renderer/` auf (Pfad
  als Variable) oder per `docker run`. So bleibt `make pdf` mit Claude Code im
  Terminal weiter möglich.
- `file:`-Verweise: Der CLI-Weg liest wie bisher aus dem Kursordner, der
  Dienst bekommt die Dateien mitgeschickt.

---

## 3. Nextcloud-Abbild

**App führend, Nextcloud als Abbild.** Quelle ist die Spec im Modul.

```
<Freigabe>/Arbeitsblätter/
  Arduino/
    01 Grundlagen/
      01 Digitale Ausgänge/
        01 Erste LED.odt
        01 Erste LED – Lösung.odt
        01 Erste LED.pdf
        _Quellen/01 Erste LED.yaml
    _Gesichert/
      2026-10-20/01 Erste LED.odt          ← von Hand geänderte Fassung
```

- Ordner bekommen eine **Positionsnummer** (`01 Grundlagen`), damit die
  Nextcloud so sortiert wie das Notebook. Die Nummer ändert sich beim Ziehen
  mit (MOVE).
- Nur Ordner mit Arbeitsblättern entstehen, reine Quiz-Bereiche nicht.
- Je Datei merkt sich die App den Pfad und das ETag ihres letzten Schreibens
  (Soll/Ist-Abgleich, stündlich nachholen, wenn die Nextcloud nicht erreichbar
  war).
- Mit der Nextcloud der Schule: `Arbeitsblätter/<Name> (<Kennung>)/…`.
- Nur eigene Lernthemen werden abgebildet, gekaufte nicht.

### Konflikte – eine einzige Regel

> **Die App überschreibt nie eine Datei, die sie nicht selbst genau so
> geschrieben hat. Solche Dateien verschiebt sie zuerst nach
> `_Gesichert/<Datum>/` und schreibt dann.**

Das deckt alle Fälle ab:

| Fall | Was passiert |
|---|---|
| .odt in der Nextcloud von Hand bearbeitet, danach ändert sich das Blatt in der App | Handfassung → `_Gesichert/2026-10-20/`, neue Fassung unter dem gewohnten Namen. Am Modul steht „⚠ Handfassung gesichert“ mit Link. |
| Umnummerieren: Ziel-Name ist schon belegt (z. B. von Hand angelegte Datei „02 …“) | fremde Datei → `_Gesichert/`, dann umbenennen |
| Zwei Blätter hätten denselben Namen | kann durch die eindeutige Nummer im Kurs nicht passieren. Bei „nicht nummerieren“ hängt die App `(2)` an. |
| Handfassung soll bleiben | Schalter am Modul **„In der Nextcloud von Hand gepflegt“**: Die App schreibt dieses Blatt nicht mehr, verschiebt es aber weiter mit. |
| Datei in der Nextcloud gelöscht | wird beim nächsten Abgleich neu geschrieben |
| Modul in der App gelöscht | Dateien → `_Gesichert/` (nicht sofort weg) |

`_Gesichert/` räumt die App nach 180 Tagen auf (einstellbar). Zusätzlich hat
die Nextcloud ihre eigenen Versionen.

### Speicherplatz

Grobe Größen je Blatt ohne große Bilder: .odt 30–150 KB, PDF 50–300 KB. Mit
Lösung und PDF ca. **0,3–1 MB je Blatt**, bei 500 Blättern also 150–500 MB.

Maßnahmen:
- **Nur bei echter Änderung schreiben:** Hash über Spec + Vorlage + Nummer.
  Speichern ohne inhaltliche Änderung erzeugt keine neue Datei und damit auch
  keine neue Nextcloud-Version.
- **Formate:** Standard sind **alle vier** (.odt, Lösung .odt, .pdf, Lösung
  .pdf). Einzelne lassen sich je Lehrkraft oder je Kurs-Knoten abschalten.
  PDFs für Schüler kommen aus derselben Datei bzw. aus dem kurzen Cache des
  Servers.
- **Bilder** liegen einmal in `Bilder/` und werden nur referenziert.
- **Anzeige** des belegten Platzes im Nextcloud-Dialog. Für später eine
  Obergrenze je Lehrkraft, wie heute bei den Bildern in der App.
- Nextcloud-Versionen zählen zum Kontingent. Die Nextcloud räumt sie zwar
  selbst auf, aber seltene Schreibvorgänge (siehe oben) helfen am meisten.

---

## 4. Vorlagen

- .ott mit `{{TITEL}}` (Kopfzeile) und `{{INHALT}}` (Ankerabsatz) +
  Zuordnung der Formatvorlagen.
- **Arten:** Arbeitsblatt, Klassenarbeit, Skript.
- **Wer:** jede Lehrkraft eigene; der Schuladmin legt die Schul-Standardvorlage
  fest; mitgeliefert eine neutrale Grundvorlage.
- **Welche gilt:** Modul → Kurs-Knoten (vererbt) → Lehrkraft → Schule → Grundvorlage.
- **Hochladen:** prüfen (`inspect_ott`), fehlende Rollen zuordnen oder ergänzen,
  Probeblatt erzeugen. Gespeichert in der DB.
- Die FES-Vorlagen aus dem privaten Repo werden so als Schulvorlage hochgeladen.

---

## 5. Freischaltung (Funktionsschalter)

- `User.features: string[] | null` (z. B. `['worksheets']`), SystemConfig
  `features.worksheets: 'off' | 'selected' | 'all'`.
- Zunächst schaltet **nur der Hauptadmin** frei (Benutzerverwaltung: Häkchen je
  Lehrkraft; Einstellungen: aus / ausgewählte / alle). Später zusätzlich der
  Schuladmin für seine Schule, weil der Speicher dann in der Schul-Nextcloud liegt.
- Ohne Freischaltung: Modultyp nicht im „Neues Modul“-Dialog, kein KI-Reiter,
  keine Kurs-Einstellungen, Server-Routen `/api/worksheets/*` gesperrt
  (`@RequireFeature('worksheets')`).
- Vorhandene Arbeitsblatt-Module bleiben für Schüler sichtbar, wenn sie in
  einem Link stehen, auch wenn der Schalter später wieder aus ist.

---

## 6. KI-Prompt

Reiter **📄 Arbeitsblatt** in der Ansicht 🤖 KI-Prompt, auch über das
Knotenmenü „➕ Arbeitsblatt per KI“ mit vorgewähltem Ziel.

- Eingaben: Ziel (Lernthema neu/vorhanden, Knoten), Art, Fragestellung/Thema,
  Niveau, Umfang, Material (Text, Quellcode, `nc:`-Bilder), Anzahl Blätter.
- Der Prompt enthält das Block-Format, die redaktionellen Regeln und die
  vererbten **KI-Vorgaben** des Kurs-Knotens (≙ bisherige Kurs-`CLAUDE.md`).
- Antwort als YAML (JSON geht auch). Schemaprüfung mit Bericht und
  „Fehlerbericht als Prompt kopieren“, damit die KI selbst korrigiert, dann
  Vorschau und Speichern.
- Optional im selben Prompt: **passende Quiz-Module zum Blatt** (vorhandenes
  JSON-Format) ins selbe Lernthema. So entstehen Blatt und Übung zusammen.

---

## 7. Import und Export von Kursen

- **Import .zip** eines Kursordners → Book (oder Bereich unter einem gewählten
  Knoten) mit Kurs-Einstellungen (`kurs.yaml`) und KI-Vorgaben (`CLAUDE.md`).
- **Abschnitte aus `skripte/*.yaml`:** Jedes Skript wird ein Abschnitt (Titel
  ohne den Kursnamen, z. B. „Grundlagen“) mit seinen Blättern in der dort
  angegebenen Reihenfolge. Die Skript-Angaben (Titel, Kopfzeile) werden am
  Abschnitt gemerkt, für „Als Skript drucken“ später. Blätter in keinem
  Skript kommen direkt ins Book, `ka_*` in einen Abschnitt „Klassenarbeiten“
  (Art Klassenarbeit, nicht nummeriert).
- Je `NN_thema/` ein Lernthema mit einem Dokument-Modul, `slug` = Ordnername.
  Die Reihenfolge kommt aus Skript bzw. `NN`, danach wird dynamisch
  nummeriert. `file:`-Code wird inline übernommen, Bilder kommen in
  die Nextcloud.
- **Import einzelner Blätter** (.yaml/.json) in ein Lernthema.
- **Export** eines Knotens als .zip im Generator-Format, also hin und zurück
  zum privaten Repo.

---

## 8. Schüler und OneNote (später, aber jetzt mitgedacht)

Weil das Arbeitsblatt ein Modul ist, funktioniert der Weg zu den Schülern über
das Vorhandene:

- Themen-Link oder Quick-Link → Web-Ansicht + ⬇ PDF (öffentliche Route,
  Rechte wie bei den anderen Modulen).
- **Neu:** Im Knotenmenü **„📓 Als OneNote-Seite kopieren“** an
  Abschnitt/Bereich: eine Seite mit der Gliederung (Nummer + Titel je Blatt),
  je Blatt ein Link zur Web-Ansicht und zum PDF, oben ein QR-Code. Baut auf
  `copyOneNotePage()` in `utils.js` auf.
- Links für Schüler zeigen immer auf die **App** (Modul-ID), nie direkt auf
  Nextcloud-Dateien. Umnummerieren und Verschieben macht sie deshalb nicht
  kaputt.

---

## 9. Datenmodell

```
LearningModule (vorhanden)
  type = 'document'         (neuer Typ; der alte 'worksheet' bleibt bis zur Migration in Phase 7)
  content = { spec, slug, kind: 'arbeitsblatt'|'klassenarbeit'|'text', numbered: bool, handMaintained: bool }
  Spec intern als JSON wie bei allen Modulen; YAML nur im Editor und für Import/Export.

WorksheetRender            (Zustand je Modul und Lehrkraft, nicht im Modul selbst)
  moduleId, ownerId
  number, renderHash, renderedAt
  ncFiles: simple-json     [{ art, path, etag }]
  status: 'ok' | 'pending' | 'error', error

WorksheetTemplate
  id, ownerId | null, schoolId | null, kind, name, ott: blob, styleMap, isDefault

NotebookNode (+)
  worksheetSettings: simple-json   { kurs, titelmuster, autor, templateId, meta, formats,
                                     numberRoot: bool   („Zählung beginnt hier“),
                                     numberFlat: bool   („Darunter durchzählen“),
                                     skript: { titel, kopfzeile } (am Abschnitt) }
  aiGuidelines: text

User (+)          features: string[] | null
SystemConfig (+)  features
```

---

## 10. API (Skizze)

```
POST /api/worksheets/validate              Spec prüfen
GET  /api/worksheets/:moduleId/file/:art   odt | loesung.odt | pdf | loesung.pdf
POST /api/worksheets/:moduleId/render      sofort neu bauen
GET  /api/worksheets/status?nodeId=…       Render-/Nextcloud-Status für den Baum
POST /api/worksheets/import                .zip / .yaml / .json
GET  /api/notebooks/nodes/:id/export       .zip im Generator-Format
PUT  /api/notebooks/nodes/:id/worksheet-settings
GET  /api/public/…/worksheet/:moduleId.pdf Schüler-PDF (über Link-Token)
CRUD /api/worksheet-templates (+ /:id/check)
```

Module selbst laufen über die vorhandenen Modul-Routen. Ein Hook nach dem
Speichern bzw. Verschieben stößt das Rendern und den Abgleich an.

---

## 11. Oberfläche

- Kein neuer Hauptmenüpunkt.
- Notebook: Arbeitsblatt-Module erscheinen im aufgeklappten Lernthema mit 📄
  und ihrer Nummer. Filter *Alle · Lernthemen · Arbeitsblätter*. Statuspunkt,
  falls das Rendern oder die Nextcloud hängt.
- Knotenmenü: ⚙️ Kurs-Einstellungen & KI-Vorgaben, ➕ Arbeitsblatt per KI,
  📥 Kurs importieren, ⬇ Als Kurs exportieren, 📓 Als OneNote-Seite kopieren.
- Modul-Editor für Arbeitsblätter: links die Spec, rechts die Web-Ansicht
  (sofort, ohne Renderer), Knopf „Druckansicht“ (PDF vom Renderer), oben die
  Downloads.
  - Stufe 1: YAML-Editor mit Prüfung beim Tippen.
  - Stufe 2: Block-Editor (bevor andere Lehrkräfte es nutzen).

---

## 12. Phasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| 0 ✅ | Generator nach `worksheet-renderer/` umziehen, HTTP-Dienst, Dockerfile, CI; privates Repo auf neuen Pfad umstellen | `make pdf` geht weiter, `curl` liefert .odt/.pdf |
| 1 ✅ | Funktionsschalter, Modultyp „Dokument (neu)“ mit Web-Ansicht (inkl. StarMath→MathML), YAML-Editor, Downloads | Blätter in der App ansehen und drucken |
| 2 ✅ | Kurs-Einstellungen am Knoten, Pfadnummern mit Zählbeginn/Durchzählen je Ordner, Verweise `{{blatt:…}}`, Import (Abschnitte aus Skripten)/Export .zip | deine Kurse sind drin und lassen sich umsortieren |
| 3 ✅ | Spec-Erweiterung (Inline-Formatierung, heading, box, float, Zellverbund) in Web-Ansicht und Generator; .odt-Import → Spec | beliebige .odt-Dokumente als Dokument-Modul |
| 4 | Nextcloud-Abbild mit Soll/Ist-Abgleich, `_Gesichert/`, Speicheranzeige | Dateien auch ohne App |
| 5 | KI-Prompt-Reiter (optional mit Quiz-Modulen) | Blätter per KI ohne Terminal |
| 6 | Rich-Text-Editor auf Spec umstellen (HTML ↔ Spec), Vorlagen hochladen | bequem bearbeiten, eigene Vorlagen |
| 7 | Migration der alten HTML-Module, alter Typ entfällt; Schüler-PDF, OneNote-Seite für Knoten, Schuladmin-Freischaltung, Skripte | bereit für alle |

---

## 13. Offene Fragen

Entschieden:
- Generator öffentlich unter AGPL in `worksheet-renderer/`; Kurse und
  FES-Vorlagen bleiben im privaten Repo.
- Zwei Container (App + Renderer), ein Repo.
- Ein Modultyp „Dokument“, in dem der alte Typ aufgeht (.odt-Import → Spec).
- Spec intern als JSON; YAML nur im Editor und für Import/Export.
- Nummerierung als Pfadnummer (`Arduino 2.1 – …`). Die Tiefe legen die
  Schalter „Zählung beginnt hier“ und „Darunter durchzählen“ je Ordner fest.
  Beides am Book = durchgehend wie heute.
- Verweise `{{blatt:…}}` auf andere Blätter.
- Import bildet die Abschnitte aus `skripte/*.yaml`.
- Alle vier Formate in die Nextcloud, abschaltbar.
- App führend, Nextcloud als Abbild, Konflikte → `_Gesichert/`.
- Freischaltung zunächst nur durch den Hauptadmin.

Noch offen: nichts Grundsätzliches. Details klären sich in Phase 0/1.
