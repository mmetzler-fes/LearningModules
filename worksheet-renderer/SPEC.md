# Spec-Format der Arbeitsblätter

Gilt für `tools/make_worksheet.py`, `tools/make_script.py` und den Renderer-Dienst.
Fachliche und redaktionelle Vorgaben gehören nicht hierher, sondern in das Projekt
mit den Kursen (z. B. dessen `CLAUDE.md`).

## Spec-Format

`kurs.yaml` liefert die Vorgaben (Vorlage, Titelmuster, Kursname), die Spec
ergänzt nur noch das Blatt:

```yaml
nummer: 6                       # Nummer im Kurs
titel: Verzweigungen            # ergibt mit dem Titelmuster den Kopfzeilentitel
slug: 06_verzweigungen          # optional, sonst der Ordnername

content:
  - type: section               # Überschrift Ebene 1 -> "1."
    text: …
  - type: task                  # Überschrift Ebene 2 -> "1.1"
    title: …
    text: …                     # optionaler Einleitungstext
    blocks: [ … ]               # verschachtelte Blöcke
  - type: subtask               # Ebene 3 -> "1.1.1"
  - type: text                  # Fließtext; Leerzeile trennt Absätze
  - type: list
    items: [ … ]
  - type: code                  # Monospace, grau hinterlegt
    caption: "datei.html"       # optional, kursiv darüber
    code: |-                    # entweder Code inline …
      …
    file: quellcodes/x.html     # … oder aus einer Datei
    from_line: 5                # optionaler Zeilenausschnitt
    to_line: 20
  - type: image                 # Bild (PNG/JPEG/SVG), Höhe aus dem Seitenverhältnis
    file: quellen/schaltung.svg
    width: 9cm
    caption: "Brückenschaltung"    # Zeichenvorlage „Abbildung" (Arial fett 8 pt)
  - type: table                 # Spaltenbreiten und Schriftgröße berechnet der
    caption: "Operatoren"       # Renderer aus dem Inhalt; die Tabelle wird nie
    header: [Operator, Bedeutung]   # über einen Seitenumbruch getrennt
    rows:
      - ["==", "prüft auf Gleichheit"]
  - type: formula               # freistehende Formel im Formeleditor (StarMath)
    math: '{U_a} over {U_e} = {X_C} over sqrt{R^2 + X_C^2}'
    align: center               # optional; center (Vorgabe) oder left
    text: "…"                   # optionaler Ersatztext, siehe Fallstricke
  - type: note                  # kursiver Hinweis
    text: …
  - type: solution              # Arbeitsblatt: ausgeblendet; Lösungsblatt: rot über dem Karo
    title: "Lösung:"
    blocks: [ … ]
  - type: karo                  # Schreibfeld zum handschriftlichen Eintragen
    lines: 6                    # Höhe in Karozeilen à 0,5 cm
    width: 8cm                  # optional: Breite (0,5-cm-Schritte), sonst die Satzbreite
    pattern: linien             # optional: karo (Vorgabe) | linien (alle 1 cm) | leer (nur Rahmen) | frei (unsichtbar, nur Platz)
  - type: spacer                # nur Leerraum, ohne Raster
    lines: 4
  - type: pagebreak
  - type: heading               # Überschrift OHNE Nummer, zählt nicht mit
    level: 1                    # 1–3 (wie section/task/subtask)
    text: Vorwort
  - type: box                   # Kasten mit Rahmen, darin beliebige Blöcke
    title: Merke                # optional, fett
    shaded: true                # optional, grau hinterlegt
    blocks: [ … ]
  - type: quiz                  # nur LearningModules: Modul aus demselben Lernthema
    module: <Modul-ID>          # im Durchlauf direkt im Blatt; im Druck setzt die App
    title: Kurzquiz Ohm         #   QR-Code und Adresse ein; hier nur ein Hinweis
    scale: 0.8                  # optional: Größe im Blatt (0.5–1.5), nur online
```

### Erweiterungen

```yaml
  - type: text
    align: center               # left | center | right | justify
    text: |-
      **fett**, *kursiv*, ***beides***, ++unterstrichen++, ~~durchgestrichen~~,
      `code`, x^{2}, CO_{2}, [Link](https://example.org)
      Zeile mit Backslash am Ende\
      erzwingt den Umbruch.
  - type: list
    ordered: true               # 1. 2. 3. (zweite Ebene a) b) c))
    items:
      - Punkt
      - text: Punkt mit Unterpunkten
        items: [a, b]           # bis zu 3 Ebenen
  - type: table
    header: [{text: Gruppe, colspan: 2}, Wert]
    rows:                       # nur sichtbare Zellen nennen, wie in HTML
      - [{text: A, rowspan: 2}, a1, "1"]
      - [a2, "2"]
  - type: table                 # Bilder in Zellen (Baustein links, Diagramm rechts):
    rows:                       # unter dem Text der Zelle; die Spalte wird so breit
      - [{text: "Netzwerk 1:", images: [{file: ton.png, width: 6cm}]},   # wie das Bild
         {images: [{file: diagramm.png, width: 9cm}]}]
  - type: table                 # feste Spaltenbreiten (leer = automatisch, teilt
    header: [Begriff, Erklärung, Seite]   # sich den Rest) und Mindesthöhen je Zeile
    rows:                       # (Kopfzeile zuerst); in cm oder mm
      - [OPV, Operationsverstärker, "3"]
    widths: [3cm, "", 1.5cm]
    heights: ["", 2cm]
  - type: columns               # Inhalte nebeneinander (2–4 Spalten, randlos),
    blocks:                     # z. B. Schaltung links, Wertetabelle rechts;
      - type: column            # je Spalte beliebige Bausteine, width optional
        width: 9cm              # (leer = teilt sich den Rest)
        blocks: [{type: image, file: schaltung.png, width: 8cm}]
      - type: column
        blocks: [{type: table, header: [C, B, A, X], rows: [["", "", "", ""]]}]
  - type: table                 # Tabelle in der Tabelle: Bausteine einer Zelle
    rows:                       # unter `blocks` (nach Text und Bildern)
      - - Schaltung links
        - text: "Wertetabelle:"
          blocks: [{type: table, header: [C, B, A, X], rows: [["", "", "", ""]]}]
  - type: text                  # Einzug in cm (1–6), Zeilenabstand 1/1.15/1.5/2;
    indent: 2                   # im Text Farben: [Text]{blau}, [Text]{hl-gelb},
    lineHeight: 1.5             # [Text]{blau,hl-gelb} – blau, gruen, orange,
    text: "[Wichtig]{blau}"     # lila, grau; Hervorhebung gelb, gruen, blau, rosa
  - type: list                  # marker: dash, arrow, square, check (☐);
    marker: check               # nummeriert: numbering a (a) b)) oder i (i. ii.)
    items: [Aufgabe 1, Aufgabe 2]
  - type: table                 # Rahmenfarbe (lineColor: schwarz, grau, blau,
    lineColor: blau             # gruen, orange, lila), Zellenhintergrund
    rows: [[{text: a, background: gelb}]]   # (grau, gelb, gruen, blau, rosa)
  - type: table                 # Linien: Stärke in pt (0.25–6), Art solid,
    lineWidth: 1.5              # dashed oder dotted
    lineStyle: dashed
    rows: [[a, b]]
  - type: table                 # Ausrichtung aller Zellen (left, center, right);
    align: left                 # eine Zelle kann eigene haben. Ohne Linien
    border: false               # (border: false) ist sonst zentriert.
    rows:
      - [Name, {text: "3,50 €", align: right}]
  - type: table                 # Bild neben dem Text der Zelle statt darunter
    rows:
      - [{text: Schließer, beside: true, images: [{file: schliesser.svg, width: 0.6cm}]}, betätigt, "1"]
  - type: table                 # Abbildungen nebeneinander: ohne Linien, zentriert
    border: false
    rows:
      - [{images: [{file: a.png, width: 5cm}]}, {images: [{file: b.png, width: 5cm}]}]
      - ["**Abbildung 1**", "**Abbildung 2**"]
  - type: image
    file: schaltung.png         # in der App: src (data: oder Nextcloud-Link)
    width: 6cm
    float: left                 # left | right: folgende text/list/note stehen daneben
    border: true                # center: eigene Zeile, mittig
```

Ein Bild mit `float: left/right` bildet mit den direkt folgenden Text-,
Listen- und Hinweisblöcken eine randlose zweispaltige Gruppe – im Druck eine
Tabelle, online nebeneinander. So kann nichts Nachfolgendes das Bild verdecken.

### Verweise (nur in LearningModules)

`{{blatt:06_verzweigungen}}` → aktuelle Nummer, `{{blatt:a..b}}` → Bereich,
`{{titel:…}}` → Titel. Beim Export als Kurs werden sie durch die Nummern
ersetzt.

`file:`-Pfade werden in dieser Reihenfolge gesucht: Ordner der Spec →
Kursordner → Projektwurzel. Also `code/vorlage.html` neben der Spec oder
`quellcodes/addition1.html` im Kurs.

Die Nummerierung erzeugt LibreOffice aus der Gliederungsebene – nie „Aufgabe 3"
in den Titel schreiben.

## Lösungsblatt

Im Lösungsblatt wird jeder `solution`-Block dem davorstehenden `karo`-Block als
Overlay zugeordnet: rote Schrift in einem transparenten Rahmen über dem Raster.
Das Raster wächst dafür bis `KARO_MAX_ROWS` mit; längere Lösungen stehen
darunter. Deshalb sollte auf jede Aufgabe mit Lösung auch ein `karo`-Block folgen.

## Wie ein Skript entsteht

Ein Skript (Kompendium) fasst die Arbeitsblätter eines Themas zum Nachlesen
zusammen – gleicher Stoff, nur ohne Karopapier zum Eintragen.

1. `kurse/<kurs>/skripte/<name>.yaml` listet Titel und Blätter auf.
2. `make skript` rendert nach `build/<kuerzel>/Skript_<Thema>.odt` und
   `…_Lösung.odt`; darin sind die Musterlösungen rot sichtbar.

```yaml
titel: Mikrocontroller programmieren – Grundlagen
slug: Skript_Grundlagen        # optional, sonst Skript_<Dateiname>
kopfzeile: Arduino (ESP32) – Grundlagen    # optional, sonst "<Kurs> – <titel>"
blaetter:                      # Reihenfolge im Skript; oder: alle
  - 01_mikrocontroller_erste_led
  - 02_digitale_ausgaenge
```

Vorlage (`skript_template`) und `autor` stehen in der `kurs.yaml`. Die
Gliederung rutscht gegenüber dem Arbeitsblatt eine Ebene tiefer: Ebene 1 ist
der `titel` des Blatts, Ebene 2 sein „Schritt n – …", Ebene 3 die Aufgabe.
Titelseite, Kopfzeile und Inhaltsverzeichnis kommen aus der Vorlage; die
Verzeichniseinträge und ihre Seitenzahlen erzeugt der Renderer (Ebene 1 und 2).

## Fallstricke

* YAML: Listeneinträge mit Komma oder Doppelpunkt in Anführungszeichen setzen.
  Das Komma gehört **in** die Anführungszeichen.
* Formatvorlagennamen mit Leerzeichen findet odfpy nicht (deshalb
  `LösungQuelltext` statt `Lösung Quelltext`).
* Innerhalb von Textrahmen wendet LibreOffice **keine** benannten Formatvorlagen
  aus `styles.xml` an. Vorlagen für Rahmeninhalte müssen automatische Vorlagen
  sein (`doc.automaticstyles`).
* Bilder in einer Musterlösung erscheinen **nicht** im Overlay über dem
  Karoraster (im Rahmen wird der Bildrahmen nicht dargestellt). Ein `solution`
  mit `image` gehört deshalb in einen eigenen Block **ohne** unmittelbar
  davorstehendes `karo` – dann steht er im Arbeitsblatt ausgeblendet an seiner
  Stelle und wird im Lösungsblatt sichtbar.
* In Codeblöcken bleiben Leerzeichenkolonnen erhalten (`<text:s>`), damit
  ausgerichtete Kommentare nicht verrutschen. Kästchen- und Pfeilzeichen
  (`│ └ ← →`) stammen aus einer Ersatzschrift anderer Breite und zerstören die
  Ausrichtung – in Codeblöcken nur ASCII (`| + - <--`) verwenden.
* Tabellen bekommen ihre Spaltenbreiten aus dem Inhalt (längster Text als
  Wunsch-, längstes Wort als Mindestbreite) und rutschen bei viel Umbruch auf
  10 oder 9 pt. Wer eine Tabelle schmaler haben will, kürzt also den Text in
  der breitesten Spalte – Breiten von Hand gibt es nicht.
* Formeln (`type: formula`) sind echte Formeleditor-Objekte: eine Formel je
  Absatz, StarMath-Schreibweise (`over`, `sqrt{…}`, `^2`, `_C`, `cdot`, `%pi`,
  `left( … right)`, Text in Anführungszeichen). Der Rahmen bekommt bewusst
  keine Größe – LibreOffice rechnet sie beim Laden aus der Formel aus. Im
  Fließtext (mitten im Satz) gibt es keine Formeln; dort bleibt die
  Schreibweise mit `√( … )` und `_C`.
* Im Lösungsrahmen über dem Karoraster stellt LibreOffice weder Bilder noch
  Objekte dar. Eine Formel in einem `solution`-Block wird dort deshalb durch
  ihren Ersatztext ersetzt (aus `text:` oder automatisch aus der Formel
  abgeleitet); im Arbeitsblatt, im Skript und außerhalb von Lösungen steht das
  Objekt selbst. Rechenwege in Lösungen schreibt man daher weiter als Text.
* Tiefgestellte Indizes für Formelzeichen: `n_S` wird zu n mit tiefgestelltem
  S, mehrbuchstabige Indizes in geschweifte Klammern (`P_{Schlupf}`). Ohne
  Klammern ist die Basis genau ein Buchstabe, dem kein Wortzeichen vorausgeht –
  Bezeichner wie `to_line`, `AB_Vorlage` oder `01_drehfeld` bleiben also
  unangetastet. Mit Klammern wirkt `_{…}` nach jedem Zeichen (`CO_{2}`). In
  Codeblöcken wird nichts umgesetzt; im Fließtext schreibt `\_` einen
  gewöhnlichen Unterstrich (`c\_str()`). Nicht indiziert werden Bezeichnungen,
  die nur so *aussehen* wie ein Formelzeichen: Klemmen und Betriebsmittel
  (`U1, V1, W1`, `L1`, `Q11`), Normreihen und Klassen (`E12`, `IE2`, `S1`) und
  Schaltungsnamen (`RC`-Tiefpass).
* Auszeichnung wirkt nur am Wortrand: `8*7` oder `a**b` bleiben, wie sie sind.
  Hochgestellt nur mit Klammern (`x^{2}`) – `10^9` bleibt eine Schreibweise.
  Ein Backslash schreibt das Zeichen selbst (`\*`, `` \` ``, `\[`).
* Zeilenumbrüche im Fließtext: Ein einfacher Umbruch der Spec ist meist nur
  Satzspiegel und wird zum Leerzeichen. Er bleibt aber als Zeilenumbruch
  erhalten, wenn die Zeile kürzer als 70 Zeichen ist, die Folgezeile mit einer
  Aufzählung („b) …", „2. …") beginnt, beide Zeilen mit einer Zuweisung
  beginnen (`X = …`, `x := …`), die Zeile mit „:" endet und die Folgezeile
  eingerückt ist, oder eine der Zeilen Lücken aus mehreren Leerzeichen hat
  (`text_lines` in `make_worksheet.py`). Rechenzeilen also einfach
  untereinander schreiben.
* Mehrere Leerzeichen bleiben im Dokument erhalten (`<text:s>`) – auch
  Einrückungen am Zeilenanfang. Formel und Einheit trennt man mit Komma und
  drei Leerzeichen: `J = I / A,   [J] = A/mm²`; mehrere Formeln in einer
  Zeile mit einer breiteren Lücke.
* Bilder in der Vorlage gehören als PNG hinein, nicht als eingebettetes PDF.
  Aus einem PDF-Bild übernimmt LibreOffice beim Export zwar den Zeichenbefehl
  `/a0 gs`, nicht aber dessen Definition; strenge Betrachter (OneNote) lassen
  die Grafik dann weg. Ein Logo als PDF in der Schulvorlage lässt sich in deren
  `.patch.yaml` über `dateien:` durch ein PNG ersetzen. Prüfen lässt sich das mit `pdftoppm`: Meldet es
  „ExtGState 'a0' is unknown", steckt wieder ein PDF-Bild in der Vorlage.
* PDF-Erzeugung nur gesammelt in einem `soffice`-Aufruf: Läuft schon eine
  LibreOffice-Instanz, kehrt ein zweiter Aufruf ohne Fehlercode und ohne
  Ergebnis zurück.
* Im Skript gibt es kein Karoraster: Dort bleiben die Lösungen an ihrem Platz
  (`ctx["skip"]`), statt in ein Overlay über dem Raster zu wandern.
* Nach jeder Änderung neu bauen und die Seitenzahl prüfen.
