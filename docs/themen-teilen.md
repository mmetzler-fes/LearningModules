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
beiden Fällen nicht mehr: Dafür zählt der Eigentümer des **Themen-Links**,
nicht der des Inhalts. Wer den Link verteilt, bekommt die Ergebnisse — auch
wenn die Aufgaben von jemand anderem stammen.

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
gekennzeichnet und stehen im Themen-Link-Editor unter „Von Kolleginnen und
Kollegen freigegeben" zur Auswahl. Kopierbare tragen zusätzlich den Knopf
**„📥 Zu mir kopieren"**.

## Was die Kopie übernimmt – und was nicht

| Übernommen | Nicht übernommen |
|---|---|
| Titel (mit Zusatz „(Kopie)") | Eigentümer – das wird der Kopierende |
| Beschreibung | Freigabe-Einstellung |
| Alle Module samt Inhalten | Quick-Link / QR-Code |
| Reihenfolge, Modul-Freigaben | Themenpasswort, Subscribe-Key |

Die Kopie startet bewusst **inaktiv** und auf „gesperrt": erst ansehen, dann
selbst freigeben. So taucht sie nicht ungeprüft bei den Schülern auf.

## Zugriffsstufen

Das Datenmodell kennt drei Stufen, geordnet – `write` schließt `read` ein:

| Stufe | Darf |
|---|---|
| `read` | Inhalte sehen und in eigenen Themen-Links verwenden |
| `write` | zusätzlich Module anlegen, bearbeiten, löschen, umsortieren |
| Eigentümer | zusätzlich Thema löschen, Freigabe ändern, Quick-Link verwalten |

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
| `GET` | `/api/topics/shared-with-me` | Was mir freigegeben wurde (mit `canUse`/`canCopy`) |
| `GET` | `/api/topics/usable` | Eigene + zur Nutzung freigegebene Themen samt Modulen |
| `POST` | `/api/topics/:id/sharing` | `{sharedWith, sharedAccess}` – fehlendes Feld bleibt unverändert |
| `POST` | `/api/topics/:id/copy` | Eigene Kopie anlegen |

Gespeichert wird in zwei Feldern: `topics.sharedWith` (Kopier-Freigabe, Liste
von Benutzer-IDs) und `topics.sharedAccess` (`[{userId, level}]`). Bei beiden
steht `'*'` für alle Kolleginnen und Kollegen; ein persönlicher Eintrag in
`sharedAccess` schlägt die Sammelfreigabe, sodass eine Einzelperson mehr
bekommen kann als die Allgemeinheit.

`GET /api/topics/usable` liefert fremde Themen entschärft: Themenpasswort,
Subscribe-Key und Quick-Link-Token bleiben draußen. Wer Inhalte verwenden
darf, braucht die Zugangsdaten des Eigentümers nicht.

**Hinweis zur Technik:** `shared-with-me` filtert in JavaScript statt in SQL,
weil `sharedWith` als JSON-Text abgelegt ist. Bei schulischen Datenmengen ist
das unkritisch; bei mehreren tausend Themen wäre eine eigene Tabelle besser.

`GET /api/topics/colleagues` zeigt jeder Lehrkraft die Namen und E-Mail-Adressen
der übrigen Lehrkräfte. Das ist für die Auswahl nötig und im Kollegium
unproblematisch – bewusst entschieden, nicht übersehen.
