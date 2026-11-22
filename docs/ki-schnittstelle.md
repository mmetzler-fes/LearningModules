# KI-Schnittstelle (KI-Assistent)

Die eigene KI der Lehrkraft (Claude, ChatGPT, Claude Code …) bekommt ein zeitlich begrenztes
Token und eine Anleitung. Sie sieht nur die freigegebenen Books und Pläne, nie Schülerdaten;
alles lässt sich im Dialog mit ⏪ rückgängig machen (`src/ai-bridge/`).

## Dauerhafter Zugang: einschalten, annehmen, ablehnen

Mit dem Haken **🔑 Dauerhafter Zugang** beim Erzeugen bleibt das Token gültig – es kommt einmal in
die KI (bzw. ihre Einstellungen). Benutzen kann die KI es nur, solange du den Zugang im
KI-Assistenten **▶ einschaltest** (30 Minuten bis 4 Stunden); danach schaltet er sich selbst aus,
**⏹ Ausschalten** geht sofort. Ein neues Token (Haken erneut setzen) ersetzt das alte.

Jeder Aufruf der KI wird **vorläufig übernommen** und steht unter **🤖 Offene KI-Änderungen**:

- **✅ Annehmen** – bleibt, wie es ist.
- **⏪ Ablehnen** – die Änderungen dieses Aufrufs werden zurückgenommen. Neuere offene Aufrufe
  derselben Sitzung zuerst (sie können darauf aufbauen). Hast du seitdem etwas davon selbst
  geändert, fragt die App nach, denn das ginge dabei verloren.
- Was **Schüler gerade sehen** (Lernthema freigegeben oder einer Klasse zugewiesen, Modul aktiv),
  ändert die KI nicht direkt: Es wird ein **📝 Entwurf**. Schüler sehen bis zum Annehmen den
  bisherigen Stand; die KI liest ihren Entwurf (`"pending": true`) und arbeitet daran weiter.
  Hast du selbst einen offenen Entwurf zu dem Modul, lehnt der Server die Änderung ab.
- Das Notizbuch erinnert mit einem Hinweis an offene Änderungen.

Der zeitlich begrenzte Zugang (ohne Haken) funktioniert wie bisher; auch seine Aufrufe lassen sich
einzeln annehmen oder ablehnen.

## KI verbinden (MCP mit OAuth) – der Hauptweg

Einmal einrichten, dann nur noch im KI-Chat arbeiten (📥 → 🤖 KI-Assistent → **🔌 KI verbinden**):

1. Adresse kopieren: `https://<server>/api/mcp`.
2. In der KI eintragen – **Claude.ai**: Einstellungen → Connectors → Benutzerdefinierten Connector
   hinzufügen; **ChatGPT**: Einstellungen → Apps & Connectors → Erstellen (Entwicklermodus),
   Authentifizierung OAuth; **Claude Code**: `claude mcp add --transport http learningmodules https://<server>/api/mcp`,
   dann `/mcp` → anmelden.
3. Es öffnet sich LearningModules: anmelden und **✅ Zulassen**. Wer mit Microsoft angemeldet ist,
   öffnet LearningModules vorher in einem anderen Tab (mit „Angemeldet bleiben“) und lädt die Seite neu.

Danach im KI-Assistenten: **Zugang ein/aus** (gilt für alle verbundenen KIs), **🔌 Verbundene KIs**
mit *Trennen*, **⚙️ Was die KI darf** (Books, Pläne, Rechte – gespeichert für alle verbundenen KIs),
**🤖 Offene KI-Änderungen** zum Annehmen oder Ablehnen, **💬 Beispiele** für den Chat. Kein Passwort
und kein Token gehen an die KI: Sie bekommt einen Schlüssel für eine Stunde und erneuert ihn selbst,
solange die Verbindung besteht.

Technik: `src/ai-bridge/mcp.ts` (Werkzeuge `get_overview`, `get_tree`, `get_topic`, `get_document`,
`get_docspec_reference`, `get_quiz_reference`, `run_operations`), `src/ai-bridge/oauth.*`
(Server-Beschreibung `/.well-known/oauth-protected-resource` und `/.well-known/oauth-authorization-server`,
Registrierung `/oauth/register`, Freigabe `/oauth/authorize`, Schlüssel `/oauth/token` mit PKCE).
Die Freigabeseite nimmt nur registrierte KIs mit ihrer hinterlegten Rücksprung-Adresse an und nennt
das Ziel. Ein dauerhaftes Token in der Adresse (`/api/mcp/lma_…`) geht weiterhin, wird aber nicht mehr angeboten.

Ohne Connector (oder für „Mit KI neu aufbereiten“ ohne verbundene KI) gibt es unten im Dialog weiter
**📋 Anleitung kopieren** mit einem zeitlich begrenzten Token.

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

Bewertete Typen: Multiple Choice, Wahr/Falsch, Lückentext, Wörter ziehen, Wörter markieren, Drag & Drop
(`AI_QUIZ_TYPES` in `quiz-format.ts`). Format und Prüfung kommen aus demselben Code wie der
KI-Prompt im Browser (`ai-prompt.js`, `json-text.js`, `h5p-types.js`).

- `create_quiz` (`topicId`, `type`, `title`, `content`, `ref`) – mit `"ref": "$q1"` lässt sich das
  Quiz im selben Aufruf ins Blatt setzen: `{ "type": "quiz", "module": "$q1" }`.
- `update_quiz` (`moduleId`, `content`, `title`) – der Typ bleibt.
- Ein unvollständiges Quiz lehnt der Server mit Grund und Verweis aufs Format ab.

**🤖 Mit KI überarbeiten…** am Quiz im Lernnotizbuch: eine Anleitung mit dem jetzigen Stand und
dem Format nur dieses Typs; die KI darf nur dieses Quiz ändern.

## Ordner einstellen

`set_doc_settings` (`id`, `kurs`, `titelmuster`, `numbering`: flat | tree | off | inherit) setzt Kurs,
Kopfzeile und 🔢 Nummerierung eines Ordners; die übrigen Dokument-Einstellungen bleiben, ⏪ stellt
den alten Stand wieder her.

`update_document` mit `kind` (arbeitsblatt | klassenarbeit | text) und ohne `spec` stellt nur die
Dokument-Art um – nummeriert werden nur Arbeitsblätter. Im Baum (`GET tree`) steht die Art je Dokument als `docKind`.

## Dokumente verschieben

`move_modules` (`moduleIds`, `topicId`) verschiebt Dokumente und Quizze in ein anderes Lernthema –
wie „↔️ Verschieben“ in der Oberfläche, Reihenfolge der Auswahl bleibt, ans Ende des Ziels.
Ein Lernthema enthält höchstens ein Dokument: Ein Ziel, das schon eines hat, lehnt der Server ab;
`create_document` in ein solches Lernthema legt das Dokument in ein eigenes Lernthema direkt dahinter
(`topicId` im Ergebnis).
Zusammen mit `create_topic` (`"ref": "$t1"`, `"topicId": "$t1"`) wird aus einer Sammlung je Blatt
ein eigenes Lernthema. ⏪ schiebt zurück und stellt die alte Reihenfolge wieder her.

## Lernthemen umbenennen

`rename_topic` (`topicId`, `title`, optional `description`) benennt ein Lernthema um – wie „Umbenennen“
im Notizbuch: Hat das Lernthema genau ein Dokument, das bisher gleich hieß, heißt das Dokument mit.
Wichen die Titel schon ab, bleibt das Dokument, wie es ist (Dokumente benennt `update_document` mit `title` um).
⏪ stellt Titel, Beschreibung und Dokumenttitel wieder her.
