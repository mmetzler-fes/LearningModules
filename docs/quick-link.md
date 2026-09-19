# Quick-Link: Schüler starten per Link oder QR-Code

> Der Quick-Link startet **ein** Thema sofort im Quiz-Modus. Soll der Modus
> wählbar sein (Quiz, Klassenarbeit, Lernen mit Lösungen) oder sollen mehrere
> Themen zusammen abgefragt werden, ist ein **[Themen-Link](themen-links.md)**
> das passendere Werkzeug.

## Für die Lehrkraft

Auf der Karte eines Lernthemas gibt es den Button **🔗 Quick-Link**. Der Dialog
zeigt beides nebeneinander:

- **QR-Code** – zum Abscannen mit iPad oder Handy
- **Link** – zum Kopieren am PC, etwa für Moodle, Teams oder die Tafel

Dazu: *Kopieren*, *Drucken* (nur QR und Link kommen aufs Blatt), *Neu* und
*Zurückziehen*.

Der Token bleibt stabil. Einmal ausgeteilte Zettel behalten also ihre Gültigkeit,
bis bewusst *Neu* oder *Zurückziehen* gewählt wird.

## Für die Schüler

Link öffnen oder QR scannen → Name eintippen → das Quiz startet sofort.
Eine Anmeldung gibt es für Schüler nicht mehr; der Link ist der Zugang.

## Freigabe-Regeln

Ein Quick-Link entsteht **nur**, wenn das Thema tatsächlich startbar ist:

| Situation | Verhalten |
|---|---|
| Thema nicht freigegeben | Button deaktiviert, Server verweigert (403) |
| Kein Modul freigegeben | Server verweigert (403) |
| Thema nachträglich deaktiviert | Bestehender Link liefert 403 |
| Token neu erzeugt | Alter Link sofort ungültig (404) |

So kann kein QR-Code entstehen, der Schüler vor eine verschlossene Tür führt.

## Sicherheit

**Der Link ist der Schlüssel.** Wer ihn hat, kommt ohne weitere Prüfung ins
Quiz. Das ist der Zweck, sollte aber bewusst eingesetzt werden: Für eine
Prüfung den Link erst zu Beginn zeigen und danach *Zurückziehen* wählen —
oder gleich einen Themen-Link im Modus „Klassenarbeit“ verwenden.

Der Token hat 96 Bit Zufall (`crypto.randomBytes(12)`, base64url) und ist nicht
erratbar.

## Technik

| Endpunkt | Zweck |
|---|---|
| `POST /api/topics/:id/quick-link` | Link abrufen/erzeugen, `{regenerate:true}` erneuert |
| `DELETE /api/topics/:id/quick-link` | Link entwerten |
| `GET /api/public/quick/:token` | Öffentlicher Einstieg, liefert Thema + Module |

Die Link-Adresse baut der Server aus `APP_URL`, sonst aus den Request-Headern
(`X-Forwarded-Proto` / `X-Forwarded-Host`) – hinter dem nginx-Proxy stimmt sie
damit ohne zusätzliche Konfiguration.

Der QR-Code wird serverseitig als SVG erzeugt (`qrcode`). Fehlt das Paket,
bleibt der Link trotzdem nutzbar; im Dialog erscheint dann nur ein Hinweis.

Einstieg im Frontend: `?q=<token>` auf der Startseite, ausgewertet in
`app.init()` → `LoginView.startQuickEntry()`.
