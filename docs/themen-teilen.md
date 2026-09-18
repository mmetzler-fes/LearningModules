# Lernthemen freigeben und kopieren

## Gedanke dahinter

Freigeben heißt hier **nicht** gemeinsames Bearbeiten, sondern: Kolleginnen und
Kollegen dürfen sich eine **eigene Kopie** ziehen und sind deren Eigentümer.

Das vermeidet ein Rechtemodell mit Lese-, Schreib- und Exportstufen – und vor
allem die Frage, bei wem die Schülerergebnisse landen, wenn zwei Lehrkräfte
dasselbe Thema einsetzen. Bei Kopien ist das eindeutig: jede Lehrkraft hat ihr
eigenes Thema, ihren eigenen Quick-Link und ihre eigenen Ergebnisse.

Der Preis: Spätere Änderungen am Original wandern **nicht** in die Kopien.

## Für die Lehrkraft

**Freigeben:** Auf der Themenkarte → **👥** → entweder „Für alle Kolleginnen und
Kollegen freigeben" oder einzelne Konten ankreuzen → speichern. Die Karte trägt
danach ein Abzeichen („freigegeben für alle" bzw. „für 3").

Freigabe zurücknehmen: alle Haken entfernen und speichern. Bereits gezogene
Kopien bleiben davon unberührt – sie gehören ja schon jemand anderem.

**Kopieren:** Unter der eigenen Themenliste erscheint der Bereich
„📤 Von Kolleginnen und Kollegen freigegeben" mit dem Knopf
**„📥 Zu mir kopieren"**. Der Bereich ist unsichtbar, solange niemand etwas
freigegeben hat.

## Was die Kopie übernimmt – und was nicht

| Übernommen | Nicht übernommen |
|---|---|
| Titel (mit Zusatz „(Kopie)") | Eigentümer – das wird der Kopierende |
| Beschreibung | Freigabe-Einstellung |
| Alle Module samt Inhalten | Quick-Link / QR-Code |
| Reihenfolge, Modul-Freigaben | Themenpasswort, Subscribe-Key |

Die Kopie startet bewusst **inaktiv** und auf „gesperrt": erst ansehen, dann
selbst freigeben. So taucht sie nicht ungeprüft bei den Schülern auf.

## Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/topics/colleagues` | Auswahlliste für den Dialog (auch für Lehrkräfte) |
| `GET` | `/api/topics/shared-with-me` | Was mir freigegeben wurde |
| `POST` | `/api/topics/:id/sharing` | `{sharedWith: ["*"]}` oder Liste von Benutzer-IDs |
| `POST` | `/api/topics/:id/copy` | Eigene Kopie anlegen |

Gespeichert wird in `topics.sharedWith` (`simple-json`). `['*']` steht für alle
und schlägt jede Einzelauswahl, damit kein widersprüchlicher Zustand entsteht.

**Hinweis zur Technik:** `shared-with-me` filtert in JavaScript statt in SQL,
weil `sharedWith` als JSON-Text abgelegt ist. Bei schulischen Datenmengen ist
das unkritisch; bei mehreren tausend Themen wäre eine eigene Tabelle besser.

`GET /api/topics/colleagues` zeigt jeder Lehrkraft die Namen und E-Mail-Adressen
der übrigen Lehrkräfte. Das ist für die Auswahl nötig und im Kollegium
unproblematisch – bewusst entschieden, nicht übersehen.
