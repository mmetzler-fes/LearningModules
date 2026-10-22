import { A4, strokeOutline, polyline, hitsStroke, bounds, inSelection, moved, ruling } from './ink-geometry.js';

// ==================== STIFT-EDITOR ====================
//
// Ein Arbeitsblatt mit Stift (iPad), Finger oder Maus bearbeiten – wie auf
// Papier. Unten liegt der Hintergrund (das PDF des Blatts, Karo, Linien,
// leer oder ein eigenes Bild/PDF), darüber eine Ebene zum Beschriften:
// Stift mit Druck, Textmarker, Radierer, Auswahl (verschieben, löschen),
// Textfelder. In der Ansicht der Lehrkraft lässt sich das Lösungsblatt als
// Hintergrund einblenden.
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
        <rect class="ink-sel-rect" hidden></rect><rect class="ink-sel-box" hidden></rect>
      </svg>
      <div class="ink-texts"></div>`;
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

  // ---------- Zeichnen der Beschriftung ----------
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
      box.hidden = !b;
      if (b) for (const [k, v] of Object.entries({ x: b.x, y: b.y, width: b.w, height: b.h })) box.setAttribute(k, v);
      p.svg.querySelectorAll('[data-id]').forEach((el) => el.classList.toggle('ink-selected', !!state.selection?.ids.has(el.dataset.id) && state.selection.page === p.i));
      p.texts.querySelectorAll('[data-id]').forEach((el) => el.classList.toggle('ink-selected', !!state.selection?.ids.has(el.dataset.id) && state.selection.page === p.i));
    }
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
      // Handballen: Solange der Stift schreibt, zählt kein Finger. Ohne
      // „Mit Finger zeichnen“ scrollt der Finger (touch-action im CSS).
      if (e.pointerType === 'touch' && (penDown || !state.fingerDraws)) return;
      if (e.button > 0 && e.button !== 5) return;
      const [x, y] = toPage(e);
      // Stift mit Radierer-Ende (Windows Ink / Wacom): radiert.
      const tool = e.button === 5 || (e.buttons & 32) ? 'eraser' : state.tool;
      e.preventDefault();
      p.el.setPointerCapture?.(e.pointerId);

      if (tool === 'pen' || tool === 'marker') {
        const marker = tool === 'marker';
        gesture = {
          kind: 'stroke', id: e.pointerId,
          item: { id: uid(), type: 'stroke', tool, color: marker ? state.marker : state.color, width: WIDTHS[tool][state.widthIdx], points: [[x, y, pressureOf(e)]] },
        };
        gesture.el = itemSvg(gesture.item);
        p.svg.querySelector(marker ? '.ink-marker' : '.ink-live').appendChild(gesture.el);
      } else if (tool === 'eraser') {
        gesture = { kind: 'erase', id: e.pointerId, removed: false };
        erase(p.i, x, y, gesture);
      } else if (tool === 'select') {
        const b = state.selection?.page === p.i ? selectionBounds() : null;
        if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          gesture = { kind: 'move', id: e.pointerId, from: [x, y], base: doc.pages[p.i].items.map((it) => ({ ...it })) };
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
      if (!gesture || e.pointerId !== gesture.id) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (gesture.kind === 'stroke') {
        for (const ev of events.length ? events : [e]) {
          const [x, y] = toPage(ev);
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
        r.hidden = false;
        const [fx, fy] = gesture.from;
        for (const [k, v] of Object.entries({ x: Math.min(fx, x), y: Math.min(fy, y), width: Math.abs(x - fx), height: Math.abs(y - fy) })) r.setAttribute(k, v);
        gesture.to = [x, y];
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
      if (!gesture || e.pointerId !== gesture.id) return;
      const g = gesture;
      gesture = null;
      if (g.raf) cancelAnimationFrame(g.raf);
      if (g.kind === 'stroke') {
        g.el.remove();
        snapshot();
        doc.pages[p.i].items.push(g.item);
        changed();
        drawItems(p.i);
      } else if (g.kind === 'erase') {
        if (g.removed) changed();
      } else if (g.kind === 'rect') {
        p.svg.querySelector('.ink-sel-rect').hidden = true;
        if (g.to) {
          const rect = { x: g.from[0], y: g.from[1], w: g.to[0] - g.from[0], h: g.to[1] - g.from[1] };
          const ids = new Set(doc.pages[p.i].items.filter((it) => inSelection(it, rect)).map((it) => it.id));
          state.selection = ids.size ? { page: p.i, ids } : null;
          paintSelection();
          paintToolbar();
        }
      } else if (g.kind === 'move' && g.moved) {
        state.undo.push(JSON.stringify(doc.pages.map((pg, i) => (i === p.i ? { ...pg, items: g.base } : pg))));
        state.redo = [];
        changed();
      }
    };
    p.el.addEventListener('pointermove', move);
    p.el.addEventListener('pointerup', up);
    p.el.addEventListener('pointercancel', up);
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
