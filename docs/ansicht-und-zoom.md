# Ansicht und Zoom

## Zoom für Menü und Inhalt

Unten in der Seitenleiste stehen zwei Regler:

- **Zoom Menü** – nur die Seitenleiste links,
- **Zoom Inhalt** – alles rechts davon.

Beide gehen in Stufen von 70 % bis 160 %. Ein Klick auf die Prozentzahl setzt
auf 100 % zurück. Die Einstellung gilt für dieses Gerät und diesen Browser –
am Beamer-Rechner kann sie anders sein als am eigenen. Dialoge (Rückfragen,
Auswahlfenster) bleiben in normaler Größe.

Bei schmaler Seitenleiste (Tablet, Handy) fehlen die Regler; dort zoomt man
mit zwei Fingern.

## Drag and Drop mit Bild

Hohe Bilder ragten früher über den Bildschirm hinaus, und jedes Element musste
über eine lange Strecke gezogen werden. Jetzt gibt es über der Aufgabe einen
Umschalter:

- **⤢ Einpassen** (Vorgabe): Die ganze Aufgabe – Text, Ablage, Bild und
  Knöpfe – wird so verkleinert, dass sie auf einen Bildschirm passt. Je
  nachdem, was das größere Bild ergibt, steht die Ablage über dem Bild oder
  daneben. Schmaler als 320 Bildschirm-Pixel wird das Bild nicht, damit die
  Beschriftung lesbar bleibt; bei sehr hohen Bildern bleibt dann ein Rest zum
  Scrollen.
- **🔍 Vergrößern**: Das Bild nutzt die volle Breite und wird dafür höher als
  der Bildschirm. Die Ablage bleibt beim Scrollen oben stehen, die Elemente
  sind also immer in Reichweite.

Die Wahl merkt sich der Browser für alle Drag-and-Drop-Aufgaben. Die Zonen
liegen in Prozent des Bildes und passen in jeder Größe. Der Zoom aus der
Seitenleiste wird mit eingerechnet.

## Technik

Zoom per CSS `zoom` auf `#sidebar` bzw. `#mainContent`
(`App.initZoom`, `localStorage` `lm_zoom_sidebar` / `lm_zoom_content`).
Beim Ziehen bekommt die Kopie am `body` denselben Zoom (`effectiveZoom` in
`utils.js`). Einpassen: `setupDndFit` in `h5p-renderer.js`, gemerkt unter
`lm_dnd_view`.
