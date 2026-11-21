# ⏱ Zeitsimulation in Python-Darstellungen

Für Abläufe in der Zeit (Motoranlauf, Ein- und Ausschalten an RC/RL, Regelkreise, Schrittketten …) gibt es
im Modul `lm` eine feste Schnittstelle: **`Zeitsimulation`**. Sie übernimmt alles, was für jede Simulation
gleich ist. Das Arbeitsblatt enthält nur noch das Modell und die Darstellung. Ändert sich das Modell, bleibt
die App unverändert.

Die Schnittstelle hat eine Versionsnummer (`Zeitsimulation.VERSION`, jetzt 1). Neue Möglichkeiten kommen als
zusätzliche, wahlweise Angaben dazu; bestehende Blätter laufen weiter.

## Was sie übernimmt

- **Zeitregler** mit ▶ Abspielen, ⏸ Anhalten, ⏹ zurück an den Anfang, Zeitlupe (Echtzeit … 1 : 100) und Ziehen mit Maus oder Stift
- **Einmal rechnen** je Einstellung (`rechne`) – beim Abspielen und Ziehen wird nur nachgeführt
- **Figur einmal bauen** je Einstellung (`figur`) – je Bild ändern sich nur Linienenden, Punkte und Texte (schnell)
- **Drehzeiger** (`drehzeiger`), die mit der Simulationszeit drehen: beim Abspielen flüssig im Zeitlupentempo
  (der Browser spielt die Zwischenschritte ab), angehalten stehen sie
- Neu gerechnet wird automatisch, wenn sich der Code ändert (z. B. ein Modellwert)

## Gerüst

```python
import numpy as np
from lm import Zeitsimulation

art = auswahl('Verfahren', ['A', 'B'])                     # Einstellungen wie gewohnt
sim = Zeitsimulation('Zeit t', dauer=4.0, zeitlupe=20, max_umlauf=25)

def simuliere(art):                                        # Modell: Zeitachse und Verläufe
    t = np.linspace(0, 4.0, 4001)
    return {'t': t, 'n': ..., 'winkel': ...}

def baue(fig, d):                                          # Figur einmal je Einstellung
    ax = fig.add_subplot(1, 2, 1)
    ax.plot(d['t'], d['n'], alpha=0.2)                     # ganzer Verlauf blass
    linie, = ax.plot([], [])                               # bis t kräftig
    zeit = ax.axvline(0)
    motor = fig.add_subplot(1, 2, 2, aspect='equal')
    return {'linie': linie, 'zeit': zeit, 'motor': motor}

d = sim.rechne(simuliere, art)
fig, teile = sim.figur(baue, d, groesse=(12, 6))
j = sim.index(d['t'])                                      # Index der eingestellten Zeit sim.t
teile['linie'].set_data(d['t'][:j + 1], d['n'][:j + 1])
teile['zeit'].set_xdata([sim.t, sim.t])
sim.drehzeiger(teile['motor'], d['t'], d['winkel'], farbe='#dc2626', laenge=0.6)
sim.zeige(fig)
```

## Bausteine

| Aufruf | Bedeutung |
|---|---|
| `Zeitsimulation(name, dauer, zeitlupe=10, einheit='s', start=0, max_umlauf=0)` | Zeitregler anlegen. `zeitlupe`: Vorgabe für das Tempo. `max_umlauf`: schnellste Drehung in der Simulation (Umdrehungen je Sekunde) – wäre sie im gewählten Tempo nicht mehr zu verfolgen, drehen alle Zeiger zusätzlich langsamer. |
| `sim.t` | eingestellte Zeit |
| `sim.spielt`, `sim.zeitlupe` | läuft gerade ▶? gewähltes Tempo (20 = 20-mal langsamer) |
| `sim.rechne(funktion, *werte)` | `funktion(*werte)`, je Einstellung und Codefassung gemerkt |
| `sim.figur(baue, daten, groesse=(12, 7))` | `baue(fig, daten)` einmal je Datensatz; gibt `(fig, teile)` |
| `sim.index(zeiten)` | Index in `zeiten`, der `sim.t` am nächsten liegt |
| `sim.drehzeiger(ax, zeiten, winkel, farbe, laenge, rueck=0, mitte=(0, 0), breite=0.06, gestrichelt=False, spitze=True)` | Zeiger in den Achsen `ax`; `winkel` in Grad (0° = rechts, gegen den Uhrzeigersinn) über `zeiten`; Länge und Mitte in Datenkoordinaten (Achsen mit `aspect='equal'`) |
| `sim.hinweis` | Satz zum Tempo der Zeiger, z. B. für eine Bildunterschrift |
| `sim.zeige(fig)` | Ausgabe: Figur als Bild, Drehzeiger darüber |

## Beispiel

Das Arbeitsblatt „Anlaufverfahren des Drehstrom-Asynchronmotors“ (DASM, Lernthema „Anlaufverfahren –
Überblick, Simulation und Rechnen“): Raumzeigermodell des Motors, vier Diagramme, Motorbild mit Drehfeld-
und Läuferzeiger.

## Darunter (für Sonderfälle)

`zeit()`, `spielt()`, `zeitlupe()`, `bild(fig)` und `svg(text)` stehen im Code auch einzeln zur Verfügung.
`Zeitsimulation` baut auf ihnen auf; für neue Simulationen genügt sie.
