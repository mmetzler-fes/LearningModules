/* Python im Hintergrund (Pyodide) – python-run.js schickt Code, hier läuft er.
 *
 * Eigener Thread, damit eine Endlosschleife die Seite nicht einfriert: ⏹ beendet den Worker.
 * Jedes Dokument hat seinen eigenen Namensraum (`ns`) – alle Blöcke eines Dokuments sehen dieselben
 * Variablen, wie in einem Jupyter-Notebook. input() wartet synchron auf die Antwort: über eine
 * Anfrage, die der Service Worker (py-sw.js) erst beantwortet, wenn die Seite die Eingabe schickt.
 *
 * Nachrichten herein: { type: 'init', base, inputUrl } · { type: 'run', id, ns, code, widgets } · { type: 'reset', ns }
 * hinaus: { type: 'loading' } · { type: 'out', id, text, err } · { type: 'input', id, key, prompt }
 *         · { type: 'widget', id, kind, name, spec } · { type: 'done', id, ok, error }
 *
 * Interaktive Darstellungen: regler(), auswahl() und schalter() melden der Seite ihr Bedienelement
 * (widget) und geben den aktuellen Wert zurück – den schickt die Seite bei jedem Lauf mit (widgets).
 * Dazu das Modul `lm` mit zeiger() für Zeigerdiagramme.
 */
let base = '/vendor/pyodide/';
let inputUrl = null;
let pyodide = null;
let booting = null;
const spaces = new Map();
let current = null;
let inputCount = 0;
let lmRun = null;
let prepareMatplotlib = null;
let matplotlibReady = false;
let setWidgetValues = null;

/** Hilfsmodul für Darstellungen: `from lm import zeiger` (liegt im Dateisystem von Pyodide). */
const LM_MODULE = `
"""Hilfen für Darstellungen in LearningModules."""
import cmath as _cmath


def zeiger(z, start=0, name='', farbe=None, ax=None, breite=0.012, seite=1, **kw):
    \"\"\"Zeichnet einen Zeiger (komplexe Zahl z) ab start (komplex), beschriftet mit name.

    seite=1: Beschriftung links der Pfeilrichtung, seite=-1: rechts davon.
    Gibt das Ende des Zeigers zurück – so lassen sich Zeiger aneinanderhängen:
        e = zeiger(U_R, name='$U_R$'); zeiger(U_L, start=e, name='$U_L$')
    \"\"\"
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
`;

function boot() {
  if (pyodide) return Promise.resolve(pyodide);
  if (!booting) {
    postMessage({ type: 'loading' });
    booting = (async () => {
      // Modul-Worker (Pyodide 314 kennt keine klassischen mehr).
      const { loadPyodide } = await import(`${base}pyodide.mjs`);
      // Agg: Diagramme ohne Fenster – plt.show() schickt sie als Bild in die Ausgabe (_lm_show).
      const py = await loadPyodide({ indexURL: base, env: { MPLBACKEND: 'Agg' } });
      const decoder = { out: new TextDecoder(), err: new TextDecoder() };
      const writer = (err) => ({
        write(buf) {
          const text = decoder[err ? 'err' : 'out'].decode(buf, { stream: true });
          if (text) postMessage({ type: 'out', id: current, text, err });
          return buf.length;
        },
      });
      py.setStdout(writer(false));
      py.setStderr(writer(true));
      self.lmInput = (prompt) => readInput(String(prompt ?? ''));
      self.lmImage = (png, mime) => postMessage({ type: 'image', id: current, png, mime: mime === 'image/svg+xml' ? mime : 'image/png' });
      self.lmWidget = (kind, name, spec) => postMessage({ type: 'widget', id: current, kind, name, spec: JSON.parse(spec) });
      try {
        py.FS.mkdirTree('/home/pyodide');
        py.FS.writeFile('/home/pyodide/lm.py', LM_MODULE);
      } catch (_) { /* ohne Hilfsmodul geht der Rest trotzdem */ }
      const helpers = py.globals.get('dict')();
      py.runPython(`
import builtins, js, sys
def _lm_input(prompt=''):
    sys.stdout.flush()
    answer = js.lmInput(str(prompt))
    if answer is None:
        raise KeyboardInterrupt('Eingabe abgebrochen')
    print(str(prompt) + answer)
    return answer
builtins.input = _lm_input

# Wie in Jupyter: der Wert der letzten Zeile erscheint (außer mit ; am Ende).
from pyodide.code import eval_code_async
async def _lm_run(code, ns):
    result = await eval_code_async(code, ns, filename='<exec>')
    if result is not None:
        print(repr(result))
    _lm_flush_figures()

def _lm_flush_figures():
    plt = sys.modules.get('matplotlib.pyplot')
    if plt is None:
        return
    import io, base64
    sys.stdout.flush()
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        # Beim Abspielen (zeit()) kleiner und schneller – angehalten wieder scharf.
        fig.savefig(buf, format='png', dpi=75 if _lm_values.get('__spielt') else 110, bbox_inches='tight', facecolor='white')
        js.lmImage(base64.b64encode(buf.getvalue()).decode('ascii'))
    plt.close('all')

def _lm_show(*args, **kwargs):
    _lm_flush_figures()

# Bedienelemente für interaktive Darstellungen – Werte schickt die Seite bei jedem Lauf mit.
import json as _json, math as _math
_lm_values = {}
def _lm_set_values(text):
    global _lm_values
    try:
        _lm_values = _json.loads(text or '{}')
    except Exception:
        _lm_values = {}

def regler(name, von, bis, start=None, schritt=None, einheit='', log=False):
    """Schieberegler: gibt den eingestellten Wert zurück (beim ersten Lauf start)."""
    name = str(name)
    von, bis = float(von), float(bis)
    if bis < von:
        von, bis = bis, von
    if log and von <= 0:
        raise ValueError('regler(..., log=True) braucht einen Anfangswert größer als 0.')
    start = von if start is None else float(start)
    ganz = all(float(x).is_integer() for x in (von, bis, start)) and (schritt is None or float(schritt).is_integer()) and not log
    if schritt is None:
        schritt = 1 if ganz and bis - von <= 200 else (bis - von) / 100
    wert = _lm_values.get(name, start)
    try:
        wert = min(bis, max(von, float(wert)))
    except (TypeError, ValueError):
        wert = start
    js.lmWidget('regler', name, _json.dumps({'min': von, 'max': bis, 'step': float(schritt), 'value': wert,
                                              'unit': str(einheit or ''), 'log': bool(log), 'start': start}))
    return int(round(wert)) if ganz and float(schritt).is_integer() else wert

def auswahl(name, optionen, start=None):
    """Auswahlliste: optionen als Liste oder {Beschriftung: Wert}; gibt den gewählten Wert zurück."""
    name = str(name)
    if isinstance(optionen, dict):
        texte, werte = [str(k) for k in optionen.keys()], list(optionen.values())
    else:
        werte = list(optionen)
        texte = [str(w) for w in werte]
    if not werte:
        raise ValueError('auswahl() braucht mindestens eine Option.')
    erst = 0
    if start is not None:
        erst = werte.index(start) if start in werte else (texte.index(str(start)) if str(start) in texte else 0)
    nr = _lm_values.get(name, erst)
    nr = nr if isinstance(nr, int) and 0 <= nr < len(werte) else erst
    js.lmWidget('auswahl', name, _json.dumps({'options': texte, 'value': nr, 'start': erst}))
    return werte[nr]

def schalter(name, start=False):
    """Kästchen zum An-/Ausschalten: gibt True oder False zurück."""
    name = str(name)
    wert = bool(_lm_values.get(name, bool(start)))
    js.lmWidget('schalter', name, _json.dumps({'value': wert, 'start': bool(start)}))
    return wert

def zeit(name='Zeit t', von=0, bis=1, start=None, schritt=None, einheit='s', zeitlupe=10):
    """Zeitregler mit ▶ Abspielen: läuft in Zeitlupe (zeitlupe=10: zehnmal langsamer als echt)
    oder wird mit Maus/Stift an jede Stelle gezogen. Gibt die eingestellte Zeit zurück."""
    name = str(name)
    von, bis = float(von), float(bis)
    if bis < von:
        von, bis = bis, von
    start = von if start is None else float(start)
    schritt = (bis - von) / 1000 if schritt is None else float(schritt)
    wert = _lm_values.get(name, start)
    try:
        wert = min(bis, max(von, float(wert)))
    except (TypeError, ValueError):
        wert = start
    js.lmWidget('zeit', name, _json.dumps({'min': von, 'max': bis, 'step': schritt, 'value': wert,
                                            'unit': str(einheit or ''), 'slow': float(zeitlupe or 1), 'start': start}))
    return wert

def bild(fig, dpi=None, eng=True):
    """Ein Bild ausgeben, ohne es zu schließen – für Darstellungen, die beim Abspielen nur
    Teile ändern (fig einmal bauen, je Lauf set_data … und bild(fig)). Viel schneller als neu zeichnen."""
    import io, base64
    sys.stdout.flush()
    buf = io.BytesIO()
    if dpi is None:
        dpi = 75 if _lm_values.get('__spielt') else 110
    fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight' if eng else None, facecolor='white')
    js.lmImage(base64.b64encode(buf.getvalue()).decode('ascii'))

def svg(text):
    """SVG-Bild ausgeben – auch mit Bewegung (SMIL, z. B. <animateTransform>), die der Browser selbst
    flüssig abspielt. Es erscheint als Bild: Skripte und Links darin laufen nicht."""
    import base64
    sys.stdout.flush()
    js.lmImage(base64.b64encode(str(text).encode('utf-8')).decode('ascii'), 'image/svg+xml')

def spielt():
    """True, solange ein zeit()-Regler abspielt – z. B. um dann weniger zu zeichnen."""
    return bool(_lm_values.get('__spielt'))

builtins.regler, builtins.auswahl, builtins.schalter = regler, auswahl, schalter
builtins.zeit, builtins.spielt, builtins.bild, builtins.svg = zeit, spielt, bild, svg
builtins.slider, builtins.dropdown, builtins.checkbox = regler, auswahl, schalter
if '/home/pyodide' not in sys.path:
    sys.path.insert(0, '/home/pyodide')

def _lm_prepare_matplotlib():
    import matplotlib
    matplotlib.use('Agg')
    # matplotlib 3.10 im Pyodide-Build meldet bei jeder Formel ($U_L$) intern
    # „The width parameter as float was deprecated…“, obwohl es int übergibt –
    # für Lernende nur Lärm unter dem Diagramm.
    import warnings
    warnings.filterwarnings('ignore', message=r'The \\w+ parameter as float was deprecated',
                            category=matplotlib.MatplotlibDeprecationWarning)
    import matplotlib.pyplot as plt
    plt.show = _lm_show
`, { globals: helpers, filename: '<lm-helfer>' });
      lmRun = helpers.get('_lm_run');
      prepareMatplotlib = helpers.get('_lm_prepare_matplotlib');
      setWidgetValues = helpers.get('_lm_set_values');
      pyodide = py;
      return py;
    })();
  }
  return booting;
}

/** Wartet (synchron) auf die Eingabe aus der Seite. */
function readInput(prompt) {
  if (!inputUrl) {
    throw new Error('input() geht hier nicht: Der Browser erlaubt die Eingabe nur über eine sichere Verbindung (https). Setze den Wert im Code, z. B. name = "Ada".');
  }
  const key = `${current}:${++inputCount}`;
  postMessage({ type: 'input', id: current, key, prompt });
  const xhr = new XMLHttpRequest();
  xhr.open('GET', `${inputUrl}?key=${encodeURIComponent(key)}`, false);
  xhr.send(null);
  if (xhr.status !== 200) throw new Error('Die Eingabe ist nicht angekommen.');
  // Abbruch: die Seite schickt "\u0000".
  return xhr.responseText === '\u0000' ? null : xhr.responseText;
}

/** Nur die Zeilen, die den Code der Schüler betreffen – nicht Pyodides eigene Aufrufe. */
function shortError(message) {
  const lines = String(message || '').split('\n');
  const first = lines.findIndex((l) => l.includes('File "<exec>"'));
  if (first < 0) return lines.filter((l) => l.trim()).slice(-3).join('\n');
  return ['Traceback (most recent call last):', ...lines.slice(first)].join('\n').trim();
}

onmessage = async (e) => {
  const m = e.data || {};
  if (m.type === 'init') {
    base = m.base || base;
    inputUrl = m.inputUrl || null;
    return;
  }
  if (m.type === 'reset') {
    const ns = spaces.get(m.ns);
    if (ns) { ns.destroy?.(); spaces.delete(m.ns); }
    return;
  }
  if (m.type !== 'run') return;
  current = m.id;
  try {
    const py = await boot();
    let ns = spaces.get(m.ns);
    if (!ns) {
      ns = py.globals.get('dict')();
      ns.set('__name__', '__main__');
      spaces.set(m.ns, ns);
    }
    // Pakete aus den import-Zeilen (numpy, matplotlib …) vom eigenen Server nachladen.
    const before = new Set(Object.keys(py.loadedPackages));
    await py.loadPackagesFromImports(m.code, {
      messageCallback: (msg) => { if (/^Loading /.test(msg)) postMessage({ type: 'status', id: m.id, text: `Lade ${msg.replace(/^Loading /, '')} …` }); },
      errorCallback: () => {},
    });
    const added = Object.keys(py.loadedPackages).filter((p) => !before.has(p));
    if (added.length) postMessage({ type: 'status', id: m.id, text: '' });
    if (!matplotlibReady && py.loadedPackages.matplotlib) {
      prepareMatplotlib();
      matplotlibReady = true;
    }
    setWidgetValues(JSON.stringify(m.widgets || {}));
    await lmRun(m.code, ns);
    postMessage({ type: 'done', id: m.id, ok: true });
  } catch (err) {
    postMessage({ type: 'done', id: m.id, ok: false, error: shortError(err?.message || String(err)) });
  }
};
