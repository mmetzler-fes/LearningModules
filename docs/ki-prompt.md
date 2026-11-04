# KI-Lernmodul erstellen

Der Menüpunkt **🤖 KI-Prompt** legt ein Lernthema unter **Unsortiert** an. Am Book, Bereich oder Abschnitt
entsteht es über **⋯ → 🤖 KI-Lernmodul hinzufügen** an dieser Stelle, am Lernthema kommen die Module hinein.

1. **Gemeinsame Angaben** einmal eintragen: Thema, Beschreibung, Klassenstufe, Sprache, auf Wunsch Material.
2. **Auswählen,** was entstehen soll: 📄 Dokument, 🧠 Quiz. Jeder Inhalt ist ein eigener Schritt.
3. **🤖 Prompt erzeugen und kopieren.** Der Prompt liegt in der Zwischenablage; sehen musst du ihn nicht
   (eingeklappt unter „Prompt ansehen“). In den KI-Chat einfügen.
4. **Antwort einfügen,** am besten über den Kopier-Knopf am Codeblock. Das Feld prüft sie sofort.
5. **✅ Übernehmen.** Die erste Antwort legt das Lernthema an, alle weiteren kommen hinein. Weitere Teile:
   im Chat „weiter“ schreiben und die nächste Antwort ins selbe Feld einfügen.

Ein übernommenes Dokument ist automatisch Material für den Quiz-Prompt danach, das Quiz passt so zum Blatt.
Dokument und Quiz haben getrennte Prompts: Zusammen in einer Antwort halten KIs das Format oft nicht ein.
**🔄 Neu beginnen** startet das nächste Lernthema.

## Angaben

| Feld | Wirkung |
|---|---|
| Thema | Titel des Lernthemas |
| Beschreibung * | Was vermittelt oder abgefragt werden soll, gilt für alle Schritte |
| Klassenstufe / Niveau, Sprache | steuern Schwierigkeit und Sprache |
| 📓 Material aus dem Notizbuch | Book, Bereich, Abschnitt oder Lernthema wählen und die Dokumente darunter ankreuzen, ihr Text steht dann im Prompt (siehe unten) |
| 📄 Dokument | Art, Seiten, Anzahl Blätter, Vorbilder; Kurs und KI-Vorgaben des Zielordners fließen ein |
| 🧠 Quiz | Anzahl Module und Aufgabentypen: Multiple Choice, Wahr/Falsch, Fill in the Blanks, Drag the Words, Mark the Words, Drag and Drop, Formelaufgabe, Reihenfolge, Kreuzworträtsel, dazu Memory als Übungsspiel ohne Bewertung |
| 📎 Anhänge | Dateinamen der Unterlagen, die du im KI-Chat anhängst; geteilter Ordner; Bilder aus der Nextcloud |

Der Browser merkt sich deine Eingaben. **Anhänge gelten nur für einen Prompt:** Material aus dem Notizbuch,
Vorbilder, Dateinamen, geteilter Ordner und Nextcloud-Bilder sind nach dem Erzeugen und beim erneuten Öffnen
der Seite wieder leer. Unter dem fertigen Prompt steht, welches Material darin steckt.

**Materialien am besten direkt im KI-Chat hochladen.** Einen geteilten
Nextcloud-Ordner kann eine KI meist nicht öffnen – die Seite braucht
JavaScript und zeigt keine lesbare Dateiliste. Ohne Bild-Links bleiben
`imageUrl`, `backgroundImage` und bei Memory `aImage`/`bImage` leer; Bilder
ergänzt man im Editor.

## Eigene Dokumente als Material

Statt Dateien im KI-Chat anzuhängen (oft begrenzt), nimmt der Prompt den
**Text eigener Dokumente** gleich mit, für Quizze zum Stoff der Blätter wie für neue,
besser gegliederte Blätter (die Wünsche dazu in die Beschreibung).

Am schnellsten aus dem Notizbuch: am Book, Bereich, Abschnitt oder Lernthema
**⋯ → 🤖 KI-Lernmodul aus den Dokumenten**. Die Seite öffnet mit dieser Quelle; einzelne Dokumente lassen sich
abwählen (höchstens 80). Im Prompt steht je Dokument Pfad, Titel und Text:
Überschriften und Aufgaben, Tabellen, Listen, Formeln (StarMath), Lösungen
zwischen `[Lösung]` und `[Ende Lösung]`. Karo, Abstände und eingebettete
Bilder fallen weg (Bilder bleiben als `[Abbildung: Bildunterschrift]`).

Der Umfang steht unter dem Prompt – über etwa 30k
Tokens besser weniger Dokumente auf einmal nehmen.

## Was im Prompt steht

- Auftrag und Rahmen aus den Angaben.
- Der Aufbau der Importdatei (`topic` mit `modules`).
- Je gewähltem Typ: die Felder aus `h5p-types.js` (ändert sich ein Editor,
  ändert sich der Prompt mit), die Regeln, an denen KIs gern scheitern, und
  ein Beispiel im echten Format:
  - Lückentext: `*Antwort*`, Alternativen mit `/`
  - Drag the Words: `*Wort*`, Alternativen mit `|`, Ablenker in `distractors`
  - Wahr/Falsch: `correctAnswer` als Text `"true"`/`"false"`
  - Drag and Drop: nur ohne Hintergrundbild und ohne Positionen – als Paare
    (`"layout": "pairs"`, je Zone genau ein Element) oder als Gruppen (mehrere
    Elemente je Zone). Zonen auf einem Bild kann eine KI nicht sinnvoll setzen;
    sie ergänzt die Lehrkraft bei Bedarf selbst im Editor
  - Reihenfolge: Elemente in der **richtigen** Reihenfolge angeben (die App
    mischt selbst), 3–8 Elemente mit eindeutiger Folge
  - Kreuzworträtsel: 6–12 Wörter mit gemeinsamen Buchstaben, Hinweise ohne
    das Lösungswort, `seed` 0 (die App ordnet das Gitter an)
  - Memory: höchstens eins je Thema, 6–10 kurze Paare, jede Karte passt zu
    genau einem Paar
- Ausgabe: nur ein JSON-Codeblock, gültiges JSON, Aufgaben vorher prüfen.
- Mehr als 5 Module: Die KI antwortet in Teilen zu höchstens 5 Modulen, jeder
  Teil eine vollständige Datei; mit „weiter“ kommt der nächste. Lange Antworten
  brechen KIs sonst mitten im JSON ab (Gemini etwa nach sechs Modulen). Jeden Teil
  ins Antwortfeld einfügen und übernehmen. Eine abgeschnittene Antwort meldet die
  Prüfung als „unvollständig“. Eine Antwort als Datei geht weiter über **📥 Importieren**.
- Die KI-Antwort darf samt Markdown-Rahmen (```` ```json … ``` ````) und Text
  davor oder danach gespeichert werden – der Import nimmt nur das JSON darin.
- Bei verbundener Nextcloud kann der Prompt die Bilder eines Ordners anbieten:
  Die KI wählt nur aus der Liste (`nc:<Ordner>/<Datei>`), der Import macht
  daraus Links (siehe [Nextcloud](nextcloud.md#bilder-im-ki-prompt)). Fehlen
  Bilder, erzeugt **🎨 Prompt für Bilder** einen Prompt für eine Bild-KI mit
  festen Dateinamen je Wort; die heruntergeladenen Bilder lädt die App danach
  in den Ordner.
- Der Prompt nennt das Ausgabeformat am Anfang und am Ende: Die ganze Antwort ist genau ein Codeblock.
  Material steht zuletzt, damit langer Text die Formatvorgabe nicht verdrängt.
- **Wenn die Antwort nicht passt:** Der Import-Dialog repariert Kleinigkeiten selbst und nennt sie
  (Komma am Ende, Kommentare, typografische Anführungszeichen als Begrenzer, Zeilenumbrüche und
  Anführungszeichen in Texten, LaTeX mit einfachem Backslash). Mehrere Codeblöcke einer Antwort werden
  zusammengeführt. Er prüft auch den Inhalt je Typ, zum Beispiel ob eine richtige Antwort markiert ist.
  Bei Fließtext, abgeschnittenen Antworten oder Hinweisen kopiert **🔁 Korrektur-Prompt kopieren** einen
  Text für denselben Chat, der genau das Problem nennt.
- Kleine Abweichungen gleicht der Import an: Reihenfolge-Elemente als bloße
  Texte, Memory-Paare als `["Hund", "dog"]`, Kreuzworträtsel mit `word`/`hint`
  statt `answer`/`clue`.

Code: `src/renderer/js/ai-prompt.js` (auch `docSpecToText`), Seite in `views/ai-prompt-view.js` und `views/doc-prompt-view.js`, Antwortfeld in `views/ai-answer.js`, Prüfung in `views/import-check.js`, Auswahl des Materials in `views/prompt-material.js`.
