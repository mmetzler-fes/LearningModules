# Formelaufgabe

Rechenaufgabe mit Formel: Jeder Schüler bekommt **eigene Zufallswerte**,
bewertet wird mit **Toleranz**. Abschreiben vom Nachbarn bringt nichts, und
eine Aufgabe ergibt beliebig viele Übungen.

## Anlegen

Im Modul-Editor den Typ **🧮 Formelaufgabe** wählen.

| Feld | Bedeutung |
|---|---|
| Aufgabentext | Variablen als `{Name}`, z. B. „U = {U} V“; ein berechneter Zwischenwert als `{=Formel}`, z. B. `{={U}/{R}}` |
| Variablen | Name, Minimum, Maximum, Nachkommastellen – je Schüler zufällig im Bereich |
| Gesuchte Ergebnisse | Bezeichnung, Formel, Einheit, Toleranz (in % oder ± Einheiten), Nachkommastellen der Lösung |
| „🎲 Neue Werte“ | beim freien Üben neue Zahlen per Klick |

Beispiel: Variablen `U` (5 bis 24, 1 Stelle) und `R` (10 bis 470, 0 Stellen),
Ergebnisse „Strom I“ mit `U/R` in A und „Leistung P“ mit `U^2/R` in W.

Beim Speichern prüft der Editor die Formeln: unbekannte Variablen, Tippfehler
und fehlende Rechenzeichen werden gemeldet.

## Formeln

- Rechenzeichen `+ - * / ^` und Klammern; `^` bindet stärker als das
  Vorzeichen: `-2^2` = −4.
- Dezimalzahlen mit **Punkt** (`1.5`, `2e-3`) – das Komma trennt
  Funktionsargumente.
- Funktionen: `sqrt`, `abs`, `exp`, `ln` (auch `log`), `log10`, `sin`, `cos`,
  `tan` (Bogenmaß), `asin`, `acos`, `atan`, `atan2`, `deg2rad`, `rad2deg`,
  `pow(a,b)`, `min`, `max`, `round`, `floor`, `ceil`; Konstanten `pi` und `e`.
- Winkel in Grad: `sin(deg2rad(phi))`, Ergebnis in Grad: `rad2deg(atan(X/R))`.
- Variablen dürfen auch in Moodles Schreibweise `{U}` stehen.

## Bewertung

- Eingabe mit Komma oder Punkt (`0,25`, `0.25`, `2,5e-3`).
- Richtig ist ein Wert innerhalb der Toleranz – oder genau der auf die
  angegebenen Nachkommastellen gerundete Wert.
- Mehrere Ergebnisse geben Teilpunkte (1 von 2 richtig = 50 %).
- In den Ergebnissen stehen Eingabe, Lösung und die Werte des Schülers.
- In Klassenarbeit, Lernbegleitung und Quiz-Arena bewertet die App am Ende;
  „Überprüfen“ und „🎲 Neue Werte“ gibt es nur beim freien Üben. In der
  Quiz-Arena hat jeder eigene Werte – am Beamer steht deshalb die Formel.

## Moodle

Berechnete Fragen (`calculated`, `calculatedsimple`) aus Moodle-XML werden
Formelaufgaben: Datensätze → Variablen, voll bewertete Antwort → Formel,
Toleranz relativ oder absolut. Beim Export nach Moodle wird je Ergebnis eine
berechnete Frage mit 10 Zahlensätzen. Auswahlfragen mit Formeln
(`calculatedmulti`) werden noch übersprungen. H5P kennt keinen passenden Typ.
