# Bearbeitungen und PIN

Schreiben Schüler über einen **Klassenlink** mit dem Stift in ein Dokument
(✍️ Mit Stift bearbeiten), speichert die App ihre Bearbeitung **bei der
Lehrkraft** – nicht nur auf dem Gerät. So geht es später weiter, auch an
einem anderen Gerät, und die Lehrkraft sieht, was geschrieben wurde.
Gespeichert wird nur, was der Schüler hinzufügt: Striche, Textfelder, Felder
und die Höhe der Karos – nicht das Dokument selbst.

Ohne Klasse (gewöhnlicher Themenlink, Quick-Link ohne Klasse) bleibt die
Beschriftung wie bisher auf dem Gerät.

## Die PIN

Jeder Schüler der Klassenliste hat eine **PIN aus 4 Ziffern** – eine für alle
Links, nicht je Blatt.

- **Lehrkraft:** Die PIN steht in der Klassenliste (🏫 Klassen → Klasse, Spalte
  PIN). „neu“ heißt: dem Schüler noch nicht angezeigt. 🔑 würfelt eine neue
  (vergessen, weitergesagt); die Bearbeitungen bleiben.
- **Schüler:** Beim **ersten Speichern überhaupt** zeigt die App die PIN – nur
  dieses eine Mal („Schreib sie dir auf“). Danach fragt **jeder Link** nach
  ihr, bevor ein Blatt aufgeht. Innerhalb einer geöffneten Seite fragt sie
  nur einmal.
- Nach **5 falschen PINs** ist 10 Minuten Pause – Raten lohnt sich nicht.
- Vergessen? Die Lehrkraft liest sie in der Klassenliste vor oder würfelt eine
  neue; die neue wird beim nächsten Speichern wieder angezeigt.

Gut zu wissen: Wer zuerst unter einem Namen speichert, bekommt die PIN zu
sehen. Gibt sich jemand vorher als Mitschüler aus, hilft 🔑 – dann gilt die
alte PIN nicht mehr.

## Klassenarbeit

Über den Link der Klassenarbeit gibt es **keine PIN** und **kein späteres
Weiterarbeiten**: Die Bearbeitung gehört zu der Anmeldung, mit der die
Klassenarbeit begonnen wurde. Wird der Link später neu geöffnet, lässt sich
das Blatt weder öffnen noch ändern.

## Ansehen (Lehrkraft)

🏫 Klassen → Klasse → **✍️ Bearbeitungen**: je Dokument und Link die Schüler
mit Zeitpunkt. **Ansehen** öffnet das Blatt mit der Beschriftung des
Schülers; geändert wird dabei nichts. 🗑 löscht eine Bearbeitung – der
Schüler beginnt dann von vorn.

Bearbeitungen sind persönlich: Sie gehen mit, wenn ein unbestätigter Eintrag
einem Schüler zugeordnet wird (⇄), und werden gelöscht mit dem Schüler, der
Klasse und durch die Löschregel des Schuljahrs.

## Technik

- Tabelle `document_works`: je Link, Schüler und Modul ein Stand
  (`data` = Stand des Stift-Editors, höchstens 5 MB). PIN in
  `class_students.pin`, angezeigt am `pinShownAt`.
- Schüler: `POST /api/public/work/load` und `/save` mit `linkToken`,
  `studentTicket`, `moduleId`, `pin` – 403 mit `needPin`, wenn die PIN fehlt
  oder falsch ist; die erste Speicherung liefert `pin`.
- Lehrkraft: `GET /api/work?classId=…`, `GET/DELETE /api/work/:id`,
  `POST /api/classes/:id/students/:studentId/pin`.
- Klassenarbeit: `examSession` = Ablauf des Schülerausweises beim ersten
  Speichern; nur derselbe Ausweis lädt und speichert.

Code: `src/work/` (Dienst, PIN, Tests), `src/renderer/js/ink/work-store.js`
(Speicher und PIN-Dialoge), `src/renderer/js/ink/ink-open.js`
(openStudentWork), `src/renderer/js/views/classes.js`.
