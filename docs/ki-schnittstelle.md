# KI-Schnittstelle (KI-Assistent)

Die eigene KI der Lehrkraft (Claude, ChatGPT, Claude Code …) bekommt ein zeitlich begrenztes
Token und eine Anleitung. Sie sieht nur die freigegebenen Books und Pläne, nie Schülerdaten;
alles lässt sich im Dialog mit ⏪ rückgängig machen (`src/ai-bridge/`).

## Grundanleitung und Nachschlagen

Die kopierte Anleitung bleibt kurz: Zugang, erlaubte Operationen (je eine Zeile), Kurzform des
Blatt-Formats, Gliederung des freigegebenen Bereichs. Formate holt eine KI mit Webzugriff erst,
wenn sie sie braucht:

| Adresse | Inhalt |
|---|---|
| `GET /api/ai-bridge/instructions` | Operationen mit Beispielen, Adressen der Formate, Baum |
| `GET /api/ai-bridge/reference/docspec` | vollständiges Blatt-Format (DocSpec) |
| `GET /api/ai-bridge/reference/quiz?types=multipleChoice,trueFalse` | Quiz-Format, nur der genannten Typen (Markdown) |

Eine KI ohne Webzugriff (normaler Chat) antwortet mit einem JSON-Block `{"operations": [...]}`,
den die Lehrkraft im Dialog einfügt. Soll sie Quizze anlegen, setzt der Dialog auf Wunsch die
Quiz-Formate gleich in die Anleitung (Haken „🧠 Quiz-Formate gleich in die Anleitung“).

## Quizze

Bewertete Typen: Multiple Choice, Wahr/Falsch, Lückentext, Wörter ziehen, Drag & Drop
(`AI_QUIZ_TYPES` in `quiz-format.ts`). Format und Prüfung kommen aus demselben Code wie der
KI-Prompt im Browser (`ai-prompt.js`, `json-text.js`, `h5p-types.js`).

- `create_quiz` (`topicId`, `type`, `title`, `content`, `ref`) – mit `"ref": "$q1"` lässt sich das
  Quiz im selben Aufruf ins Blatt setzen: `{ "type": "quiz", "module": "$q1" }`.
- `update_quiz` (`moduleId`, `content`, `title`) – der Typ bleibt.
- Ein unvollständiges Quiz lehnt der Server mit Grund und Verweis aufs Format ab.

**🤖 Mit KI überarbeiten…** am Quiz im Lernnotizbuch: eine Anleitung mit dem jetzigen Stand und
dem Format nur dieses Typs; die KI darf nur dieses Quiz ändern.
