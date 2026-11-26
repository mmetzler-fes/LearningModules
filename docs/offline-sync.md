# Arbeiten bei wackligem WLAN (Nachsenden)

Schüler schreiben im Stift-Editor, auch wenn das WLAN kurz weg ist. Nichts wartet beim Schreiben auf das Netz.

## Stufen

1. **Lokal zuerst** (gebaut 2026-11-26): Jeder Stand eines Blatts kommt sofort in die IndexedDB des Geräts
   (`src/renderer/js/sync/outbox.js`, Datenbank `lm-sync`):
   - **Spiegel**: der zuletzt bekannte Stand je Blatt, mit der Revision des Servers.
   - **Warteschlange**: Was noch zum Server muss. Je Schlüssel zählt nur der neueste Stand, er behält aber seinen Platz.
     Gesendet wird einzeln und der Reihe nach, mit Wiederholung (2 s … 60 s), beim Wiederkommen des Netzes,
     beim Zurückkehren in die App und alle 30 s. Die Einträge überstehen Neuladen.
   - Genutzt von: Blättern (`/api/public/work/save`), dem Zwischenstand der Klassenarbeit (`/api/public/exam/progress`)
     und Ergebnissen, die ohne Netz nicht ankamen (`/api/public/results`).
   - Vor der Abgabe geht erst alles Wartende hinaus. Sonst schlösse die Abgabe einer Klassenarbeit den Server für die Blätter.
2. **Speichern entlastet**: Der Stift-Editor speichert erst 1 s nach dem letzten Strich und nie, solange der Stift aufliegt.
   Schließen und „Weiter“ warten nur noch auf das Gerät, nicht mehr auf das Netz.
3. **Offline öffnen** (offen, nach dem iPad-Test): Service Worker für App und Schülerzugang, Inhalte eines Links vorab laden.
   Bis dahin gilt: Ein Blatt, das auf dem Gerät schon einmal offen war, geht auch ohne Netz wieder auf (aus dem Spiegel).

## Zwei Geräte

Jedes Speichern trägt `sync: { device, seq, base }`. `device` ist die Zufallskennung des Browsers, `seq` seine laufende Nummer,
`base` die Revision (`syncRev`), die das Gerät zuletzt vom Server kannte. Die Regel steht in `syncDecision` (`src/work/work.service.ts`):

- Dasselbe Gerät mit kleinerer Nummer: überholt, wird verworfen.
- Das Gerät kannte den neuesten Stand: Er wird einfach übernommen.
- Sonst haben zwei Geräte unabhängig gearbeitet. Es gewinnt der neuere Stand (nach der Uhr des Geräts, `data.updatedAt`).
  Der andere wird zur **zweiten Fassung** (`previousData`).
  Das unterlegene Gerät bekommt keine Revision. Sein nächster Stand läuft deshalb wieder über den Vergleich.

Die Lehrkraft sieht „⇄ 2 Fassungen“ an der Bearbeitung und vergleicht beide nebeneinander (`views/work-compare.js`).
Danach übernimmt sie die zweite Fassung (getauscht, nichts geht verloren) oder verwirft sie.

## Zeitstempel

- Blätter: `clientAt` ist die Uhr des Geräts beim Schreiben, `updatedAt` die Ankunft.
  Liegen mehr als 2 Minuten dazwischen, steht „⏱ nachgereicht“ an der Bearbeitung.
- Klassenarbeit: Der Zwischenstand trägt `writtenAt` und `receivedAt`, das Ergebnis `payload.writtenAt`.
