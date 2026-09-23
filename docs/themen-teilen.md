# Lernthemen freigeben: verwenden und kopieren

## Gedanke dahinter

Es gibt zwei Arten, ein Thema herzugeben. Sie lassen sich unabhängig
voneinander erlauben.

**Verwenden** – die Kollegin nimmt das **Original** in ihre eigenen
Themen-Links. Es gibt keine Kopie; du pflegst den Inhalt an einer Stelle, und
Änderungen wirken sofort bei allen, die ihn einsetzen.

**Kopieren** – die Kollegin zieht sich eine **eigene Fassung** und wird deren
Eigentümerin. Spätere Änderungen am Original wandern nicht mit.

Die früher heikle Frage, bei wem die Schülerergebnisse landen, stellt sich in
beiden Fällen nicht mehr: Dafür zählt die Lehrkraft, die den **Zugang**
verteilt hat, nicht die, der der Inhalt gehört. Das gilt für den
[Themen-Link](themen-links.md) wie für den [Quick-Link](quick-link.md) — auch
wenn die Aufgaben von jemand anderem stammen.

## Eigentümer und Nutzer

Zwei Rollen, die sauber auseinandergehalten werden:

| | Eigentümer | nutzende Lehrkraft |
|---|---|---|
| Inhalte ändern, löschen, freigeben | ja | nein |
| Quick-Link und Themen-Link erzeugen | ja | **ja, einen eigenen** |
| Ergebnisse | aus den eigenen Links | aus den eigenen Links |
| Freigabe ausblenden oder entfernen | – | ja, nur bei sich |

Der Eigentümer behält also die Schreibhoheit, die nutzende Lehrkraft bekommt
volle **Benutzungsrechte**: Sie darf mit den Inhalten unterrichten, Links und
QR-Codes dafür ausgeben und bekommt die Ergebnisse ihrer eigenen Klassen.
Jeder Zugang gehört dabei dem, der ihn ausgegeben hat — *Neu* und
*Zurückziehen* wirken nie auf die Links der anderen.

**Wann was?** Für laufendes Üben ist *verwenden* angenehmer: eine Quelle, keine
veralteten Kopien. Für eine Klassenarbeit ist *kopieren* die ruhigere Wahl —
sonst könnte eine Änderung am Original die Arbeit verändern, die morgen
geschrieben wird.

## Für die Lehrkraft

**Freigeben:** Auf der Themenkarte → **👥**. Pro Person gibt es zwei Häkchen,
*verwenden* und *kopieren*; die oberste Zeile setzt beides für alle
Kolleginnen und Kollegen auf einmal. Die Karte trägt danach getrennte
Abzeichen („🔗 verwendbar für 3", „👥 kopierbar für alle").

**Zurücknehmen:** Haken entfernen und speichern. Bei *kopieren* bleiben
bereits gezogene Kopien unberührt – sie gehören ja schon jemand anderem. Bei
*verwenden* wirkt der Entzug dagegen **sofort**: Bestehende Themen-Links der
Kollegin liefern das Thema nicht mehr aus, und ihre Link-Liste weist darauf
hin. Die Prüfung läuft bei jedem Schülerstart neu, nicht nur beim Anlegen des
Links.

**Empfangen:** Unter der eigenen Themenliste erscheint der Bereich
„📤 Von Kolleginnen und Kollegen freigegeben". Verwendbare Themen sind dort
gekennzeichnet, tragen einen eigenen Knopf **🔗 Quick-Link** und stehen im
Themen-Link-Editor unter „Von Kolleginnen und Kollegen freigegeben" zur
Auswahl. Kopierbare tragen zusätzlich den Knopf **„📥 Zu mir kopieren"**.

## Ausblenden und Entfernen

Wer eine Freigabe geschenkt bekommt, entscheidet allein, ob sie bei ihm
überhaupt auftaucht. Zwei Stufen, beide rein persönlich:

| | wirkt |
|---|---|
| **🚫 Ausblenden** | aus dem Weg, aber zusammengeklappt weiter erreichbar |
| **🗑 Entfernen** | ganz aus der Liste – auch aus dem Themen-Link-Editor |

**Gelöscht wird dabei nichts.** Thema, Module und die Freigabe des Eigentümers
bleiben unangetastet; entfernt wird allein die eigene Sicht darauf. Deshalb
heißt der Endpunkt auch `POST /api/topics/:id/removed` und nicht `DELETE`.

Zwei bewusste Feinheiten:

- Bereits verteilte Links auf das entfernte Thema **laufen weiter**. Sie
  gehören der Lehrkraft, und stillschweigend einen QR-Code zu entwerten, den
  eine Klasse morgen scannt, wäre die falsche Hilfsbereitschaft. Wer sie
  loswerden will, zieht sie in der Linkliste selbst zurück.
- Gibt der Eigentümer später etwas **Neues** frei – erstmals, eine höhere
  Stufe oder zusätzlich zum Kopieren –, taucht das Thema wieder auf. Eine
  frische Einladung soll nicht an einer alten Absage scheitern. Das bloße
  Erneutspeichern unveränderter Freigaben holt dagegen nichts zurück.

## Was die Kopie übernimmt – und was nicht

| Übernommen | Nicht übernommen |
|---|---|
| Titel (mit Zusatz „(Kopie)") | Eigentümer – das wird der Kopierende |
| Beschreibung | Kopier-Freigabe des Originals |
| Alle Module samt Inhalten | Quick-Link / QR-Code |
| Reihenfolge, Modul-Freigaben | Themenpasswort, Subscribe-Key |

**Die Eigentümerrolle wechselt vollständig.** Der bisherige Eigentümer behält
sein Original und bekommt auf die Kopie *verwenden* **und** *kopieren*
vorbelegt – er darf sehen, was aus seinem Material geworden ist, und sich eine
verbesserte Fassung auch zurückholen. Damit kehrt sich das Verhältnis um: Für
die Kopie ist der Kopierende der Eigentümer, der frühere Eigentümer der
Nutzer. Wer das nicht möchte, wählt die Haken in seinem eigenen
Freigabe-Dialog ab; die Kopie gehört ihm ja.

## Herkunft

Jede Kopie merkt sich, woher sie stammt, und zeigt es auf ihrer Karte:

> 📋 Kopie von „Arduino Grundlagen" · Ursprung: Frau Meier

Die Nennung ist **unentziehbar**. Sie steht nicht in der Positivliste
änderbarer Felder, ein `PATCH` läuft also ins Leere. Sie überlebt außerdem das
Löschen der Quelle und ihres Verfassers, weil Titel und Name als Text
mitkopiert werden statt als Verweis.

Auf der anderen Seite trägt das Original ein Abzeichen **„📋 3 Kopien
gezogen"**. Das beantwortet die Frage, die vor jedem Entzug steht: Ist
überhaupt noch etwas zu holen? Gezogene Kopien gehören schon jemand anderem.

### Warum Nennung und nicht Zugriff

Naheliegend wäre, dem Urheber ein **unentziehbares** Recht an jeder Kopie zu
geben. Dagegen sprechen drei Dinge:

- **Der Auslöser passt nicht zum Inhalt.** „Stammt einmal von dir ab" sagt
  nichts darüber, was heute drinsteht. Nach ein paar Bearbeitungen enthält die
  Kopie Material, das nie aus dem Original stammte — eine lizenzierte Aufgabe,
  ein Foto einer Klasse. Ein nicht abstellbares Zugriffsrecht griffe mit
  darauf zu.
- **Die Transitivität hat keine gute Antwort.** Behielte der Urheber das Recht
  am Enkel, sammelte ein altes Thema über Jahre eine unübersichtliche Liste
  Berechtigter an. Behielte er es nicht, wäre die Regel mit einem Klick
  ausgehebelt: einmal die eigene Kopie kopieren, Abstammung gekappt.
- **Es wäre das einzige unentziehbare Recht im System.** Alles andere lässt
  sich zurücknehmen; genau das macht das Modell verständlich.

Deshalb: **Herkunft festhalten ja, Zugriff erzwingen nein.** Die Rechte des
Urhebers an der Kopie sind vorbelegt, nicht festgeschrieben — dieselbe Wirkung
im Normalfall, ein Ventil für den Ausnahmefall.

Entsprechend nennt eine Kopie nur ihre **direkte** Quelle. Die Kopie einer
Kopie verweist auf die mittlere Lehrkraft, nicht auf den ursprünglichen
Verfasser, und der Zähler am Original zählt nur direkte Kopien: Er beantwortet
„wer hat sich bei mir bedient", nicht „wie weit hat es sich verbreitet".

Die Kopie startet bewusst **inaktiv** und auf „gesperrt": erst ansehen, dann
selbst freigeben. So taucht sie nicht ungeprüft bei den Schülern auf.

## Gruppen (Fachschaften)

Statt zwölf Haken einzeln zu setzen, gibt man an **„Fachschaft Informatik"**
frei. Im Freigabe-Dialog stehen die Gruppen über der Personenliste, mit
denselben zwei Häkchen.

Der Unterschied zu einer einmaligen Mehrfachauswahl ist die Dauer: Eine Gruppe
wirkt **fortlaufend**. Wer später dazukommt, ist automatisch dabei; wer
ausscheidet, verliert den Zugriff sofort — auch in bereits gespeicherten
Themen- und Quick-Links, denn die Prüfung läuft bei jedem Schülerstart neu.

**Gepflegt werden Gruppen vom Admin** (Administration → 🏫 Gruppen). Das ist
bewusst zentral: Dürfte jede Lehrkraft eigene Verteiler anlegen, gäbe es nach
einem Jahr acht Versionen von „Mathe", und niemand wüsste, welche die richtige
ist. Lesen darf jede Lehrkraft — für die Auswahl im Dialog ist das nötig, und
wer an eine Fachschaft freigibt, soll sehen, wen er damit erreicht.

Wird eine Gruppe gelöscht, verschwinden die Freigaben, die auf sie zeigen,
gleich mit. In der Zugriffsprüfung wäre ein toter Verweis zwar folgenlos —
Mitglied einer gelöschten Gruppe ist niemand —, stünde aber für immer als
unerklärlicher Eintrag in den Listen der Kolleginnen.

### Technisch

Eine Gruppe steht in denselben Feldern wie eine Person, nur mit Präfix:
`group:<id>` in `sharedWith` und `sharedAccess`. Das Datenmodell wird dadurch
nicht doppelt geführt.

Die Mitgliedschaft wird **einmal pro Anfrage** in der JWT-Strategie geladen und
liegt danach als `user.groupIds` bereit. So bleibt `accessLevel()` synchron und
ohne Datenbankzugriff — die Funktion läuft teils in Schleifen über alle Themen,
eine Abfrage je Prüfung wäre spürbar. Außerhalb einer Anfrage, etwa für den
Eigentümer eines Themen-Links beim Schülerstart, liefert
`GroupsService.asUser()` dasselbe.

**Bewusst nicht im Token.** Das wäre billiger, aber eine Änderung der Besetzung
würde erst nach dem nächsten Login wirken. Ein Entzug, der erst morgen greift,
ist keiner.

## Zugriffsstufen

Das Datenmodell kennt drei Stufen, geordnet – `write` schließt `read` ein:

| Stufe | Darf |
|---|---|
| `read` | Inhalte sehen und in eigenen Themen- und Quick-Links verwenden |
| `write` | zusätzlich Module anlegen, bearbeiten, löschen, umsortieren |
| Eigentümer | zusätzlich Thema löschen, Freigabe ändern, Themenpasswort setzen |

Der Quick-Link steht seit der Trennung von Inhalt und Zugang **allen** Stufen
offen – er gehört ja der Lehrkraft, die ihn verteilt, nicht dem Thema.

**`write` ist im Datenmodell vorgesehen, in der Oberfläche aber noch nicht
wählbar.** Das war Absicht: Die Stufe lässt sich später freischalten, ohne das
Modell noch einmal anzufassen. Serverseitig ist sie vollständig umgesetzt und
geprüft, einschließlich der Eigentümervorbehalte.

Der gesamte Zugriff hängt an einer einzigen Stelle – `findOneFor(id, user,
need)` in `topics.service.ts`. Jede Methode nennt die Stufe, die sie braucht;
was nicht ausdrücklich geöffnet wird, bleibt eigentümergebunden. `update()`
arbeitet zusätzlich mit einer Positivliste erlaubter Felder, damit ein
Bearbeiter nicht über einen Umweg `ownerId`, die Freigabe oder das
Themenpasswort mitsetzen kann.

## Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/topics/colleagues` | Auswahlliste für den Dialog (auch für Lehrkräfte) |
| `GET` | `/api/groups` | Gruppen lesen (jede Lehrkraft) |
| `POST`/`PATCH`/`DELETE` | `/api/groups[/:id]` | Gruppen pflegen (nur Admin) |
| `GET` | `/api/topics/shared-with-me` | Was mir freigegeben wurde (mit `canUse`/`canCopy`) |
| `GET` | `/api/topics/usable` | Eigene + zur Nutzung freigegebene Themen samt Modulen |
| `POST` | `/api/topics/:id/sharing` | `{sharedWith, sharedAccess}` – fehlendes Feld bleibt unverändert |
| `POST` | `/api/topics/:id/copy` | Eigene Kopie anlegen (verwenden + kopieren zurück an den bisherigen Eigentümer, abstellbar) |
| `POST` | `/api/topics/:id/hidden` | `{hidden}` – in der eigenen Liste ausblenden |
| `POST` | `/api/topics/:id/removed` | `{removed}` – aus der eigenen Liste entfernen |
| `POST` | `/api/topics/:id/quick-link` | Eigenen Quick-Link, auch auf fremde Themen |

Gespeichert wird die Freigabe in zwei Feldern: `topics.sharedWith`
(Kopier-Freigabe, Liste von Benutzer-IDs) und `topics.sharedAccess`
(`[{userId, level}]`). Bei beiden steht `'*'` für alle Kolleginnen und
Kollegen und `group:<id>` für eine Gruppe. Der spezifischere Eintrag schlägt
den allgemeineren — persönlich vor Gruppe vor „alle" —, sodass eine
Einzelperson mehr bekommen kann als ihre Fachschaft und die Fachschaft mehr
als das Kollegium. Unter mehreren Gruppen gewinnt die höhere Stufe.

Die persönlichen Entscheidungen des Empfängers stehen dagegen bei ihm, nicht
am Thema: `users.hiddenSharedTopics` und `users.removedSharedTopics`. So kann
jeder für sich aufräumen, ohne dass es beim Eigentümer ankommt.

Die Herkunft liegt in vier Spalten an der Kopie: `copiedFromId`,
`copiedFromOwnerId`, `copiedFromAuthor`, `copiedFromTitle`. Die beiden
Textfelder sind bewusst denormalisiert — die Nennung soll ihre Quelle
überleben. `findAll()` reicht daraus `origin` und `copyCount` an die
Oberfläche.

`GET /api/topics/usable` liefert fremde Themen entschärft: Themenpasswort,
Subscribe-Key und Quick-Link-Token bleiben draußen. Wer Inhalte verwenden
darf, braucht die Zugangsdaten des Eigentümers nicht.

**Hinweis zur Technik:** `shared-with-me` filtert in JavaScript statt in SQL,
weil `sharedWith` als JSON-Text abgelegt ist. Bei schulischen Datenmengen ist
das unkritisch; bei mehreren tausend Themen wäre eine eigene Tabelle besser.

`GET /api/topics/colleagues` zeigt jeder Lehrkraft die Namen und E-Mail-Adressen
der übrigen Lehrkräfte. Das ist für die Auswahl nötig und im Kollegium
unproblematisch – bewusst entschieden, nicht übersehen.
