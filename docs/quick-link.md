# Quick-Link: Schüler starten per Link oder QR-Code

Es gibt zwei Arten von Links, und die Regel ist einfach: **anonym ohne Daten, Klasse mit Daten.**

| Link | Woher | Schüler | Gespeichert |
|---|---|---|---|
| 🌐 **Anonym** | Quick-Link im 📓 Notizbuch, 🔗 Link & QR in den Schülerfreigaben | starten sofort, ohne Anmeldung | nichts, nur die Nutzung ohne Namen |
| 🏫 **Klasse** | Quick-Link im 📒 Klassennotizbuch, 🏫 Für eine Klasse in den Schülerfreigaben | Name und PIN, einmal je Gerät | Ergebnisse und Stand unter dem Schüler |

## Anonyme Links

**🔗 Quick-Link** auf der Karte eines Lernthemas oder im Menü eines Notebook-Eintrags erzeugt ihn, ohne Rückfrage.
Er passt auf gedruckte Blätter und gilt auch im nächsten Schuljahr. **🚫 Zurückziehen** macht ihn sofort ungültig,
auch gedruckte QR-Codes.

**Wiederfinden:** Unter **🔗 Schülerfreigaben → 📚 Themen** trägt jeder anonyme Link das Abzeichen **🌐 Anonym**.
„🌐 Nur anonyme Links zeigen“ blendet die übrigen aus, **🚫 Anonymen Link zurückziehen** steht an der Karte.

| Modus über einen anonymen Link | Name | Ende |
|---|---|---|
| Quiz, Lernen mit Lösungen, Lernbegleitung | keiner | Ergebnis nur auf dem Bildschirm |
| 📝 Klassenarbeit, hier **Probearbeit** | frei wählbar | Punkte auf dem Bildschirm; Gesperrtes (🔒, Klassenarbeits-Dokumente) nur, wenn es einzeln gewählt ist |
| 🏆 Quiz-Arena | frei wählbar, auch Fantasienamen | Siegertreppchen, keine Ergebnisse |

Die echte Klassenarbeit läuft über die Klasse.

## Klassenlinks: Name und PIN, einmal je Gerät

Beim ersten Mal geben Schüler Namen und PIN ein, danach steht auf der Eingabeseite „Angemeldet als …“: Ein Klick genügt.
Auf einem gemeinsam genutzten Gerät führt **Das bin ich nicht** zur Eingabe zurück. Das Gerät hält nur einen signierten
Ausweis, nie die PIN; eine neue PIN (🔑 in der Klassenliste) macht ihn ungültig.

- **PIN noch nie gesehen:** Sie erscheint einmal, solange die [Erstanmeldung](klassennotizbuch.md#erstanmeldung) offen ist.
  Ist sie zu, hilft die Lehrkraft, die die PIN in der Klassenliste sieht. Vor dem ersten Einsatz also einmal öffnen.
- **Offene Klasse:** Ein unbekannter Name kommt weiter ohne PIN hinein, als „unbestätigt“.
- **Stift-Editor:** Wer so angemeldet ist, wird dort nicht noch einmal gefragt.
- **Ausnahmen, nur Name:** der eigene Link der Klassenarbeit und die Quiz-Arena.

## Ältere Links

- **Quick-Links mit Klassenauswahl** (`/?l=<token>`): Der Link gilt weiter, ist aber anonym. Darüber kommen **keine Ergebnisse
  mehr in der Klasse an**.
- **Varianten mit fester Klasse** (`/?l=<token>.<klasse>`) und Klassenlinks bleiben Klassenlinks, verlangen aber Name und PIN.
- **Quick-Links aus der Zeit vor den Klassen** (`/?q=…`) gelten weiter und sind anonym.

### Schuljahreswechsel

Eine Variante mit alter Klasse führt über die Kette der Vorgänger zur Klasse, die jetzt ausgewählt ist. Eine nicht mehr
benötigte Klasse ist **erloschen** („Diesen Link gibt es nicht mehr“).

## Der Quick-Link gehört der Lehrkraft, nicht dem Thema

Jede Lehrkraft hat ihren **eigenen** Quick-Link auf ein Thema – auch auf eines,
das sie im Shop zur Nutzung (**Use**) erworben hat. Im Bereich
„Zur Nutzung erworben" steht dafür derselbe Knopf **🔗 Quick-Link**; eine
eigene Freigabe ist dafür nicht nötig.

Eine im Shop erworbene **Kopie** ist dagegen ein eigenes Thema und beginnt
**nicht freigegeben**. Ein Klick auf **🔗 Quick-Link** fragt dann, ob das
Thema gleich freigegeben werden soll.

Das ist dieselbe Trennung wie beim [Themen-Link](themen-links.md):

| | gehört |
|---|---|
| Inhalt (Thema, Module) | dem Eigentümer |
| Zugang (Quick-Link, Themen-Link) | der Lehrkraft, die ihn verteilt |
| Ergebnisse | der Lehrkraft, die den Link verteilt hat |

Wer also mit fremden Aufgaben arbeitet, findet die Ergebnisse trotzdem in der
eigenen Liste. *Neu* und *Zurückziehen* wirken nur auf den eigenen Token; die
Links der Kolleginnen auf dasselbe Thema bleiben gültig.

Zieht der Eigentümer die Nutzungsfreigabe zurück, ist der fremde Quick-Link
sofort tot – die Prüfung läuft bei jedem Schülerstart neu.

Bei den älteren Links: Link öffnen oder QR scannen → Name eintippen → das
Quiz startet sofort.

## Freigabe-Regeln

Ein Quick-Link entsteht **nur**, wenn das Thema tatsächlich startbar ist:

| Situation | Verhalten |
|---|---|
| Eigenes Thema nicht freigegeben | Button fragt, ob freigegeben werden soll; Server verweigert (403) |
| Kein Modul freigegeben | Server verweigert (403) |
| Eigenes Thema nachträglich deaktiviert | Bestehender Link liefert 403 |
| Token neu erzeugt | Alter Link sofort ungültig (404) |
| Nutzungsfreigabe zurückgezogen | Quick-Link der Kollegin liefert 403 |

So kann kein QR-Code entstehen, der Schüler vor eine verschlossene Tür führt.

Bei **fremden** Themen zählt der Haken „aktiv" des Eigentümers nicht: Er
gehört zu *seiner* Schülersicht. Maßgeblich ist die Nutzungsfreigabe – sie ist
seine ausdrückliche Zustimmung. Der Themen-Link hält es genauso.

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
| `POST /api/topics/:id/quick-link` | Eigenen Link abrufen/erzeugen, `{regenerate:true}` erneuert |
| `DELETE /api/topics/:id/quick-link` | Eigenen Link entwerten |
| `GET /api/public/quick/:token` | Öffentlicher Einstieg, liefert Thema + Module |

Die Link-Adresse baut der Server aus `APP_URL`, sonst aus den Request-Headern
(`X-Forwarded-Proto` / `X-Forwarded-Host`) – hinter dem nginx-Proxy stimmt sie
damit ohne zusätzliche Konfiguration.

Der QR-Code wird serverseitig als SVG erzeugt (`qrcode`). Fehlt das Paket,
bleibt der Link trotzdem nutzbar; im Dialog erscheint dann nur ein Hinweis.

Gespeichert werden die Tokens in der Tabelle `topic_quick_links`
(`topicId`, `ownerId`, `token`) – ein Eintrag je Thema und Lehrkraft. Die alte
Spalte `topics.quickToken` bleibt als Rückfallebene bestehen: Tokens von
früher gelten weiter und wandern beim ersten Öffnen des Dialogs in die
Tabelle.

Einstieg im Frontend: `?q=<token>` auf der Startseite, ausgewertet in
`app.init()` → `LoginView.startQuickEntry()`. Der Token wandert von dort in
`state.quickSession` und mit jedem Ergebnis zurück an den Server – dieser und
nicht die mitgeschickte E-Mail entscheidet, wem das Ergebnis gehört.
