// ==================== PYTHON IM DOKUMENT ====================
//
// Code-Blöcke mit `run: true` (docspec.js: pre.ds-code-run) werden im Durchlauf, in der Vorschau
// und im Notizbuch zu einem kleinen Notebook: Code ändern, ▶ Ausführen (Strg+Enter), Ausgabe darunter.
// Python (Pyodide) kommt vom eigenen Server (/vendor/pyodide/) und läuft in einem Worker (py-worker.js),
// damit eine Endlosschleife die Seite nicht einfriert – ⏹ beendet ihn. Alle Blöcke eines Dokuments
// teilen sich ihre Variablen. Was ein Schüler am Code ändert, merkt sich das Gerät (localStorage);
// ändert die Lehrkraft den Code, gilt wieder ihrer.
//
// 📊 Interaktive Darstellung (view: 'result', pre[data-view="result"]): Der Code ist versteckt, der Block
// läuft von selbst, sobald er sichtbar wird (auch erst beim Aufdecken einer Lösung), und zeigt nur das
// Ergebnis. regler(), auswahl() und schalter() im Code werden zu Bedienelementen über dem Bild – jede
// Änderung lässt den Block neu laufen.

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
    if (r && !loaded) r.block.status('Python wird geladen … (beim ersten Mal etwa 12 MB, mit numpy/matplotlib mehr – danach schneller)');
    return;
  }
  if (!r || m.id !== r.id) return;
  if (m.type === 'out') { loaded = true; r.block.status(''); r.block.write(m.text, m.err); return; }
  if (m.type === 'status') { loaded = true; r.block.status(m.text); return; }
  if (m.type === 'image') { r.block.image(m.png, m.mime); return; }
  if (m.type === 'widget') { r.block.widget?.(m.kind, m.name, m.spec || {}); return; }
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
    w.postMessage({ type: 'run', id: job.id, ns: job.ns, code: job.code, widgets: job.widgets || {} });
  } catch (err) {
    finish(false, `Python ließ sich nicht starten: ${err.message}`);
  }
}

function run(block, ns, code, widgets = null) {
  const job = { id: ++runSeq, block, ns, code, widgets };
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

/**
 * Ausgabe unter einem Block bzw. in der Konsole des Editors: was ein Lauf schreibt, fragt (input())
 * und meldet. `keep`: frühere Ausgaben stehen lassen (Konsole), sonst leert jeder Lauf.
 */
export function outputView({ out, status, btnRun = null, btnStop = null, keep = false, swap = false, label = '' }) {
  let askBox = null;
  // swap: alte Ausgabe bleibt stehen, bis die neue kommt (kein Flackern beim Ziehen am Regler).
  let stale = false;
  const fresh = () => { if (stale) { stale = false; out.textContent = ''; out.classList.remove('py-failed', 'py-quiet'); } };
  const view = {
    // `this`: der Lauf (forRun) – mit eigener Überschrift, auch wenn mehrere warten.
    begin() {
      if (keep) {
        const title = this.label || label;
        if (title || out.childNodes.length) {
          const head = document.createElement('span');
          head.className = 'py-run-head';
          head.textContent = `${out.childNodes.length ? '\n' : ''}▶ ${title || 'Lauf'}\n`;
          out.appendChild(head);
        }
        out.hidden = false;
      } else if (swap) {
        stale = true;
      } else {
        out.textContent = '';
        out.hidden = true;
      }
      if (!swap) out.classList.remove('py-failed', 'py-quiet');
      if (btnRun) btnRun.disabled = true;
      if (btnStop) btnStop.hidden = false;
    },
    status(text) { status.textContent = text; },
    write(text, err) {
      fresh();
      out.hidden = false;
      if (err) {
        const span = document.createElement('span');
        span.className = 'py-err';
        span.textContent = text;
        out.appendChild(span);
      } else {
        out.appendChild(document.createTextNode(text));
      }
      if (keep) out.scrollTop = out.scrollHeight;
    },
    /** Diagramm (matplotlib, plt.show() bzw. am Ende des Laufs) als Bild in der Ausgabe. */
    image(png, mime = 'image/png') {
      fresh();
      out.hidden = false;
      const img = document.createElement('img');
      img.className = 'py-img';
      img.alt = 'Diagramm';
      // svg(): als Bild eingebunden – Bewegung (SMIL) läuft, Skripte nicht.
      img.src = `data:${mime === 'image/svg+xml' ? mime : 'image/png'};base64,${png}`;
      out.appendChild(img);
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
      this.closeAsk = view.closeAsk = () => { if (askBox) { askBox.remove(); askBox = null; answer('\u0000'); } };
    },
    done(ok) {
      fresh();
      if (btnRun) btnRun.disabled = false;
      if (btnStop) btnStop.hidden = true;
      out.classList.toggle('py-failed', !ok);
      if (!keep && out.hidden && ok) { out.hidden = false; out.textContent = '✓ ohne Ausgabe'; out.classList.add('py-quiet'); }
    },
  };
  /** Derselbe Ausgabebereich für einen Lauf mit eigener Überschrift. */
  view.forRun = (runLabel) => Object.assign(Object.create(view), { label: runLabel });
  return view;
}

/** Code laufen lassen (wartet, wenn schon etwas läuft). `view`: siehe outputView. */
export function runPython(view, ns, code, widgets = null) { run(view, ns, code, widgets); }
export { stop as stopPython, resetNamespace as resetPython };

/** Für lm-host.js (host.pythonBlocks): alle ausführbaren Blöcke in `el` beleben. */
export function mountPythonBlocks({ el, moduleId }) {
  const ns = `doc:${moduleId || 'ohne-id'}:${Math.random().toString(36).slice(2, 8)}`;
  el.querySelectorAll('pre.ds-code-run').forEach((pre, i) => {
    const key = moduleId ? `${moduleId}:${i}` : null;
    if (pre.dataset.view === 'result') mountResultBlock(pre, ns, key);
    else mountBlock(pre, ns, key);
  });
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
      <button type="button" class="py-mini py-to-sheet" hidden title="Das Diagramm als Bild auf dein Blatt legen – zum Verschieben und Beschriften">➕ Aufs Blatt</button>
      <button type="button" class="py-mini py-copy" hidden title="Diagramm in die Zwischenablage – zum Einfügen ins eigene Blatt">📋 Bild kopieren</button>
      <button type="button" class="py-mini py-restore" ${startCode === original ? 'hidden' : ''} title="Den ursprünglichen Code der Lehrkraft wiederherstellen">↺ Ursprünglich</button>
      <button type="button" class="py-mini py-reset" title="Variablen aller Python-Blöcke dieses Dokuments löschen">⟲ Neu starten</button>
      <button type="button" class="py-mini py-grow" title="Groß – Code und Ausgabe über die ganze Seite (Esc: zurück)" aria-pressed="false">⤢</button>
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

  const fit = () => {
    if (box.classList.contains('py-full')) return; // groß: die Fläche bestimmt die Höhe (CSS)
    code.style.height = 'auto';
    code.style.height = `${code.scrollHeight + 2}px`;
  };
  requestAnimationFrame(fit);
  const block = outputView({ out, status, btnRun, btnStop });
  const btnCopy = box.querySelector('.py-copy');
  const btnSheet = box.querySelector('.py-to-sheet');
  watchFigure(out, btnCopy, btnSheet);
  btnCopy.addEventListener('click', () => void copyFigure(out, status));
  btnSheet.addEventListener('click', () => { setLarge(false); void figureToSheet(box, out, status); });

  // ⤢ Groß: an <body> gehängt, damit kein gezoomter oder schmaler Rahmen (Stift-Editor, Vorschau) ihn einengt.
  const btnGrow = box.querySelector('.py-grow');
  let home = null;
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLarge(false); } };
  const setLarge = (on) => {
    if (on === !!home) return;
    if (on) {
      home = document.createComment('py-block');
      box.replaceWith(home);
      document.body.appendChild(box);
      box.classList.add('py-full');
      document.addEventListener('keydown', onKey, true);
    } else {
      box.classList.remove('py-full');
      home.replaceWith(box);
      home = null;
      document.removeEventListener('keydown', onKey, true);
    }
    btnGrow.textContent = on ? '⤡' : '⤢';
    btnGrow.title = on ? 'Wieder im Blatt (Esc)' : 'Groß – Code und Ausgabe über die ganze Seite (Esc: zurück)';
    btnGrow.setAttribute('aria-pressed', String(on));
    code.style.height = '';
    if (!on) fit();
    code.focus({ preventScroll: true });
  };
  btnGrow.addEventListener('click', () => setLarge(!home));

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

/**
 * 📋 Das (letzte) Diagramm eines Blocks in die Zwischenablage – zum Einfügen ins eigene Blatt
 * (Stift-Editor: Einfügen, Word/OneNote: Strg+V). Der Blob geht als Zusage hinein: Safari (iPad)
 * verlangt den Aufruf direkt im Klick. Ohne Zwischenablage (kein https) wird das Bild gespeichert.
 */
/** Das Bild als PNG – ein SVG (svg()) wird dafür im aktuellen Zustand auf eine Zeichenfläche gemalt. */
async function figurePng(img) {
  if (img.src.startsWith('data:image/png')) return (await fetch(img.src)).blob();
  const pic = new Image();
  pic.src = img.src;
  await pic.decode();
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = Math.round((pic.naturalWidth || img.width || 800) * scale);
  c.height = Math.round((pic.naturalHeight || img.height || 500) * scale);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(pic, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild ließ sich nicht umwandeln.'))), 'image/png'));
}

async function copyFigure(out, status, name = 'Diagramm') {
  const imgs = out.querySelectorAll('.py-img');
  const img = imgs[imgs.length - 1];
  if (!img) return;
  const say = (text) => {
    status.textContent = text;
    setTimeout(() => { if (status.textContent === text) status.textContent = ''; }, 4000);
  };
  const blob = figurePng(img);
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      say('📋 Kopiert – im Blatt mit „Einfügen“ (Strg+V) einsetzen und beschriften.');
      return;
    } catch (_) { /* weiter: speichern */ }
  }
  const url = URL.createObjectURL(await blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Diagramm'}.png` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  say('⬇ Kopieren geht hier nicht – das Bild wurde gespeichert.');
}

/**
 * ➕ Aufs Blatt (nur im Stift-Editor, der sein Blatt mit data-ink-figures kennzeichnet): Das Diagramm
 * geht als Ereignis an den Editor (ink-editor.js), der es als freies Bild ins eigene Blatt legt.
 */
// Gemerkt, damit der Knopf auch bleibt, während der Block groß (⤢, an <body>) gezeigt wird.
const sheetOf = (box) => (box._lmSheet ||= box.closest('[data-ink-figures]'));
async function figureToSheet(box, out, status) {
  const imgs = out.querySelectorAll('.py-img');
  const img = imgs[imgs.length - 1];
  if (!img || !sheetOf(box)) return;
  const blob = await figurePng(img);
  const file = new File([blob], 'Diagramm.png', { type: 'image/png' });
  const taken = !box.dispatchEvent(new CustomEvent('lm-figure-to-sheet', { bubbles: true, cancelable: true, detail: { file } }));
  if (!taken) status.textContent = 'Aufs Blatt geht hier nicht – „📋 Bild kopieren“ und einfügen.';
}

/** 📋-/➕-Knöpfe nur zeigen, wenn die Ausgabe ein Bild hat (➕ nur im Stift-Editor). */
function watchFigure(out, btn, btnSheet = null) {
  const box = out.closest('.py-block');
  const update = () => {
    const has = !!out.querySelector('.py-img');
    btn.hidden = !has;
    if (btnSheet) btnSheet.hidden = !has || !sheetOf(box);
  };
  new MutationObserver(update).observe(out, { childList: true });
  update();
}

/** Zahl zum Anzeigen am Regler: so viele Nachkommastellen wie der Schritt, deutsches Komma. */
function formatValue(value, step) {
  const digits = step > 0 && step < 1 ? Math.min(6, Math.ceil(-Math.log10(step) - 1e-9)) : 0;
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return value.toExponential(2).replace('.', ',');
  return value.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** Logarithmischer Regler: Stellung 0…LOG_STEPS ↔ Wert zwischen min und max. */
const LOG_STEPS = 1000;
const toLogPos = (v, s) => Math.round((Math.log(v / s.min) / Math.log(s.max / s.min)) * LOG_STEPS);
const fromLogPos = (p, s) => {
  const v = s.min * (s.max / s.min) ** (p / LOG_STEPS);
  const mag = 10 ** (Math.floor(Math.log10(v)) - 2); // drei gültige Stellen
  return Math.round(v / mag) * mag;
};

/**
 * 📊 Interaktive Darstellung: Code versteckt, läuft beim Sichtbarwerden von selbst; regler()/auswahl()/
 * schalter() werden Bedienelemente. „‹/› Code“ klappt den Code auf (ändern und ▶ wie im normalen Block).
 */
function mountResultBlock(pre, ns, storeKey) {
  if (pre.dataset.pyMounted) return;
  pre.dataset.pyMounted = '1';
  const original = pre.textContent.replace(/\n$/, '');
  const saved = storeKey ? load(storeKey) : null;
  const startCode = saved && saved.base === original ? saved.code : original;

  const box = document.createElement('div');
  box.className = 'py-block py-result';
  box.innerHTML = `
    <div class="py-head">
      <span class="py-label">📊 Interaktiv</span>
      <span class="py-status hint" aria-live="polite"></span>
      <span class="py-spacer"></span>
      <button type="button" class="btn btn-primary btn-sm py-to-sheet" hidden title="Das Bild so, wie es gerade eingestellt ist, auf dein Blatt legen – zum Verschieben und Beschriften">➕ Aufs Blatt</button>
      <button type="button" class="btn btn-secondary btn-sm py-copy" hidden title="Das Bild so, wie es gerade eingestellt ist, in die Zwischenablage – zum Einfügen ins eigene Blatt">📋 Bild kopieren</button>
      <button type="button" class="py-mini py-reset-values" hidden title="Alle Regler auf den Anfangswert">↺ Anfangswerte</button>
      <button type="button" class="py-mini py-toggle-code" title="Den Python-Code dahinter zeigen" aria-pressed="false">‹/› Code</button>
      <button type="button" class="py-mini py-grow" title="Groß über die ganze Seite (Esc: zurück)" aria-pressed="false">⤢</button>
    </div>
    <div class="py-code-area" hidden>
      <textarea class="py-code" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Python-Code"></textarea>
      <div class="py-code-bar">
        <button type="button" class="btn btn-primary btn-sm py-run" title="Ausführen (Strg+Enter)">▶ Ausführen</button>
        <button type="button" class="btn btn-secondary btn-sm py-stop" hidden title="Anhalten">⏹ Stopp</button>
        <button type="button" class="py-mini py-restore" ${startCode === original ? 'hidden' : ''} title="Den ursprünglichen Code der Lehrkraft wiederherstellen">↺ Ursprünglich</button>
      </div>
    </div>
    <div class="py-controls" hidden></div>
    <pre class="py-out py-result-out"><span class="py-placeholder">📊 Die Darstellung erscheint, sobald Python geladen ist …</span></pre>`;
  const $ = (s) => box.querySelector(s);
  const code = $('.py-code');
  code.value = startCode;
  const out = $('.py-out');
  const status = $('.py-status');
  const controls = $('.py-controls');
  const btnRun = $('.py-run');
  const btnStop = $('.py-stop');
  const btnRestore = $('.py-restore');
  const btnResetValues = $('.py-reset-values');
  pre.replaceWith(box);
  const btnCopy = $('.py-copy');
  const btnSheet = $('.py-to-sheet');
  watchFigure(out, btnCopy, btnSheet);
  btnCopy.addEventListener('click', () => void copyFigure(out, status));
  btnSheet.addEventListener('click', () => { setLarge(false); void figureToSheet(box, out, status); });

  /** Werte der Bedienelemente (Name → Zahl/Index/bool) und ihre Elemente. */
  const values = {};
  const starts = {};
  const elements = new Map();
  let seen = new Set();
  let dirty = false;
  let busy = false;

  const base = outputView({ out, status, btnRun, btnStop, swap: true });
  const view = Object.assign(Object.create(base), {
    begin() { busy = true; seen = new Set(); base.begin(); },
    widget(kind, name, spec) {
      seen.add(name);
      ensureControl(kind, name, spec);
    },
    done(ok) {
      base.done(ok);
      busy = false;
      if (ok) {
        // Bedienelemente, die der Code nicht mehr anlegt, verschwinden.
        for (const [name, el] of elements) if (!seen.has(name)) { el.remove(); elements.delete(name); delete values[name]; }
      }
      controls.hidden = elements.size === 0;
      btnResetValues.hidden = elements.size === 0;
      if (dirty) { dirty = false; go(); return; }
      // ▶ Abspielen (zeit()): nächstes Bild, sobald dieses fertig ist – die Zeit folgt der Uhr, nicht den Bildern.
      for (const el of elements.values()) el.afterRun?.(ok);
    },
  });
  const go = () => {
    if (busy) { dirty = true; return; }
    busy = true;
    run(view, ns, code.value, { ...values });
  };

  function ensureControl(kind, name, spec) {
    starts[name] = spec.start;
    let el = elements.get(name);
    if (el && el.dataset.kind === kind && el.dataset.spec === JSON.stringify({ ...spec, value: null })) return;
    // Zeitregler als div: In einem label löste jeder Klick daneben den ▶-Knopf aus.
    const fresh = document.createElement(kind === 'zeit' ? 'div' : 'label');
    fresh.className = `py-ctl py-ctl-${kind}`;
    fresh.dataset.kind = kind;
    fresh.dataset.spec = JSON.stringify({ ...spec, value: null });
    values[name] = spec.value;
    if (kind === 'regler') {
      const log = !!spec.log;
      fresh.innerHTML = `<span class="py-ctl-name"></span>
        <input type="range" min="${log ? 0 : spec.min}" max="${log ? LOG_STEPS : spec.max}" step="${log ? 1 : spec.step}">
        <output class="py-ctl-value"></output>`;
      const input = fresh.querySelector('input');
      const shown = fresh.querySelector('output');
      input.value = String(log ? toLogPos(spec.value, spec) : spec.value);
      const show = () => { shown.textContent = `${formatValue(values[name], log ? values[name] / 100 : spec.step)}${spec.unit ? ` ${spec.unit}` : ''}`; };
      show();
      input.addEventListener('input', () => {
        values[name] = log ? fromLogPos(Number(input.value), spec) : Number(input.value);
        show();
        go();
      });
      fresh.resetTo = (v) => { values[name] = v; input.value = String(log ? toLogPos(v, spec) : v); show(); };
    } else if (kind === 'zeit') {
      // Zeitregler: ▶/⏸ spielt in Zeitlupe ab (Tempo wählbar), Ziehen setzt die Zeit an jede Stelle.
      const speeds = [1, 2, 5, 10, 20, 50, 100];
      const slow0 = speeds.includes(spec.slow) ? spec.slow : speeds.reduce((a, b) => (Math.abs(b - spec.slow) < Math.abs(a - spec.slow) ? b : a));
      fresh.innerHTML = `<button type="button" class="py-play" aria-label="Abspielen" title="Abspielen in Zeitlupe">▶</button>
        <button type="button" class="py-stop-time" aria-label="Stopp" title="Stopp – zurück an den Anfang">⏹</button>
        <span class="py-ctl-name"></span>
        <input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}">
        <output class="py-ctl-value"></output>
        <select class="py-speed" title="Zeitlupe: so viel langsamer als in echt">${speeds.map((k) => `<option value="${k}"${k === slow0 ? ' selected' : ''}>${k === 1 ? 'Echtzeit' : `1 : ${k}`}</option>`).join('')}</select>`;
      const input = fresh.querySelector('input');
      const shown = fresh.querySelector('output');
      const btnPlay = fresh.querySelector('.py-play');
      const speed = fresh.querySelector('.py-speed');
      input.value = String(spec.value);
      const digits = Math.max(0, Math.min(4, Math.ceil(-Math.log10(spec.step || 0.001))));
      const show = () => { shown.textContent = `${Number(values[name]).toFixed(digits).replace('.', ',')}${spec.unit ? ` ${spec.unit}` : ''}`; };
      show();
      let play = null; // { t0, v0 }
      // Python fragt das Tempo mit zeitlupe() ab (z. B. für Bewegungen zwischen den Bildern).
      values.__zeitlupe = Number(speed.value);
      const setPlaying = (on) => {
        btnPlay.textContent = on ? '⏸' : '▶';
        btnPlay.setAttribute('aria-label', on ? 'Anhalten' : 'Abspielen');
        btnPlay.classList.toggle('active', on);
        values.__spielt = on;
      };
      const stopPlay = () => { if (!play) return; play = null; setPlaying(false); go(); }; // angehalten: einmal scharf
      const frame = () => {
        if (!play) return;
        const v = Math.min(spec.max, play.v0 + (performance.now() - play.t0) / 1000 / Number(speed.value));
        values[name] = v;
        input.value = String(v);
        show();
        if (v >= spec.max) { play = null; setPlaying(false); }
        go();
      };
      btnPlay.addEventListener('click', () => {
        if (play) { stopPlay(); return; }
        if (values[name] >= spec.max - spec.step / 2) values[name] = spec.min; // am Ende: von vorn
        play = { t0: performance.now(), v0: Number(values[name]) };
        setPlaying(true);
        frame();
      });
      fresh.querySelector('.py-stop-time').addEventListener('click', () => {
        play = null;
        setPlaying(false);
        values[name] = spec.min;
        input.value = String(spec.min);
        show();
        go();
      });
      speed.addEventListener('change', () => {
        values.__zeitlupe = Number(speed.value);
        if (play) play = { t0: performance.now(), v0: Number(values[name]) };
        else go();
      });
      fresh.afterRun = (ok) => { if (play) { if (ok) requestAnimationFrame(frame); else { play = null; setPlaying(false); } } };
      input.addEventListener('pointerdown', () => { if (play) { play = null; setPlaying(false); } });
      input.addEventListener('input', () => {
        if (play) { play = null; setPlaying(false); }
        values[name] = Number(input.value);
        show();
        go();
      });
      fresh.resetTo = (v) => { play = null; setPlaying(false); values[name] = v; input.value = String(v); show(); };
    } else if (kind === 'auswahl') {
      fresh.innerHTML = `<span class="py-ctl-name"></span><select></select>`;
      const select = fresh.querySelector('select');
      (spec.options || []).forEach((t, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = t; select.appendChild(o); });
      select.value = String(spec.value);
      select.addEventListener('change', () => { values[name] = Number(select.value); go(); });
      fresh.resetTo = (v) => { values[name] = v; select.value = String(v); };
    } else {
      fresh.innerHTML = `<input type="checkbox"><span class="py-ctl-name"></span>`;
      const input = fresh.querySelector('input');
      input.checked = !!spec.value;
      input.addEventListener('change', () => { values[name] = input.checked; go(); });
      fresh.resetTo = (v) => { values[name] = v; input.checked = !!v; };
    }
    fresh.querySelector('.py-ctl-name').textContent = name;
    if (el) el.replaceWith(fresh);
    else controls.appendChild(fresh);
    // Der Zeitregler (▶) steht immer zuletzt – auch wenn je nach Auswahl Regler dazukommen.
    controls.append(...controls.querySelectorAll('.py-ctl-zeit'));
    elements.set(name, fresh);
    controls.hidden = false;
  }

  btnResetValues.addEventListener('click', () => {
    for (const [name, el] of elements) el.resetTo?.(starts[name]);
    go();
  });

  // Code auf-/zuklappen
  const codeArea = $('.py-code-area');
  const btnCode = $('.py-toggle-code');
  const fit = () => {
    if (box.classList.contains('py-full')) return;
    code.style.height = 'auto';
    code.style.height = `${code.scrollHeight + 2}px`;
  };
  btnCode.addEventListener('click', () => {
    codeArea.hidden = !codeArea.hidden;
    btnCode.setAttribute('aria-pressed', String(!codeArea.hidden));
    btnCode.textContent = codeArea.hidden ? '‹/› Code' : '‹/› Code ausblenden';
    if (!codeArea.hidden) requestAnimationFrame(fit);
  });
  btnRun.addEventListener('click', () => go());
  btnStop.addEventListener('click', () => { dirty = false; stop(); busy = false; });
  btnRestore.addEventListener('click', () => {
    code.value = original;
    if (storeKey) save(storeKey, original, original);
    btnRestore.hidden = true;
    fit();
    go();
  });
  code.addEventListener('input', () => {
    fit();
    if (storeKey) save(storeKey, original, code.value);
    btnRestore.hidden = code.value === original;
  });
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); return; }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      code.setRangeText('    ', code.selectionStart, code.selectionEnd, 'end');
      code.dispatchEvent(new Event('input'));
    }
  });

  // ⤢ Groß
  const btnGrow = $('.py-grow');
  let home = null;
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLarge(false); } };
  const setLarge = (on) => {
    if (on === !!home) return;
    if (on) {
      home = document.createComment('py-block');
      box.replaceWith(home);
      document.body.appendChild(box);
      box.classList.add('py-full');
      document.addEventListener('keydown', onKey, true);
    } else {
      box.classList.remove('py-full');
      home.replaceWith(box);
      home = null;
      document.removeEventListener('keydown', onKey, true);
    }
    btnGrow.textContent = on ? '⤡' : '⤢';
    btnGrow.setAttribute('aria-pressed', String(on));
  };
  btnGrow.addEventListener('click', () => setLarge(!home));

  // Von selbst starten, sobald der Block zu sehen ist (eine versteckte Lösung erst beim Aufdecken).
  let started = false;
  const begin = () => { if (!started) { started = true; go(); } };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); begin(); }
    }, { rootMargin: '200px' });
    io.observe(box);
  } else {
    begin();
  }
}
