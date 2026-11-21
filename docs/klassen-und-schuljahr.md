# Klassen und Schuljahr

Ergebnisse sollen nach Schuljahr und Klasse ausgewertet werden können: je
Klasse alle Schüler (Name, Vorname) mit ihren Ergebnissen, je Test alle
Schüler der Klasse – auch die, die noch fehlen –, und über das Jahr ein
Überblick über das Engagement.

**📒 Klassenbuch-Link:** Unter 🏫 Klassen steht an jeder Klasse der Link zum [Klassennotizbuch](klassennotizbuch.md) mit dem
Klassencode, dazu **📋 Text für Schüler** zum Weitergeben. Gibt es noch kein Klassennotizbuch, entsteht ein leeres. In der
Schülerliste stehen zusätzlich der QR-Code und die Erstanmeldung, die PINs stehen in der Tabelle.

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
  deshalb (vorerst) je eine eigene Liste – die sich aber per
  [Klasse teilen](#klasse-teilen) weitergeben lässt.
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

**Arbeit sparen:** Vorerst dürfen Schülerlisten unter Kolleginnen und
Kollegen geteilt werden, damit nicht jede Lehrkraft dieselbe Klasse neu
anlegen muss. Mit **👥 Teilen** in der Schülerliste bekommen sie eine eigene
Kopie von Klasse und Schülerliste (siehe [Klasse teilen](#klasse-teilen)).
Eine Kopie entsteht nur bei Kolleginnen und Kollegen der eigenen Schule,
die das Angebot annehmen.

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

### PIN zum Weiterbearbeiten

Jeder Schüler hat eine PIN aus 4 Ziffern (Spalte **PIN** der Schülerliste,
🔑 würfelt eine neue). Mit ihr arbeiten Schüler über Klassenlinks an ihren
Blättern weiter; angezeigt wird sie ihnen einmal, beim ersten Speichern.
Siehe [Bearbeitungen und PIN](bearbeitungen.md).

### Testschüler

Um einen Klassenlink selbst durchzuspielen, braucht es keinen Eintrag in der
Schülerliste: **🏫 Klassen → 🧪 Testschüler** – Name (z. B. „Test Kai“) und
ein eigenes Testpasswort (mindestens 4 Zeichen) einmal festlegen.

- Er gilt für **alle eigenen Klassenlinks**, auch bei 🔒 strikter Anmeldung,
  und an jedem Gerät, auch am Schüler-PC.
- Auf der Startseite den Namen eingeben (Groß/klein egal) → die Seite fragt
  nach dem **🧪 Testpasswort** → los. Ein Passwort des Links gilt zusätzlich.
- Das Ergebnis heißt „🧪 Test Kai“ und steht unter **📊 Ergebnisse** und im Klassennotizbuch als eigene Zeile. In Durchschnitten,
  Schülerzahlen und unter „Geteilt & genutzt“ zählt es nicht mit.
- Das Testpasswort wird nur als Hash gespeichert; ändern geht jederzeit
  (Feld leer lassen behält das bisherige), **Entfernen** schaltet den
  Testschüler ab.

### 👁 Vorschau (Klasse aus Schülersicht)

In der Inhaltsübersicht des Klassennotizbuchs öffnet **👁 Vorschau** die eigene Klasse aus Schülersicht in einem neuen Tab,
ohne Name, PIN und Testpasswort. Die Anmeldung als Lehrkraft bleibt erhalten: In einem Tab arbeitest du als Schüler, im anderen siehst du
die Auswertung. Die Vorschau ist der Testschüler; ohne eigenen Namen heißt er „🧪 Vorschau“.

- **Sie sieht, was die Klasse sieht,** also auch nur, was eingeschaltet ist. Dazu eigene Ergebnisse und Blätter sowie der Stand von HTML-Apps.
- **Bei dir erscheint sie** in 📡 Live, 📊 Ergebnisübersicht und 👥 Schülerdaten als eigene 🧪-Zeile.
- **Sie zählt nicht mit:** nicht in Durchschnitten und Schülerzahlen, nicht unter 📈 Geteilt & genutzt. Schüler sehen sie nie.
- **🧹 Vorschau zurücksetzen** löscht ihre Daten dieser Klasse, etwa um noch einmal von vorn zu testen; den Stand von HTML-Apps in allen Klassen.
- **Nicht abgedeckt:** Anmeldung und PIN werden übersprungen. Für die Erstanmeldung braucht es einen echten Eintrag in der Schülerliste.
  In der Klassenarbeit ist sie immer wiederholbar und steht nicht in der Abgabeliste.
- **An anderen Geräten** (iPad, QR-Code) ohne Lehrer-Anmeldung meldet sich der Testschüler weiter mit Name und Testpasswort an.

### Als Lehrkraft teilnehmen

Ist im Browser eine Lehrkraft angemeldet (etwa in einer Fortbildung), steht auf der Eingabeseite eines Klassenlinks oder
Klassenbuch-Links schon ihr Name, wenn sie damit in die Klasse kommt. Abschicken bleibt ihr Schritt, allein durch das Öffnen
entsteht kein Eintrag. Danach gilt alles wie bei jedem Schüler.

| Lage | Auf der Eingabeseite |
|---|---|
| **Offene Klasse** | Name steht drin, die Lehrkraft der Klasse bestätigt den unbestätigten Eintrag |
| **Name steht in der Liste** | Name steht drin, auch in einer strikten Klasse; dazu die PIN wie bei jedem Schüler |
| **Strikte Klasse, nicht in der Liste** | kein Name, Hinweis: Die Lehrkraft der Klasse kann dich eintragen |
| **Eigene Klasse** | kein Name, Hinweis auf 👁 Vorschau; sonst stünde man selbst in der Schülerliste |

Das klappt auch in einem neuen Tab (die Seite fragt die offenen Tabs der App), aber nur im selben Browser auf demselben Gerät,
nicht über den QR-Code am Handy. **Wichtig:** Außerhalb der Vorschau löscht der Start einer Aufgabe die gespeicherte Lehrer-Anmeldung in diesem Browser.
Wer danach weiter als Lehrkraft arbeiten will, meldet sich neu an oder nimmt für die Aufgabe ein privates Fenster oder ein anderes
Gerät; dort steht der Name nicht schon im Feld.

## Lehrkräfte als Teilnehmer (Fortbildung)

Eine Klasse kann auch registrierte Lehrkräfte als Teilnehmer haben – sonst
bleibt alles wie bei Schülern (Ergebnisse, Blätter, Klassenarbeiten).

- **👩‍🏫 Lehrkraft eintragen** in der Klasse: per E-Mail-Adresse, mit der sie
  sich anmeldet. Name und Vorname kommen aus ihrem Konto; der Eintrag ist mit
  dem Konto verknüpft (`class_students.userId`) und trägt 👩‍🏫.
- Öffnet die angemeldete Lehrkraft den Klassenbuch-Link, steht dort
  **„👩‍🏫 Als ‹Name› hinein – ohne PIN“** (`POST /api/classbook/join/:token`,
  das Konto ist der Nachweis).
- **Selbsteintrag** in einer offenen Klasse: derselbe Knopf legt einen
  unbestätigten, verknüpften Eintrag an; die Lehrkraft der Klasse bestätigt (✓)
  oder ordnet ihn einem vorhandenen Namen zu (⇄) – das Konto geht dabei mit.
- Ohne Anmeldung (fremdes Gerät) geht es weiter mit Name und PIN.

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

**🔄 Klasse aktualisieren → Aus Datei einlesen** nimmt

- die **Klassenliste des SchülerLernTools** (`.ods`, mit dem App-Passwort
  verschlüsselt): Klassenseite → `⋯` → Klassenliste exportieren;
- jede andere Tabelle – **LibreOffice (`.ods`), Excel (`.xlsx`)** oder
  **CSV** – mit einer Kopfzeile, die die Spalten `Name` (oder `Nachname`) und
  `Vorname` enthält.

**📄 Vorlage** (in der Klasse und neben *Klassen einlesen*) lädt eine
passende Tabelle als LibreOffice-, Excel- oder CSV-Datei:

| Klasse | TG12 | |
|---|---|---|
| | | |
| **Name** | **Vorname** | **Schüler-ID** |
| Mustermann | Max | |
| Musterfrau | Erika | |

- Die Kopfzeile darf in den ersten 15 Zeilen stehen, darüber z. B. ein Titel.
  Groß-/Kleinschreibung und Spaltenreihenfolge sind egal, weitere Spalten
  werden ignoriert.
- `Schüler-ID` ist freiwillig; damit erkennt ein späteres Einlesen dieselben
  Schüler auch nach einer Namensänderung.
- Die Zeile `Klasse | …` braucht nur *Klassen einlesen*; mehrere Klassen in
  einer Datei = ein Blatt je Klasse (nur `.ods`/`.xlsx`).
- CSV: Trennzeichen Semikolon, Komma oder Tabulator; Zeichensatz UTF-8 (in
  Excel „CSV UTF-8“ wählen, sonst werden Umlaute zu Zeichensalat).
- Mit Passwort geschützte Excel-Dateien gehen nicht – bitte ohne Passwort
  speichern. Verschlüsselte `.ods` (z. B. aus dem SchülerLernTool) gehen.

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

## Klassen der Schule

Der **Schuladmin** pflegt unter *Schuladmin → 🎓 Klassen der Schule* alle Klassen
der Schule mit einer einzigen Tabelle (LibreOffice, Excel oder CSV, **📄 Vorlage**):

| Nachname | Vorname | Klasse | UserID |
|---|---|---|---|
| Mustermann | Max | TG12 | max.mustermann |

`Name` statt `Nachname` geht auch, ebenso `Benutzername` oder `E-Mail` statt
`UserID` (gespeichert wird der Teil vor dem @). Das Schuljahr ist das gewählte;
ein Vorsatz wie `SJ26-27-TG12` in der Spalte Klasse legt es je Zeile fest.

Beim Einlesen, je Klasse der Datei:

| Fall | Ergebnis |
|---|---|
| Klasse mit gleichem Namen gibt es schon | wird aktualisiert |
| anderer Name, aber mindestens die Hälfte dieselben Schüler – der Klasse in der Datei oder der vorhandenen Klasse | **übersprungen** – am Ende steht, mit welcher Klasse sie sich deckt. Mit ✏️ Umbenennen den Namen an die Tabelle angleichen und noch einmal einlesen |
| sonst | neue Klasse |

Schüler werden über die UserID zugeordnet, sonst über den gleichen Namen
(auch mit vertauschtem Vor- und Nachnamen), sonst über einen Namen, der sich
um **höchstens 3 Zeichen** unterscheidet (ein Buchstabendreher wie „Adrain“
zählt als eins, „Müller“/„Mueller“ als zwei) – dann wird der Name aus der
Datei übernommen. Neue Schüler kommen dazu; wer in der Datei fehlt, bleibt –
einzeln entfernen geht mit 🗑. Das gilt genauso, wenn eine Lehrkraft ihre
Klasse über den Schuladmin aktualisiert: ergänzen und Namen angleichen ja,
löschen macht sie selbst.

**⏭ Versetzen** (zum Schuljahresende): Je Klasse *versetzen* (mit neuem
Namen, Vorschlag TG11 → TG12), *löschen* oder *lassen*. Versetzt wird eine
Kopie ins nächste Schuljahr mit Schülern, Autoregistrierung und Freigaben.
Die Klassen der Schule fallen nicht unter die Löschregel – gelöscht wird nur
hier. Die Lehrkräfte machen ihren eigenen Schuljahreswechsel selbst; danach
schlägt *Über den Schuladmin aktualisieren* ihnen die versetzte Klasse vor (⭐),
wer die alte Klasse hatte, bekommt sie ohne neue Freigabe.

**Übernehmen durch Lehrkräfte.** Unter *Klassen → ➕ Neue Klasse → Aus den
Klassen der Schule übernehmen* wählt eine Lehrkraft eine Klasse (sie sieht
nur Name und Schülerzahl):

- **⚡ Autoregistrierung** (je Klasse oder für alle im Schuljahr): Die Klasse
  steht sofort mit Schülerliste bei ihr.
- sonst wartet die Anfrage. Der Schuladmin sieht beim Anmelden einen Hinweis,
  am Menüpunkt die Zahl und oben auf der Seite, wer welche Klasse will:
  **✓ Freigeben** oder **Ablehnen**.

Eine gleichnamige eigene Klasse wird dabei ergänzt, sonst neu angelegt. In
der Klasse aktualisiert **🔄 Klasse aktualisieren → Über den Schuladmin** die
Schülerliste später wieder aus den Klassen der Schule (mit Vorschau); bei
einer noch nicht verbundenen Klasse wählt man zuerst die Klasse der Schule.
*Aus Datei einlesen* geht wie bisher. PINs, Ergebnisse und Klassenlinks
bleiben, die Liste der Lehrkraft bleibt ihre eigene Kopie.

## Klassenergebnisse

Die Ergebnisse über Klassenlinks stehen im
**[📒 Klassennotizbuch](klassennotizbuch.md)** der Klasse (früher eigener
Menüpunkt „Klassenergebnisse“); alles ohne Klasse steht weiter unter
**📊 Ergebnisse**.

| Wo | Inhalt |
|---|---|
| 👥 Schülerdaten → 📈 Ergebnisse | je Schüler (Name, Vorname) Durchläufe, Ø, zuletzt – aufgeklappt alle Durchläufe; darunter „nicht zugeordnet“ |
| 👥 Schülerdaten → ✍️ Blätter | Blätter mit Stift- und Texteingaben, nach Schüler oder Link |
| 📊 Ergebnisübersicht → 🧩 Je Modul | je Zuweisung Schüler × Module: bestes Ergebnis, erledigt, Blatt |
| 📊 Ergebnisübersicht → 📝 Je Aufgabe | je Klassenlink die ganze Klasse: Durchläufe, bestes Ergebnis, zuletzt – und wer **fehlt noch** |
| 📊 Ergebnisübersicht → 📅 Jahresüberblick | je Schüler Durchläufe, verschiedene Tests, aktive Wochen, Ø, zuletzt – das Engagement übers Jahr |
| 📡 Live | wer gerade bei welcher Aufgabe ist – siehe [Bearbeitungen und PIN](bearbeitungen.md#live) |

## Schuljahreswechsel

Nach dem Wechsel durch den Admin erscheint unter **🏫 Klassen** ein Hinweis
(nach dem Login einmal auch als Meldung). **Klassen übernehmen …** zeigt je
Klasse des Vorjahres:

- **Übernehmen** mit neuem Namen – vorgeschlagen ist die erste Zahl um eins
  erhöht (TG11 → TG12, E1ME1 → E2ME1). Die bestätigten Schüler werden
  kopiert, „strikt“ bleibt; die alte Klasse bleibt mit ihren Ergebnissen.
- **Links mitnehmen** hängt die Klassenlinks an die neue Klasse – ausgeteilte
  QR-Codes gelten weiter, neue Ergebnisse landen im neuen Jahr.
- Das **[Klassennotizbuch](klassennotizbuch.md#schuljahreswechsel)** geht
  mit: Bereiche, Abschnitte, klasseneigene Lernthemen und Zuweisungen –
  alles ausgeschaltet, bis du es im neuen Jahr einschaltest.
- Nicht angehakt: **nicht mehr benötigt** – ihre Klassenlinks werden
  deaktiviert.
- [Quick-Links](quick-link.md) folgen immer, auch ohne „Links mitnehmen“:
  Die übernommene Klasse ersetzt die alte in ihrer Klassenauswahl, eine nicht
  mehr benötigte fällt heraus.

*Später* lässt alles offen; der Hinweis bleibt, bis über jede Klasse
entschieden ist.

## Klasse teilen

In der Schülerliste **👥 Teilen**: Kolleginnen und Kollegen der eigenen
Schule auswählen. Sie sehen unter **🏫 Klassen** ein Angebot; **Annehmen**
legt bei ihnen eine eigene Klasse mit Name und Schülerliste an (Stand beim
Annehmen, bestätigte Schüler). Danach sind beide unabhängig; Ergebnisse
sieht jede Lehrkraft nur von ihren eigenen Links. In der Schülerliste steht,
mit wem geteilt wurde und ob angenommen.

## Löschregel

Aufbewahrt werden das **aktuelle und die zwei vorigen Schuljahre** (im
SJ26-27 also SJ24-25 bis SJ26-27). **30 Tage nach dem Schuljahreswechsel**
löscht der Server ältere Klassen samt Schülerlisten, Klassenlinks, offenen
Teilen-Angeboten, Ergebnissen und Bearbeitungen. Ohne Wechsel durch den Admin zählt der
1. August.

Vorher sehen die Lehrkräfte unter **🏫 Klassen** und **📊 Ergebnisse**
einen Hinweis mit Datum und **⬇️ Diese Jahre exportieren**.

**Export und Import:** Unter **📊 Ergebnisse** exportiert *⬇️ Exportieren*
alle eigenen Ergebnisse vollständig (ohne IP-Adressen) als JSON-Datei,
*📥 Importieren* liest eine solche Datei wieder ein – etwa auf einem anderen
Server. Eingelesene Ergebnisse gehören der Lehrkraft, die einliest; schon
vorhandene werden übersprungen. Ergebnisse aus abgelaufenen Schuljahren
entfernt die Löschregel beim nächsten Lauf wieder (der Import sagt das).

## Umsetzung

1. ✅ Schuljahr, Klassen mit Schülerliste, Import
2. ✅ Klassenlinks, siehe [Schülerfreigaben](themen-links.md#versenden-immer-für-eine-klasse)
3. ✅ Anmeldung über die Schülerliste, strikter Modus, Schülerausweis,
   Zuordnen unbestätigter Einträge, Klassen einlesen aus dem SchülerLernTool
4. ✅ Klassenergebnisse
5. ✅ Assistent zum Schuljahreswechsel
6. ✅ Klasse teilen, Löschregel mit Export/Import

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
| `GET/POST /api/classes/rollover` | Schuljahreswechsel: offene Klassen / `{ items: [{ classId, take, name, moveLinks }] }` |
| `POST /api/classes/:id/share`, `GET /api/classes/:id/shares` | Klasse anbieten (`{ userIds }`), Stand der Angebote |
| `GET /api/classes/shares/incoming`, `POST …/shares/:id/accept\|decline` | Angebote an mich |
| `GET /api/classes/retention` | Löschregel: abgelaufene eigene Jahre, Löschtermin |
| `GET /api/results/class/:classId` | Klassenergebnisse |
| `GET /api/results/export?years=…`, `POST /api/results/import` | Ergebnisse exportieren, einlesen |

Entitäten: `StudentClass` (Tabelle `classes`, bestehend und erweitert) und
`ClassStudent`. Das Schuljahr steht in `system_config` unter `school_year`.
Löschregel: `src/classes/retention.ts` (Lauf beim Start und alle 6 Stunden),
Abgleich beim Import: `src/classes/student-import.ts`, Namenszuordnung:
`src/classes/name-match.ts`, Schülerausweis: `src/classes/student-ticket.ts`. ODF-Lesen im Browser:
`src/renderer/js/odf/`. Beim Löschen oder Zusammenführen eines Kontos wandern
die Klassen mit (`HandoverService`).
