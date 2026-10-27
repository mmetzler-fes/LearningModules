# Lehrerfortbildung LearningModules – Leitfaden für die Schulungsleitung

Die Fortbildung ist selbst ein **Book in LearningModules**: 14 Lernthemen in
fünf Abschnitten, je ein Dokument mit der Anleitung (darin ein eingebettetes
Quiz) und dahinter weitere Quiz-Module – zusammen alle wichtigen Quiz-Arten.
Die Teilnehmenden erleben die App so zuerst als Schüler und bauen dann
dasselbe selbst nach.

| Abschnitt | Lernthemen |
|---|---|
| 1 · Start | Willkommen · Registrieren · App installieren (PC, iPad) |
| 2 · Klasse und Schüler | Testklasse frei und strikt · Schüler freischalten und PIN |
| 3 · Inhalte | Notizbuch · Lernmodul „Dokument“ (mit Stift) · Quiz-Module (je ein Beispiel) |
| 4 · Im Unterricht | Klassennotizbuch · Klassenbuch-Link · Quiz, Lernbegleiter, Quiz-Arena · Ergebnisse |
| 5 · Weiter geht’s | Import, KI-Prompt, Shop · Checkliste und Feedback |

Gegenüber der ersten Gliederung ergänzt: **Testschüler** (eigene Links
durchspielen), **Erstanmeldung und PIN**, **Mit Stift bearbeiten**,
**Ergebnisse** (Übersicht, Live), **Material schneller** (Import, KI, Shop,
Xournal++) und eine **Checkliste** zum Abschluss.

## Datei bauen und einlesen

```bash
node schulung/fortbildung/build.mjs   # → schulung/fortbildung/LearningModules-Fortbildung.zip
```

Texte und Fragen stehen in `build.mjs` (Liste `KAPITEL`) – ändern, neu bauen,
neu einlesen. In der App: **📓 Notizbuch → 📥 Importieren** → die ZIP wählen.
Es entsteht das Book „LearningModules – Fortbildung“. Wie alles Importierte
sind die Lernthemen zunächst **gesperrt (○)** – mit ● freigeben (Mehrfachauswahl
☑ → „● Freigeben“ geht für alle auf einmal).

## Vorbereitung

1. **Konten:** Selbstregistrierung braucht Mailversand und die Schuladressen in
   der Whitelist (siehe `docs/benutzerverwaltung.md`). Ohne Mailversand legt der
   Admin die Konten an – auch mit selbst gewähltem Initialpasswort.
2. **Funktionen freischalten** für die Teilnehmenden: „Arbeitsblätter“
   (Dokumente), „PDF-Import“, ggf. „Stift-Editor“ (Administration → Benutzer).
3. **Dein Konto:** ZIP einlesen, alles freigeben, einen 🧪 Testschüler anlegen.
4. **Einheitliche Testklasse** – jede Teilnehmerin, jeder Teilnehmer legt sie
   selbst an (Lernthema 2.1): **„Fortbildung“** mit **Anna Apfel, Ben Birne,
   Cem Kirsche**. „Dora Dattel“ steht absichtlich nicht in der Liste – sie
   meldet sich bei offener Klasse an und wird dann bestätigt (2.2).
5. Für das Schüler-Erlebnis: ein **zweites Gerät** (Handy) oder ein **privates
   Fenster** im Browser – sonst überschreibt die Schüler-Anmeldung die eigene.

## Ablauf (ca. 3 Stunden)

| Zeit | Inhalt | Lernthemen |
|---|---|---|
| 0:00 | Begrüßung, Vision (Präsentation `../LearningModules-Schulung.pdf`) | 1.1 |
| 0:15 | Registrieren, App installieren | 1.2, 1.3 |
| 0:35 | Testklasse anlegen, offen ↔ strikt, Dora bestätigen | 2.1, 2.2 |
| 1:00 | **Die Fortbildung als Schüler:** Klassenbuch-Link der Schulungsleitung öffnen, 1.1–3.3 durcharbeiten | 3.1–3.3 |
| 1:30 | Pause | |
| 1:45 | Selbst bauen: Lernthema mit Dokument und zwei Quizzen, freigeben | 3.1–3.3 |
| 2:15 | Klassennotizbuch zuweisen, Klassenbuch-Link, als Anna anmelden | 4.1, 4.2 |
| 2:35 | **Gemeinsame Quiz-Arena** (Leitung am Beamer, 3.3 als Aufgaben) | 4.3 |
| 2:50 | Ergebnisse, Ausblick, Checkliste, Feedback | 4.4, 5.1, 5.2 |

**Tipp:** Weise das Book deiner eigenen Klasse „Fortbildung“ zu und gib den
Teilnehmenden deren **Klassenbuch-Link** (QR am Beamer): Dann siehst du ihren
Fortschritt live in 📡 Live und 📊 Ergebnisübersicht – genau das, was sie
danach selbst nutzen. Ihre Namen fügst du dafür vorab in die Liste ein (oder
lässt die Klasse offen und bestätigst sie). Sind die Teilnehmenden in der App
angemeldet, genügt auf der Eingabeseite **👤 Als ‹Name› teilnehmen** – kein
Namen-Tippen, keine Tippfehler.

## Als Werbung teilen – mit Test-Zugang

- **Ohne Konto (Schüler-Sicht):** Im Notizbuch am Book **⋯ → 🔗 Quick-Link**
  (ein Link für den ganzen Bereich). Wer ihn öffnet, gibt einen Namen ein und
  arbeitet die Fortbildung wie ein Schüler durch – Quizze, Lernbegleiter,
  Ergebnis. Ideal für Rundmail oder Homepage (QR-Code).
- **Mit Testlehrer-Konto (Lehrer-Sicht):** Der Admin legt ein Konto an,
  z. B. `testlehrer@<schule>` mit selbst gewähltem Initialpasswort, und schaltet
  die Funktionen frei. Darin die ZIP einlesen und freigeben. Zugangsdaten
  weitergeben.
  - Ein geteiltes Konto kann jeder verändern: Neue Inhalte, Klassen und
    Schülerdaten aller Gäste landen am selben Ort. Ab und zu aufräumen bzw.
    das Book neu einlesen; keine echten Schülernamen dort verwenden.
  - „Angemeldet bleiben“ und das Passwort ändern kann jeder Gast – lieber
    nach einer Werbeaktion Passwort neu setzen und **📱 Geräte → Überall
    abmelden**.
- **Für Kolleginnen und Kollegen mit eigenem Konto:** das Book im **🛒 Shop**
  anbieten (Kopie erlaubt) – dann hat jede und jeder eine eigene Fassung zum
  Ausprobieren und Anpassen.
