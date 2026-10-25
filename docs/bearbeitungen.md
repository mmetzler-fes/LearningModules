# Bearbeitungen und PIN

Schreiben Schüler über einen **Klassenlink** mit dem Stift in ein Dokument
(✍️ Mit Stift bearbeiten), speichert die App ihre Bearbeitung **bei der
Lehrkraft** – nicht nur auf dem Gerät. So geht es später weiter, auch an
einem anderen Gerät, und die Lehrkraft sieht, was geschrieben wurde.
Gespeichert wird nur, was der Schüler hinzufügt: Striche, Textfelder, Felder
und die Höhe der Karos – nicht das Dokument selbst.

Dazu gehören auch die **Eingaben in eingebetteten Quizzen**, die ein Schüler
im Stift-Fenster macht (Textfelder, Kästchen, Auswahllisten; Gezogenes bei
Drag and Drop nicht). Sie wandern beim Schließen des Stift-Fensters in den
Durchlauf zurück und zählen bei „Weiter“ wie dort eingetragen.

**Wie gespeichert wird:** nur die Eingaben des Schülers – und einmal je
Fassung das Blatt, wie er es vor sich hatte (mit seinen Quizzen). Die Ansicht
setzt beides zusammen. Ändert die Lehrkraft das Dokument später, zeigt sie
trotzdem das Blatt, auf dem der Schüler geschrieben hat.

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

Über den Link der Klassenarbeit gibt es **keine PIN**. Bei **„nur ein
Durchlauf“** kommt jeder Schüler genau einmal hinein – auch wenn er den
Browser aus Versehen schließt, das Gerät wechselt oder abgestürzt ist.

**Wiedereinstieg:** 🏫 Klassen → Klasse → **📝 Klassenarbeiten** zeigt je
Schüler, ob die Klassenarbeit läuft (mit Zahl der beantworteten Aufgaben)
oder abgegeben ist. **🔓 Wiedereinstieg** erlaubt genau einen weiteren Start:
Der Schüler öffnet den Link der Klassenarbeit, gibt seinen Namen ein und
macht bei der nächsten offenen Aufgabe weiter – mit allen bisherigen
Antworten und mit seinem Blatt aus dem Stift-Editor. Die alte Seite (etwa auf
dem ersten Gerät) kann danach nichts mehr speichern oder abgeben.

- Möglich auch **nach der Abgabe** (Nachschreiben, technische Panne) – die
  neue Abgabe **ersetzt** dann die bisherige; sie enthält deren Antworten.
- Die Freigabe lässt sich zurücknehmen, solange der Schüler nicht neu
  gestartet hat.
- Den Zwischenstand speichert die App nach jeder Aufgabe (Klassenarbeiten
  blättern nicht zurück). Haben sich die Aufgaben inzwischen geändert,
  beginnt die Klassenarbeit von vorn.
- Ohne „nur ein Durchlauf“ setzt jeder neue Start einfach fort – ohne
  Freigabe.
- Gilt für Klassenlinks; ohne Klasse kennt die App den Schüler nicht und
  kann nichts zuordnen. Der Testschüler ist ausgenommen.

## Ansehen (Lehrkraft)

**📈 Klassenergebnisse → ✍️ Bearbeitungen:** Klasse wählen, dann gruppiert
**nach Schüler** oder **nach Link** – die neuesten Eingaben zuerst.
**👁 Ansehen** öffnet das ganze Blatt mit Stift-, Text- und Quiz-Eingaben des
Schülers; geändert wird dabei nichts.

🏫 Klassen → Klasse → **✍️ Bearbeitungen** zeigt dasselbe je Dokument, mit
🗑 zum Löschen – der Schüler beginnt dann von vorn.

## Live

**📈 Klassenergebnisse → 📡 Live:** alle Schüler der Klasse und je Aufgabe des
gewählten Links ✓ erledigt oder ▶ gerade dran, dazu „fertig“ und wann sich
zuletzt etwas getan hat. ✍️ hinter dem Namen: schreibt gerade (in den letzten
10 Minuten) mit dem Stift. Wer noch nicht gestartet hat, steht grau da. Die
Ansicht frischt sich alle 5 Sekunden auf, solange sie offen ist; gezeigt
werden Durchläufe der letzten 12 Stunden, über Klassenlinks. Antworten oder
Punkte zeigt sie nicht – die stehen wie gewohnt in den Ergebnissen.

Bearbeitungen sind persönlich: Sie gehen mit, wenn ein unbestätigter Eintrag
einem Schüler zugeordnet wird (⇄), und werden gelöscht mit dem Schüler, der
Klasse und durch die Löschregel des Schuljahrs.

## Technik

- Tabelle `document_works`: je Link, Schüler und Modul ein Stand
  (`data` = Stand des Stift-Editors mit `forms` = Quiz-Eingaben, höchstens
  5 MB), `versionId` → `document_versions` (Prüfsumme über Titel, Inhalt und
  eingebettete Quizze; einmal je Fassung).
- Live: Tabelle `run_progress` je Link und Schüler (Aufgabentitel, erledigt,
  fertig); `POST /api/public/run/progress` aus dem Durchlauf,
  `GET /api/live/class/:id` für die Lehrkraft. PIN in
  `class_students.pin`, angezeigt am `pinShownAt`.
- Schüler: `POST /api/public/work/load` und `/save` mit `linkToken`,
  `studentTicket`, `moduleId`, `pin` – 403 mit `needPin`, wenn die PIN fehlt
  oder falsch ist; die erste Speicherung liefert `pin`.
- Lehrkraft: `GET /api/work?classId=…`, `GET/DELETE /api/work/:id`,
  `POST /api/classes/:id/students/:studentId/pin`.
- Klassenarbeit: Tabelle `exam_attempts` je Link und Schüler – `session`
  (Ablauf des Schülerausweises der laufenden Anmeldung), `submittedAt`,
  `reentryAllowed`, `progress` ({ steps, index, answers, embeddedAnswers }).
  Start (`POST /api/public/link/:token/start`) legt an bzw. setzt fort
  (`examResume`), `POST /api/public/exam/progress` nach jeder Aufgabe,
  die Abgabe (`/api/public/results`) prüft die Anmeldung. Lehrkraft:
  `GET /api/exams?classId=…`, `POST /api/exams/:id/reentry` `{ allow }`.

Code: `src/work/` (Bearbeitungen, Klassenarbeiten, PIN, Tests), `src/renderer/js/ink/work-store.js`
(Speicher und PIN-Dialoge), `src/renderer/js/ink/ink-open.js`
(openStudentWork), `src/renderer/js/views/classes.js`.
