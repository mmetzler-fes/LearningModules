# 💬 Feedback und 📷 Bildschirmfoto

## Bildschirmfoto im Stift-Editor

Mit dem Werkzeug **Bereich** (Rechteck mit Strichlinie) ein Rechteck aufziehen. Das Rechteck bleibt stehen, darüber erscheint eine Leiste:

- **📷** – Bild des Bereichs (Dokument, Quizze, Beschriftung). Es liegt gleich in der Zwischenablage; im Fenster danach:
  📋 Kopieren, 📤 Teilen (iPad), ⬇ Speichern, 💬 Als Feedback senden.
- Ist im Bereich etwas gewählt (Striche, Formen, Textfelder; bei Lehrkräften auch Bausteine): zusätzlich
  **✂ Ausschneiden, ⧉ Kopieren, 🗑 Löschen** und **⋯** für alles Weitere.

## Feedback melden

**💬** steht in der Tab-Leiste oben, in der Seitenleiste der App (Lehrkräfte) und im Stift-Editor. Beschreiben, was passiert ist –
ein Bild hängt an: das letzte 📷-Foto, ein Bild aus der Zwischenablage (Knopf oder ⌘V/Strg+V) oder eine Datei.
Mitgeschickt werden Ansicht, offener Tab, Gerät und Bildschirmgröße (ohne Zugangsschlüssel).
Von der Person speichert die Meldung nur Klasse, Vorname und den ersten Buchstaben des Nachnamens, z. B. „TG12 · Anna B. (Schüler)“.

## Für den Admin

**Administration → 💬 Feedback:** alle Meldungen mit Bild und Gerät. Wichtigkeit setzen (🔴 hoch, 🟠 mittel, 🟢 niedrig),
als erledigt markieren oder löschen. Offene stehen oben, nach Wichtigkeit geordnet.

## Mit einer KI auswerten

Das KI-Token eines Admins (🤖 KI-Schnittstelle) liest die Meldungen auch: `GET /api/ai-bridge/feedback`, das Bild mit
`GET /api/ai-bridge/feedback/:id/image`. Mit `PATCH /api/ai-bridge/feedback/:id` und `{ priority, status, adminNote }` ordnet die KI
sie ein oder markiert sie als erledigt. Löschen geht nur in der App. Tokens von Lehrkräften sehen kein Feedback.
