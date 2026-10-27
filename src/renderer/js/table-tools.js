import { showContextMenu } from '../lm-editor/src/util/dom.js';
import { LINE_COLORS, CELL_BACKGROUNDS } from '../lm-editor/src/doc/docspec.js';

const LINE_COLOR_NAMES = [['', 'schwarz'], ['grau', 'grau'], ['blau', 'blau'], ['gruen', 'grün'], ['orange', 'orange'], ['lila', 'lila']];
const BG_NAMES = [['', 'keine'], ['grau', '⬜ grau'], ['gelb', '🟨 gelb'], ['gruen', '🟩 grün'], ['blau', '🟦 blau'], ['rosa', '🩷 rosa']];

// ==================== TABELLEN IM DOKUMENT-EDITOR ====================
//
// Steht die Schreibmarke in einer Tabelle der Schreibfläche, erscheint eine
// Leiste: Zeilen und Spalten einfügen oder löschen, Kopfzeile und Linien
// umschalten, Breite der Spalte und Höhe der Zeile in cm. Spalten- und
// Zeilenränder lassen sich auch mit der Maus ziehen.
//
// Alles ändert nur das HTML der Fläche; der Editor liest es wie jede andere
// Bearbeitung zurück (docspec-html.js: <col style="width"> → widths,
// <tr style="height"> → heights). Verbundene Zellen (colspan/rowspan)
// bleiben dabei richtig: Gerechnet wird auf dem Raster der Tabelle.

const PX_PER_CM = 96 / 2.54;
// Linien der Tabelle (lineWidth in pt, lineStyle) – „0“ heißt ohne Linien (border: false).
const LINE_WIDTHS = [['0', 'ohne'], ['0.5', '0,5 pt'], ['', 'normal'], ['1', '1 pt'], ['1.5', '1,5 pt'], ['2.25', '2,25 pt']];
const LINE_STYLES = [['', '━ durchgezogen'], ['dashed', '┅ gestrichelt'], ['dotted', '┈ gepunktet']];

/** Linien einer Tabelle im Editor setzen (wie docspec-html.js sie liest). */
function setLines(table, { width, style, color }) {
  if (width !== undefined) {
    table.classList.toggle('ws-table-plain', width === '0');
    if (width && width !== '0') table.dataset.lineWidth = width; else delete table.dataset.lineWidth;
  }
  if (style !== undefined) {
    if (style) table.dataset.lineStyle = style; else delete table.dataset.lineStyle;
  }
  if (color !== undefined) {
    if (LINE_COLORS[color]) table.dataset.lineColor = color; else delete table.dataset.lineColor;
  }
  const w = table.dataset.lineWidth;
  const st = table.dataset.lineStyle;
  const c = table.dataset.lineColor;
  if (w || st || c) {
    table.style.setProperty('--ds-line-w', `${w || 0.75}pt`);
    table.style.setProperty('--ds-line-s', st || 'solid');
    table.style.setProperty('--ds-line-c', LINE_COLORS[c] || LINE_COLORS.schwarz);
  } else ['--ds-line-w', '--ds-line-s', '--ds-line-c'].forEach((v) => table.style.removeProperty(v));
  if (!table.getAttribute('style')) table.removeAttribute('style');
  if (!table.getAttribute('class')) table.removeAttribute('class');
}
const EDGE_PX = 5;
let surfaces = 0;

const rowsOf = (table) => [...table.children].flatMap((c) => (c.tagName === 'TR' ? [c]
  : ['THEAD', 'TBODY', 'TFOOT'].includes(c.tagName) ? [...c.children].filter((r) => r.tagName === 'TR') : []));
const cellsOf = (tr) => [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
const spanOf = (td, name) => Math.max(1, Number(td.getAttribute(name)) || 1);

/** Raster: map[r][c] = Zelle, die diese Stelle belegt; start = Zeile/Spalte jeder Zelle. */
function grid(table) {
  const rows = rowsOf(table);
  const map = rows.map(() => []);
  const start = new Map();
  rows.forEach((tr, r) => {
    let c = 0;
    for (const td of cellsOf(tr)) {
      while (map[r][c]) c++;
      start.set(td, { r, c });
      for (let dr = 0; dr < spanOf(td, 'rowspan'); dr++) {
        for (let dc = 0; dc < spanOf(td, 'colspan'); dc++) {
          if (!map[r + dr]) map[r + dr] = [];
          map[r + dr][c + dc] = td;
        }
      }
      c += spanOf(td, 'colspan');
    }
  });
  const cols = Math.max(1, ...map.map((r) => r.length));
  return { rows, map, start, cols };
}

const setSpan = (td, name, n) => { if (n > 1) td.setAttribute(name, String(n)); else td.removeAttribute(name); };

function newCell(tr) {
  const td = document.createElement(tr.parentNode?.tagName === 'THEAD' ? 'th' : 'td');
  td.innerHTML = '<br>';
  return td;
}

/** Zelle `td` in Zeile r an Spalte c einordnen (vor die erste Zelle dieser Zeile weiter rechts). */
function placeCell(g, r, c, td) {
  const tr = g.rows[r];
  const next = cellsOf(tr).find((x) => g.start.get(x)?.c > c);
  tr.insertBefore(td, next || null);
}

/** <colgroup> mit genau `cols` Spalten (fehlende ergänzt). */
function colgroup(table, cols) {
  let group = [...table.children].find((c) => c.tagName === 'COLGROUP');
  if (!group) {
    group = document.createElement('colgroup');
    table.insertBefore(group, table.firstChild);
  }
  while (group.children.length < cols) group.appendChild(document.createElement('col'));
  return group;
}

function dropEmptyColgroup(table) {
  const group = [...table.children].find((c) => c.tagName === 'COLGROUP');
  if (group && ![...group.children].some((c) => c.style.width)) group.remove();
}

// ---------- Zeilen ----------

/** Neue Zeile so, dass sie Zeile `at` wird (0 … Anzahl). */
function insertRow(table, at) {
  const g = grid(table);
  const above = g.rows[at - 1];
  const below = g.rows[at];
  const tr = document.createElement('tr');
  // In die Kopfzeile kommt keine zweite Zeile – dann an den Anfang des Rumpfs.
  if (above && above.parentNode.tagName === 'THEAD') {
    let body = [...table.children].find((c) => c.tagName === 'TBODY');
    if (!body) { body = document.createElement('tbody'); table.appendChild(body); }
    body.insertBefore(tr, body.firstChild);
  } else if (above) above.after(tr);
  else below.before(tr);
  const grown = new Set();
  for (let c = 0; c < g.cols; c++) {
    const a = g.map[at - 1]?.[c];
    if (a && a === g.map[at]?.[c] && above?.parentNode.tagName !== 'THEAD') {
      if (!grown.has(a)) { grown.add(a); setSpan(a, 'rowspan', spanOf(a, 'rowspan') + 1); }
      c += spanOf(a, 'colspan') - 1;
    } else tr.appendChild(newCell(tr));
  }
  return tr;
}

function deleteRow(table, r) {
  const g = grid(table);
  if (g.rows.length <= 1) { table.remove(); return; }
  const done = new Set();
  for (let c = 0; c < g.cols; c++) {
    const td = g.map[r]?.[c];
    if (!td || done.has(td)) continue;
    done.add(td);
    const rs = spanOf(td, 'rowspan');
    if (rs < 2) continue;
    // Reicht die Zelle über die Zeile hinaus, bleibt sie – eine Zeile kürzer.
    setSpan(td, 'rowspan', rs - 1);
    if (g.start.get(td).r === r) placeCell(g, r + 1, g.start.get(td).c, td);
  }
  const tr = g.rows[r];
  const parent = tr.parentNode;
  tr.remove();
  if (parent !== table && !parent.children.length) parent.remove();
}

// ---------- Spalten ----------

/** Neue Spalte so, dass sie Spalte `at` wird (0 … Anzahl). */
function insertColumn(table, at) {
  const g = grid(table);
  const grown = new Set();
  g.rows.forEach((tr, r) => {
    const left = g.map[r][at - 1];
    if (left && left === g.map[r][at]) {
      if (!grown.has(left)) { grown.add(left); setSpan(left, 'colspan', spanOf(left, 'colspan') + 1); }
      return;
    }
    placeCell(g, r, at - 0.5, newCell(tr));
  });
  const group = [...table.children].find((c) => c.tagName === 'COLGROUP');
  if (group) {
    colgroup(table, g.cols);
    group.insertBefore(document.createElement('col'), group.children[at] || null);
  }
}

function deleteColumn(table, c) {
  const g = grid(table);
  if (g.cols <= 1) { table.remove(); return; }
  const done = new Set();
  g.rows.forEach((_, r) => {
    const td = g.map[r][c];
    if (!td || done.has(td)) return;
    done.add(td);
    const cs = spanOf(td, 'colspan');
    if (cs > 1) setSpan(td, 'colspan', cs - 1); else td.remove();
  });
  const group = [...table.children].find((x) => x.tagName === 'COLGROUP');
  group?.children[c]?.remove();
  dropEmptyColgroup(table);
}

// ---------- Kopfzeile ----------

function retag(cell, tag) {
  const el = document.createElement(tag);
  for (const a of cell.attributes) el.setAttribute(a.name, a.value);
  while (cell.firstChild) el.appendChild(cell.firstChild);
  cell.replaceWith(el);
}

function toggleHeader(table) {
  const head = [...table.children].find((c) => c.tagName === 'THEAD');
  let body = [...table.children].find((c) => c.tagName === 'TBODY');
  if (head) {
    if (!body) { body = document.createElement('tbody'); table.appendChild(body); }
    for (const tr of [...head.children].reverse()) {
      cellsOf(tr).forEach((c) => retag(c, 'td'));
      body.insertBefore(tr, body.firstChild);
    }
    head.remove();
    return;
  }
  const first = rowsOf(table)[0];
  if (!first) return;
  const thead = document.createElement('thead');
  const group = [...table.children].find((c) => c.tagName === 'COLGROUP');
  table.insertBefore(thead, group ? group.nextSibling : table.firstChild);
  thead.appendChild(first);
  cellsOf(first).forEach((c) => retag(c, 'th'));
}

// ---------- Größen ----------

const cmText = (px) => (Math.round((px / PX_PER_CM) * 10) / 10).toString().replace('.', ',');
const parseCm = (text) => {
  const n = Number(String(text).trim().replace(',', '.').replace(/\s*cm$/i, ''));
  return Number.isFinite(n) && n >= 0.2 && n <= 40 ? Math.round(n * 10) / 10 : null;
};

/** Breite der Spalte c in px – gemessen an einer Zelle ohne Verbund. */
function columnPx(g, c) {
  for (let r = 0; r < g.rows.length; r++) {
    const td = g.map[r]?.[c];
    if (td && spanOf(td, 'colspan') === 1) return td.getBoundingClientRect().width;
  }
  return 0;
}

function setColumnWidth(table, c, cm) {
  const g = grid(table);
  const col = colgroup(table, g.cols).children[c];
  if (cm) col.style.width = `${cm}cm`; else col.style.removeProperty('width');
  if (!col.getAttribute('style')) col.removeAttribute('style');
  dropEmptyColgroup(table);
}

function setRowHeight(tr, cm) {
  if (cm) tr.style.height = `${cm}cm`; else tr.style.removeProperty('height');
  if (!tr.getAttribute('style')) tr.removeAttribute('style');
}

// ---------- Leiste und Ziehen ----------

/**
 * Tabellenwerkzeuge an eine Schreibfläche hängen. `bar`: Element, in das die
 * Leiste kommt (sichtbar nur, solange die Schreibmarke in einer Tabelle steht).
 */
export function attachTableTools(surface, bar) {
  bar.classList.add('ds-tablebar', 'rich-text-toolbar');
  bar.hidden = true;
  bar.innerHTML = `
    <span class="ds-tablebar-label">▤ Tabelle</span>
    <button type="button" class="rt-btn ds-tb-notcols" data-t="rowAbove" title="Zeile darüber einfügen">⬆＋</button>
    <button type="button" class="rt-btn ds-tb-notcols" data-t="rowBelow" title="Zeile darunter einfügen">⬇＋</button>
    <button type="button" class="rt-btn ds-tb-notcols" data-t="rowDel" title="Zeile löschen">✕ Zeile</button>
    <span class="ds-tablebar-sep ds-tb-notcols"></span>
    <button type="button" class="rt-btn" data-t="colLeft" title="Spalte links einfügen">⬅＋</button>
    <button type="button" class="rt-btn" data-t="colRight" title="Spalte rechts einfügen">➡＋</button>
    <button type="button" class="rt-btn" data-t="colDel" title="Spalte löschen">✕ Spalte</button>
    <span class="ds-tablebar-sep"></span>
    <label title="Breite dieser Spalte in cm – leer = automatisch (auch: Spaltenrand ziehen)">↔ <input type="text" class="ds-tb-width" inputmode="decimal" placeholder="auto" size="4"> cm</label>
    <label class="ds-tb-notcols" title="Mindesthöhe dieser Zeile in cm – leer = automatisch (auch: unteren Zeilenrand ziehen)">↕ <input type="text" class="ds-tb-height" inputmode="decimal" placeholder="auto" size="4"> cm</label>
    <span class="ds-tablebar-sep ds-tb-notcols"></span>
    <button type="button" class="rt-btn ds-tb-notcols" data-t="alignLeft" title="Linksbündig – diese Zelle, bei „Ganze Tabelle“ alle">⇤</button>
    <button type="button" class="rt-btn ds-tb-notcols" data-t="alignCenter" title="Zentriert – diese Zelle, bei „Ganze Tabelle“ alle">↔</button>
    <button type="button" class="rt-btn ds-tb-notcols" data-t="alignRight" title="Rechtsbündig – diese Zelle, bei „Ganze Tabelle“ alle">⇥</button>
    <button type="button" class="rt-btn" data-t="valignTop" title="Oben – diese Zelle, bei „Ganze Tabelle“ alle">⤒</button>
    <button type="button" class="rt-btn" data-t="valignMiddle" title="Mitte (senkrecht) – diese Zelle, bei „Ganze Tabelle“ alle">⇕</button>
    <button type="button" class="rt-btn" data-t="valignBottom" title="Unten – diese Zelle, bei „Ganze Tabelle“ alle">⤓</button>
    <span class="ds-tablebar-sep"></span>
    <label class="ds-tb-notcols" title="Erste Zeile als Kopfzeile (fett)"><input type="checkbox" class="ds-tb-head"> Kopfzeile</label>
    <label class="ds-tb-notcols ds-tb-beside-label" title="Bilder dieser Zelle neben dem Text statt darunter"><input type="checkbox" class="ds-tb-beside"> Bild neben Text</label>
    <label class="ds-tb-notcols" title="Linien der ganzen Tabelle – „ohne“ z. B. für Abbildungen nebeneinander">Linien
      <select class="ds-tb-lw">${LINE_WIDTHS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <select class="ds-tb-ls">${LINE_STYLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <select class="ds-tb-lc" title="Rahmenfarbe">${LINE_COLOR_NAMES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
    <label class="ds-tb-notcols" title="Hintergrund dieser Zelle – bei „Ganze Tabelle“ aller Zellen">Zellfarbe
      <select class="ds-tb-bg">${BG_NAMES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
    <span class="ds-tablebar-sep"></span>
    <button type="button" class="rt-btn" data-t="selectTable" title="Ganze Tabelle wählen – dann gelten ↔ Breite und ↕ Höhe für alle Spalten bzw. Zeilen; Strg+C / Strg+X">⬚ Ganze Tabelle</button>
    <button type="button" class="rt-btn" data-t="cutTable" title="Tabelle ausschneiden – danach in eine Zelle einer anderen Tabelle oder zwischen Absätze einfügen">✂ Ausschneiden</button>
    <button type="button" class="rt-btn ds-tb-paste" data-t="pasteTable" title="Ausgeschnittene Tabelle hier einfügen – in diese Zelle" hidden>📥 Tabelle hier einfügen</button>
    <button type="button" class="rt-btn" data-t="evenWidths" title="Alle festen Breiten entfernen – die Spalten richten sich wieder nach dem Inhalt">⇔ auto</button>
    <button type="button" class="rt-btn ds-tb-danger" data-t="tableDel" title="Ganze Tabelle löschen">🗑</button>`;
  const widthIn = bar.querySelector('.ds-tb-width');
  const heightIn = bar.querySelector('.ds-tb-height');
  const headBox = bar.querySelector('.ds-tb-head');
  const lwSel = bar.querySelector('.ds-tb-lw');
  const lsSel = bar.querySelector('.ds-tb-ls');
  const lcSel = bar.querySelector('.ds-tb-lc');
  const bgSel = bar.querySelector('.ds-tb-bg');
  const besideBox = bar.querySelector('.ds-tb-beside');

  // Zuletzt gewählte Zelle – die Leiste wirkt auf sie, auch wenn der Fokus im Eingabefeld steht.
  let cell = null;
  // Ausgeschnittene Tabelle, bis sie woanders eingefügt ist (in eine Zelle oder per Hinweis zwischen Absätze).
  let held = null;
  const pasteBtn = bar.querySelector('.ds-tb-paste');
  const holdNote = document.createElement('div');
  holdNote.className = 'ds-tb-hold hint';
  holdNote.hidden = true;
  holdNote.innerHTML = '✂ Tabelle ausgeschnitten – Schreibmarke setzen, dann <b>Strg+V</b> oder: <button type="button" class="rt-btn" data-hold="cell">in die Zelle der Schreibmarke</button> <button type="button" class="rt-btn" data-hold="here">hinter den Absatz der Schreibmarke</button> <button type="button" class="rt-btn" data-hold="undo">zurück an die alte Stelle</button>';
  bar.after(holdNote);
  let heldFrom = null;
  const showPaste = () => {
    pasteBtn.hidden = !held;
    holdNote.hidden = !held;
  };
  // Wo die Schreibmarke zuletzt in der Fläche stand (auch außerhalb von Tabellen).
  let lastNode = null;
  holdNote.addEventListener('mousedown', (e) => e.preventDefault());
  /** Ausgeschnittene Tabelle einsetzen: 'cell' (in die Zelle der Schreibmarke), 'after' (hinter ihren Absatz), 'undo'. */
  const placeHeld = (what) => {
    if (!held) return;
    if (what === 'cell' && cell?.isConnected) {
      // Leere Zelle (nur <br>): die Tabelle ersetzt den Platzhalter.
      if (!cell.textContent.trim() && !cell.querySelector('img, table')) cell.innerHTML = '';
      cell.appendChild(held);
    } else if (what === 'undo') {
      const { parent, next } = heldFrom || {};
      if (parent?.isConnected) parent.insertBefore(held, next?.parentNode === parent ? next : null);
      else surface.appendChild(held);
    } else {
      // Hinter den Block der Schreibmarke: direktes Kind der Fläche, eines Kastens oder einer Zelle.
      let n = lastNode && surface.contains(lastNode) ? (lastNode.nodeType === 3 ? lastNode.parentNode : lastNode) : null;
      while (n && n !== surface && !(n.parentNode === surface || n.parentNode?.matches?.('div.ws-box, td, th'))) n = n.parentNode;
      if (n && n !== surface) n.after(held); else surface.appendChild(held);
    }
    const placed = held;
    const first = cellsOf(rowsOf(placed)[0] || document.createElement('tr'))[0];
    held = null;
    showPaste();
    if (first) focusCell(first);
    selectTable(placed);
  };
  const cutTable = (table) => {
    selectTable(null);
    heldFrom = { parent: table.parentNode, next: table.nextSibling };
    held = table;
    table.remove();
    focusCell(null);
    showPaste();
  };
  holdNote.addEventListener('click', (e) => {
    const what = e.target.closest('[data-hold]')?.dataset.hold;
    if (what) placeHeld(what === 'here' ? 'after' : what);
  });
  const tableOf = (td) => td?.closest('table');
  /** Ist die ganze Tabelle gewählt (Rahmen)? Dann gelten Breite und Höhe für alle. */
  const wholeTable = (table) => !!table && table.classList.contains('ds-table-selected');
  const editable = (table) => table && surface.contains(table) && !table.closest('.ds-widget');

  const pos = () => {
    const table = tableOf(cell);
    if (!editable(table)) return null;
    const g = grid(table);
    const at = g.start.get(cell);
    return at ? { table, g, ...at, cs: spanOf(cell, 'colspan'), rs: spanOf(cell, 'rowspan') } : null;
  };

  const show = () => {
    const p = pos();
    // Die eigene Leistenzeile bleibt verborgen – Rechtsklick und „Tabelle ▾“ ersetzen sie.
    bar.hidden = true;
    if (!p) { placeCellUi(); return; }
    // Spalten (table.ws-columns): nur Spalten einfügen/löschen und Breite.
    const columns = p.table.classList.contains('ws-columns');
    bar.classList.toggle('ds-tb-columns', columns);
    const whole = wholeTable(p.table);
    bar.querySelector('.ds-tablebar-label').textContent = columns ? '▥ Spalten' : whole ? '▤ Ganze Tabelle' : '▤ Tabelle';
    const col = [...p.table.children].find((c) => c.tagName === 'COLGROUP')?.children[p.c + p.cs - 1];
    if (document.activeElement !== widthIn) widthIn.value = col?.style.width ? String(parseFloat(col.style.width)).replace('.', ',') : '';
    const tr = p.g.rows[p.r];
    // Ganze Tabelle: die gemeinsame Höhe aller Zeilen (sonst leer).
    const heights = whole ? [...new Set(p.g.rows.map((r) => r.style.height || ''))] : [tr.style.height || ''];
    if (document.activeElement !== heightIn) heightIn.value = heights.length === 1 && heights[0] ? String(parseFloat(heights[0])).replace('.', ',') : '';
    headBox.checked = [...p.table.children].some((c) => c.tagName === 'THEAD');
    lwSel.value = p.table.classList.contains('ws-table-plain') ? '0' : p.table.dataset.lineWidth || '';
    lsSel.value = p.table.dataset.lineStyle || '';
    lsSel.disabled = lwSel.value === '0';
    lcSel.value = p.table.dataset.lineColor || '';
    lcSel.disabled = lwSel.value === '0';
    bgSel.value = cell.dataset.bg || '';
    placeCellUi();
    // Nur bei Zellen mit Bild.
    bar.querySelector('.ds-tb-beside-label').hidden = !cell.querySelector('img');
    besideBox.checked = cell.classList.contains('ws-cell-beside');
  };

  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    const node = sel?.anchorNode;
    if (!node || !surface.contains(node)) {
      if (!bar.contains(document.activeElement)) { cell = null; bar.hidden = true; }
      return;
    }
    lastNode = node;
    const el = node.nodeType === 3 ? node.parentNode : node;
    cell = el.closest?.('td, th') || null;
    show();
  });

  /** Schreibmarke in eine Zelle setzen. */
  const focusCell = (td) => {
    if (!td) { cell = null; bar.hidden = true; return; }
    const range = document.createRange();
    range.selectNodeContents(td);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    cell = td;
    show();
  };

  /**
   * Ausrichtung: ganze Tabelle gewählt → für alle Zellen (data-align, eigene
   * Ausrichtungen der Zellen fallen weg), sonst nur die Zelle der Schreibmarke.
   */
  const alignCells = (dir) => {
    const p = pos();
    if (!p) return false;
    if (wholeTable(p.table)) {
      p.table.dataset.align = dir;
      for (const tr of p.g.rows) for (const td of cellsOf(tr)) { td.style.removeProperty('text-align'); if (!td.getAttribute('style')) td.removeAttribute('style'); }
    } else {
      cell.style.textAlign = dir;
    }
    return true;
  };

  /** Senkrecht ausrichten: ganze Tabelle (data-valign) oder die Zelle der Schreibmarke. */
  const valignCells = (dir) => {
    const p = pos();
    if (!p) return;
    if (wholeTable(p.table)) {
      p.table.dataset.valign = dir;
      for (const tr of p.g.rows) for (const td of cellsOf(tr)) { td.style.removeProperty('vertical-align'); if (!td.getAttribute('style')) td.removeAttribute('style'); }
    } else cell.style.verticalAlign = dir;
  };

  const run = (t) => {
    const p = pos();
    if (!p) return;
    const { table } = p;
    switch (t) {
      // Das Format kennt nur eine Kopfzeile – darüber passt keine Zeile.
      case 'rowAbove': if (p.g.rows[p.r].parentNode.tagName === 'THEAD') return; focusCell(cellsOf(insertRow(table, p.r))[0]); return;
      case 'rowBelow': focusCell(cellsOf(insertRow(table, p.r + p.rs))[0]); return;
      case 'rowDel': {
        deleteRow(table, p.r);
        const g = table.isConnected ? grid(table) : null;
        focusCell(g?.map[Math.min(p.r, g.rows.length - 1)]?.[p.c] || null);
        return;
      }
      case 'colLeft': insertColumn(table, p.c); focusCell(grid(table).map[p.r][p.c]); return;
      case 'colRight': insertColumn(table, p.c + p.cs); focusCell(grid(table).map[p.r][p.c + p.cs]); return;
      case 'colDel': {
        deleteColumn(table, p.c);
        const g = table.isConnected ? grid(table) : null;
        focusCell(g?.map[p.r]?.[Math.min(p.c, g.cols - 1)] || null);
        return;
      }
      case 'selectTable':
        selectTable(table);
        return;
      case 'cutTable':
        cutTable(table);
        return;
      case 'pasteTable':
        placeHeld('cell');
        return;
      case 'alignLeft': case 'alignCenter': case 'alignRight':
        alignCells(t.slice(5).toLowerCase());
        return;
      case 'valignTop': case 'valignMiddle': case 'valignBottom':
        valignCells(t.slice(6).toLowerCase());
        return;
      case 'evenWidths':
        [...table.children].filter((c) => c.tagName === 'COLGROUP').forEach((c) => c.remove());
        show();
        return;
      case 'tableDel':
        if (window.confirm('Ganze Tabelle löschen?')) { table.remove(); focusCell(null); }
        return;
      default:
    }
  };
  bar.querySelectorAll('[data-t]').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault()); // Schreibmarke in der Zelle lassen
    b.addEventListener('click', () => run(b.dataset.t));
  });
  headBox.addEventListener('change', () => { const p = pos(); if (p) { toggleHeader(p.table); focusCell(cell.isConnected ? cell : null); } });
  besideBox.addEventListener('change', () => {
    if (!pos()) return;
    cell.classList.toggle('ws-cell-beside', besideBox.checked);
    if (!cell.getAttribute('class')) cell.removeAttribute('class');
  });
  lwSel.addEventListener('change', () => { const p = pos(); if (p) { setLines(p.table, { width: lwSel.value }); show(); } });
  lsSel.addEventListener('change', () => { const p = pos(); if (p) { setLines(p.table, { style: lsSel.value }); show(); } });
  lcSel.addEventListener('change', () => { const p = pos(); if (p) { setLines(p.table, { color: lcSel.value }); show(); } });
  bgSel.addEventListener('change', () => {
    const p = pos();
    if (!p) return;
    const cells = wholeTable(p.table) ? p.g.rows.flatMap(cellsOf) : [cell];
    for (const td of cells) {
      if (CELL_BACKGROUNDS[bgSel.value]) { td.dataset.bg = bgSel.value; td.style.backgroundColor = CELL_BACKGROUNDS[bgSel.value]; } else {
        delete td.dataset.bg;
        td.style.removeProperty('background-color');
      }
      if (!td.getAttribute('style')) td.removeAttribute('style');
    }
  });

  const applySize = (input, apply) => {
    const p = pos();
    if (!p) return;
    const text = input.value.trim();
    const cm = text ? parseCm(text) : null;
    if (text && cm === null) { input.classList.add('ds-tb-bad'); return; }
    input.classList.remove('ds-tb-bad');
    apply(p, cm);
  };
  // Ist die ganze Tabelle gewählt (Markieren, Griff ⠿), gilt der Wert für alle Spalten bzw. Zeilen.
  widthIn.addEventListener('change', () => applySize(widthIn, (p, cm) => {
    const cols = wholeTable(p.table) ? [...Array(p.g.cols).keys()] : [p.c + p.cs - 1];
    for (const c of cols) setColumnWidth(p.table, c, cm);
  }));
  heightIn.addEventListener('change', () => applySize(heightIn, (p, cm) => {
    for (const tr of wholeTable(p.table) ? p.g.rows : [p.g.rows[p.r]]) setRowHeight(tr, cm);
  }));
  [widthIn, heightIn].forEach((input) => input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    input.dispatchEvent(new Event('change'));
    if (cell?.isConnected) focusCell(cell);
  }));

  // Ränder ziehen: rechter Rand einer Zelle → Spaltenbreite, unterer → Zeilenhöhe.
  // Den Mauszeiger setzt ein eigenes Stylesheet – ein style-Attribut an der
  // Fläche meldete der Editor sonst bei jeder Bewegung als Bearbeitung.
  const tag = `tt${++surfaces}`;
  surface.dataset.tableTools = tag;
  const cursorStyle = document.head.appendChild(document.createElement('style'));
  let cursorNow = '';
  const setCursor = (cursor) => {
    if (cursor === cursorNow) return;
    cursorNow = cursor;
    cursorStyle.textContent = cursor ? `[data-table-tools="${tag}"], [data-table-tools="${tag}"] * { cursor: ${cursor} !important; }` : '';
  };
  const edgeAt = (e) => {
    const td = e.target.closest?.('td, th');
    const table = tableOf(td);
    if (!editable(table)) return null;
    const r = td.getBoundingClientRect();
    if (Math.abs(e.clientX - r.right) <= EDGE_PX) return { kind: 'col', td, table };
    if (Math.abs(e.clientY - r.bottom) <= EDGE_PX) return { kind: 'row', td, table };
    return null;
  };
  let drag = null;
  surface.addEventListener('pointermove', (e) => {
    if (drag) {
      if (drag.kind === 'col') {
        const cm = Math.max(0.5, Math.round(((drag.px + e.clientX - drag.x) / PX_PER_CM) * 10) / 10);
        setColumnWidth(drag.table, drag.c, cm);
        widthIn.value = String(cm).replace('.', ',');
      } else {
        const cm = Math.max(0.4, Math.round(((drag.px + e.clientY - drag.y) / PX_PER_CM) * 10) / 10);
        setRowHeight(drag.tr, cm);
        heightIn.value = String(cm).replace('.', ',');
      }
      return;
    }
    const edge = e.pointerType === 'mouse' ? edgeAt(e) : null;
    setCursor(edge ? (edge.kind === 'col' ? 'col-resize' : 'row-resize') : '');
  });
  surface.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType !== 'mouse') return;
    const edge = edgeAt(e);
    if (!edge) return;
    e.preventDefault();
    const g = grid(edge.table);
    const at = g.start.get(edge.td);
    if (edge.kind === 'col') {
      const c = at.c + spanOf(edge.td, 'colspan') - 1;
      drag = { kind: 'col', table: edge.table, c, x: e.clientX, px: columnPx(g, c) || edge.td.getBoundingClientRect().width };
    } else {
      const tr = g.rows[at.r + spanOf(edge.td, 'rowspan') - 1];
      drag = { kind: 'row', table: edge.table, tr, y: e.clientY, px: tr.getBoundingClientRect().height };
    }
    surface.setPointerCapture(e.pointerId);
    cell = edge.td;
    show();
  });
  const endDrag = () => { drag = null; setCursor(''); };
  surface.addEventListener('pointerup', endDrag);
  surface.addEventListener('pointercancel', endDrag);
  // Ohne feste Breite zeigt das Feld die jetzige als Anhalt.
  widthIn.addEventListener('focus', () => { const p = pos(); if (p && !widthIn.value) widthIn.placeholder = `≈${cmText(columnPx(p.g, p.c + p.cs - 1))}`; });
  widthIn.addEventListener('blur', () => { widthIn.placeholder = 'auto'; });

  // ---------- Tabelle als Objekt: Griff, Auswahl, Leiste ----------
  //
  // Der Griff ⠿ liegt über der Fläche (nicht in ihr – sonst landete er im
  // Dokument), an der Ecke der Tabelle unter Maus oder Schreibmarke. Ein Klick
  // wählt die ganze Tabelle: ↑ ↓ ⧉ ✂ ✕, bei inneren Tabellen „⬆ äußere“.
  const host = surface.parentElement;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const grip = document.createElement('div');
  grip.className = 'ds-table-grip';
  grip.hidden = true;
  grip.innerHTML = `<button type="button" class="ds-grip-handle" title="Ganze Tabelle auswählen – verschieben, verdoppeln, ausschneiden, löschen">⠿</button>
    <span class="ds-grip-bar" hidden>
      <button type="button" data-g="up" title="Nach oben (Alt+↑)">↑</button>
      <button type="button" data-g="down" title="Nach unten (Alt+↓)">↓</button>
      <button type="button" data-g="dup" title="Verdoppeln">⧉</button>
      <button type="button" data-g="cut" title="Ausschneiden (Strg+X) – dann in eine Zelle oder hinter einen Absatz einfügen (Strg+V)">✂</button>
      <button type="button" data-g="outer" title="Die Tabelle außen herum auswählen">⬆ äußere</button>
      <button type="button" data-g="del" title="Löschen (Entf)">✕</button>
    </span>`;
  host.appendChild(grip);
  let gripTable = null;
  let selectedTable = null;

  const placeGrip = (table) => {
    gripTable = table && editable(table) ? table : null;
    grip.hidden = !gripTable;
    if (!gripTable) return;
    const t = gripTable.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    grip.style.left = `${Math.max(0, t.left - h.left - 22)}px`;
    grip.style.top = `${t.top - h.top}px`;
    grip.querySelector('[data-g="outer"]').hidden = !gripTable.parentElement?.closest('table');
  };
  function selectTable(table) {
    if (selectedTable && selectedTable !== table) {
      selectedTable.classList.remove('ds-table-selected');
      if (!selectedTable.getAttribute('class')) selectedTable.removeAttribute('class');
    }
    selectedTable = table && editable(table) ? table : null;
    if (selectedTable) {
      selectedTable.classList.add('ds-table-selected');
      // Die Leiste wirkt auf diese Tabelle – auch ohne Schreibmarke darin.
      if (!cell || cell.closest('table') !== selectedTable) cell = cellsOf(rowsOf(selectedTable)[0] || document.createElement('tr'))[0] || null;
    }
    show();
    grip.querySelector('.ds-grip-bar').hidden = !selectedTable;
    grip.classList.toggle('ds-grip-active', !!selectedTable);
    placeGrip(selectedTable || gripTable);
  }

  const gripAction = (act) => {
    const t = selectedTable;
    if (!t) return;
    if (act === 'up' && t.previousElementSibling) t.previousElementSibling.before(t);
    else if (act === 'down' && t.nextElementSibling) t.nextElementSibling.after(t);
    else if (act === 'dup') {
      const copy = t.cloneNode(true);
      copy.classList.remove('ds-table-selected');
      copy.removeAttribute('data-id');
      copy.querySelectorAll('[data-id]').forEach((n) => n.removeAttribute('data-id'));
      t.after(copy);
      selectTable(copy);
    } else if (act === 'cut') cutTable(t);
    else if (act === 'outer') selectTable(t.parentElement.closest('table'));
    else if (act === 'del') { selectTable(null); t.remove(); placeGrip(null); return; }
    if (selectedTable) { placeGrip(selectedTable); selectedTable.scrollIntoView?.({ block: 'nearest' }); }
  };
  grip.addEventListener('mousedown', (e) => e.preventDefault()); // Schreibmarke bleibt, wo sie ist
  grip.addEventListener('click', (e) => {
    if (e.target.closest('.ds-grip-handle')) { selectTable(selectedTable === gripTable ? null : gripTable); return; }
    const act = e.target.closest('[data-g]')?.dataset.g;
    if (act) gripAction(act);
  });

  // Griff zeigen: an der Tabelle unter der Maus, sonst an der der Schreibmarke.
  surface.addEventListener('mousemove', (e) => {
    if (selectedTable || drag) return;
    const t = e.target.closest?.('table');
    if (t && t !== gripTable && editable(t)) placeGrip(t);
  });
  document.addEventListener('selectionchange', () => {
    if (selectedTable) return;
    const node = document.getSelection()?.anchorNode;
    if (!node || !surface.contains(node)) return;
    const t = (node.nodeType === 3 ? node.parentNode : node).closest?.('table');
    placeGrip(t || null);
  });
  surface.addEventListener('scroll', () => placeGrip(selectedTable || gripTable));
  window.addEventListener('resize', () => placeGrip(selectedTable || gripTable));
  // Klick in die Fläche (nicht auf den Griff) hebt die Auswahl auf.
  surface.addEventListener('mousedown', () => { if (selectedTable) selectTable(null); });

  const keysFor = () => selectedTable && selectedTable.isConnected && !document.querySelector('.confirm-overlay:not(.hidden)');
  document.addEventListener('keydown', (e) => {
    if (keysFor()) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); gripAction('del'); }
      else if (e.key === 'Escape') selectTable(null);
      else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); gripAction('up'); }
      else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); gripAction('down'); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') { e.preventDefault(); gripAction('cut'); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        // Kopieren macht der Browser – dafür die Tabelle markieren (Einfügen dann als Tabelle).
        const range = document.createRange();
        range.selectNode(selectedTable);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      }
      return;
    }
    // Strg+V mit ausgeschnittener Tabelle: in die Zelle der Schreibmarke, sonst hinter ihren Absatz.
    if (held && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && lastNode && surface.contains(lastNode)
      && surface.contains(document.getSelection()?.anchorNode)) {
      e.preventDefault();
      placeHeld(cell && surface.contains(cell) ? 'cell' : 'after');
    }
  });

  // ---------- Menü für Zeile, Spalte, Zelle, Tabelle (Rechtsklick, „Tabelle ▾“) ----------
  //
  // Verschachtelt wie in Google Docs, damit es kurz bleibt. Die Einträge
  // wirken auf die Zelle, für die das Menü geöffnet wurde (auch wenn der
  // Fokus inzwischen woanders ist); bei „Ganze Tabelle“ auf alle Zellen.
  function placeCellUi() { /* keine schwebenden Knöpfe mehr – Menü und Leiste genügen */ }

  /** Kleines Fenster für einen Wert in cm; liefert die Zahl, '' (automatisch) oder null (abgebrochen). */
  const askCm = (title, value) => new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<form class="import-modules-card ds-cm-dialog" role="dialog" aria-modal="true">
        <h3>${title}</h3>
        <label>in cm <input type="text" inputmode="decimal" value="${value || ''}" placeholder="automatisch" style="width:7em"></label>
        <p class="hint">Leer lassen für automatisch.</p>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary" data-x>Abbrechen</button><button type="submit" class="btn btn-primary">OK</button></div>
      </form>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('input');
    input.focus();
    input.select();
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('[data-x]').addEventListener('click', () => done(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    overlay.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = input.value.trim();
      if (!t) { done(''); return; }
      const cm = parseCm(t);
      if (cm === null) { input.classList.add('ds-tb-bad'); return; }
      done(cm);
    });
  });

  const setBackground = (td, name) => {
    const table = td.closest('table');
    const g = grid(table);
    for (const c of wholeTable(table) ? g.rows.flatMap(cellsOf) : [td]) {
      if (CELL_BACKGROUNDS[name]) { c.dataset.bg = name; c.style.backgroundColor = CELL_BACKGROUNDS[name]; } else {
        delete c.dataset.bg;
        c.style.removeProperty('background-color');
      }
      if (!c.getAttribute('style')) c.removeAttribute('style');
    }
  };

  /** Zeilen bzw. Spalten gleich hoch / breit wie im Mittel. */
  const distribute = (table, what) => {
    const g = grid(table);
    if (what === 'rows') {
      const h = g.rows.reduce((n, tr) => n + tr.getBoundingClientRect().height, 0) / g.rows.length;
      const cm = Math.max(0.4, Math.round((h / PX_PER_CM) * 10) / 10);
      g.rows.forEach((tr) => setRowHeight(tr, cm));
    } else {
      const w = [...Array(g.cols).keys()].reduce((n, c) => n + columnPx(g, c), 0) / g.cols;
      const cm = Math.max(0.5, Math.round((w / PX_PER_CM) * 10) / 10);
      for (let c = 0; c < g.cols; c++) setColumnWidth(table, c, cm);
    }
  };

  /** Tabelle als Ganzes setzen (Breite, Lage, Abstand oben/unten, Innenabstand) – wie docspec.js es zeigt. */
  const setTableProps = (table, { width, position, sb, sa, pad }) => {
    const st = table.style;
    const put = (key, value, css) => {
      if (value === '' || value === null || value === undefined) { delete table.dataset[key]; css.forEach(([p]) => st.removeProperty(p)); } else {
        table.dataset[key] = String(value);
        css.forEach(([p, v]) => st.setProperty(p, v));
      }
    };
    put('width', width, [['width', `${width}cm`]]);
    st.removeProperty('margin-left');
    st.removeProperty('margin-right');
    if (position === 'center' || position === 'right') {
      table.dataset.position = position;
      st.setProperty('margin-left', 'auto');
      if (position === 'center') st.setProperty('margin-right', 'auto');
    } else delete table.dataset.position;
    put('sb', sb, [['margin-top', `${sb}cm`]]);
    put('sa', sa, [['margin-bottom', `${sa}cm`]]);
    put('pad', pad, [['--ds-cell-pad', `${pad}cm`]]);
    if (!table.getAttribute('style')) table.removeAttribute('style');
  };

  /** Dialog „Tabelleneigenschaften“: Reiter Tabelle, Umrandung, Zellen – wirkt mit OK. */
  function openTableProps(td) {
    const table = td?.closest('table');
    if (!table || !editable(table)) return;
    const d = table.dataset;
    const num = (v) => (v === undefined || v === '' ? '' : String(v).replace('.', ','));
    const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('');
    const plain = table.classList.contains('ws-table-plain');
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<form class="import-modules-card ds-tprops" role="dialog" aria-modal="true">
        <h3>▤ Tabelleneigenschaften</h3>
        <div class="admin-tabs ds-tprops-tabs">
          <button type="button" class="admin-tab active" data-tab="t">Tabelle</button>
          <button type="button" class="admin-tab" data-tab="u">Umrandung</button>
          <button type="button" class="admin-tab" data-tab="z">Zellen</button>
        </div>
        <div class="ds-para-grid" data-pane="t">
          <label>Breite<span class="ds-para-in"><input name="width" inputmode="decimal" value="${num(d.width)}" placeholder="volle"> cm</span></label>
          <label>Lage auf der Seite<select name="position">${opt([['', 'Links'], ['center', 'Mitte'], ['right', 'Rechts']], d.position || '')}</select></label>
          <label>Abstand oben<span class="ds-para-in"><input name="sb" inputmode="decimal" value="${num(d.sb)}" placeholder="0,2"> cm</span></label>
          <label>Abstand unten<span class="ds-para-in"><input name="sa" inputmode="decimal" value="${num(d.sa)}" placeholder="0,2"> cm</span></label>
          <label class="ds-tprops-check"><input type="checkbox" name="head" ${[...table.children].some((c) => c.tagName === 'THEAD') ? 'checked' : ''}> Erste Zeile ist Kopfzeile</label>
        </div>
        <div class="ds-para-grid" data-pane="u" hidden>
          <label>Stärke<select name="lw">${opt(LINE_WIDTHS, plain ? '0' : d.lineWidth || '')}</select></label>
          <label>Art<select name="ls">${opt(LINE_STYLES, d.lineStyle || '')}</select></label>
          <label>Farbe<select name="lc">${opt(LINE_COLOR_NAMES, d.lineColor || '')}</select></label>
        </div>
        <div class="ds-para-grid" data-pane="z" hidden>
          <label>Gilt für<select name="scope"><option value="cell">diese Zelle</option><option value="all">alle Zellen</option></select></label>
          <label>Hintergrund<select name="bg">${opt([['-', '– unverändert –'], ...BG_NAMES], '-')}</select></label>
          <label>Waagerecht<select name="ha">${opt([['-', '– unverändert –'], ['left', 'Links'], ['center', 'Zentriert'], ['right', 'Rechts']], '-')}</select></label>
          <label>Senkrecht<select name="va">${opt([['-', '– unverändert –'], ['top', 'Oben'], ['middle', 'Mitte'], ['bottom', 'Unten']], '-')}</select></label>
          <label>Innenabstand (alle)<span class="ds-para-in"><input name="pad" inputmode="decimal" value="${num(d.pad)}" placeholder="0,1"> cm</span></label>
        </div>
        <p class="hint ds-para-error" hidden>Bitte Zahlen in cm: Breite 2–17, Abstände 0–3, Innenabstand 0–1.</p>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary" data-x>Abbrechen</button><button type="submit" class="btn btn-primary">OK</button></div>
      </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-x]').addEventListener('click', close);
    overlay.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      overlay.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
      overlay.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = form.elements;
      const cm = (t, lo, hi) => {
        const v = String(t).trim().replace(',', '.');
        if (!v) return '';
        const n = Number(v);
        return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 10) / 10 : null;
      };
      const v = { width: cm(f.width.value, 2, 17), sb: cm(f.sb.value, 0, 3), sa: cm(f.sa.value, 0, 3), pad: cm(f.pad.value, 0, 1) };
      if (Object.values(v).some((x) => x === null)) { overlay.querySelector('.ds-para-error').hidden = false; return; }
      setTableProps(table, { ...v, position: f.position.value });
      setLines(table, { width: f.lw.value, style: f.ls.value, color: f.lc.value });
      if (f.head.checked !== [...table.children].some((c) => c.tagName === 'THEAD')) toggleHeader(table);
      const cells = f.scope.value === 'all' ? grid(table).rows.flatMap(cellsOf) : [td];
      for (const c of cells) {
        if (!c.isConnected) continue;
        if (f.bg.value !== '-') { const was = table.classList.contains('ds-table-selected'); table.classList.remove('ds-table-selected'); setBackground(c, f.bg.value); if (was) table.classList.add('ds-table-selected'); }
        if (f.ha.value !== '-') c.style.textAlign = f.ha.value;
        if (f.va.value !== '-') c.style.verticalAlign = f.va.value;
      }
      close();
      cell = td.isConnected ? td : cell;
      show();
    });
  }

  /** Einträge des Menüs für die Zelle `td` – oder null, wenn sie nicht bearbeitbar ist. */
  function menuFor(td) {
    const table = td?.closest('table');
    if (!td || !editable(table)) return null;
    const at = (t) => () => { cell = td; run(t); };
    const check = (on, label) => `${on ? '✓ ' : ''}${label}`;
    const columns = table.classList.contains('ws-columns');
    const rowOf = () => { cell = td; const p = pos(); return p ? p.g.rows[p.r] : null; };
    const colOf = () => { cell = td; const p = pos(); return p ? p.c + p.cs - 1 : null; };
    const plain = table.classList.contains('ws-table-plain');
    const lw = plain ? '0' : table.dataset.lineWidth || '';
    const ls = table.dataset.lineStyle || '';
    const lc = table.dataset.lineColor || '';
    const setL = (opts) => () => { setLines(table, opts); cell = td; show(); };

    const spalte = { label: columns ? '▥ Spalte' : '⇳ Spalte', submenu: [
      { label: '⬅ Links einfügen', onClick: at('colLeft') },
      { label: '➡ Rechts einfügen', onClick: at('colRight') },
      { label: '✕ Löschen', onClick: at('colDel') },
      '-',
      { label: '↔ Breite …', onClick: async () => {
        const c = colOf();
        if (c === null) return;
        const col = [...table.children].find((x) => x.tagName === 'COLGROUP')?.children[c];
        const cm = await askCm('Spaltenbreite', col?.style.width ? String(parseFloat(col.style.width)).replace('.', ',') : '');
        if (cm !== null) setColumnWidth(table, c, cm || null);
      } },
    ] };
    if (columns) {
      return [spalte, { label: '▥ Spalten', submenu: [
        { label: '⬚ Auswählen', onClick: () => { cell = td; selectTable(table); } },
        { label: '✂ Ausschneiden', onClick: () => cutTable(table) },
        { label: '🗑 Löschen (mit Inhalt)', danger: true, onClick: () => { selectTable(null); table.remove(); focusCell(null); } },
      ] }];
    }
    return [
      { label: '⇔ Zeile', submenu: [
        { label: '⬆ Darüber einfügen', onClick: at('rowAbove') },
        { label: '⬇ Darunter einfügen', onClick: at('rowBelow') },
        { label: '✕ Löschen', onClick: at('rowDel') },
        '-',
        { label: '↕ Höhe …', onClick: async () => {
          const tr = rowOf();
          if (!tr) return;
          const cm = await askCm('Zeilenhöhe (mindestens)', tr.style.height ? String(parseFloat(tr.style.height)).replace('.', ',') : '');
          if (cm !== null) setRowHeight(tr, cm || null);
        } },
      ] },
      spalte,
      { label: '▢ Zelle', submenu: [
        { label: 'Ausrichtung', submenu: [['Left', '⇤ Links'], ['Center', '↔ Zentriert'], ['Right', '⇥ Rechts']].map(([d, l]) => ({ label: check(td.style.textAlign === d.toLowerCase(), l), onClick: at(`align${d}`) })) },
        { label: 'Senkrecht', submenu: [['Top', '⤒ Oben'], ['Middle', '⇕ Mitte'], ['Bottom', '⤓ Unten']].map(([d, l]) => ({ label: check(td.style.verticalAlign === d.toLowerCase(), l), onClick: at(`valign${d}`) })) },
        { label: 'Farbe', submenu: BG_NAMES.map(([v, l]) => ({ label: check((td.dataset.bg || '') === v, l), onClick: () => setBackground(td, v) })) },
        ...(td.querySelector('img') ? [{ label: check(td.classList.contains('ws-cell-beside'), 'Bild neben Text'), onClick: () => { td.classList.toggle('ws-cell-beside'); cell = td; show(); } }] : []),
      ] },
      { label: '▤ Tabelle', submenu: [
        { label: check([...table.children].some((c) => c.tagName === 'THEAD'), 'Kopfzeile'), onClick: () => { cell = td; toggleHeader(table); focusCell(td.isConnected ? td : null); } },
        { label: 'Linien', submenu: [
          ...LINE_WIDTHS.map(([v, l]) => ({ label: check(lw === v, l), onClick: setL({ width: v }) })),
          '-',
          ...LINE_STYLES.map(([v, l]) => ({ label: check(ls === v, l), onClick: setL({ style: v }) })),
          '-',
          { label: 'Farbe', submenu: LINE_COLOR_NAMES.map(([v, l]) => ({ label: check(lc === v, l), onClick: setL({ color: v }) })) },
        ] },
        { label: 'Zeilen gleichmäßig verteilen', onClick: () => distribute(table, 'rows') },
        { label: 'Spalten gleichmäßig verteilen', onClick: () => distribute(table, 'cols') },
        { label: '⇔ Spaltenbreiten automatisch', onClick: () => { [...table.children].filter((c) => c.tagName === 'COLGROUP').forEach((c) => c.remove()); } },
        '-',
        { label: '⬚ Ganze Tabelle auswählen', onClick: () => { cell = td; selectTable(table); } },
        { label: '✂ Ausschneiden', onClick: () => cutTable(table) },
        { label: '🗑 Löschen', danger: true, onClick: () => { selectTable(null); table.remove(); focusCell(null); placeGrip(null); } },
      ] },
      { label: '⚙ Tabelleneigenschaften …', onClick: () => openTableProps(td) },
    ];
  }

  /** Zelle der Schreibmarke bzw. der gewählten Tabelle (für „Tabelle ▾“ in der Leiste). */
  const currentCell = () => {
    const node = document.getSelection()?.anchorNode;
    const el = node && surface.contains(node) ? (node.nodeType === 3 ? node.parentNode : node) : null;
    return el?.closest?.('td, th') || (selectedTable ? cellsOf(rowsOf(selectedTable)[0] || document.createElement('tr'))[0] : null) || (cell?.isConnected ? cell : null);
  };

  return {
    /** Menüeinträge für die Zelle unter `target` (Rechtsklick) – null außerhalb von Tabellen. */
    menuFor: (target) => {
      const td = target?.closest?.('td, th');
      return td && surface.contains(td) ? menuFor(td) : null;
    },
    /** Menüeinträge für die Zelle der Schreibmarke (Knopf „Tabelle ▾“) – null außerhalb. */
    menuHere: () => menuFor(currentCell()),
    /** Steht die Schreibmarke in einer Tabelle? */
    inTable: () => !!currentCell(),
    /** Ausrichtung (left, center, right), wenn die Schreibmarke in einer Zelle steht – sonst false. */
    align: (dir) => {
      const node = document.getSelection()?.anchorNode;
      const inCell = node && surface.contains(node) && (node.nodeType === 3 ? node.parentNode : node).closest?.('td, th');
      return (inCell || selectedTable) ? alignCells(dir) : false;
    },
  };
}

// Für Tests.
export const _tableOps = { grid, insertRow, deleteRow, insertColumn, deleteColumn, toggleHeader, setColumnWidth, setRowHeight };
