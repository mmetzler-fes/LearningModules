# Für OneNote ausgeben

Der umgekehrte Weg zu [OneNote übernehmen](onenote-import.md): Lernthemen
werden OneNote-Abschnitte, damit Kolleginnen und Kollegen, die mit OneNote
arbeiten, sie in ihr eigenes Notizbuch ziehen können. Die Schüler arbeiten in
OneNote auf dem Ausdruck und kommen über Link oder QR-Code zur aktuellen
Fassung in LearningModules.

## Wo

- **Lernnotizbuch:** ⋯ bzw. Rechtsklick auf ein Book, einen Bereich oder
  Abschnitt → **🟪 Für OneNote ausgeben…**, ebenso an einem Lernthema. Die
  Links sind die **anonymen Quick-Links** der Lernthemen (fehlt einer, wird er
  angelegt): Schüler öffnen ohne Namen, gespeichert wird nichts.
- **Klassennotizbuch:** Knopf **🟪 Für OneNote** über dem Baum. Die Links
  führen ins Klassennotizbuch der Klasse – Anmeldung mit Name und PIN, die
  Ergebnisse landen in der Klasse. **Klassenarbeiten** und für Schüler
  Ausgeblendetes bleiben weg.

## Was daraus wird

| LearningModules | OneNote |
|---|---|
| Book, Bereich | Ordner im ZIP (in OneNote: Abschnittsgruppe) |
| Abschnitt | Abschnitt (`.one`-Datei) |
| Lernthemen direkt in einem Book/Bereich | ein Abschnitt mit dessen Namen |
| Dokument | eine Seite **„Lernthema – Dokument“** (heißen beide gleich: nur einmal) |
| Quizze, die in keinem Dokument stecken | eine gemeinsame Seite **„Lernthema – Quiz“**: ein Link mit QR-Code für alle (mit „Weiter“ von Quiz zu Quiz, `&mod=id1,id2,…`), bei mehreren dazu jedes einzeln verlinkt |

Eine **Dokument-Seite** enthält oben den Link zum Dokument in LearningModules,
den QR-Code, die Adresse als Text (zum Kopieren) und „Stand …“, darunter – wenn
angehakt – den **Ausdruck als Seitenbilder** untereinander. Darauf lässt sich in OneNote mit dem Stift schreiben. Der
Ausdruck veraltet, wenn das Dokument geändert wird; aktuell bleibt der Link.

**Quiz-Links im Ausdruck:** Wie im GoodNotes-Heft steht bei jedem Quiz der
QR-Code, und direkt daneben liegt ein klickbarer Link „▶ Quiz online öffnen“.
Dafür liest die Ausgabe die PDF-Verweise des Ausdrucks
(`src/renderer/js/onenote-links.js`). Die gedruckte Adresse wird im Seitenbild
weiß überdeckt, und an ihrer Stelle liegt ein eigener OneNote-Textblock mit dem
Link (Quick-Link bzw. Klassennotizbuch). Findet sich kein Verweis (kein
Ausdruck, älterer Renderer), stehen die Quizze oben auf der Seite als Liste.

Gesperrte (🔒) und ausgeschaltete Module kommen nicht mit. Eine einzelne
Datei wird direkt als `.one` geladen und heißt dann wie das Ausgegebene
(Bereich, Abschnitt oder Lernthema), mehrere kommen als ZIP. Beides ist ein
normaler Browser-Download (Download-Ordner, meist „Downloads“); auf dem
Server wird nichts abgelegt. Der Dialog nennt am Ende den Dateinamen.

## In OneNote übernehmen

1. ZIP entpacken (falls es eins ist).
2. In **OneNote für Windows** (2016 bzw. Microsoft 365 – nicht die App
   „OneNote für Windows 10“) die `.one`-Datei per Doppelklick öffnen. Sie
   erscheint unter „Geöffnete Abschnitte“.
3. Den Abschnitt **mit der Maus** ins eigene Notizbuch ziehen. „Verschieben/
   Kopieren“ im Menü ist ohne Zugang zum Schulnetz ausgegraut.
4. Den geöffneten Abschnitt schließen (Rechtsklick → „Diesen Abschnitt
   schließen“) und die Datei löschen. Einzeln geöffnete Abschnitte lassen sich
   nur schließen, nicht löschen.

## Welche Links?

- **Aus dem Lernnotizbuch** sind alle Links anonym (Quick-Link): Übersicht,
  Dokumente, Quizze und die QR-Codes im Ausdruck. Gut für Vorführungen und
  Kolleginnen und Kollegen – ohne Schülerkonten.
- **Aus dem Klassennotizbuch** führen alle Links ins Klassennotizbuch (Name und
  PIN), auch die QR-Codes der Quizze im Ausdruck: Der Renderer bekommt dafür
  `quizLink` (`<base>/?k=<token>&cl=<link>&mod=`, nur Adressen dieses Servers).
- Dasselbe gilt für das GoodNotes-Heft: Lädt ein Schüler es im Klassennotizbuch
  (Klassenlink), führen die Quiz-Adressen ins Klassennotizbuch; aus dem
  Lernnotizbuch bzw. über den Quick-Link bleiben sie anonym.

## Direktlinks

- Quick-Link bzw. Freigabelink: `?l=<token>&mod=<modul>` öffnet nur dieses Modul.
- Klassennotizbuch: `?k=<token>&cl=<zuweisung>&mod=<modul>` öffnet das Modul
  nach der Anmeldung (wie ein über 📡 geschicktes Modul).

## Technik

- Schreiber: `src/renderer/js/onenote-write.js` (MS-ONESTORE/MS-ONE, ohne
  Abhängigkeiten), Tests in `src/core/onenote-write.spec.ts` (gegengelesen mit
  dem Leser aus `onenote.js`). Ausgabe: `src/renderer/js/views/onenote-export.js`.
- Der Aufbau ist Dateien nachgebildet, die OneNote selbst schreibt, und in
  OneNote geprüft: Öffnen, Tippen (auch hinter Links und im Titel), Stift auf
  den Seitenbildern, in ein Notizbuch ziehen. Was dafür stimmen muss:
  - Jedes Objekt trägt die echte Zahl seiner Verweise (Startobjekte 1) und
    wird verwendet – sonst bricht OneNote beim Bearbeiten ab (0xE0000007).
  - Zeichenformate (TextRunFormatting) sind eigene kleine Objekte, nicht die
    benannten Absatzvorlagen.
  - Ein Link steht nie am Absatzende; danach folgt Text mit „Link aus“.
  - Der Textblock ist ein gewöhnlicher Inhaltsblock (der Datumsblock läuft
    waagerecht); Seitenbilder liegen frei auf der Seite, untereinander.
  - Links über einem Seitenbild sind eigene Textblöcke (Outline) mit fester
    Position, auf der Seite nach den Bildern eingetragen (liegen oben).
    Unterseiten gingen mit Seitenebene 2 (`level`), werden derzeit nicht genutzt.
- Die MD5-Werte der schreibgeschützten Objekte rechnet OneNote nicht nach
  erkennbarem Muster; wir nehmen MD5 der Daten – OneNote nimmt das an.
- QR-Codes: `POST /api/links/qr` (`{ urls }` → `{ svgs }`, nur Adressen
  dieses Servers). Seitenbilder: PDF über `/api/worksheets/render`, mit pdf.js
  als JPEG (144 dpi).
