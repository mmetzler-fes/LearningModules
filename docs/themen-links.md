# Themen-Links: ein Link pro Gruppe und Anlass

Ein Themen-Link ist ein benannter Zugang für Schüler, zum Beispiel
**„TG12 Informatik Arduino“**. Er bündelt eine beliebige Auswahl aus den
eigenen Lernthemen und legt fest, in welchem Modus damit gearbeitet wird.

Er löst den früheren globalen Prüfungsmodus ab. Der hing am Lehrerkonto und
galt damit für alle gleichzeitig – ungünstig, wenn eine Gruppe eine
Klassenarbeit schreibt, während eine andere noch übt. Jetzt hängt der Modus
am Link, und beides geht nebeneinander.

## Anlegen

Menüpunkt **🔗 Themen-Links → ➕ Neuer Themen-Link**.

| Feld | Bedeutung |
|---|---|
| Name | Frei wählbar, erscheint beim Schüler und in der Ergebnisliste |
| Abfragemodus | Mindestens einer; mehrere erlaubt |
| Passwort | Optional, wird zusätzlich zum Namen abgefragt |
| Einmalige Teilnahme | Nur bei Klassenarbeit wählbar |
| Tags | Zum Wiederfinden, siehe unten |
| Inhalte | Themen ankreuzen, oder Module einzeln auswählen |

Zur Auswahl stehen die **eigenen** Themen und die, die dir jemand **zur
Nutzung freigegeben** hat – letztere in einem eigenen Abschnitt mit
Eigentümernamen. Verwendest du fremde Inhalte, landen die Ergebnisse trotzdem
bei dir: Dafür zählt der Eigentümer des Links. Siehe
[Lernthemen freigeben](themen-teilen.md).

Bei den Inhalten gibt es zwei Wege:

- **Ganzes Thema** – später ergänzte Module sind automatisch dabei.
- **Einzelne Module** – über *Module zeigen* aufklappen und ankreuzen. Hat ein
  Modul Submodule, lassen sich auch die einzeln wählen. Ist nur das
  Elternmodul angehakt, gilt das ganze Modul.

## Die drei Modi

| Modus | Verhalten | Ergebnis |
|---|---|---|
| 🧠 **Quiz** | Rückmeldung nach jeder Aufgabe, Zurückblättern erlaubt | wird gespeichert |
| 📝 **Klassenarbeit** | Keine Rückmeldung, kein Zurückblättern | wird gespeichert |
| 💡 **Lernen mit Lösungen** | Antworten wie im Quiz, danach die Musterlösung zur Aufgabe | wird **nicht** gespeichert |

Ist nur ein Modus freigegeben, startet der Link ohne Rückfrage hinein. Sind
mehrere freigegeben, wählt der Schüler nach der Namenseingabe selbst.

Die Musterlösung im Lernmodus stammt aus derselben Auswertung, die auch das
Ergebnis erzeugt. Angezeigte Lösung und Bewertung können deshalb nicht
auseinanderlaufen.

## Versenden

**🔗 Link & QR** öffnet den Dialog mit QR-Code und URL, dazu *Kopieren*,
*Drucken*, *Neu* und *Zurückziehen* – wie beim Quick-Link.

Der Token bleibt stabil. Ausgeteilte Zettel behalten ihre Gültigkeit, bis
bewusst *Neu* oder *Zurückziehen* gewählt wird.

## Wenn Inhalte wegfallen

Nutzt ein Link fremde Inhalte und zieht der Eigentümer die Freigabe zurück
oder löscht das Thema, wirkt das sofort – die Prüfung läuft bei jedem
Schülerstart neu. Die Link-Karte weist dann darauf hin
(„⚠️ 1 Thema/Themen nicht mehr verfügbar"), und bleibt nichts übrig, wird der
Start mit einer Meldung abgewiesen statt mit einem leeren Quiz.

## Deaktivieren statt löschen

**⏸ Deaktivieren** lässt den Link samt Auswahl bestehen, weist Schüler aber
ab. Praktisch nach einer Klassenarbeit: Der Link ist zu, die Konfiguration
bleibt für das nächste Mal erhalten.

## Einmalige Teilnahme

Bei der Klassenarbeit lässt sich ein Durchlauf pro Schülername erzwingen. Ein
zweiter Versuch unter demselben Namen wird abgewiesen.

Das ist **eine Hürde, keine fälschungssichere Sperre** – den Namen gibt der
Schüler selbst ein. Wer es darauf anlegt, tippt einen anderen. Für den
normalen Unterrichtsfall reicht es; für mehr bräuchte es echte Konten.

## Sicherheit

**Der Link ist der Schlüssel.** Wer ihn hat, kommt hinein – bei gesetztem
Passwort zusätzlich mit diesem. Für eine Klassenarbeit den Link also erst zu
Beginn zeigen und danach *Zurückziehen* oder *Deaktivieren* wählen.

Der Token hat 96 Bit Zufall (`crypto.randomBytes(12)`, base64url) und ist
nicht erratbar. Das Passwort wird nie an den Browser zurückgegeben; die API
meldet nur, *ob* eines gesetzt ist.

## Tags

Tags ordnen Lernthemen und Links ein, zum Beispiel „Informatik“ oder
„Arduino“. Verwaltet werden sie unter **🏷 Tags** – bewusst als gepflegte
Liste statt freier Eingabe, damit nicht dreimal dasselbe unterschiedlich
geschrieben im Filter steht.

Über der Themen- und der Link-Liste sitzt der Filter: Freitextfeld zum Suchen,
darunter die passenden Tags als Checkboxen. Der Schalter *alle Tags müssen
passen* stellt zwischen ODER (mindestens ein Tag) und UND (alle Tags) um.

Wird ein Tag gelöscht, verschwindet er zugleich aus allen Themen und Links –
sonst blieben unsichtbare Treffer im Filter zurück. Der Verwendungszähler in
der Liste sagt vorher, woran er noch hängt.

## Ergebnisse

Jeder gespeicherte Durchlauf trägt Schülername, Zeit, IP-Adresse, Linkname und
Modus. In der Ergebnisliste lässt sich nach Schülername (Suchfeld) und nach
Link (Auswahlfeld) filtern.

Der Linkname wird ins Ergebnis kopiert, nicht nur verwiesen. Die Liste bleibt
damit lesbar, auch wenn der Link später umbenannt oder gelöscht wird.

## Technik

| Endpunkt | Zweck |
|---|---|
| `GET /api/topics/usable` | Auswahl für den Baum: eigene + freigegebene Themen |
| `GET/POST /api/links` | Links auflisten, anlegen |
| `PATCH/DELETE /api/links/:id` | Ändern, löschen |
| `POST /api/links/:id/share` | Link + QR abrufen, `{regenerate:true}` erneuert |
| `DELETE /api/links/:id/share` | Token entwerten |
| `GET /api/tags` … | Tags verwalten (CRUD) |
| `GET /api/public/link/:token` | Öffentliche Vorschau: Name, Modi, Passwortpflicht |
| `POST /api/public/link/:token/start` | Name/Passwort/Modus prüfen, Module liefern |

Einstieg im Frontend: `?l=<token>` auf der Startseite, ausgewertet in
`app.init()` → `LoginView.startLinkEntry()`.

Entitäten: `TopicLink` (`src/core/entities/topic-link.entity.ts`) und `Tag`.
Die Auswahl steht als JSON im Feld `selection`; aufgelöst wird sie in
`LinksService.resolveModules()`.
