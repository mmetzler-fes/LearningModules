# OneNote übernehmen

Ein OneNote-Notizbuch lässt sich in einem Schritt nach LearningModules holen –
gedacht für die **Aufgabenblätter**: PDFs, die als Anlage oder Ausdruck auf
den Seiten liegen, und andere angehängte Dateien. Text, Freihand und das
Layout der Seiten bleiben in OneNote.

## Exportieren (in OneNote für Windows)

1. Das Notizbuch in der Desktop-App öffnen (aus Teams: „In Desktop-App
   öffnen“) und warten, bis alles synchronisiert ist.
2. **Datei → Exportieren**:
   - **Notizbuch → OneNote-Paket (`.onepkg`)** für das ganze Notizbuch, oder
   - **Abschnitt → OneNote-Abschnitt (`.one`)** für einen einzelnen Abschnitt.
3. Speichern.

## Übernehmen (in LearningModules)

1. Notebook-Ansicht → **🟪 OneNote übernehmen** und die Datei wählen (oder
   hineinziehen). Mehrere `.one`-Dateien gehen auch auf einmal.
2. Der Browser liest die Datei und zeigt, was übernommen wird: je Abschnitt
   die Zahl der Seiten mit Anlagen, Dateien und Größe. Häkchen weg = nicht
   übernehmen.
3. **✅ Übernehmen**. Der Fortschritt läuft unten im Dialog; den Dialog darf
   man schließen, nur den Tab nicht.

Bei einem **Klassennotizbuch** kommen nur die **Inhaltsbibliothek** und
**Nur für Lehrer** mit. Schülerbereiche, der Platz für Zusammenarbeit und die
Willkommen-Seite bleiben weg – ihre Namen erscheinen nirgends und verlassen
den Browser nicht. Gelöschte Seiten (Papierkorb) und ältere Fassungen einer
Seite kommen ebenfalls nicht mit.

## Was daraus wird

| OneNote | LearningModules |
|---|---|
| Notizbuch | Book |
| Abschnittsgruppe (z. B. Inhaltsbibliothek) | Abschnitt, mit Untergruppen ein Bereich |
| Abschnitt | Lernthema |
| Seite mit Anlagen | Modul 📎 Anhang mit allen Dateien der Seite |
| Unterseite | Modul „Seite › Unterseite“ |
| Ausdruck mit Originaldatei | das Original-PDF |
| Ausdruck ohne Original | PDF aus den Seitenbildern |
| Seite ohne Anlage | wird übersprungen (gezählt) |

Die Dateien landen in der Nextcloud im Ordner des Lernthemas – deshalb muss
eine Nextcloud verbunden sein. „Nur für Lehrer“ ist einfach ein eigener
Ordner im Book: Schüler sehen nur, was du über Links teilst.

## Abgebrochen?

Mit derselben Datei noch einmal **🟪 OneNote übernehmen**: Es geht an der
Stelle weiter, an der es aufgehört hat – schon angelegte Lernthemen und
Module kommen nicht doppelt. Wurde das Book inzwischen gelöscht, beginnt die
Übernahme von vorn.

## Technik

- Entpacken im Browser: `src/renderer/js/cab.js` (Cabinet mit LZX, nach
  MS-CAB und libmspack), Lesen der Abschnitte: `src/renderer/js/onenote.js`
  (MS-ONESTORE/MS-ONE: aktueller Stand jedes Objektraums über die Kette der
  Revisionen; Seiten aus der Seitenreihe, Titel und Ebene aus den Metadaten,
  Dateien aus `EmbeddedFileNode` bzw. `ImageNode` und dem FileDataStore).
- Angelegt wird über die bestehenden Endpunkte (Ordner, Lernthema,
  `POST /api/nextcloud/attachments`, Modul). Der Server rechnet nichts.
- Fortschritt im `localStorage` des Browsers (`lm_onenote_import:<Datei>`).
- Nur das Desktop-Format `.one` (OneNote 2010–2016 und Microsoft 365 für
  Windows); MSZIP-komprimierte Pakete werden abgelehnt.

Code: `src/renderer/js/views/onenote-import.js` (Dialog und Ablauf),
`src/core/onenote-import.spec.ts` (Tests; mit einem echten Export unter
`data/onenote-sample/` auch gegen diesen).
