/* Python im Hintergrund (Pyodide) – python-run.js schickt Code, hier läuft er.
 *
 * Eigener Thread, damit eine Endlosschleife die Seite nicht einfriert: ⏹ beendet den Worker.
 * Jedes Dokument hat seinen eigenen Namensraum (`ns`) – alle Blöcke eines Dokuments sehen dieselben
 * Variablen, wie in einem Jupyter-Notebook. input() wartet synchron auf die Antwort: über eine
 * Anfrage, die der Service Worker (py-sw.js) erst beantwortet, wenn die Seite die Eingabe schickt.
 *
 * Nachrichten herein: { type: 'init', base, inputUrl } · { type: 'run', id, ns, code } · { type: 'reset', ns }
 * hinaus: { type: 'loading' } · { type: 'out', id, text, err } · { type: 'input', id, key, prompt }
 *         · { type: 'done', id, ok, error }
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
      self.lmImage = (png) => postMessage({ type: 'image', id: current, png });
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
        fig.savefig(buf, format='png', dpi=110, bbox_inches='tight', facecolor='white')
        js.lmImage(base64.b64encode(buf.getvalue()).decode('ascii'))
    plt.close('all')

def _lm_show(*args, **kwargs):
    _lm_flush_figures()

def _lm_prepare_matplotlib():
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.show = _lm_show
`, { globals: helpers, filename: '<lm-helfer>' });
      lmRun = helpers.get('_lm_run');
      prepareMatplotlib = helpers.get('_lm_prepare_matplotlib');
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
    await lmRun(m.code, ns);
    postMessage({ type: 'done', id: m.id, ok: true });
  } catch (err) {
    postMessage({ type: 'done', id: m.id, ok: false, error: shortError(err?.message || String(err)) });
  }
};
