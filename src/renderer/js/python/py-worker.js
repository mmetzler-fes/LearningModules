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

function boot() {
  if (pyodide) return Promise.resolve(pyodide);
  if (!booting) {
    postMessage({ type: 'loading' });
    booting = (async () => {
      // Modul-Worker (Pyodide 314 kennt keine klassischen mehr).
      const { loadPyodide } = await import(`${base}pyodide.mjs`);
      const py = await loadPyodide({ indexURL: base });
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
`);
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
    await py.runPythonAsync(m.code, { globals: ns, filename: '<exec>' });
    postMessage({ type: 'done', id: m.id, ok: true });
  } catch (err) {
    postMessage({ type: 'done', id: m.id, ok: false, error: shortError(err?.message || String(err)) });
  }
};
