# Klassen und Schuljahr

Ergebnisse sollen nach Schuljahr und Klasse ausgewertet werden können: je
Klasse alle Schüler (Name, Vorname) mit ihren Ergebnissen, je Test alle
Schüler der Klasse – auch die, die noch fehlen –, und über das Jahr ein
Überblick über das Engagement.

## Schuljahr

Der Hauptadmin setzt unter **Shop & Sicherheit → 📅 Schuljahr** das aktuelle
Schuljahr, in oder nach den Sommerferien, im Format `SJ26-27`. *Nächstes
Schuljahr eintragen* zählt das eingetragene um eins weiter.

Solange es nie gesetzt wurde, gilt der Kalender: ab dem 1. August das neue
Schuljahr.

Das Format entspricht dem SchülerLernTool, das Klassen als `SJ26-27-E1ME1`
benennt.

Jedes Ergebnis hält beim Speichern das aktuelle Schuljahr fest – auch in der
Quiz-Arena. Errechnet wird es bewusst nicht aus dem Datum, denn der Wechsel
geschieht von Hand.

**Bestand:** Ergebnisse und Klassen aus der Zeit vor den Schuljahren kommen
beim Start ins aktuelle Schuljahr; alte Klassen gehören dabei ihrem
Ersteller. Das Programm ist jung genug, dass praktisch alles aus dem
laufenden Schuljahr stammt. Der Nachtrag ändert nur Einträge ohne Schuljahr
und tut danach nichts mehr.

## Klassen

Menüpunkt **🏫 Klassen**. Oben das Schuljahr (Vorgabe: das aktuelle),
darunter die eigenen Klassen dieses Jahres.

- Eine Klasse gehört **genau zu einem Schuljahr**. Der Name ist je Lehrkraft
  und Schuljahr eindeutig.
- **Schülerlisten sind je Lehrkraft**, nicht schulweit: Nicht jede Lehrkraft
  soll alle Schülerdaten sehen. Zwei Lehrkräfte derselben Klasse pflegen
  deshalb (vorerst) je eine eigene Liste.
- Zum Schuljahreswechsel eine Klasse **nicht umbenennen**, sondern ins neue
  Jahr übernehmen (kommt mit dem Assistenten, siehe unten) – sonst stehen die
  Ergebnisse des alten Jahres unter dem neuen Namen.
- Löschen entfernt Klasse und Schülerliste; gespeicherte Ergebnisse bleiben.

### Schülerliste

Je Schüler Vorname(n) und Name. Doppelvornamen stehen in einem Feld
(„Anna Lena“). Sortiert wird nach Name, dann Vorname.

Einträge mit dem Vermerk **unbestätigt** sind bei der Anmeldung eines
Schülers entstanden. Die Lehrkraft bestätigt sie (✓), korrigiert sie (✏️)
oder ordnet sie einem Schüler der Liste zu (⇄) – seine Ergebnisse gehen
dann mit, der Eintrag verschwindet. Eine Namenskorrektur ändert auch den
Namen in den Ergebnissen des Schülers.

## Anmeldung über Klassenlinks

Wer über einen Klassenlink startet (Übung, Klassenarbeit, Quiz-Arena), gibt
Vorname(n) und – bei Bedarf – den Nachnamen oder seinen Anfang ein. Der Name
wird einem Schüler der Liste zugeordnet:

- Alles als Vorname gelesen („Adrian“, „Anna Lena“, auch nur „Lena“) oder
  das letzte Wort als Anfang des Nachnamens („Adrian Al“).
- Passt genau einer, ist er es. Der volle Name gilt immer („Max Mai“ neben
  „Max Maier“).
- Groß-/Kleinschreibung, Umlaute (Ö = Oe) und Akzente spielen keine Rolle.

Im Ergebnis steht der Name aus der Liste, nicht die Schreibweise der
Eingabe. Gespeichert wird über einen **Schülerausweis**, den der Start
ausstellt (signiert, 12 Stunden gültig) – ein geänderter Name im Browser
ändert daran nichts. „Klassenarbeit nur einmal“ zählt je Schüler.

**🔒 strikt** (je Klasse, in der Schülerliste und beim Einlesen): Wer nicht
eindeutig zugeordnet werden kann, kommt nicht hinein. Die Meldung sagt nur,
ob der Name fehlt oder mehrdeutig ist – nie, welche Namen es gibt.

**Offen** (strikt aus): Unbekannte Namen kommen als unbestätigte Einträge
dazu; wer sich erneut so anmeldet, landet beim selben Eintrag. Für
Nachzügler strikt kurz ausschalten, anmelden lassen, wieder einschalten und
den Eintrag bestätigen oder zuordnen.

## Klassen einlesen (SchülerLernTool)

Im SchülerLernTool unter **Eigenschaften → 🎓 Klassen für LearningModules
exportieren** die Klassen wählen; es entsteht eine mit dem App-Passwort
verschlüsselte Tabelle, ein Blatt je Klasse (Klasse, Klassen-ID, dann
Name | Vorname | Schüler-ID).

In LearningModules unter **🏫 Klassen → 📥 Klassen einlesen** öffnen. Die
Vorschau zeigt je Klasse Schuljahr, ob sie neu ist und wie viele Schüler
dazukommen; **Danach strikt** ist vorgewählt.

- Das Schuljahr steht im SchülerLernTool als Vorsatz im Klassennamen
  (`SJ26-27-E1ME1` → Klasse `E1ME1` im SJ26-27); ohne Vorsatz gilt das oben
  gewählte Schuljahr.
- Vorhandene Klassen werden über die Klassen-ID erkannt (auch nach dem
  Umbenennen), sonst über den Namen; Schüler über die Schüler-ID, sonst
  über den Namen. Erneutes Einlesen legt nichts doppelt an.
- Schüler, die in der Datei fehlen, bleiben erhalten.
- Eine einzelne Klassenliste (mit Kursen und Noten) lässt sich weiterhin in
  der Klasse selbst über *📥 Schülerliste einlesen* übernehmen.

### Schülerliste einlesen

**📥 Schülerliste einlesen** nimmt

- die **Klassenliste des SchülerLernTools** (`.ods`, mit dem App-Passwort
  verschlüsselt): Klassenseite → `⋯` → Klassenliste exportieren;
- jede andere Tabelle (`.ods`) oder **CSV-Datei** mit einer Kopfzeile, die
  die Spalten `Name` (oder `Nachname`) und `Vorname` enthält.

Übernommen werden nur Name, Vorname und – falls vorhanden – die
`Schüler-ID`. Betrieb, Fotos, Kurse und Noten bleiben im SchülerLernTool.

Die Datei wird **im Browser** gelesen und entschlüsselt; das Passwort
verlässt das Gerät nicht, zum Server gehen nur die Namen. Gelesen werden
alle Verschlüsselungen, die vorkommen: Blowfish (so schreibt das
SchülerLernTool), AES-CBC (LibreOffice bis 24.2) und AES-GCM mit Argon2id
(neueres LibreOffice).

Vor dem Übernehmen zeigt eine Vorschau, wer neu ist und wer aktualisiert
wird. Dabei gilt:

| Fall | Ergebnis |
|---|---|
| gleiche Schüler-ID | derselbe Schüler, Namen werden aktualisiert |
| sonst gleicher Name (Groß-/Kleinschreibung egal) | derselbe Schüler, er bekommt die Schüler-ID; ein unbestätigter Eintrag gilt damit als bestätigt |
| sonst | neuer Schüler |
| Schüler fehlt in der Datei | bleibt in der Klasse |

## Geplant

Die Umsetzung erfolgt in Schritten, jeder für sich nutzbar:

1. ✅ Schuljahr, Klassen mit Schülerliste, Import
2. ✅ **Klassenlinks**, siehe [Schülerfreigaben](themen-links.md#versenden-immer-für-eine-klasse).
   Freigabe und Quick-Link sind Regeln; *Link & QR* fragt nach der Klasse
   (oder legt sie an) und erzeugt einen Klassenlink in der Klassenübersicht
   der Schülerfreigaben, neuester oben. Ergebnisse speichern Klasse und
   deren Schuljahr. Alte Links und QR-Codes gelten weiter und speichern unter
   „ohne Klasse“, bis man sie einer Klasse zuordnet.
3. ✅ **Anmeldung über die Schülerliste**, strikter Modus, Schülerausweis,
   Zuordnen unbestätigter Einträge, Klassen einlesen aus dem SchülerLernTool.
4. **Ansicht Klassenergebnisse:** Schuljahr → Klasse → Schüler / Tests (mit
   „fehlt noch“) / Jahresüberblick.
5. **Assistent zum Schuljahreswechsel:** Klassen übernehmen (Schülerliste
   wird kopiert) oder aufgeben, Klassenlinks umhängen oder deaktivieren.
6. **Klasse mit Kollegin teilen** (übernimmt Klasse und Schülerliste, eigene
   Ergebnisse bleiben getrennt), **Löschregel** nach drei Schuljahren mit
   vorherigem Export.

## Technik

| Endpunkt | Zweck |
|---|---|
| `GET /api/classes/school-year` | aktuelles Schuljahr, Schuljahre mit eigenen Klassen |
| `PUT /api/classes/school-year` | nur Admin: `{ schoolYear: 'SJ26-27' }` |
| `GET /api/classes?year=SJ26-27` | eigene Klassen eines Schuljahrs mit Zählern |
| `POST/PATCH/DELETE /api/classes[/:id]` | Klasse anlegen, umbenennen, löschen |
| `GET /api/classes/:id` | Klasse mit Schülerliste |
| `POST /api/classes/:id/students` | Schüler anlegen |
| `PATCH/DELETE /api/classes/:id/students/:sid` | ändern (`confirm: true` bestätigt), entfernen |
| `POST /api/classes/:id/import` | `{ students: [{ firstName, lastName, importId }], dryRun }` |
| `POST /api/classes/import` | mehrere Klassen: `{ classes: [{ name, classId, students }], schoolYear, strict, dryRun }` |
| `POST /api/classes/:id/students/:sid/merge` | unbestätigten Eintrag zuordnen, `{ targetId }` |

Entitäten: `StudentClass` (Tabelle `classes`, bestehend und erweitert) und
`ClassStudent`. Das Schuljahr steht in `system_config` unter `school_year`.
Abgleich beim Import: `src/classes/student-import.ts`, Namenszuordnung:
`src/classes/name-match.ts`, Schülerausweis: `src/classes/student-ticket.ts`. ODF-Lesen im Browser:
`src/renderer/js/odf/`. Beim Löschen oder Zusammenführen eines Kontos wandern
die Klassen mit (`HandoverService`).
