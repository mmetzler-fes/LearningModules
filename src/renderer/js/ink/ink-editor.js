import {
  A4, CM, strokeOutline, polyline, hitsStroke, bounds, inSelection, moved, ruling,
  pageToRuler, inRuler, nearEdge, projectOnSegment, snapAngle, itemAt, extremesAlong,
} from './ink-geometry.js';
import { rulerSvg, rulerHandles } from './ink-ruler.js';

// ==================== STIFT-EDITOR ====================
//
// Ein Arbeitsblatt mit Stift (iPad), Finger oder Maus bearbeiten – wie auf
// Papier. Unten liegt der Hintergrund (das PDF des Blatts, Karo, Linien,
// leer oder ein eigenes Bild/PDF), darüber eine Ebene zum Beschriften:
// Stift mit Druck, Textmarker, Radierer, Auswahl (verschieben, löschen),
// Textfelder. Bleibt der Stift am Ende eines Strichs kurz stehen, wird der
// Strich zur geraden Linie; Linien haben im Auswahl-Modus zwei Anfasser. In der Ansicht der Lehrkraft lässt sich das Lösungsblatt als
// Hintergrund einblenden. Dazu ein Geodreieck: verschieben, drehen (1°,
// mit Umschalt 5°; zwei Finger; Mausrad), an der Ecke vergrößern – setzt der
// Stift an seiner Kante an, zeichnet er genau an ihr entlang.
//
// Gespeichert wird vorerst nur auf diesem Gerät (IndexedDB) – Abgabe und
// Auswertung kommen später. Koordinaten in PDF-Punkten der Seite, damit die
// Striche bei jedem Zoom an derselben Stelle des Blatts bleiben.

const COLORS = ['#1e293b', '#2563eb', '#dc2626', '#16a34a'];
const MARKERS = ['#fde047', '#86efac', '#f9a8d4', '#93c5fd'];
const WIDTHS = { pen: [1.1, 1.9, 3.2], marker: [9, 14, 20] };
const ERASER = 7;           // Radius des Radierers in Punkten
const TEXT_SIZE = 13;       // Schriftgröße der Textfelder in Punkten
const MAX_PIXELS = 12e6;    // Obergrenze je Hintergrund-Leinwand (iPad Safari: ~16 Mio.)
const RULER_REACH = 12;     // So nah (Bildschirmpunkte) muss der Stift an die Kante des Geodreiecks
const RULER_MIN = 6 * CM;
const HOLD_MS = 550;        // So lange still halten, dann wird der Strich zur Linie
const HOLD_SLACK = 4;       // … und so wenig (Bildschirmpunkte) darf er sich dabei bewegen
const HANDLE = 9;           // Anfasser einer Linie (Bildschirmpunkte, Radius)
const RULER_MAX = 32 * CM;

// ---------- Speicher auf diesem Gerät ----------

const DB = 'lm-ink';
const STORE = 'docs';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key) {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch (_) { return null; }
}

async function dbPut(key, value) {
  try {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch (_) { return false; }
}

// ---------- pdf.js (erst bei Bedarf) ----------

let pdfjs = null;
async function pdfLib() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

async function openPdf(data) {
  const lib = await pdfLib();
  return lib.getDocument({ data: new Uint8Array(data) }).promise;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Editor öffnen (Vollbild).
 * - `key`: unter diesem Namen speichert das Gerät die Beschriftung.
 * - `loadPdf(variant)`: 'blatt' | 'loesung' → ArrayBuffer des PDFs; ohne gibt es kein PDF als Hintergrund.
 * - `solutions`: Lösungsblatt einblenden erlaubt (nur Lehrkräfte).
 */
export async function openInkEditor({ title = 'Arbeitsblatt', key, loadPdf = null, solutions = false }) {
  const storeKey = `ink:${key}`;
  const saved = await dbGet(storeKey);
  const doc = saved?.v === 1 ? saved : { v: 1, bg: loadPdf ? 'pdf' : 'karo', pages: [{ items: [] }] };
  if (!loadPdf && doc.bg === 'pdf') doc.bg = 'karo';
  let fileBg = doc.bg === 'file' ? await dbGet(`${storeKey}:file`) : null; // { type, data }
  if (doc.bg === 'file' && !fileBg) doc.bg = loadPdf ? 'pdf' : 'karo';

  const state = {
    tool: 'pen', color: COLORS[0], marker: MARKERS[0], widthIdx: 1,
    zoom: 1, fingerDraws: false, variant: 'blatt',
    selection: null,          // { page, ids: Set }
    undo: [], redo: [],
  };
  const pdfs = {};            // variant → PDFDocumentProxy | Promise
  let pages = [];             // [{ w, h, el, svg, canvas, texts }]
  let saveTimer = null;

  // ---------- Gerüst ----------
  const overlay = document.createElement('div');
  overlay.className = 'ink-overlay ink-finger-off';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', `Bearbeiten: ${title}`);
  overlay.innerHTML = `
    <div class="ink-toolbar" role="toolbar">
      <button type="button" class="ink-btn ink-close" title="Schließen – die Beschriftung bleibt auf diesem Gerät gespeichert">✕</button>
      <span class="ink-title">${esc(title)}</span>
      <span class="ink-group ink-tools">
        <button type="button" class="ink-btn" data-tool="pen" title="Stift">✏️</button>
        <button type="button" class="ink-btn" data-tool="marker" title="Textmarker">🖍️</button>
        <button type="button" class="ink-btn" data-tool="eraser" title="Radierer – löscht ganze Striche">🧽</button>
        <button type="button" class="ink-btn" data-tool="select" title="Auswählen: Rechteck aufziehen, dann verschieben oder löschen">⬚</button>
        <button type="button" class="ink-btn" data-tool="text" title="Textfeld: auf die Seite tippen und schreiben">T</button>
      </span>
      <span class="ink-group">
        <button type="button" class="ink-btn ink-ruler-toggle" title="Geodreieck ein- und ausblenden – drehen am ⟳ (Umschalt: 5°), mit zwei Fingern oder dem Mausrad; vergrößern am ⤢">📐</button>
      </span>
      <span class="ink-group ink-colors"></span>
      <span class="ink-group ink-widths">
        ${[0, 1, 2].map((i) => `<button type="button" class="ink-btn ink-width" data-width="${i}" title="${['dünn', 'mittel', 'dick'][i]}"><i style="--d:${4 + i * 4}px"></i></button>`).join('')}
      </span>
      <span class="ink-group">
        <button type="button" class="ink-btn ink-undo" title="Rückgängig">↶</button>
        <button type="button" class="ink-btn ink-redo" title="Wiederholen">↷</button>
        <button type="button" class="ink-btn ink-delete" title="Auswahl löschen" hidden>🗑</button>
      </span>
      <span class="ink-group">
        <button type="button" class="ink-btn ink-finger" title="Mit dem Finger zeichnen (sonst scrollt der Finger, gezeichnet wird mit Stift oder Maus)">☝️</button>
        <select class="ink-bg-select" title="Hintergrund">
          ${loadPdf ? '<option value="pdf">📄 Arbeitsblatt</option>' : ''}
          <option value="karo">▦ Karo</option>
          <option value="linien">☰ Linien</option>
          <option value="leer">▢ Leer</option>
          <option value="file">🖼 Bild oder PDF …</option>
        </select>
        ${solutions && loadPdf ? '<button type="button" class="ink-btn ink-solution" title="Lösungsblatt als Hintergrund ein- und ausblenden">💡</button>' : ''}
        <button type="button" class="ink-btn ink-add-page" title="Seite anfügen">＋📄</button>
      </span>
      <span class="ink-group">
        <button type="button" class="ink-btn ink-zoom-out" title="Verkleinern">−</button>
        <button type="button" class="ink-btn ink-zoom-fit" title="Auf Breite">↔</button>
        <button type="button" class="ink-btn ink-zoom-in" title="Vergrößern">＋</button>
      </span>
      <span class="ink-status" aria-live="polite"></span>
    </div>
    <div class="ink-scroll"><div class="ink-pages"></div></div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('ink-open');
  const $ = (sel) => overlay.querySelector(sel);
  const scroller = $('.ink-scroll');
  const pagesEl = $('.ink-pages');
  const status = (text) => { $('.ink-status').textContent = text; };

  // ---------- Werkzeugleiste ----------
  const paintToolbar = () => {
    overlay.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === state.tool));
    const list = state.tool === 'marker' ? MARKERS : COLORS;
    const current = state.tool === 'marker' ? state.marker : state.color;
    $('.ink-colors').innerHTML = list.map((c) => `<button type="button" class="ink-btn ink-color ${c === current ? 'active' : ''}" data-color="${c}" style="--c:${c}" title="Farbe"></button>`).join('');
    $('.ink-colors').hidden = !['pen', 'marker', 'text'].includes(state.tool);
    $('.ink-widths').hidden = !['pen', 'marker'].includes(state.tool);
    overlay.querySelectorAll('.ink-width').forEach((b) => b.classList.toggle('active', Number(b.dataset.width) === state.widthIdx));
    $('.ink-undo').disabled = !state.undo.length;
    $('.ink-redo').disabled = !state.redo.length;
    $('.ink-delete').hidden = !state.selection?.ids.size;
    $('.ink-finger').classList.toggle('active', state.fingerDraws);
    overlay.classList.toggle('ink-finger-off', !state.fingerDraws);
    overlay.classList.toggle('ink-tool-text', state.tool === 'text');
    $('.ink-bg-select').value = doc.bg;
    $('.ink-solution')?.classList.toggle('active', state.variant === 'loesung');
    if ($('.ink-solution')) $('.ink-solution').hidden = doc.bg !== 'pdf';
    $('.ink-add-page').hidden = !['karo', 'linien', 'leer'].includes(doc.bg);
    $('.ink-ruler-toggle').classList.toggle('active', !!doc.ruler?.visible);
  };

  overlay.querySelector('.ink-tools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    state.tool = b.dataset.tool;
    if (state.tool !== 'select') clearSelection();
    paintToolbar();
  });
  $('.ink-colors').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    if (state.tool === 'marker') state.marker = b.dataset.color; else state.color = b.dataset.color;
    paintToolbar();
  });
  $('.ink-widths').addEventListener('click', (e) => {
    const b = e.target.closest('[data-width]');
    if (b) { state.widthIdx = Number(b.dataset.width); paintToolbar(); }
  });
  $('.ink-undo').addEventListener('click', () => history(state.undo, state.redo));
  $('.ink-redo').addEventListener('click', () => history(state.redo, state.undo));
  $('.ink-delete').addEventListener('click', () => deleteSelection());
  $('.ink-finger').addEventListener('click', () => { state.fingerDraws = !state.fingerDraws; paintToolbar(); });
  $('.ink-zoom-in').addEventListener('click', () => setZoom(state.zoom * 1.25));
  $('.ink-zoom-out').addEventListener('click', () => setZoom(state.zoom / 1.25));
  $('.ink-zoom-fit').addEventListener('click', () => setZoom(fitZoom()));
  $('.ink-add-page').addEventListener('click', () => {
    snapshot();
    doc.pages.push({ items: [] });
    changed();
    void layout().then(() => pages[pages.length - 1]?.el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  });
  $('.ink-solution')?.addEventListener('click', () => {
    state.variant = state.variant === 'blatt' ? 'loesung' : 'blatt';
    paintToolbar();
    void layout();
  });
  $('.ink-bg-select').addEventListener('change', async (e) => {
    const value = e.target.value;
    if (value === 'file') {
      const file = await pickFile();
      if (!file) { paintToolbar(); return; }
      fileBg = { type: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/*'), data: await file.arrayBuffer() };
      delete pdfs.file;
      if (!(await dbPut(`${storeKey}:file`, fileBg))) status('⚠️ Bild zu groß zum Speichern – es gilt nur bis zum Schließen.');
    }
    doc.bg = value;
    changed();
    paintToolbar();
    void layout();
  });
  $('.ink-close').addEventListener('click', () => close());
  $('.ink-ruler-toggle').addEventListener('click', () => {
    if (doc.ruler?.visible) doc.ruler.visible = false;
    else {
      // Auf die Seite, die gerade zu sehen ist, waagrecht in die Mitte.
      const mid = scroller.getBoundingClientRect().top + scroller.clientHeight / 2;
      const page = pages.find((pg) => pg.el.getBoundingClientRect().bottom > mid) || pages[0];
      const r = page.el.getBoundingClientRect();
      const L = doc.ruler?.L || 16 * CM;
      const cy = Math.min(page.h - 0.5 * CM, Math.max(L / 2 + 0.5 * CM, (mid - r.top) / state.zoom + L / 4));
      doc.ruler = { visible: true, page: page.i, cx: page.w / 2, cy, angle: 0, L };
    }
    renderRuler();
    changed();
  });

  const pickFile = () => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf,application/pdf';
    input.onchange = () => resolve(input.files[0] || null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });

  // ---------- Verlauf und Speichern ----------
  const pagesJson = () => JSON.stringify(doc.pages);
  function snapshot() {
    state.undo.push(pagesJson());
    if (state.undo.length > 100) state.undo.shift();
    state.redo = [];
  }
  function history(from, to) {
    if (!from.length) return;
    to.push(pagesJson());
    const count = doc.pages.length;
    doc.pages = JSON.parse(from.pop());
    clearSelection();
    changed();
    // Nur die Beschriftung neu zeichnen – Seiten und Hintergrund bleiben (kein Flackern).
    if (doc.pages.length === count) pages.forEach((p) => drawItems(p.i));
    else void layout();
  }
  function changed() {
    paintToolbar();
    status('…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 700);
  }
  async function persist() {
    clearTimeout(saveTimer);
    doc.updatedAt = new Date().toISOString();
    status((await dbPut(storeKey, doc)) ? '💾 Auf diesem Gerät gespeichert' : '⚠️ Speichern auf diesem Gerät nicht möglich');
  }

  // ---------- Seiten ----------
  async function background() {
    if (doc.bg === 'pdf') {
      const variant = state.variant;
      if (!pdfs[variant]) {
        pdfs[variant] = (async () => openPdf(await loadPdf(variant)))();
        pdfs[variant].catch(() => { delete pdfs[variant]; });
      }
      return { pdf: await pdfs[variant] };
    }
    if (doc.bg === 'file' && fileBg) {
      if (/pdf/.test(fileBg.type)) {
        pdfs.file = pdfs.file || openPdf(fileBg.data);
        return { pdf: await pdfs.file };
      }
      const url = URL.createObjectURL(new Blob([fileBg.data], { type: fileBg.type }));
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
      return { img };
    }
    return { ruling: doc.bg };
  }

  async function layout() {
    let bg;
    status('Wird geladen …');
    try { bg = await background(); } catch (err) {
      status(`⚠️ Hintergrund nicht verfügbar: ${err.message || err}`);
      bg = { ruling: 'karo' };
    }
    const sizes = [];
    if (bg.pdf) {
      for (let i = 1; i <= bg.pdf.numPages; i++) {
        const vp = (await bg.pdf.getPage(i)).getViewport({ scale: 1 });
        sizes.push({ w: vp.width, h: vp.height });
      }
    } else if (bg.img) {
      sizes.push({ w: A4.w, h: A4.w * (bg.img.naturalHeight / bg.img.naturalWidth) });
    } else {
      for (let i = 0; i < Math.max(1, doc.pages.length); i++) sizes.push({ ...A4 });
    }
    while (doc.pages.length < sizes.length) doc.pages.push({ items: [] });
    // Mehr beschriftete Seiten als der Hintergrund hat: auf Karo weiterführen.
    while (sizes.length < doc.pages.length) sizes.push({ ...sizes[sizes.length - 1] || A4 });
    if (!state.zoomSet) { state.zoom = fitZoom(sizes[0].w); state.zoomSet = true; }

    pagesEl.innerHTML = '';
    pages = sizes.map((s, i) => buildPage(i, s));
    for (const p of pages) { drawItems(p.i); }
    renderRuler();
    for (const p of pages) await drawBackground(p, bg);
    status('');
    paintToolbar();
  }

  function buildPage(i, { w, h }) {
    const el = document.createElement('div');
    el.className = 'ink-page';
    el.dataset.i = i;
    el.innerHTML = `<canvas class="ink-bg"></canvas>
      <svg class="ink-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
        <g class="ink-marker"></g><g class="ink-pen"></g><g class="ink-live"></g>
        <rect class="ink-sel-rect" display="none"></rect><rect class="ink-sel-box" display="none"></rect>
      </svg>
      <div class="ink-texts"></div>
      <svg class="ink-top" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><g class="ink-handles"></g></svg>`;
    pagesEl.appendChild(el);
    const page = { i, w, h, el, svg: el.querySelector('svg'), canvas: el.querySelector('canvas'), texts: el.querySelector('.ink-texts') };
    sizePage(page);
    bindInput(page);
    return page;
  }

  function sizePage(p) {
    p.el.style.width = `${p.w * state.zoom}px`;
    p.el.style.height = `${p.h * state.zoom}px`;
    p.el.style.setProperty('--z', state.zoom);
  }

  async function drawBackground(p, bg) {
    const dpr = window.devicePixelRatio || 1;
    let scale = state.zoom * dpr;
    if (p.w * p.h * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (p.w * p.h));
    const c = p.canvas;
    c.width = Math.round(p.w * scale);
    c.height = Math.round(p.h * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    if (bg.pdf && p.i < bg.pdf.numPages) {
      const page = await bg.pdf.getPage(p.i + 1);
      await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise;
      return;
    }
    if (bg.img && p.i === 0) { ctx.drawImage(bg.img, 0, 0, c.width, c.height); return; }
    const kind = bg.ruling || 'karo';
    ctx.strokeStyle = kind === 'karo' ? '#c7d2e0' : '#94a3b8';
    ctx.lineWidth = Math.max(1, 0.5 * scale);
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of ruling(kind, p.w, p.h)) { ctx.moveTo(x0 * scale, y0 * scale); ctx.lineTo(x1 * scale, y1 * scale); }
    ctx.stroke();
  }

  function fitZoom(pageW = pages[0]?.w || A4.w) {
    const room = scroller.clientWidth - 24;
    return Math.max(0.3, Math.min(2.5, room / pageW));
  }

  function setZoom(z) {
    const keep = scroller.scrollTop / (scroller.scrollHeight || 1);
    state.zoom = Math.max(0.3, Math.min(4, z));
    state.zoomSet = true;
    void layout().then(() => { scroller.scrollTop = keep * scroller.scrollHeight; });
  }

  // ---------- Geodreieck ----------
  const angleText = (r) => `${(360 - r.angle) % 360}°`;

  function renderRuler() {
    overlay.querySelectorAll('.ink-ruler').forEach((el) => el.remove());
    const r = doc.ruler;
    const p = r?.visible ? pages[r.page] : null;
    if (!p) return;
    const el = document.createElement('div');
    el.className = 'ink-ruler';
    p.el.appendChild(el);
    // Mausrad dreht (1°, mit Umschalt 5°).
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      r.angle = snapAngle(r.angle + (e.deltaY > 0 ? step : -step), step);
      placeRuler();
      changed();
    }, { passive: false });
    placeRuler(true);
  }

  function placeRuler(redraw = false) {
    const r = doc.ruler;
    const el = overlay.querySelector('.ink-ruler');
    if (!r || !el) return;
    const z = state.zoom;
    if (redraw || Number(el.dataset.L) !== r.L) {
      el.innerHTML = rulerSvg(r.L, z, angleText(r));
      el.dataset.L = r.L;
    } else {
      const t = el.querySelector('.ir-angle');
      if (t) t.textContent = angleText(r);
    }
    Object.assign(el.style, {
      left: `${(r.cx - r.L / 2) * z}px`, top: `${(r.cy - r.L / 2) * z}px`,
      width: `${r.L * z}px`, height: `${(r.L / 2) * z}px`, transform: `rotate(${r.angle}deg)`,
    });
  }

  /** Griff unter dem Punkt (in Seitenkoordinaten), sonst null. */
  function rulerHandleAt(r, x, y) {
    const [lx, ly] = pageToRuler(r, x, y);
    const g = rulerHandles(r.L, state.zoom);
    for (const [name, h] of Object.entries(g)) if (Math.hypot(lx - h.x, ly - h.y) <= h.r * 1.4) return name;
    return null;
  }

  // Verschieben, Drehen, Vergrößern – mit einem oder zwei Fingern, Stift oder Maus.
  let rulerDrag = null; // { pointers: Map(id → [x, y]), mode, start }
  function rulerStart(e, x, y, handle) {
    const r = doc.ruler;
    if (!rulerDrag) rulerDrag = { pointers: new Map() };
    rulerDrag.pointers.set(e.pointerId, [x, y]);
    if (rulerDrag.pointers.size === 2) {
      const [a, b] = [...rulerDrag.pointers.values()];
      rulerDrag.mode = 'twist';
      rulerDrag.start = { a, b, angle: r.angle, cx: r.cx, cy: r.cy };
    } else {
      rulerDrag.mode = handle || 'move';
      rulerDrag.start = { x, y, cx: r.cx, cy: r.cy };
    }
  }
  function rulerMove(e, x, y) {
    const r = doc.ruler;
    rulerDrag.pointers.set(e.pointerId, [x, y]);
    const s = rulerDrag.start;
    if (rulerDrag.mode === 'move') {
      r.cx = s.cx + x - s.x;
      r.cy = s.cy + y - s.y;
    } else if (rulerDrag.mode === 'rotate') {
      // Der Griff liegt senkrecht über der Mitte: Winkel zur Mitte + 90°.
      const step = e.shiftKey ? 5 : 1;
      r.angle = snapAngle((Math.atan2(y - r.cy, x - r.cx) * 180) / Math.PI + 90, step);
    } else if (rulerDrag.mode === 'resize') {
      const [lx] = pageToRuler(r, x, y);
      const L = Math.round((2 * (lx + 1.35 * CM)) / CM) * CM; // ganze Zentimeter
      r.L = Math.max(RULER_MIN, Math.min(RULER_MAX, L));
    } else if (rulerDrag.mode === 'twist') {
      const [a, b] = [...rulerDrag.pointers.values()];
      const turn = (p, q) => (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
      r.angle = snapAngle(s.angle + turn(a, b) - turn(s.a, s.b), 1);
      r.cx = s.cx + (a[0] + b[0]) / 2 - (s.a[0] + s.b[0]) / 2;
      r.cy = s.cy + (a[1] + b[1]) / 2 - (s.a[1] + s.b[1]) / 2;
    }
    placeRuler();
  }
  function rulerEnd(e) {
    rulerDrag.pointers.delete(e.pointerId);
    if (!rulerDrag.pointers.size) { rulerDrag = null; changed(); return; }
    // Ein Finger bleibt liegen: mit ihm weiter verschieben.
    const [[, pos]] = [...rulerDrag.pointers.entries()];
    rulerDrag.mode = 'move';
    rulerDrag.start = { x: pos[0], y: pos[1], cx: doc.ruler.cx, cy: doc.ruler.cy };
  }

  // ---------- Zeichnen der Beschriftung ----------
  // SVG-Elemente kennen „hidden“ nicht zuverlässig – deshalb display.
  const showSvg = (el, on) => { if (on) el.removeAttribute('display'); else el.setAttribute('display', 'none'); };
  const svgEl = (tag, attrs) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  function itemSvg(item) {
    if (item.tool === 'marker') {
      return svgEl('path', { d: polyline(item.points), stroke: item.color, 'stroke-width': item.width, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-id': item.id });
    }
    return svgEl('path', { d: strokeOutline(item.points, item.width), fill: item.color, 'data-id': item.id });
  }

  function drawItems(i) {
    const p = pages[i];
    if (!p) return;
    const items = doc.pages[i]?.items || [];
    const marker = p.svg.querySelector('.ink-marker');
    const pen = p.svg.querySelector('.ink-pen');
    marker.innerHTML = '';
    pen.innerHTML = '';
    p.texts.innerHTML = '';
    for (const item of items) {
      if (item.type === 'stroke') (item.tool === 'marker' ? marker : pen).appendChild(itemSvg(item));
      else if (item.type === 'text') p.texts.appendChild(textBox(p, item));
    }
    paintSelection();
  }

  function textBox(p, item) {
    const box = document.createElement('div');
    box.className = 'ink-text';
    box.dataset.id = item.id;
    // Bearbeitbar nur mit dem Text-Werkzeug (sonst pointer-events: none im CSS).
    box.contentEditable = 'true';
    box.spellcheck = false;
    box.style.left = `${(item.x / p.w) * 100}%`;
    box.style.top = `${(item.y / p.h) * 100}%`;
    box.style.color = item.color;
    box.style.fontSize = `calc(${item.size || TEXT_SIZE}px * var(--z))`;
    box.textContent = item.text || '';
    box.addEventListener('pointerdown', (e) => { if (state.tool === 'text') e.stopPropagation(); });
    box.addEventListener('blur', () => {
      const text = box.innerText.replace(/\s+$/, '');
      const list = doc.pages[p.i].items;
      const idx = list.findIndex((x) => x.id === item.id);
      if (idx < 0) return;
      if (text === (list[idx].text || '') && text) return;
      snapshot();
      if (!text) list.splice(idx, 1);
      else list[idx] = { ...list[idx], text, w: box.offsetWidth / state.zoom, h: box.offsetHeight / state.zoom };
      changed();
      drawItems(p.i);
    });
    return box;
  }

  // ---------- Auswahl ----------
  function clearSelection() {
    if (!state.selection) return;
    state.selection = null;
    paintSelection();
    paintToolbar();
  }

  function selectionBounds() {
    const sel = state.selection;
    if (!sel?.ids.size) return null;
    const items = doc.pages[sel.page].items.filter((x) => sel.ids.has(x.id));
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const it of items) { const b = bounds(it); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    return { x: x0 - 4, y: y0 - 4, w: x1 - x0 + 8, h: y1 - y0 + 8 };
  }

  function paintSelection() {
    for (const p of pages) {
      const box = p.svg.querySelector('.ink-sel-box');
      const b = state.selection?.page === p.i ? selectionBounds() : null;
      showSvg(box, !!b);
      if (b) for (const [k, v] of Object.entries({ x: b.x, y: b.y, width: b.w, height: b.h })) box.setAttribute(k, v);
      p.svg.querySelectorAll('[data-id]').forEach((el) => el.classList.toggle('ink-selected', !!state.selection?.ids.has(el.dataset.id) && state.selection.page === p.i));
      p.texts.querySelectorAll('[data-id]').forEach((el) => el.classList.toggle('ink-selected', !!state.selection?.ids.has(el.dataset.id) && state.selection.page === p.i));
      // Anfasser an beiden Enden gewählter Linien.
      const handles = p.el.querySelector('.ink-top .ink-handles');
      handles.innerHTML = '';
      for (const it of selectedLines(p.i)) {
        for (const [x, y] of it.points) handles.appendChild(svgEl('circle', { cx: x, cy: y, r: HANDLE / state.zoom, class: 'ink-handle' }));
      }
    }
  }

  /** Gewählte gerade Linien auf der Seite. */
  function selectedLines(page) {
    const sel = state.selection;
    if (!sel || sel.page !== page) return [];
    return (doc.pages[page]?.items || []).filter((it) => it.line && sel.ids.has(it.id));
  }

  /** Anfasser unter dem Punkt: { id, idx } oder null. */
  function handleAt(page, x, y) {
    const reach = (HANDLE * 1.6) / state.zoom;
    for (const it of selectedLines(page)) {
      for (let idx = 0; idx < it.points.length; idx++) {
        if (Math.hypot(x - it.points[idx][0], y - it.points[idx][1]) <= reach) return { id: it.id, idx };
      }
    }
    return null;
  }

  /** Strich zur geraden Linie: vom ersten bis zum letzten Punkt, mit mittlerem Druck. */
  function straighten(g) {
    const pts = g.item.points;
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(last[0] - first[0], last[1] - first[1]) < 8) return false; // ein Punkt bleibt ein Punkt
    const p = pts.reduce((a, q) => a + (q[2] ?? 0.5), 0) / pts.length;
    g.item.points = [[first[0], first[1], p], [last[0], last[1], p]];
    g.line = true;
    g.el?.setAttribute('d', g.item.tool === 'marker' ? polyline(g.item.points) : strokeOutline(g.item.points, g.item.width));
    return true;
  }

  function deleteSelection() {
    const sel = state.selection;
    if (!sel?.ids.size) return;
    snapshot();
    doc.pages[sel.page].items = doc.pages[sel.page].items.filter((x) => !sel.ids.has(x.id));
    state.selection = null;
    changed();
    drawItems(sel.page);
  }

  // ---------- Eingabe ----------
  let penDown = false;

  function bindInput(p) {
    const toPage = (e) => {
      const r = p.svg.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * p.w, ((e.clientY - r.top) / r.height) * p.h];
    };
    let gesture = null;

    p.el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen') penDown = true;
      // Handballen: Solange der Stift schreibt, zählt kein Finger.
      if (e.pointerType === 'touch' && penDown) return;
      if (e.button > 0 && e.button !== 5) return;
      const [x, y] = toPage(e);
      // Stift mit Radierer-Ende (Windows Ink / Wacom): radiert.
      const tool = e.button === 5 || (e.buttons & 32) ? 'eraser' : state.tool;
      const draws = e.pointerType !== 'touch' || state.fingerDraws;

      // Geodreieck: Griffe drehen/vergrößern; setzt der Stift an einer Kante
      // an, läuft der Strich genau an ihr entlang; sonst wird es verschoben.
      const ruler = doc.ruler?.visible && doc.ruler.page === p.i ? doc.ruler : null;
      let snap = null;
      // Im Auswahl-Modus gehen Anfasser und Striche vor – auch unter dem Geodreieck
      // (sonst käme man an Linien entlang seiner Kante nicht heran).
      const selectsHere = tool === 'select' && (handleAt(p.i, x, y) || itemAt(doc.pages[p.i].items, x, y, 6 / state.zoom));
      if (ruler && !selectsHere) {
        const inside = inRuler(ruler, x, y);
        const handle = inside ? rulerHandleAt(ruler, x, y) : null;
        if (!handle && draws && (tool === 'pen' || tool === 'marker')) snap = nearEdge(ruler, x, y, RULER_REACH / state.zoom);
        if (handle || (inside && !snap) || (rulerDrag && e.pointerType === 'touch' && inside)) {
          e.preventDefault();
          p.el.setPointerCapture?.(e.pointerId);
          rulerStart(e, x, y, handle);
          return;
        }
      }

      // Ohne „Mit Finger zeichnen“ scrollt der Finger (touch-action im CSS).
      if (!draws) return;
      e.preventDefault();
      p.el.setPointerCapture?.(e.pointerId);

      if (tool === 'pen' || tool === 'marker') {
        const marker = tool === 'marker';
        gesture = {
          kind: 'stroke', id: e.pointerId,
          item: { id: uid(), type: 'stroke', tool, color: marker ? state.marker : state.color, width: WIDTHS[tool][state.widthIdx], points: [] },
          snap,
        };
        const [sx, sy] = snap ? projectOnSegment(x, y, snap[0], snap[1]) : [x, y];
        gesture.item.points.push([sx, sy, pressureOf(e)]);
        gesture.el = itemSvg(gesture.item);
        p.svg.querySelector(marker ? '.ink-marker' : '.ink-live').appendChild(gesture.el);
        gesture.anchor = [e.clientX, e.clientY];
        holdTimer(gesture);
      } else if (tool === 'eraser') {
        gesture = { kind: 'erase', id: e.pointerId, removed: false };
        erase(p.i, x, y, gesture);
      } else if (tool === 'select') {
        const base = () => doc.pages[p.i].items.map((it) => ({ ...it }));
        const handle = handleAt(p.i, x, y);
        const b = state.selection?.page === p.i ? selectionBounds() : null;
        const hit = itemAt(doc.pages[p.i].items, x, y, 6 / state.zoom);
        if (handle) {
          gesture = { kind: 'handle', id: e.pointerId, item: handle.id, idx: handle.idx, base: base() };
        } else if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          gesture = { kind: 'move', id: e.pointerId, from: [x, y], base: base() };
        } else if (hit) {
          // Antippen wählt das Element (eine Linie zeigt ihre Anfasser) – gleich weiterziehen verschiebt es.
          state.selection = { page: p.i, ids: new Set([hit.id]) };
          paintSelection();
          paintToolbar();
          gesture = { kind: 'move', id: e.pointerId, from: [x, y], base: base() };
        } else {
          clearSelection();
          gesture = { kind: 'rect', id: e.pointerId, from: [x, y] };
        }
      } else if (tool === 'text') {
        snapshot();
        const item = { id: uid(), type: 'text', x, y: y - TEXT_SIZE * 0.7, w: 160, h: TEXT_SIZE * 1.4, text: '', color: state.color, size: TEXT_SIZE };
        doc.pages[p.i].items.push(item);
        const box = textBox(p, item);
        p.texts.appendChild(box);
        setTimeout(() => box.focus(), 0);
        state.undo.pop(); // erst beim Schreiben zählt es (blur)
      }
    });

    const move = (e) => {
      if (rulerDrag?.pointers.has(e.pointerId)) { const [x, y] = toPage(e); rulerMove(e, x, y); return; }
      if (!gesture || e.pointerId !== gesture.id) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (gesture.kind === 'stroke') {
        // Bewegt sich der Stift, beginnt das Warten aufs Stillhalten neu.
        if (Math.hypot(e.clientX - gesture.anchor[0], e.clientY - gesture.anchor[1]) > HOLD_SLACK) {
          gesture.anchor = [e.clientX, e.clientY];
          holdTimer(gesture);
        }
        if (gesture.line) {
          // Schon eine Linie: das Ende folgt dem Stift (am Geodreieck auf der Kante).
          let [x, y] = toPage(e);
          if (gesture.snap) [x, y] = projectOnSegment(x, y, gesture.snap[0], gesture.snap[1]);
          gesture.item.points[1] = [x, y, gesture.item.points[0][2]];
          gesture.el.setAttribute('d', gesture.item.tool === 'marker' ? polyline(gesture.item.points) : strokeOutline(gesture.item.points, gesture.item.width));
          return;
        }
        for (const ev of events.length ? events : [e]) {
          let [x, y] = toPage(ev);
          // Am Geodreieck: genau auf der Kante bleiben.
          if (gesture.snap) [x, y] = projectOnSegment(x, y, gesture.snap[0], gesture.snap[1]);
          const last = gesture.item.points[gesture.item.points.length - 1];
          if (Math.hypot(x - last[0], y - last[1]) < 0.4) continue;
          gesture.item.points.push([x, y, pressureOf(ev)]);
        }
        if (!gesture.raf) {
          gesture.raf = requestAnimationFrame(() => {
            gesture && gesture.el && gesture.el.setAttribute('d', gesture.item.tool === 'marker' ? polyline(gesture.item.points) : strokeOutline(gesture.item.points, gesture.item.width));
            if (gesture) gesture.raf = 0;
          });
        }
      } else if (gesture.kind === 'erase') {
        const [x, y] = toPage(e);
        erase(p.i, x, y, gesture);
      } else if (gesture.kind === 'rect') {
        const [x, y] = toPage(e);
        const r = p.svg.querySelector('.ink-sel-rect');
        showSvg(r, true);
        const [fx, fy] = gesture.from;
        for (const [k, v] of Object.entries({ x: Math.min(fx, x), y: Math.min(fy, y), width: Math.abs(x - fx), height: Math.abs(y - fy) })) r.setAttribute(k, v);
        gesture.to = [x, y];
      } else if (gesture.kind === 'handle') {
        let [x, y] = toPage(e);
        // Am Geodreieck rastet das Ende auf der Kante ein.
        const ruler = doc.ruler?.visible && doc.ruler.page === p.i ? doc.ruler : null;
        const edge = ruler ? nearEdge(ruler, x, y, RULER_REACH / state.zoom) : null;
        if (edge) [x, y] = projectOnSegment(x, y, edge[0], edge[1]);
        doc.pages[p.i].items = gesture.base.map((it) => {
          if (it.id !== gesture.item) return it;
          const points = it.points.map((q) => q.slice());
          points[gesture.idx] = [x, y, points[gesture.idx][2]];
          return { ...it, points };
        });
        gesture.moved = true;
        drawItems(p.i);
      } else if (gesture.kind === 'move') {
        const [x, y] = toPage(e);
        const dx = x - gesture.from[0];
        const dy = y - gesture.from[1];
        doc.pages[p.i].items = gesture.base.map((it) => (state.selection.ids.has(it.id) ? moved(it, dx, dy) : it));
        gesture.moved = true;
        drawItems(p.i);
      }
    };

    const up = (e) => {
      if (e.pointerType === 'pen') penDown = false;
      if (rulerDrag?.pointers.has(e.pointerId)) { rulerEnd(e); return; }
      if (!gesture || e.pointerId !== gesture.id) return;
      const g = gesture;
      gesture = null;
      if (g.raf) cancelAnimationFrame(g.raf);
      if (g.kind === 'stroke') {
        clearTimeout(g.hold);
        g.el.remove();
        // Am Geodreieck gezogen: eine Linie zwischen den äußersten Punkten.
        if (g.snap && !g.line && g.item.points.length > 1) {
          const [lo, hi] = extremesAlong(g.item.points, g.snap[0], g.snap[1]);
          if (Math.hypot(hi[0] - lo[0], hi[1] - lo[1]) >= 2) { g.item.points = [lo, hi]; g.line = true; }
        }
        if (g.line) g.item.line = true;
        snapshot();
        doc.pages[p.i].items.push(g.item);
        changed();
        drawItems(p.i);
      } else if (g.kind === 'erase') {
        if (g.removed) changed();
      } else if (g.kind === 'rect') {
        showSvg(p.svg.querySelector('.ink-sel-rect'), false);
        if (g.to) {
          const rect = { x: g.from[0], y: g.from[1], w: g.to[0] - g.from[0], h: g.to[1] - g.from[1] };
          const ids = new Set(doc.pages[p.i].items.filter((it) => inSelection(it, rect)).map((it) => it.id));
          state.selection = ids.size ? { page: p.i, ids } : null;
          paintSelection();
          paintToolbar();
        }
      } else if ((g.kind === 'move' || g.kind === 'handle') && g.moved) {
        state.undo.push(JSON.stringify(doc.pages.map((pg, i) => (i === p.i ? { ...pg, items: g.base } : pg))));
        state.redo = [];
        changed();
      }
    };
    p.el.addEventListener('pointermove', move);
    p.el.addEventListener('pointerup', up);
    p.el.addEventListener('pointercancel', up);
  }

  /** Nach HOLD_MS ohne Bewegung wird der Strich zur Linie (nicht am Geodreieck – da ist er schon gerade). */
  function holdTimer(g) {
    clearTimeout(g.hold);
    if (g.line || g.snap) return;
    g.hold = setTimeout(() => straighten(g), HOLD_MS);
  }

  function pressureOf(e) {
    // Maus und manche Finger melden 0 oder 0,5 – dann gleichmäßig mittel.
    return e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
  }

  /** Striche unter dem Radierer löschen – ein Wisch ist ein Schritt fürs Rückgängigmachen. */
  function erase(page, x, y, g) {
    const list = doc.pages[page]?.items || [];
    // Auf dem Bildschirm gleich groß, egal wie weit hineingezoomt ist.
    const radius = ERASER / Math.max(0.6, state.zoom);
    const keep = list.filter((it) => !(it.type === 'stroke' && hitsStroke(it, x, y, radius)));
    if (keep.length === list.length) return;
    if (!g.removed) snapshot();
    g.removed = true;
    doc.pages[page].items = keep;
    drawItems(page);
  }

  // ---------- Tastatur und Schließen ----------
  const onKey = (e) => {
    if (e.target.closest?.('.ink-text')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection) { e.preventDefault(); deleteSelection(); }
    else if (e.key === 'Escape') clearSelection();
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); history(e.shiftKey ? state.redo : state.undo, e.shiftKey ? state.undo : state.redo); }
  };
  document.addEventListener('keydown', onKey);

  async function close() {
    if (document.activeElement?.classList?.contains('ink-text')) document.activeElement.blur();
    await persist();
    document.removeEventListener('keydown', onKey);
    for (const v of Object.values(pdfs)) Promise.resolve(v).then((d) => d?.destroy?.()).catch(() => {});
    overlay.remove();
    document.body.classList.remove('ink-open');
  }

  paintToolbar();
  await layout();
  return { close };
}
