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
    <span class="ds-tablebar-sep"></span>
    <label class="ds-tb-notcols" title="Erste Zeile als Kopfzeile (fett)"><input type="checkbox" class="ds-tb-head"> Kopfzeile</label>
    <label class="ds-tb-notcols ds-tb-beside-label" title="Bilder dieser Zelle neben dem Text statt darunter"><input type="checkbox" class="ds-tb-beside"> Bild neben Text</label>
    <label class="ds-tb-notcols" title="Linien zeigen – ohne z. B. für Abbildungen nebeneinander"><input type="checkbox" class="ds-tb-border"> Linien</label>
    <button type="button" class="rt-btn" data-t="evenWidths" title="Alle festen Breiten entfernen – die Spalten richten sich wieder nach dem Inhalt">⇔ auto</button>
    <button type="button" class="rt-btn ds-tb-danger" data-t="tableDel" title="Ganze Tabelle löschen">🗑</button>`;
  const widthIn = bar.querySelector('.ds-tb-width');
  const heightIn = bar.querySelector('.ds-tb-height');
  const headBox = bar.querySelector('.ds-tb-head');
  const borderBox = bar.querySelector('.ds-tb-border');
  const besideBox = bar.querySelector('.ds-tb-beside');

  // Zuletzt gewählte Zelle – die Leiste wirkt auf sie, auch wenn der Fokus im Eingabefeld steht.
  let cell = null;
  const tableOf = (td) => td?.closest('table');
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
    bar.hidden = !p;
    if (!p) return;
    // Spalten (table.ws-columns): nur Spalten einfügen/löschen und Breite.
    const columns = p.table.classList.contains('ws-columns');
    bar.classList.toggle('ds-tb-columns', columns);
    bar.querySelector('.ds-tablebar-label').textContent = columns ? '▥ Spalten' : '▤ Tabelle';
    const col = [...p.table.children].find((c) => c.tagName === 'COLGROUP')?.children[p.c + p.cs - 1];
    if (document.activeElement !== widthIn) widthIn.value = col?.style.width ? String(parseFloat(col.style.width)).replace('.', ',') : '';
    const tr = p.g.rows[p.r];
    if (document.activeElement !== heightIn) heightIn.value = tr.style.height ? String(parseFloat(tr.style.height)).replace('.', ',') : '';
    headBox.checked = [...p.table.children].some((c) => c.tagName === 'THEAD');
    borderBox.checked = !p.table.classList.contains('ws-table-plain');
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
  borderBox.addEventListener('change', () => { const p = pos(); if (p) p.table.classList.toggle('ws-table-plain', !borderBox.checked); });

  const applySize = (input, apply) => {
    const p = pos();
    if (!p) return;
    const text = input.value.trim();
    const cm = text ? parseCm(text) : null;
    if (text && cm === null) { input.classList.add('ds-tb-bad'); return; }
    input.classList.remove('ds-tb-bad');
    apply(p, cm);
  };
  widthIn.addEventListener('change', () => applySize(widthIn, (p, cm) => setColumnWidth(p.table, p.c + p.cs - 1, cm)));
  heightIn.addEventListener('change', () => applySize(heightIn, (p, cm) => setRowHeight(p.g.rows[p.r], cm)));
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
}

// Für Tests.
export const _tableOps = { grid, insertRow, deleteRow, insertColumn, deleteColumn, toggleHeader, setColumnWidth, setRowHeight };
