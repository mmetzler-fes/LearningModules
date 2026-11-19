// ==================== PYTHON IM DOKUMENT ====================
//
// Code-Blöcke mit `run: true` (docspec.js: pre.ds-code-run) werden im Durchlauf, in der Vorschau
// und im Notizbuch zu einem kleinen Notebook: Code ändern, ▶ Ausführen (Strg+Enter), Ausgabe darunter.
// Python (Pyodide) kommt vom eigenen Server (/vendor/pyodide/) und läuft in einem Worker (py-worker.js),
// damit eine Endlosschleife die Seite nicht einfriert – ⏹ beendet ihn. Alle Blöcke eines Dokuments
// teilen sich ihre Variablen. Was ein Schüler am Code ändert, merkt sich das Gerät (localStorage);
// ändert die Lehrkraft den Code, gilt wieder ihrer.

import { escapeHtml } from '../utils.js';

const BASE = '/vendor/pyodide/';
const STORE = 'lm_py:';

let worker = null;
let loaded = false;
let runSeq = 0;
/** Laufender Block: { id, block, ns } */
let running = null;
const queue = [];

/** Service Worker für input() (py-sw.js) – ohne ihn (kein https) geht alles außer input(). */
let swReady = null;
function inputChannel() {
  if (!swReady) {
    swReady = (async () => {
      if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
      try {
        const reg = await navigator.serviceWorker.register(new URL('py-sw.js', document.baseURI).href);
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          // clients.claim(): kurz warten, bis die Seite ihm gehört.
          await new Promise((resolve) => {
            const t = setTimeout(resolve, 3000);
            navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); resolve(); }, { once: true });
          });
        }
        return navigator.serviceWorker.controller ? new URL('__py-input__', reg.scope).href : null;
      } catch (_) {
        return null;
      }
    })();
  }
  return swReady;
}

async function ensureWorker() {
  if (worker) return worker;
  const inputUrl = await inputChannel();
  worker = new Worker(new URL('./py-worker.js', import.meta.url), { type: 'module' });
  worker.postMessage({ type: 'init', base: BASE, inputUrl });
  worker.onmessage = (e) => onWorkerMessage(e.data || {});
  worker.onerror = (e) => {
    worker?.terminate();
    worker = null;
    finish(false, `Python ließ sich nicht starten: ${e.message || 'unbekannter Fehler'}`);
  };
  return worker;
}

function onWorkerMessage(m) {
  const r = running;
  if (m.type === 'loading') {
    if (r && !loaded) r.block.status('Python wird geladen … (beim ersten Mal etwa 12 MB, danach schneller)');
    return;
  }
  if (!r || m.id !== r.id) return;
  if (m.type === 'out') { loaded = true; r.block.status(''); r.block.write(m.text, m.err); return; }
  if (m.type === 'input') { loaded = true; r.block.status(''); r.block.ask(m.prompt, (value) => answerInput(m.key, value)); return; }
  if (m.type === 'done') { loaded = true; finish(m.ok, m.error); }
}

function answerInput(key, value) {
  navigator.serviceWorker?.controller?.postMessage({ type: 'py-input-answer', key, value });
}

function finish(ok, error) {
  const r = running;
  running = null;
  if (r) {
    r.block.status('');
    if (!ok && error) r.block.write(`${error}\n`, true);
    r.block.done(ok);
  }
  const next = queue.shift();
  if (next) void start(next);
}

async function start(job) {
  running = job;
  job.block.begin();
  try {
    const w = await ensureWorker();
    w.postMessage({ type: 'run', id: job.id, ns: job.ns, code: job.code });
  } catch (err) {
    finish(false, `Python ließ sich nicht starten: ${err.message}`);
  }
}

function run(block, ns, code) {
  const job = { id: ++runSeq, block, ns, code };
  if (running) { queue.push(job); block.status('wartet …'); return; }
  void start(job);
}

/** ⏹: Worker beenden – alle Variablen sind danach weg. */
function stop() {
  const r = running;
  if (!r) return;
  worker?.terminate();
  worker = null;
  queue.length = 0;
  r.block.closeAsk?.();
  running = null;
  r.block.write('⏹ Gestoppt. Python startet beim nächsten ▶ neu – Variablen aus früheren Blöcken sind weg.\n', true);
  r.block.done(false);
}

function resetNamespace(ns) {
  worker?.postMessage({ type: 'reset', ns });
}

function load(key) {
  try { return JSON.parse(localStorage.getItem(STORE + key) || 'null'); } catch (_) { return null; }
}
function save(key, original, code) {
  try {
    if (code === original) localStorage.removeItem(STORE + key);
    else localStorage.setItem(STORE + key, JSON.stringify({ base: original, code }));
  } catch (_) { /* privat */ }
}

/** Für lm-host.js (host.pythonBlocks): alle ausführbaren Blöcke in `el` beleben. */
export function mountPythonBlocks({ el, moduleId }) {
  const ns = `doc:${moduleId || 'ohne-id'}:${Math.random().toString(36).slice(2, 8)}`;
  el.querySelectorAll('pre.ds-code-run').forEach((pre, i) => mountBlock(pre, ns, moduleId ? `${moduleId}:${i}` : null));
}

function mountBlock(pre, ns, storeKey) {
  if (pre.dataset.pyMounted) return;
  pre.dataset.pyMounted = '1';
  const original = pre.textContent.replace(/\n$/, '');
  const saved = storeKey ? load(storeKey) : null;
  const startCode = saved && saved.base === original ? saved.code : original;

  const box = document.createElement('div');
  box.className = 'py-block';
  box.innerHTML = `
    <div class="py-head">
      <span class="py-label">🐍 Python</span>
      <button type="button" class="btn btn-primary btn-sm py-run" title="Ausführen (Strg+Enter)">▶ Ausführen</button>
      <button type="button" class="btn btn-secondary btn-sm py-stop" hidden title="Anhalten – z. B. bei einer Endlosschleife">⏹ Stopp</button>
      <span class="py-status hint" aria-live="polite"></span>
      <span class="py-spacer"></span>
      <button type="button" class="py-mini py-restore" ${startCode === original ? 'hidden' : ''} title="Den ursprünglichen Code der Lehrkraft wiederherstellen">↺ Ursprünglich</button>
      <button type="button" class="py-mini py-reset" title="Variablen aller Python-Blöcke dieses Dokuments löschen">⟲ Neu starten</button>
    </div>
    <textarea class="py-code" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Python-Code"></textarea>
    <pre class="py-out" hidden></pre>`;
  const code = box.querySelector('.py-code');
  code.value = startCode;
  const style = pre.getAttribute('style');
  if (style) code.setAttribute('style', style);
  const out = box.querySelector('.py-out');
  const status = box.querySelector('.py-status');
  const btnRun = box.querySelector('.py-run');
  const btnStop = box.querySelector('.py-stop');
  const btnRestore = box.querySelector('.py-restore');
  pre.replaceWith(box);

  const fit = () => { code.style.height = 'auto'; code.style.height = `${code.scrollHeight + 2}px`; };
  requestAnimationFrame(fit);
  let askBox = null;

  const block = {
    begin() {
      out.textContent = '';
      out.hidden = true;
      out.classList.remove('py-failed');
      btnRun.disabled = true;
      btnStop.hidden = false;
    },
    status(text) { status.textContent = text; },
    write(text, err) {
      out.hidden = false;
      if (err) {
        const span = document.createElement('span');
        span.className = 'py-err';
        span.textContent = text;
        out.appendChild(span);
      } else {
        out.appendChild(document.createTextNode(text));
      }
    },
    ask(prompt, answer) {
      out.hidden = false;
      askBox = document.createElement('form');
      askBox.className = 'py-ask';
      askBox.innerHTML = `<span class="py-ask-prompt">${escapeHtml(prompt || 'Eingabe:')}</span><input type="text" autocomplete="off" aria-label="Eingabe für input()"><button type="submit" class="btn btn-primary btn-sm">↵</button>`;
      out.after(askBox);
      const input = askBox.querySelector('input');
      input.focus();
      askBox.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = input.value;
        askBox.remove();
        askBox = null;
        answer(value);
      });
      block.closeAsk = () => { if (askBox) { askBox.remove(); askBox = null; answer('\u0000'); } };
    },
    done(ok) {
      btnRun.disabled = false;
      btnStop.hidden = true;
      out.classList.toggle('py-failed', !ok);
      if (out.hidden && ok) { out.hidden = false; out.textContent = '✓ ohne Ausgabe'; out.classList.add('py-quiet'); } else out.classList.remove('py-quiet');
    },
  };

  btnRun.addEventListener('click', () => run(block, ns, code.value));
  btnStop.addEventListener('click', () => stop());
  box.querySelector('.py-reset').addEventListener('click', () => {
    resetNamespace(ns);
    status.textContent = 'Variablen gelöscht.';
    setTimeout(() => { if (status.textContent === 'Variablen gelöscht.') status.textContent = ''; }, 2500);
  });
  btnRestore.addEventListener('click', () => {
    code.value = original;
    if (storeKey) save(storeKey, original, original);
    btnRestore.hidden = true;
    fit();
  });
  code.addEventListener('input', () => {
    fit();
    if (storeKey) save(storeKey, original, code.value);
    btnRestore.hidden = code.value === original;
  });
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); btnRun.click(); return; }
    if (e.key === 'Tab' && !e.shiftKey) {
      // Einrücken wie im Editor: vier Leerzeichen statt Fokuswechsel.
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b } = code;
      code.setRangeText('    ', a, b, 'end');
      code.dispatchEvent(new Event('input'));
    }
  });
}
