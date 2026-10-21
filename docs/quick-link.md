# Quick-Link: Schüler starten per Link oder QR-Code

Ein Quick-Link ist **ein** Link für ein Lernthema (bzw. ein Book, einen
Bereich oder Abschnitt im Notebook) – ohne Klasse in der Adresse. Er passt
deshalb auf gedruckte Blätter und gilt auch im nächsten Schuljahr weiter.

## Für die Lehrkraft

**🔗 Quick-Link** auf der Karte eines Lernthemas (oder im Menü eines
Notebook-Eintrags):

1. Beim ersten Mal die **Klassen wählen**, aus denen Schüler später wählen
   (auch keine) → **Quick-Link erstellen**.
2. Danach öffnet der Knopf Link & QR-Code mit
   - **✏️ Anpassen** – Klassen ändern. Link und QR-Code bleiben gleich.
   - **🚫 Zurückziehen** – der Link und alle seine Varianten (unten) sind
     sofort ungültig. Danach lässt sich ein neuer erstellen; die Klassenauswahl
     wird vorgeschlagen.

Ein „Neu erzeugen“ gibt es nicht: Wer einen neuen Token braucht, zieht zurück
und erstellt neu – so ist klar, dass verteilte Codes verloren gehen.

Unter **Schülerfreigaben → 🏫 Klassen** steht je gewählter Klasse der
Quick-Link als **Variante mit vorgewählter Klasse** (Abzeichen 🔗 Quick-Link).
Damit kann man einer Klasse einen Link geben, bei dem die Klassenauswahl
entfällt. Dort gibt es auch die **🏆 Quiz-Arena** der Klasse: Den
Leitungs-Link öffnet nur die Lehrkraft (z. B. am Beamer), Schüler kommen über
den QR-Code im Wartebereich hinein.

Hinter jeder Klasse steht ihr Klassenlink. Eine abgewählte Klasse behält ihn
als gewöhnlichen Klassenlink – samt Ergebnissen.

| Adresse | Schüler sehen |
|---|---|
| `/?l=<token>` | Klassenauswahl und Name |
| `/?l=<token>.<klasse>` | nur den Namen (Klasse steht fest) |

Ist die Klasse einer Variante nicht mehr ausgewählt, zeigt die App die
Klassenauswahl statt eines Fehlers. Zur Auswahl stehen nur Klassen des
aktuellen Schuljahrs.

### Schuljahreswechsel

Die Klassen-ID bleibt beim Wechsel nicht gleich – jede Klasse gehört zu einem
Schuljahr, mit eigener Schülerliste und Löschfrist
([Klassen und Schuljahr](klassen-und-schuljahr.md#schuljahreswechsel)).
Der Quick-Link folgt trotzdem:

- **Übernommene Klasse** (TG11-1 → TG12-1): Sie ersetzt die alte in der
  Auswahl. Eine gedruckte Variante mit der alten Klasse führt über die Kette
  der Vorgänger zur Klasse, die jetzt ausgewählt ist – auch nach mehreren
  Jahren. Ergebnisse landen in der neuen Klasse.
- **Nicht mehr benötigte Klasse:** Sie fällt aus der Auswahl, ihre Variante
  ist **erloschen** („Diesen Link gibt es nicht mehr“).
- Der Quick-Link selbst (ohne Klasse) bleibt gültig.

## Für die Schüler

Link öffnen oder QR scannen → Klasse wählen → Name eingeben. Der Name wird wie
beim [Klassenlink](klassen-und-schuljahr.md) der Schülerliste zugeordnet
(„unbestätigt“, „🔒 strikt“ gelten wie dort), das Ergebnis steht unter der
Klasse. Ohne gewählte Klassen genügt der Name; Ergebnisse stehen dann unter
„ohne Klasse“.

## Ältere Quick-Links

Quick-Links aus der Zeit vor den Klassen (`/?q=…`) bleiben gültig; Ergebnisse
darüber stehen unter „ohne Klasse“. Die folgenden Abschnitte beschreiben sie.

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
