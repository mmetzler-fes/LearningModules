# Nutzung und Bewertung

> **Material teilen & Wirkung schenken.** Ein Lernthema, das bei dir gut
> läuft, hilft anderen genauso – und du siehst, wo es ankommt.

Im Shop ist alles frei. Statt Punkten gibt es zwei Dinge, die zum Teilen
ermutigen sollen:

- **📈 Geteilt & genutzt** zeigt, wo das eigene Material im Unterricht ankommt – auch
  über Kopien bei anderen und wenn andere es weiterreichen.
- Wer etwas aus dem Shop nutzt oder kopiert hat, kann es **bewerten**: mit
  Sternen für die Nützlichkeit, einem 👍 Danke und einem Satz an die Creator.

## Geteilt & genutzt

Shop → **📈 Geteilt & genutzt** zeigt für alle Module, die du verfasst hast:

| Zahl | Bedeutung |
|---|---|
| Lehrkräfte erreicht | andere Lehrkräfte, die dein Material nutzen (Use), kopiert haben oder damit unterrichten |
| Schulen | an wie vielen Schulen diese Lehrkräfte sind (erscheint erst ab einer) |
| Bearbeitungen im Unterricht | je Modul und Schülerdurchlauf eine – über deine Links und die anderer |
| Klassen | Klassen mit Klassenlink, die damit gearbeitet haben, auch deine eigenen |
| Nützlichkeit, 👍 Danke | Durchschnitt der Sterne und Zahl der Danke |

Darunter steht eine Zeile je Lernthema und die **Rückmeldungen** mit Text,
neueste zuerst.

So wird gezählt:

- **Am Original.** Jede Kopie merkt sich, aus welchem Modul sie entstanden ist –
  auch über mehrere Stufen. Arbeitet eine Kollegin mit ihrer Kopie, zählt das
  für dich. Bearbeitet sie die Kopie, bleibt sie trotzdem dein Modul.
- **Auch nach dem Löschen.** Löschst du ein Lernthema, das andere kopiert
  haben, zählt es über die Kopien weiter; die Zeile trägt dann „(Original
  gelöscht)“.
- **Ohne Namen.** Gezählt wird nur, wie oft – je Modul, Lehrkraft, Klasse und
  Monat. Schülernamen und Ergebnisse kommen in dieser Übersicht nie vor.
- Kombi-Module zählen einmal, nicht je Teilaufgabe. Durchläufe im Modus
  *Lernen* werden nicht gespeichert und zählen deshalb auch nicht.
- Bestehende Ergebnisse wurden bei der Umstellung im Oktober 2026 einmal
  nachgezählt, ältere Kopien ihrem Original zugeordnet (nach Titel, Art und
  Creator).

**Geben und Nehmen:** Die Zeile mit 🤝 nennt, wie viele Angebote du im Shop
hast und wie oft du selbst etwas übernommen hast. Nur du siehst sie.

## Bewerten

Bewerten kann, wer ein Lernthema über den Shop **nutzt** oder **kopiert** hat:

- im Shop auf der Karte: **⭐ Bewerten**,
- in den [Notebooks](notebooks.md) im Menü eines genutzten Lernthemas
  (**⭐ Bewerten**) oder einer Kopie (**⭐ Original bewerten**),
- unter 🏠 LernModule auf der Karte eines genutzten Lernthemas bzw. in der
  Herkunftszeile einer Kopie.

Bewertet wird immer das **Original** – auch, wenn du über deine Kopie
bewertest. Eigene Lernthemen lassen sich nicht bewerten.

| Teil | Wer sieht es |
|---|---|
| ★ 1 bis 5 – wie nützlich für den Unterricht | alle, nur als Durchschnitt mit Anzahl |
| 👍 Danke | alle, nur als Anzahl |
| Text an die Creator (optional, bis 1000 Zeichen) | die Creator der Module und der Anbieter, mit deinem Namen |

Je Lernthema gibt es eine Bewertung von dir; du kannst sie jederzeit ändern
oder löschen.

## Creator im Shop

Ein Klick auf einen Namen auf einer Shop-Karte zeigt nur die Angebote mit
Modulen dieser Person, dazu eine Zeile: wie viele Module sie verfasst hat, wie
viele Lehrkräfte sie erreicht, wie oft damit gearbeitet wurde, ihre Bewertung.
Rückmeldungen mit Text erscheinen dort nicht.

## Hinweis zum Teilen

Wer schon einiges übernommen und selbst noch nichts angeboten hat, sieht oben
im Shop einen freundlichen Hinweis mit **🏷 Etwas anbieten**. Ab wie vielen
Übernahmen, stellt der Admin unter *Administration → Shop & Sicherheit →
📈 Teilen* ein (Vorgabe 5, 0 = aus). Gesperrt wird niemand.

## Wenn ein Konto wegfällt

- **Creator** werden nie gelöscht, nur deaktiviert: Ihre Inhalte bleiben im
  Shop, ihre Nutzung zählt weiter.
- **Konten zusammenführen** (z. B. neue E-Mail-Adresse): Zähler und
  Bewertungen gehen an das verbleibende Konto. Hat es dasselbe Lernthema schon
  bewertet, gilt seine Bewertung.
- Eine **gelöschte Lehrkraft** (ohne eigene Module) nimmt ihre Bewertungen mit;
  was über ihre Links gezählt wurde, bleibt.

## Technik

| Datei | Zweck |
|---|---|
| `src/core/entities/learning-module.entity.ts` | `originId`: das ursprüngliche Modul einer Kopie; nur der Server setzt es |
| `src/core/entities/usage-count.entity.ts` | Zähler `usage_counts`: Original, Lehrkraft, Klasse, Monat, Bearbeitungen |
| `src/core/entities/content-feedback.entity.ts` | Bewertungen `content_feedback`: Sterne, Danke, Text, je Lehrkraft und Lernthema |
| `src/impact/impact-rules.ts` | Regeln ohne Datenbank (Herkunft, Zählen, Durchschnitt, Zuordnung alter Kopien) |
| `src/impact/usage.service.ts` | Zählen beim Speichern eines Schülerergebnisses, einmalige Übernahme, Einstellungen |
| `src/impact/impact.service.ts` | Auswertung „Geteilt & genutzt“, Creator-Kurzfassung, Bewerten |

Gezählt wird in `PublicController.submitResult` und beim Speichern der
Quiz-Arena-Ergebnisse, aus `payload.details[].moduleId`. Ein Fehler beim
Zählen kostet nie ein Ergebnis. `originId` entsteht beim Kopieren über den
Shop, in den Notebooks, beim Duplizieren und beim Einlesen eines
verschlüsselten Exports (gibt es das Original nicht mehr, wird das eingelesene
Modul selbst zum Original). Offen importierte Dateien sind neues Material
ohne Herkunft. Die einmalige Übernahme merkt sich ihren Lauf in
`system_config` unter `impact_backfill_v1`.

Die Zähler sind so angelegt, dass sie sich später auch an verbundene Server
melden lassen: nur Kennungen und Zahlen, keine Schülerdaten.

### Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/impact/mine` | „Geteilt & genutzt“: Summen, Lernthemen, Rückmeldungen, Geben und Nehmen |
| `GET` | `/api/impact/creators/:id` | Kurzfassung eines Creators (ohne Texte) |
| `GET` | `/api/impact/feedback/:topicId` | eigene Bewertung und Durchschnitt; bei einer Kopie die des Originals |
| `POST` | `/api/impact/feedback/:topicId` | `{stars: 1–5 \| null, thanks, comment}` – alles leer löscht |
| `GET`/`POST` | `/api/admin/impact-settings` | `{shareHintAfter}` |
