"""Hilfen für Darstellungen in LearningModules (Python im Browser, Pyodide).

Liegt beim Start im Dateisystem von Pyodide (py-worker.js) und wird mit ``from lm import …`` geholt:

- ``zeiger``, ``polar``, ``grad`` – Zeigerdiagramme mit komplexen Zahlen
- ``Zeitsimulation`` – feste Schnittstelle für Abläufe in der Zeit (Anlauf, Schaltvorgänge, Regelkreise …):
  Zeitregler mit ▶ ⏸ ⏹ und Zeitlupe, Rechnung je Einstellung nur einmal, Bild nur nachführen,
  Drehzeiger, die flüssig mit der Simulationszeit drehen. Beschreibung: docs/python-zeitsimulation.md.

Die Schnittstelle von ``Zeitsimulation`` bleibt stabil (``Zeitsimulation.VERSION``); Arbeitsblätter
ändern nur ihr Modell, nicht diese Datei.
"""
import builtins as _builtins
import cmath as _cmath
import math as _math
import sys as _sys


def zeiger(z, start=0, name='', farbe=None, ax=None, breite=0.012, seite=1, **kw):
    """Zeichnet einen Zeiger (komplexe Zahl z) ab start (komplex), beschriftet mit name.

    seite=1: Beschriftung links der Pfeilrichtung, seite=-1: rechts davon.
    Gibt das Ende des Zeigers zurück – so lassen sich Zeiger aneinanderhängen:
        e = zeiger(U_R, name='$U_R$'); zeiger(U_L, start=e, name='$U_L$')
    """
    import matplotlib.pyplot as plt
    ax = ax or plt.gca()
    if ax.get_aspect() == 'auto' and not getattr(ax, '_lm_zeiger', False):
        ax.set_aspect('equal', adjustable='box')   # Winkel stimmen nur bei gleichem Maßstab
    ax._lm_zeiger = True
    z, start = complex(z), complex(start)
    pfeil = ax.quiver(start.real, start.imag, z.real, z.imag, angles='xy', scale_units='xy', scale=1,
                      color=farbe, width=breite, **kw)
    ende = start + z
    if name and abs(z) > 0:
        mitte = start + z * 0.5
        quer = z / abs(z) * 1j * (1 if seite >= 0 else -1)
        ax.annotate(name, (mitte.real, mitte.imag), xytext=(quer.real * 13, quer.imag * 13),
                    textcoords='offset points', ha='center', va='center', fontsize=12,
                    color=farbe if farbe is not None else pfeil.get_facecolor()[0])
    # Grenzen mitwachsen lassen (quiver tut das nicht von selbst)
    ax.update_datalim([(start.real, start.imag), (ende.real, ende.imag)])
    ax.autoscale_view()
    return ende


def polar(betrag, winkel_grad):
    """Komplexe Zahl aus Betrag und Winkel in Grad."""
    return _cmath.rect(betrag, _cmath.pi * winkel_grad / 180)


def grad(z):
    """Winkel einer komplexen Zahl in Grad."""
    return _cmath.phase(complex(z)) * 180 / _cmath.pi


# ---------------------------------------------------------------------------------------------------
# Zeitsimulation
# ---------------------------------------------------------------------------------------------------

def _hilfe(name, ersatz):
    """Bedienelemente und Ausgaben der App (py-worker.js) – außerhalb der App ein einfacher Ersatz."""
    return getattr(_builtins, name, ersatz)


class _Drehzeiger:
    __slots__ = ('ax', 'zeiten', 'winkel', 'mitte', 'laenge', 'rueck', 'farbe', 'breite', 'gestrichelt', 'spitze')

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


class Zeitsimulation:
    """Ablauf in der Zeit mit Zeitregler (▶ ⏸ ⏹, Zeitlupe) – gleiche Schnittstelle für alle Simulationen.

    Ablauf im Code eines Blocks (der Block läuft bei jeder Änderung und beim Abspielen je Bild neu)::

        from lm import Zeitsimulation
        art = auswahl('Anlauf', ['Direkt', 'Stern-Dreieck'])        # Einstellungen wie gewohnt
        sim = Zeitsimulation('Zeit t', dauer=4.0, zeitlupe=20, max_umlauf=25)
        daten = sim.rechne(simuliere, art)       # simuliere(art) -> {'t': [...], ...}; je Einstellung einmal
        fig, teile = sim.figur(baue, daten)      # baue(fig, daten) -> teile; Figur je Einstellung einmal
        j = sim.index(daten['t'])                # Index der eingestellten Zeit sim.t
        ...                                      # nur Zeitabhängiges nachführen (set_data, set_text …)
        sim.drehzeiger(ax, daten['t'], daten['winkel'], farbe='#dc2626', laenge=0.6)
        sim.zeige(fig)

    - ``rechne`` und ``figur`` merken sich ihr Ergebnis je Einstellung und je Fassung des Codes:
      Ändert sich der Code (z. B. ein Modellwert), wird neu gerechnet.
    - ``drehzeiger``: Winkel in Grad (0° = rechts, gegen den Uhrzeigersinn) über der Zeitachse. Der Zeiger
      steht auf dem Winkel zur Zeit t; beim Abspielen dreht er flüssig mit der Simulationszeit im
      gewählten Zeitlupentempo, angehalten steht er. ``max_umlauf`` (Umdrehungen je Sekunde in der
      Simulation): Dreht etwas so schnell, dass es im Tempo nicht mehr zu erkennen wäre, laufen alle
      Zeiger zusätzlich langsamer (``sim.verlangsamung``); ``sim.hinweis`` sagt es in einem Satz.
    """

    VERSION = 1
    HORIZONT = 1.5          # so viele Sekunden (echte Zeit) Zwischenschritte bekommt jedes Bild
    MAX_UMLAUF_SICHTBAR = 1.5  # Umdrehungen je echter Sekunde, die man noch gut verfolgen kann
    _MERKEN = 8              # gemerkte Einstellungen je Block

    def __init__(self, name='Zeit t', dauer=1.0, zeitlupe=10, einheit='s', start=0.0, max_umlauf=0.0):
        self.name = str(name)
        self.dauer = float(dauer)
        zeit = _hilfe('zeit', lambda n, von, bis, start=None, **k: von if start is None else start)
        self.t = float(zeit(self.name, 0.0, self.dauer, start, einheit=einheit, zeitlupe=zeitlupe))
        self.spielt = bool(_hilfe('spielt', lambda: False)())
        self.zeitlupe = float(_hilfe('zeitlupe', lambda: float(zeitlupe))())
        self.verlangsamung = max(1.0, float(max_umlauf or 0) / self.zeitlupe / self.MAX_UMLAUF_SICHTBAR)
        self._zeiger = []
        # Gemerktes liegt im Namensraum des Dokuments (nicht im Modul) – getrennt je Dokument.
        g = _sys._getframe(1).f_globals
        self._speicher = g.setdefault('_lm_zeitsimulation', {})
        self._fassung = g.get('__lm_fassung__', None)

    # ---- Text für die Darstellung ----

    @property
    def hinweis(self):
        text = f'Zeiger drehen mit der Simulationszeit (Zeitlupe 1 : {self.zeitlupe:g}'
        if self.verlangsamung > 1:
            text += f', Zeiger zusätzlich {self.verlangsamung:.0f}-fach langsamer'
        return text + ')'

    # ---- Rechnen und Figur nur einmal je Einstellung ----

    def _merke(self, art, schluessel, erzeuge):
        fach = self._speicher.setdefault(art, {})
        key = (self._fassung, schluessel)
        if key not in fach:
            while len(fach) >= self._MERKEN:
                fach.pop(next(iter(fach)))
            fach[key] = erzeuge()
        return fach[key]

    def rechne(self, funktion, *argumente, **schluesselwerte):
        """funktion(*argumente, **schluesselwerte) – Ergebnis je Einstellung gemerkt."""
        schluessel = (getattr(funktion, '__name__', ''), argumente, tuple(sorted(schluesselwerte.items())))
        return self._merke('daten', schluessel, lambda: funktion(*argumente, **schluesselwerte))

    def figur(self, baue, daten, groesse=(12, 7)):
        """Figur je Datensatz einmal bauen: baue(fig, daten) -> teile. Gibt (fig, teile) zurück."""
        def neu():
            from matplotlib.figure import Figure
            fig = Figure(figsize=groesse)
            return fig, baue(fig, daten)
        return self._merke('figur', (getattr(baue, '__name__', ''), id(daten)), neu)

    def index(self, zeiten, t=None):
        """Index des Werts in zeiten (aufsteigend), der der Zeit t (Standard: sim.t) am nächsten liegt."""
        import numpy as np
        zeiten = np.asarray(zeiten)
        t = self.t if t is None else t
        i = int(np.searchsorted(zeiten, t))
        if i <= 0:
            return 0
        if i >= len(zeiten):
            return len(zeiten) - 1
        return i if zeiten[i] - t < t - zeiten[i - 1] else i - 1

    # ---- Drehzeiger ----

    def drehzeiger(self, ax, zeiten, winkel, farbe='#dc2626', laenge=0.6, rueck=0.0, mitte=(0.0, 0.0),
                   breite=0.06, gestrichelt=False, spitze=True):
        """Zeiger in den Achsen ax um mitte (Datenkoordinaten), Länge in Datenkoordinaten; rueck: Stück
        über die Mitte hinaus nach hinten. winkel: Grad über zeiten (gleich lang wie zeiten)."""
        self._zeiger.append(_Drehzeiger(ax=ax, zeiten=zeiten, winkel=winkel, mitte=mitte, laenge=float(laenge),
                                        rueck=float(rueck), farbe=farbe, breite=float(breite),
                                        gestrichelt=bool(gestrichelt), spitze=bool(spitze)))

    def _zeiger_svg(self, z, sx, cx, cy, W, H):
        import numpy as np
        zeiten = np.asarray(z.zeiten)
        winkel = np.asarray(z.winkel, dtype=float) / self.verlangsamung
        j = self.index(zeiten)
        anim = ''
        if self.spielt and j < len(zeiten) - 1:
            ende = zeiten[j] + self.HORIZONT / self.zeitlupe
            k = int(np.searchsorted(zeiten, ende))
            k = max(j + 1, min(k, len(zeiten) - 1))
            idx = np.unique(np.linspace(j, k, min(k - j + 1, 121)).round().astype(int))
            spanne = float(zeiten[k] - zeiten[j])
            if spanne > 0:
                werte = ';'.join(f'{winkel[i] - winkel[j]:.2f}' for i in idx)
                zeiten_rel = ';'.join(f'{(zeiten[i] - zeiten[j]) / spanne:.4f}' for i in idx)
                anim = (f'<animateTransform attributeName="transform" type="rotate" values="{werte}" '
                        f'keyTimes="{zeiten_rel}" dur="{spanne * self.zeitlupe:.3f}s" fill="freeze"/>')
        L, r, b = z.laenge, z.rueck, z.breite
        strich = ' stroke-dasharray="{:.3f} {:.3f}"'.format(2.2 * b, 1.4 * b) if z.gestrichelt else ''
        kopf = 3.2 * b if z.spitze else 0.0
        form = f'<line x1="{-r:.3f}" y1="0" x2="{L - kopf * 0.8:.3f}" y2="0" stroke="{z.farbe}" stroke-width="{b:.3f}" stroke-linecap="round"{strich}/>'
        if z.spitze:
            form += f'<path d="M{L:.3f},0 L{L - kopf:.3f},{-kopf * 0.55:.3f} L{L - kopf:.3f},{kopf * 0.55:.3f}Z" fill="{z.farbe}"/>'
        # scale(sx, -sx): y nach oben wie im Diagramm – rotate() dreht dann gegen den Uhrzeigersinn.
        # Die Bewegung (animateTransform) ersetzt das transform ihres <g>, deshalb ein eigenes <g>.
        return (f'<g transform="translate({cx:.1f} {cy:.1f}) scale({sx:.3f} {-sx:.3f})">'
                f'<g transform="rotate({winkel[j] % 360:.2f})"><g>{anim}{form}</g></g></g>')

    # ---- Ausgabe ----

    def zeige(self, fig, dpi=None):
        """Figur ausgeben, darüber die Drehzeiger. Ohne Drehzeiger einfach als Bild."""
        bild = _hilfe('bild', None)
        svg = _hilfe('svg', None)
        if dpi is None:
            dpi = 75 if self.spielt else 110
        if not self._zeiger or svg is None:
            for z in self._zeiger:   # ohne svg(): Zeiger fest ins Bild
                self._zeichne_fest(z)
            if bild is not None:
                bild(fig, dpi=dpi, eng=False)
            else:
                import matplotlib.pyplot as plt
                plt.show()
            return
        import base64
        import io
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=dpi, facecolor='white')
        png = base64.b64encode(buf.getvalue()).decode('ascii')
        W, H = fig.get_size_inches() * dpi
        teile = []
        anteil = fig.transFigure.inverted()      # Bildschirm → Anteil der Figur (unabhängig von dpi)
        for z in self._zeiger:
            (x0, y0), (x1, _) = anteil.transform(z.ax.transData.transform([z.mitte, (z.mitte[0] + 1.0, z.mitte[1])]))
            teile.append(self._zeiger_svg(z, (x1 - x0) * W, x0 * W, (1 - y0) * H, W, H))
        svg(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'viewBox="0 0 {W:.0f} {H:.0f}" width="{W:.0f}" height="{H:.0f}">'
            f'<image width="{W:.0f}" height="{H:.0f}" xlink:href="data:image/png;base64,{png}" href="data:image/png;base64,{png}"/>'
            f'{"".join(teile)}</svg>')

    def _zeichne_fest(self, z):
        import numpy as np
        # Die Figur wird wiederverwendet: Zeiger vom letzten Lauf entfernen.
        if not getattr(z.ax, '_lm_fest_lauf', None) is self:
            for a in getattr(z.ax, '_lm_fest', []):
                a.remove()
            z.ax._lm_fest, z.ax._lm_fest_lauf = [], self
        j = self.index(z.zeiten)
        w = _math.radians(float(np.asarray(z.winkel)[j]) / self.verlangsamung)
        mx, my = z.mitte
        z.ax._lm_fest.append(z.ax.annotate('', xy=(mx + z.laenge * _math.cos(w), my + z.laenge * _math.sin(w)),
                      xytext=(mx - z.rueck * _math.cos(w), my - z.rueck * _math.sin(w)),
                      arrowprops=dict(arrowstyle='-|>' if z.spitze else '-', color=z.farbe, lw=3,
                                      ls='--' if z.gestrichelt else '-', mutation_scale=20)))
