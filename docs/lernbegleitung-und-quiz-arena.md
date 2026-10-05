# Lernbegleitung und Quiz-Arena

Zwei weitere Modi für [Schülerfreigaben](themen-links.md). Beide werden im
Formular der Freigabe angehakt wie Quiz oder Klassenarbeit.

## 🦉 Lernbegleitung

Eine Lerneule begleitet den Schüler durch die Aufgaben. Statt „Weiter“ gibt
es **🦉 Prüfen**, so oft der Schüler will. Die Eule kommentiert jeden Versuch,
und ihr Ton ändert sich mit der Zahl der Fehlversuche:

| Lage | Beispiel |
|---|---|
| Richtig beim ersten Versuch | „Bravo!“, „Genial!“ |
| Richtig nach Fehlversuchen | „Na also – dranbleiben lohnt sich!“ |
| Teilweise richtig | „Fast! Ein Teil stimmt schon.“ |
| 1. Fehlversuch | „Denk noch mal drüber nach.“ |
| 2. Fehlversuch | „Lies die Aufgabe genau durch.“ |
| 3. und weitere | „Raten gilt nicht!“ |

Die eingebauten Prüfknöpfe der Aufgaben sind in diesem Modus ausgeblendet,
sonst ließe sich die Eule umgehen. Zurückblättern gibt es nicht.

### Lernpunkte

Punkte gibt es nur für eine **richtig gelöste** Aufgabe, und zwar umso
weniger, je mehr Versuche es gebraucht hat:

| Versuch | Lernpunkte |
|---|---|
| 1. | 10 |
| 2. | 6 |
| 3. | 3 |
| ab 4. | 1 |

Wer ohne Lösung weitergeht oder den Joker spielt, bekommt für die Aufgabe 0.
In der Ergebnisliste erscheint der Durchlauf als „🦉 Lernbegleitung“ mit
Lernpunkten (z. B. 36/50) und je Aufgabe der Zahl der Versuche.

### Zeitstrafe

Ab dem **dritten Fehlversuch** folgt eine Denkpause: Die Aufgabe ist
gedimmt, der Prüfknopf zählt herunter. Sie beginnt bei 30 s und wächst mit
jedem weiteren Fehlversuch um denselben Betrag bis höchstens 120 s
(30 → 60 → 90 → 120). Beides ist einstellbar; 0 schaltet die Strafe ab.
Mit der nächsten Aufgabe beginnt die Zählung von vorn.

### Joker

Ab dem zweiten Fehlversuch kann zufällig ein Joker auftauchen, mit jedem
weiteren Fehler wahrscheinlicher (30 %, 60 %, dann 80 %). Wer ihn spielt,
sieht die Musterlösung; Punkte gibt es dafür keine. Wie viele Joker es je
Durchlauf höchstens gibt, ist einstellbar (Standard 2).

### Aufgaben ohne automatische Bewertung

Freitext, Audio-Aufnahme und ähnliche Aufgaben werden abgegeben, die Eule
zeigt einen Daumen hoch. Sie zählen nicht zu den Lernpunkten. Am besten
nimmt man solche Aufgaben gar nicht in eine Freigabe mit Lernbegleitung.

## 🦉 Lernbegleiter einstellen

Menüpunkt **🦉 Lernbegleiter**. Es gilt die Reihenfolge

> Grundausstattung → Schule → Lehrkraft → Freigabe

| Was | Schuladmin | Lehrkraft | Freigabe |
|---|---|---|---|
| Kommentare | ergänzt für alle | ergänzt für sich | – |
| Joker je Durchlauf | Vorgabe | überschreibt | überschreibt |
| Zeitstrafe (Start, Maximum) | Vorgabe | überschreibt | überschreibt |
| Tusch (Quiz-Arena) | Vorgabe | überschreibt | – |

Kommentare werden zusammengelegt, die Grundausstattung bleibt immer dabei.
Eigene Kommentare stehen einer pro Zeile im Feld der jeweiligen Lage.

Der Schuladmin sieht unter **👥 Ergänzungen der Kolleginnen und Kollegen**
alle Kommentare, die Lehrkräfte seiner Schule für sich angelegt haben. Mit ➕
übernimmt er einen Kommentar in die Schulvorgaben – dann haben alle etwas
davon.

## 🏆 Quiz-Arena

Wie Kahoot, aber mit den eigenen Aufgaben.

### Ablauf

1. In der Freigabe **🏆 Quiz-Arena** anhaken, Höchstpunktzahl und Zeit je
   Aufgabe festlegen. Unter *Zeit für einzelne Aufgaben anpassen* bekommt
   jede Aufgabe bei Bedarf eine eigene Zeit – ein Drag & Drop braucht länger
   als eine Wahr/Falsch-Frage.
2. Auf der Karte der Freigabe **🏆 Quiz-Arena** wählen. Der Dialog zeigt:
   - den **Leitungs-Link** – öffnet den Wartebereich, z. B. am Beamer.
     Als *Startdatei* gespeichert, genügt später ein Doppelklick.
   - den **Schüler-Link** mit QR-Code, ebenfalls als Datei speicherbar.
3. Im Wartebereich steht der QR-Code groß. Schüler scannen, geben ihren Namen
   ein und erscheinen sofort in der Liste. Unpassende Namen entfernt die
   Lehrkraft mit ✕.
4. **▶️ Quiz-Arena starten.** Alle bekommen dieselbe Aufgabe gleichzeitig auf
   ihr Gerät; am Beamer stehen die Aufgabe, der Countdown und wie viele schon
   geantwortet haben.
5. Ist die Zeit um oder haben alle geantwortet, folgt die **Auswertung**:
   Lösung, wie viele richtig lagen, und die Top 10. Mit **Weiter →** geht es
   zur nächsten Aufgabe.
6. Nach der letzten Aufgabe: **🏆 Zur Siegerehrung** – Siegertreppchen mit
   den ersten drei Plätzen und Tusch.

### Zeit je Aufgabe aus den Übungsdurchläufen

Für jede Aufgabe gilt die erste passende Zeit:

1. die eigene Zeit der Lehrkraft unter *Zeit für einzelne Aufgaben anpassen*,
2. die **gemessene Zeit** (⏱), sobald mindestens drei Messungen vorliegen,
3. sonst die *Zeit je Aufgabe* der Freigabe (Vorgabe 30 s).

Gemessen wird in **Quiz** und **Lernbegleitung** über Schülerfreigaben und
Quick-Links: die Zeit von der Anzeige einer Aufgabe bis zur ersten Antwort –
*Weiter* im Quiz, der erste *Prüfen*-Klick in der Lernbegleitung. Bei
Wahr/Falsch mit mehreren Fragen je Frage, wie in der Arena. Die Uhr steht,
solange die Seite im Hintergrund ist; wer zurückblättert, ändert eine schon
beantwortete Aufgabe nicht. Unter ½ s gilt als Durchklicken und zählt
nicht, eine einzelne Messung zählt höchstens 600 s.

Die gemessene Zeit ist **Median + 3 × Streuung um den Median** (MAD, mit
1,4826 auf eine Standardabweichung umgerechnet), auf 5 s aufgerundet,
zwischen 5 und 600 s. Das ist die robuste Form von „Mittelwert + 3 ×
Standardabweichung“: Bei 10, 12 und 14 s kommen 25 s heraus – und ein
einzelner Schüler mit 100 s ändert daran nichts (Mittelwert + 3σ ergäbe
170 s). Sie stammt aus allen Durchläufen mit
dieser Aufgabe, auch bei anderen Lehrkräften – gespeichert sind nur Modul
und Millisekunden, keine Namen. Im Editor steht sie als Platzhalter mit
„⏱ gemessen (n×)“; die Arena liest sie beim Öffnen des Wartebereichs.

Wer zu spät kommt, steigt bei der laufenden Aufgabe ein. Lädt ein Schüler
die Seite neu, behält er seinen Platz und seine Punkte. **🔁 Neuer
Durchgang** startet mit denselben Teilnehmern wieder bei 0.

### Punkte

```
Punkte = Richtigkeit² × Zeitfaktor × Höchstpunktzahl
Zeitfaktor = 1 − ½ × (benötigte Zeit / Zeitlimit)
```

Richtigkeit läuft von 0 bis 1 (Teilpunkte wie im Quiz). Der Zeitfaktor
fällt wie bei Kahoot von 1 (sofort) auf ½ (bei Ablauf). Wer spät, aber
richtig antwortet, bekommt also noch die Hälfte; eine falsche Antwort bringt
nichts, egal wie schnell. Die Zeit misst der Server.

Eine halb richtige Antwort nach der Hälfte der Zeit bei 1000 Punkten:
0,5² × 0,75 × 1000 = 188 Punkte.

Nur automatisch bewertbare Aufgaben kommen vor. Freitext, Aufnahmen und
Informationsseiten überspringt die Quiz-Arena.

Ein Wahr/Falsch-Modul mit mehreren Fragen wird in einzelne Runden zerlegt –
jede Frage hat ihren eigenen Countdown und ihre eigene Auswertung. Ist im
Modul *Fragen zufällig mischen* angehakt, kommen sie gemischt (für alle
Spieler in derselben Reihenfolge). Eine eigene Zeit für das Modul gilt je
Frage. Genauso läuft es in Quiz, Lernbegleitung und Klassenarbeit: Jede
Frage ist ein eigener Schritt mit Weiter bzw. Prüfen; im Editor bleibt es
ein Modul.

### Tusch

Standard ist eine eingebaute Fanfare, die der Browser selbst erzeugt – ohne
Datei und ohne Lizenzfrage. Ein eigener Tusch ist ein Nextcloud-Freigabelink
auf eine Audiodatei (mp3, ogg, wav, m4a), eingetragen unter
**🦉 Lernbegleiter**: vom Schuladmin für die ganze Schule, von jeder
Lehrkraft für sich. Mit 🔊/🔇 in der Quiz-Arena lässt er sich abschalten, in der
Freigabe auch ganz.

### Ergebnisse

Mit der Siegerehrung landet für jeden Teilnehmer ein Eintrag in der
Ergebnisliste („🏆 Quiz-Arena“), mit Platz, Punkten und je Aufgabe
Richtigkeit und Antwortzeit.

### Grenzen

- Eine laufende Quiz-Arena lebt im Arbeitsspeicher des Servers. Startet der
  Server neu, ist er weg; die Lehrkraft öffnet den Wartebereich einfach neu.
  Gespeichert wird erst das Endergebnis.
- Ausgelegt für eine Klasse; mehr als 100 Teilnehmer nimmt eine Quiz-Arena
  nicht auf.
- Die Richtigkeit bewertet – wie im Quiz – der Browser des Schülers. Wer
  sich gut auskennt, könnte das manipulieren. Für den Unterricht reicht es.
- Hinter einem Reverse Proxy (nginx) muss die Pufferung für die
  Ereignisströme aus sein. Der Server sendet dafür `X-Accel-Buffering: no`.

## Technik

| Endpunkt | Zweck |
|---|---|
| `GET /api/companion` | Lernbegleiter: Grundausstattung, Schule, eigene Ergänzungen |
| `PUT /api/companion/mine` | Eigene Ergänzungen speichern |
| `PUT /api/companion/school` | Schulvorgaben (nur Schuladmin) |
| `GET /api/companion/school/colleagues` | Ergänzungen der Lehrkräfte (nur Schuladmin) |
| `POST /api/links/:id/contest-share` | Leitungs- und Schüler-Link, `{regenerate:true}` erneuert den Leitungs-Link |
| `POST /api/public/contest/host/:hostToken/open` | Wartebereich öffnen bzw. laufende Quiz-Arena aufnehmen |
| `GET /api/public/contest/host/:hostToken/events` | Ereignisse für die Leitung (SSE) |
| `POST /api/public/contest/host/:hostToken/{start,next,kick,reset,close}` | Steuerung |
| `POST /api/public/contest/:token/join` | Beitreten (oder mit `playerId`/`secret` wieder aufnehmen) |
| `GET /api/public/contest/:token/events?pid=…&sec=…` | Ereignisse für Schüler (SSE) |
| `POST /api/public/contest/:token/answer` | Antwort abgeben |

Code: `src/companion/`, `src/contest/`; im Browser `views/companion-run.js`,
`views/companion-settings.js`, `views/contest.js` und `answer-eval.js` (die
gemeinsame Auswertung aller Aufgabentypen für Quiz, Lernbegleitung und
Quiz-Arena).
