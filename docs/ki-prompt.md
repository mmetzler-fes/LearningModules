# KI-Prompt-Generator

Im Hauptmenü unter **🤖 KI-Prompt** (auch über den Knopf in 🏠 LernModule) entsteht ein Prompt, mit dem eine KI
(ChatGPT, Claude, Le Chat …) ein Lernthema als JSON-Datei erstellt. Die
Antwort der KI als `.json` speichern und über **📥 Thema importieren**
einlesen.

## Angaben

| Feld | Wirkung |
|---|---|
| Thema | Titel des Lernthemas |
| Beschreibung * | Was abgefragt werden soll, Schwerpunkte |
| Klassenstufe / Niveau, Sprache, Anzahl Module | steuern Schwierigkeit und Umfang |
| Aufgabentypen | Multiple Choice, Wahr/Falsch, Fill in the Blanks, Drag the Words, Mark the Words, Drag and Drop – alle automatisch bewertbar, also auch für Lernbegleitung und Quiz-Arena |
| Materialien | Dateinamen der Unterlagen, die du im KI-Chat anhängst; die KI soll nur deren Inhalte verwenden |
| Geteilter Ordner | z. B. ein Nextcloud-Link, als Quelle im Prompt; optional dürfen Bilder daraus per Download-Link eingebunden werden |

Jede Eingabe merkt sich der Browser sofort – ein Wechsel der Ansicht oder
ein Neuladen verliert nichts.

**Materialien am besten direkt im KI-Chat hochladen.** Einen geteilten
Nextcloud-Ordner kann eine KI meist nicht öffnen – die Seite braucht
JavaScript und zeigt keine lesbare Dateiliste. Ohne Bild-Links bleiben
`imageUrl` und `backgroundImage` leer; Bilder ergänzt man im Editor.

## Was im Prompt steht

- Auftrag und Rahmen aus den Angaben.
- Der Aufbau der Importdatei (`topic` mit `modules`).
- Je gewähltem Typ: die Felder aus `h5p-types.js` (ändert sich ein Editor,
  ändert sich der Prompt mit), die Regeln, an denen KIs gern scheitern, und
  ein Beispiel im echten Format:
  - Lückentext: `*Antwort*`, Alternativen mit `/`
  - Drag the Words: `*Wort*`, Alternativen mit `|`, Ablenker in `distractors`
  - Wahr/Falsch: `correctAnswer` als Text `"true"`/`"false"`
  - Drag and Drop: je Zone genau ein richtiges Element, Positionen in Prozent
- Ausgabe: nur ein JSON-Codeblock, gültiges JSON, Aufgaben vorher prüfen.
- Mehr als 5 Module: Die KI antwortet in Teilen zu höchstens 5 Modulen, jeder
  Teil eine vollständige Datei; mit „weiter“ kommt der nächste. Lange Antworten
  brechen KIs sonst mitten im JSON ab (Gemini etwa nach sechs Modulen). Teil 1
  über **📥 Thema importieren**, die weiteren im Thema über
  **📥 Module importieren**. Eine abgeschnittene Datei meldet der Import als
  „unvollständig“.
- Die KI-Antwort darf samt Markdown-Rahmen (```` ```json … ``` ````) und Text
  davor oder danach gespeichert werden – der Import nimmt nur das JSON darin.

Code: `src/renderer/js/ai-prompt.js`, Seite in `views/ai-prompt-view.js`.
