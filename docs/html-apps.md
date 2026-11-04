# HTML-Apps einbinden

Eine HTML-App ist eine einzelne HTML-Datei, die alles mitbringt, zum Beispiel eine selbst gebaute
Lernapp. Im Lernthema läuft sie wie ein Quiz: **LearningModules führt** mit Weiter, Prüfen, Lösung,
Punkten und Lernbegleiter, die App zeigt jeweils einen Schritt und meldet die Antwort.

> **Stand:** Pilot, hinter der Freischaltung „HTML-Apps“. Ohne `HTML_APP_ORIGIN` ist sie nicht
> verfügbar (siehe „Einrichten“). In Chrome geprüft; Safari auf dem iPad steht noch aus.
> Im Shop nur auf demselben Server.

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
2. Titel eintragen und die `.html`-Datei auswählen. Der Server prüft die Datei, danach öffnet ein
   Prüflauf jeden Schritt einmal. Fehler stehen unter dem Feld, so lässt sich die App nicht speichern.
3. Speichern. Die Abschnitte erscheinen als Untermodule unter der App im Baum.
4. Das Lernthema oder einzelne Abschnitte wie gewohnt einer Klasse zuweisen.

Ein Update geht genauso: Modul bearbeiten, neue Datei wählen, speichern.

Zum Ausprobieren: [`html-app-beispiel.html`](html-app-beispiel.html) (klein) und
[`beispiel_excel.html`](beispiel_excel.html) (echte App, 123 Schritte).

## Was die App tun muss

1. **Steckbrief** in den `<head>`: Welche Abschnitte und Schritte gibt es?
2. **`LM.start`** aufrufen und darin genau den Schritt `init.step` aufbauen.
3. **`LM.answer`** bei jeder Änderung einer Aufgabe aufrufen, und gleich beim Start.
4. **Keine eigene Navigation:** Weiter und Zurück kommen von LearningModules. Jeder Schritt lädt die
   App neu; was bleiben soll, gehört in `LM.saveState`.

Die Bridge fügt der Server selbst ein. In die Datei kopieren muss sie nur, wer die App auch allein
öffnen will (Vorlage: [`lm-bridge.js`](../src/renderer/lm-bridge.js), unverändert). Allein geöffnet zeigt
sie unten eine Leiste zum Blättern durch die Schritte.

Das ist eine vollständige App (hier ohne kopierte Bridge):

```html
<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Ohmsches Gesetz</title>
<script type="application/lm-app+json">
{ "lmApp": 2, "id": "ohm-trainer", "version": "2.0", "title": "Ohmsches Gesetz",
  "units": [
    { "id": "theorie", "title": "Theorie", "steps": [{ "id": "grundlagen", "title": "U = R · I", "kind": "info" }] },
    { "id": "rechnen", "title": "Rechnen", "steps": [{ "id": "a1", "title": "Strom berechnen", "kind": "task" }] } ] }
</script>
</head><body>
<main id="schritt"></main>
<script>
  let stand = {};
  LM.start((init) => {
    if (init.state) stand = init.state;
    const el = document.getElementById('schritt');
    if (init.step.kind === 'info') { el.textContent = 'U = R · I'; return; }
    el.innerHTML = '<p>U = 230 V, R = 46 Ω. I in Ampere?</p><input id="e">';
    const feld = document.getElementById('e');
    feld.value = stand.a1 || '';
    const melde = () => LM.answer({ isCorrect: feld.value.trim() === '5', userAnswer: feld.value, correctAnswer: '5' });
    feld.addEventListener('input', () => { stand.a1 = feld.value; LM.saveState(stand); melde(); });
    melde();
  });
</script>
</body></html>
```

## Der Steckbrief

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `lmApp` | ja | Fassung der Schnittstelle, jetzt `2` |
| `id` | ja | feste Kennung der App: `a-z`, `0-9`, `-`, höchstens 40 Zeichen |
| `version` | ja | Fassung der App, frei wählbar |
| `title` | ja | Name der App |
| `units` | ja | Abschnitte, höchstens 30. Jeder wird ein Untermodul, je Klasse wählbar, mit einer Spalte in der Übersicht |
| `units[].id` | ja | feste Kennung, **darf sich nie ändern**: Sie ordnet Ergebnisse beim Update wieder zu |
| `units[].title` | ja | Name in Baum und Übersicht |
| `units[].steps` | ja | Schritte in Anzeigereihenfolge, zusammen höchstens 500 |
| `steps[].id` | ja | feste Kennung, in der ganzen App einmalig |
| `steps[].title` | ja | Name im Durchlauf und in den Ergebnissen |
| `steps[].kind` | ja | `task` wird bewertet, `info` zählt mit dem Ansehen |

Ein Schritt ist eine prüfbare Aufgabe. Ein neuer Abschnitt wird neu angelegt; ein entfernter wird im
Lernthema ausgeblendet, seine Ergebnisse bleiben.

## Die Aufrufe

| Aufruf | Zweck |
|---|---|
| `LM.start(fn)` | **Pflicht.** Ruft `fn(init)` auf |
| `LM.answer({ isCorrect, points?, userAnswer?, correctAnswer? })` | **Pflicht bei Aufgaben.** Der Gesamtstand; `points` von 0 bis 1 für Teilpunkte |
| `LM.saveState(data)` | Stand speichern: JSON, höchstens 256 KB, für alle Schritte derselbe |
| `LM.download(name, blob)` | Datei anbieten: `.xlsx`, `.csv`, `.pdf`, `.png`, `.jpg`, `.txt`, höchstens 10 MB |
| `LM.onLock(fn)` | `fn(true)`: Eingabe sperren (gelöst, Denkpause), `fn(false)`: wieder frei |
| `LM.onReveal(fn)` | Lösung zeigen (Lernmodus, Joker) |
| `LM.onCheck(fn)` | Der Schüler hat „Prüfen“ gedrückt; hier kann die App ihre Rückmeldung zeigen |
| `LM.onFlush(fn)` | Offene Eingabe abschließen und melden, etwa eine Zelle im Bearbeiten |
| `LM.onError(fn)` | abgelehnte Meldung: `fn({ code, message })` |
| `LM.hosted` | `true`, wenn die App in LearningModules läuft |

`init` enthält:

| Feld | Bedeutung |
|---|---|
| `step` | `{ unit, id, title, kind }`: Diesen Schritt aufbauen |
| `state` | zuletzt gespeicherter Stand oder `null` |
| `run` | `quiz`, `learn` oder `companion`. Im Lernbegleiter zählt jeder Versuch: eigene Prüfknöpfe und Lösungen ausblenden |
| `mode` | `practice` mit Schülerausweis, `anonymous` ohne, `preview` in der Vorschau, `standalone` allein geöffnet |
| `displayName` | immer `null`: Die App kennt keine Schülerdaten |

## Zwei Wege der Nutzung

| Weg | `init.mode` | Stand der App | Ergebnisse |
|---|---|---|---|
| Klassenlink oder Klassennotizbuch (mit Schülerausweis) | `practice` | auf dem Server, je Schüler | ja, mit Liveview |
| Quick-Link (anonym) | `anonymous` | nur auf dem Gerät | wie jedes Quiz über den Quick-Link |
| Vorschau der Lehrkraft | `preview` | nichts | nein |

Der anonyme Weg ist abschaltbar: Häkchen „Auch ohne Anmeldung nutzbar“ am Modul (Vorgabe: an).

## Was geprüft wird

Beim Hochladen und vor jeder Auslieferung; im Zweifel wird abgelehnt, die Meldung nennt die Stelle.

| Bereich | Regel |
|---|---|
| Steckbrief | genau einer, gültig, Fassung 2 |
| HTML | kein `iframe`, `frame`, `object`, `embed`, `link`, `base`, `meta http-equiv`, `<script src>`, `type="module"` |
| Ereignisse | kein `on…=` im HTML oder in HTML-Texten, dafür `addEventListener` oder `.onclick = fn` |
| Adressen | nur `#sprungmarke` und `data:`, kein `javascript:`, nichts nach außen |
| Skript | kein `eval`, `Function`, `import()`, `fetch`, `XMLHttpRequest`, `WebSocket`, `RTC…`, `Worker`, `location`, `document.write`, `window.open`, `Reflect`, `with` |
| Globales Objekt | `window`, `self`, `globalThis` nur als `window.name`, nie als Wert oder mit berechnetem Namen |
| Prüflauf | jeder Schritt startet und zeigt etwas; eine Aufgabe meldet sich und gilt unberührt nicht als richtig |

Die Datei liegt mit ihrem SHA-256 auf dem Server. Stimmt der Hash nicht mehr, wird sie nicht ausgeliefert.

## HTML-Apps im Shop

Lehrkräfte können eine App, die die Prüfung besteht, ohne Freigabe im Shop anbieten. Ein Admin kontrolliert
nachträglich: Unter Administration → 🧩 HTML-Apps stehen alle hochgeladenen Apps, mit Hash, Besitzer und den
Modulen, die sie nutzen.

- **Code ansehen** zeigt den Quelltext zum Lesen; er läuft dort nicht.
- **Der Haken „Im Shop gesperrt“** nimmt genau diese Fassung aus allen Angeboten, auch aus erworbenen
  Nutzungsrechten. Der Dialog „Im Shop anbieten“ nennt der Lehrkraft die gesperrte App.
- **Gilt je Hash:** Dieselbe Datei bleibt gesperrt, auch wenn sie jemand anderes hochlädt. Eine geänderte Fassung ist
  eine neue Datei und nicht gesperrt.
- **Wer die Sperre umgeht:** In der Benutzerverwaltung das Häkchen „HTML-Apps“ am Konto abnehmen; das geht auch, wenn
  die Funktion für alle an ist, und das Konto bleibt sonst unberührt. Es kann dann keine Apps mehr hochladen, seine Klassen
  sehen sie nicht mehr, und alles, was es hochgeladen hat, verschwindet aus dem Shop. Das Häkchen bringt es zurück,
  außer den einzeln gesperrten Fassungen. Dasselbe gilt für ein deaktiviertes Konto.
- **Nur der Shop:** Schon übernommene Kopien und die Nutzung in eigenen Klassen laufen weiter.
- **Zum Durchsehen:** Passt der Inhalt, stimmt die Bewertung, und will die App wirklich nur das Angezeigte? Die
  Prüfung deckt das nicht ab, siehe „Bekannte Lücke“. Auffällig sind verschleierter Code und Eingaben, die zur Aufgabe nicht passen.

Wer eine Kopie nutzt, braucht selbst die Freischaltung „HTML-Apps“, sonst läuft sie nicht.

## Regeln für die Auswertung

- **Immer der Gesamtstand, nie der Zuwachs.** `LM.answer` ersetzt die vorige Meldung.
- **Feste IDs.** Nicht der Listenplatz, sonst rutschen Ergebnisse beim Einfügen einer Aufgabe.
- **Musterlösung zählt nicht.** Eine Aufgabe, deren Lösung die App eingetragen hat, gilt nicht als gelöst.
- **Das Ergebnis entsteht im Browser**, wie bei jedem Quiz. Die Lösungen stehen im Quelltext; über den
  Link der Klassenarbeit läuft eine HTML-App deshalb nicht. Was Schüler nicht sehen dürfen, gehört nicht in die Datei.

## Sicherheit

| Schicht | Wirkung |
|---|---|
| Eigene Adresse, Sandkasten | kein Zugriff auf Anmeldung, Schülerdaten und Netz |
| Hash-CSP statt `unsafe-inline` | Es läuft nur das geprüfte Skript; Eingeschleustes blockiert der Browser |
| Schutzskript als erstes Skript | entfernt `RTC…` und Worker, sperrt Rahmen, Links nach außen und Formulare |
| Trusted Types | leitet jedes HTML aus Text durch das Schutzskript; ältere Browser über einen Ersatz im Schutzskript |
| Prüfung beim Hochladen | fängt, was im HTML der Datei steht und damit am Schutzskript vorbeikäme, etwa `<iframe srcdoc>` |
| Kein `allow-downloads` | Dateien nur über `LM.download` und die Liste der erlaubten Typen |

[`scripts/html-app-sicherheitstest.js`](../scripts/html-app-sicherheitstest.js) greift das im echten
Browser an und zählt, was am fremden Server ankommt, mit Kontrolle ohne Schutz. Nach jedem größeren
Chrome-Update und jeder Änderung an Schutzskript oder Kopfzeilen laufen lassen.

**Bekannte Lücke:** Ein durch `frame-src` blockierter Seitenwechsel löst in Chrome den Namen trotzdem auf
und baut eine Verbindung auf. Daten im Hostnamen kommen so nach außen, und `location` lässt sich im Rahmen
nicht abfangen. Die Prüfung lehnt `location` und die üblichen Verschleierungen ab, ein geschickter Angreifer
kommt aber daran vorbei. Abfließen könnten Eingaben in die App und die IP-Adresse, keine Namen. Im Shop gilt
Vertrauen in die Lehrkraft: Bis ein Admin eine solche App bemerkt und sperrt, kann sie bei anderen laufen.

## Was im Sandkasten geht

**Geht:** Skripte und Stile in der Datei, Bilder und Schriften als `data:`, `<canvas>`, `confirm()`, `print()`.

| Nicht möglich | Stattdessen |
|---|---|
| `localStorage`, Cookies | `LM.saveState`; Zugriffe in `try/catch` setzen, sie werfen `SecurityError` |
| Netz, CDNs, KI-Dienste, Bilder oder Skripte von außen | alles in die Datei packen |
| Zwischenablage | Text im Dialog zeigen |
| Herunterladen über `<a download>` | `LM.download` |

## Wenn etwas nicht geht

| Beobachtung | Ursache |
|---|---|
| App bleibt leer, Prüflauf: „startet nicht“ | `LM.start` fehlt, oder ein Fehler beim Aufbau |
| Prüflauf: „meldet beim Start keine Antwort“ | `LM.answer` beim Aufbau einer Aufgabe fehlt |
| Prüflauf: „gilt unberührt als richtig“ | Die Prüfung der Antwort nimmt eine leere Eingabe als richtig |
| Eingabe nach dem Zurückblättern weg | `LM.saveState` fehlt, oder Stand über 256 KB |
| „Prüfen“ wertet die letzte Eingabe nicht | `LM.onFlush` fehlt, die Eingabe war noch offen |
| Ergebnisse nach einem Update doppelt | `units[].id` wurde geändert |
| Alte App: „muss umgebaut werden“ | Sie nutzt noch `lmApp: 1` und läuft nicht mehr |

## Prompt für eine KI

Wer eine App von einer KI bauen oder umbauen lässt, gibt ihr diese Datei mit:

```text
Baue die App als eine einzige HTML-Datei ohne Netzzugriff nach html-apps.md, Schnittstelle lmApp 2.
Steckbrief im <head> mit festen IDs: Abschnitte und Schritte, je Schritt genau eine prüfbare Aufgabe
(kind: task) oder eine Infoseite (kind: info). In LM.start genau den Schritt init.step aufbauen, ohne
eigene Navigation. LM.answer bei jeder Änderung und gleich beim Start aufrufen; unberührt darf eine Aufgabe
nicht als richtig gelten. Stand mit LM.saveState speichern. Halte die Regeln aus „Was geprüft wird“ ein:
kein onclick="…", keine externen Adressen, kein fetch, keine iframes, kein location.
Eine von der App eingetragene Musterlösung zählt nicht als gelöst. Dateien nur über LM.download.
```

## Beispiel: Excel-Lernapp

[`beispiel_excel.html`](beispiel_excel.html) ist eine echte App (rund 410 KB) mit Mini-Excel-Tabelle.

| Abschnitt | Schritte | Wert |
|---|---|---|
| Start, Oberfläche, Datentypen, Formeln, Zellbezüge, Funktionen, Kalkulation, E-Technik, Diagramme | je 1 `info` | zählt mit dem Ansehen, die Trainer darin bleiben zum Üben |
| Formel-Labor | 40 `task` | richtig, wenn die Formel auch mit veränderten Werten stimmt |
| Lernsituationen | 4 `task` | Teilpunkte aus der Checkliste |
| Quiz & Theorie | 69 `task`, 1 `info` | je Frage; Theoriekarten und Zuordnen als Infoseite |

Was beim Umbau wichtig war:

- **Tabelle unverändert:** Die App behält das normale DOM, nichts davon musste in LearningModules.
- **Stiller Prüflauf:** Das Labor rechnet bei jeder Änderung still und meldet `LM.answer`; Rückmeldung
  und Markierungen erscheinen erst bei „Prüfen“.
- **Offene Zelle:** `LM.onFlush` schließt eine Zelle im Bearbeiten ab, damit „Prüfen“ sie mitzählt.
- **Weggefallen:** Lernstand (macht LearningModules), Klassenarbeit (die Lösungen stünden in der Datei) und
  Arbeitsblatt-Erstellung.

## Festlegungen

| Thema | Regel |
|---|---|
| Hochladen | Lehrkräfte mit Freischaltung |
| Alte Apps | `lmApp: 1` läuft nicht mehr, Umbau erforderlich |
| Shop | siehe „HTML-Apps im Shop“; über verbundene Server gehen HTML-Apps noch nicht, die Datei käme nicht mit |
| Klassenarbeit | nie über den Link der Klassenarbeit |
| Quiz-Arena | HTML-Apps nehmen nicht teil |
| Netz | kein Zugriff |

## Für Entwickler

Die Bridge ist nur eine Hülle um `postMessage`. Nachrichten sehen so aus: `{ lm: 2, type, data }`.

| Richtung | `type` | `data` |
|---|---|---|
| App → Rahmen | `lm.ready` | `{}` |
| Rahmen → App | `lm.init` | Felder von `init` |
| App → Rahmen | `lm.shown` | `{ text }`: aufgebaut, Länge des sichtbaren Texts |
| App → Rahmen | `lm.answer` | `{ isCorrect, points, userAnswer, correctAnswer }` |
| App → Rahmen | `lm.state` | `{ data }` |
| App → Rahmen | `lm.download` | `{ name, blob }` |
| App → Rahmen | `lm.crash` | `{ message }`: Skriptfehler |
| Rahmen → App | `lm.lock` | `{ locked }` |
| Rahmen → App | `lm.reveal`, `lm.check` | `{}` |
| Rahmen → App | `lm.flush`, zurück `lm.flushed` | `{}` |
| Rahmen → App | `lm.error` | `{ code, message }` |

- Im Durchlauf wird die App in ihre Schritte zerlegt (`html-app-steps.js`, Typen `htmlAppTask`, `htmlAppInfo`).
  Die Ergebnisse hängen am Untermodul des Abschnitts, die App meldet über den Gastgeber den normalen Durchlauf.
- Der Rahmen nimmt nur Nachrichten an, deren `event.source` das eigene iframe ist. Der Ursprung ist `null`.
- Inhalte aus Steckbrief und Antworten sind fremder Text: überall escapen, Länge begrenzt der Gastgeber.
- Die Hauptseite prüft `event.origin` und `event.source`, die Rahmenseite leitet nur die festgelegten
  Nachrichten weiter. Beide Adressen tragen `frame-ancestors`.
- Ergebnisse älterer Durchläufe (Modus `app`) bleiben sichtbar.
- E2E braucht zwei Hosts (Hauptseite `localhost`, Apps `127.0.0.1`), in Chrome `--disable-features=LocalNetworkAccessChecks`;
  die Meta-CSP `frame-src 'self' https:` lässt in Produktion nur https-Adressen zu.
