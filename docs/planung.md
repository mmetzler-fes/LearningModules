# Planung

Unter **🗂 Planung** (Menü oder Reiter neben 📓 Notizbuch und 📒 Klassennotizbuch) legst du **Pläne** an:
was ein Bildungsgang oder Beruf in welcher Reihenfolge bekommt. Dein Notizbuch bleibt die fachliche
Ordnung; ein Plan enthält nur **Verweise** auf deine Lernthemen. Verbesserst du ein Arbeitsblatt, ist es in
allen Plänen verbessert.

## Aufbau

- **📁 Ordner** für Bildungsgänge und Berufe, z. B. „Berufsschule › Mechatroniker“, „Berufsschule ›
  Elektroniker Betriebstechnik“, „TG“. Ordner lassen sich schachteln.
- **📋 Plan** in einem Ordner, z. B. „1. Ausbildungsjahr“.
- Im Plan **📂 Bereiche** (z. B. ein Lernfeld) und **📑 Abschnitte** wie im Klassennotizbuch, darin die
  **📘 Lernthemen**. Ein Abschnitt enthält nur Lernthemen.
- **🧩 Teilplan:** Ein Plan kann einen anderen Plan einbinden, z. B. „Lernfelder 1–4 Elektro“ (in einem
  Ordner „Gemeinsam“) in den Plänen mehrerer Berufe. Änderst du den Teilplan, ändert er sich in allen
  Plänen. Am Plan steht „🧩 in 2 Plänen“. Ein Plan kann sich nicht selbst einbinden, auch nicht über
  Umwege.
- Jedes Lernthema steht in einem Plan höchstens einmal. Kommt es zusätzlich über einen Teilplan, zählt
  die erste Stelle.

## Zwei Spalten

Links steht dein **📓 Lernnotizbuch**, rechts stehen die **🗂 Pläne**. Die aktive Spalte hat einen blauen
Rahmen. Rechts gilt die Zeile mit dem Cursor als **Ziel**: Sie steht oben im Kopf („Ziel: LF 5“). Steht der
Cursor auf einem Lernthema, ist das Ziel sein Bereich.

Links zeigt **✓** die Lernthemen, die schon im Plan am Cursor stehen, **✓ Teilplan** die, die über einen
Teilplan hineinkommen.

## Tasten

| Taste | Wirkung |
|---|---|
| Tab | Spalte wechseln |
| ↑ ↓, Bild↑ Bild↓, Pos1 Ende | Cursor bewegen |
| → ← oder Enter | auf- und zuklappen; ← springt zur Ebene darüber |
| Leertaste / Einfg | markieren (Einfg geht danach eine Zeile weiter), Esc hebt alle Markierungen auf |
| **F5** | links: die markierten Lernthemen, Books, Bereiche oder Abschnitte als Verweis ins Ziel. Rechts: markierten Plan als Teilplan einbinden oder als Kopie in einen Ordner |
| **F6** | rechts: Markiertes verschieben – Ziel aus einer Liste wählen |
| **F7** / **⇧F7** | neu: außerhalb eines Plans Ordner / Plan, im Plan Bereich / Abschnitt |
| **F8** / Entf | rechts: entfernen (mit Rückfrage) |
| **F2** | umbenennen |
| **F3** | Plan ansehen, wie eine Klasse ihn bekommt: Teilpläne eingesetzt, jedes Lernthema einmal |
| Alt+↑ / Alt+↓ | rechts: eine Stelle nach oben / unten |
| Strg+F | in der Spalte suchen |

Mit der Maus: Klick setzt den Cursor, Strg+Klick markiert einzeln, Umschalt+Klick einen Bereich,
Doppelklick klappt auf. Ziehen von links nach rechts legt Verweise an, Ziehen innerhalb der rechten Spalte
verschiebt. Rechtsklick öffnet ein Menü mit denselben Befehlen.

## Ganze Bereiche aus dem Notizbuch

Ein Book, Bereich oder Abschnitt kommt mit **F5** als Baum: Bereiche, Abschnitte und Lernthemen wie im
Notizbuch. Er trägt **🌱** und **wächst mit**: Was du später im Notizbuch dort anlegst, kommt beim nächsten
Öffnen der Planung dazu. Was du im Plan entfernst, kommt nicht von selbst wieder. Im Plan kannst du danach
frei umordnen. Ins Ziel „Abschnitt“ kommen nur die Lernthemen, ohne Bereiche.

## Klassen folgen ihrem Plan

**📒 Klassen zuweisen** (Knopf oder Rechtsklick auf einen Plan) wählt die Klassen, deren Klassennotizbuch dem
Plan folgt. Am Plan stehen danach ihre Namen, z. B. „📒 10a, 10b“. Im **📒 Klassennotizbuch** steht oben
„🗂 Plan: …“; dort lässt er sich auch zuweisen, wechseln oder lösen.

- Beim Zuweisen kommt der ganze Plan **eingeschaltet** ins Klassennotizbuch: seine Bereiche und Abschnitte,
  Teilpläne als Bereich, je Lernthema ein Eintrag. Was die Klasse schon hat, bleibt, wie es ist, und kommt
  nicht doppelt.
- **Neues im Plan** kommt beim nächsten Öffnen des Klassennotizbuchs dazu, **ausgeschaltet** (○). Du
  schaltest es ein, wenn die Klasse so weit ist.
- **Abweichen geht:** Im Klassennotizbuch kannst du wie gewohnt umordnen, ausschalten, entfernen oder
  eigene Lernthemen ergänzen. Was du dort entfernst, kommt nicht von selbst wieder. Was du aus dem Plan
  entfernst, bleibt in Klassen, die es schon haben.
- Eine Klasse folgt höchstens einem Plan. Ein anderer Plan ergänzt, was noch fehlt; der Inhalt des alten
  bleibt. Ohne Plan (oder wenn der Plan gelöscht ist) bleibt der Inhalt stehen und wächst nicht mehr mit.
- Im neuen Schuljahr weist du der Folgeklasse denselben Plan wieder zu.
- Gesperrte Lernthemen (🔒 nicht freigegeben) kommen, sobald du sie freigibst; die Meldung nennt sie.

## Entfernen

Entfernen wirkt nur in der Planung, im Notizbuch bleibt alles. Aus einem gelöschten Ordner, Bereich oder
Abschnitt rückt der Inhalt eine Ebene höher. Ein gelöschter Plan geht mit seinem Inhalt; steckt er als
Teilplan in anderen Plänen, warnt die Rückfrage und er fällt dort weg. Folgen ihm Klassen, nennt die
Rückfrage sie; ihr Klassennotizbuch bleibt, wie es ist. Ein im Notizbuch gelöschtes
Lernthema verschwindet auch aus den Plänen.

## Technik

- Server: `src/plans` (Regeln in `plan-rules.ts`, Tabellen `plan_nodes`, `plan_entries`).
- Ansicht: `src/renderer/js/views/planning.js`.
