// Drag and Drop als Tabelle: Der Editor zeigt ein Raster – links feste
// Zeilen, oben Spalten, in jeder Zelle das Element, das die Schüler dort
// hineinziehen. Gespeichert wird wie immer als Zonen (eine je Zelle, mit
// `row` und `col`) und ziehbare Elemente. So bleiben Auswertung, H5P-,
// Moodle- und JSON-Export unverändert.
//
// Die Datei darf nichts importieren: Der Server lädt sie für die Tests
// (browser-module.ts), der Editor über window.dndTable (app.js).

const name = (v) => String(v ?? '').trim();
const blankCell = () => ({ text: '', imageUrl: '', hideText: false });
const hasCell = (c) => !!c && (!!name(c.text) || !!c.imageUrl);

/** Bezeichnung der Zone einer Zelle – eindeutig, solange Zeilen und Spalten es sind. */
export function cellLabel(row, col) {
  return col ? `${row} – ${col}` : row;
}

/**
 * Zonen und Elemente → Raster `{ head, rows, cols, cells[r][c], extras }`.
 * Zonen ohne `row`/`col` (z. B. aus Paaren) werden je eine Zeile mit einer
 * Spalte „Antwort“. Elemente ohne Zelle bleiben als Ablenker (`extras`).
 */
export function tableFromContent(content) {
  const zones = ((content && content.dropZones) || []).filter((z) => z && name(z.label));
  const drags = ((content && content.draggables) || []).filter(Boolean);
  const rows = [];
  const cols = [];
  // Ohne Zeile/Spalte: „Zeile – Spalte“ in der Bezeichnung (z. B. nach einem Umweg über Paare), sonst Spalte „Antwort“.
  const placeOf = (z) => {
    if (name(z.row)) return [name(z.row), name(z.col)];
    const label = name(z.label);
    const cut = label.lastIndexOf(' – ');
    return cut > 0 ? [label.slice(0, cut), label.slice(cut + 3)] : [label, name(z.col) || 'Antwort'];
  };
  for (const z of zones) {
    const [r, c] = placeOf(z);
    if (!rows.includes(r)) rows.push(r);
    if (!cols.includes(c)) cols.push(c);
  }
  const cells = rows.map(() => cols.map(blankCell));
  const used = new Set();
  for (const z of zones) {
    const [r, c] = placeOf(z);
    const free = (d) => !used.has(d);
    const d = drags.find((x) => free(x) && x.correctZone === z.label && (!z.correctDraggable || x.text === z.correctDraggable))
      || drags.find((x) => free(x) && x.correctZone === z.label)
      || (z.correctDraggable ? drags.find((x) => free(x) && x.text === z.correctDraggable) : null);
    if (!d) continue;
    used.add(d);
    cells[rows.indexOf(r)][cols.indexOf(c)] = { text: name(d.text), imageUrl: name(d.imageUrl), hideText: !!(d.hideText && d.imageUrl) };
  }
  const extras = drags.filter((d) => !used.has(d) && (name(d.text) || d.imageUrl))
    .map((d) => ({ text: name(d.text), imageUrl: name(d.imageUrl), hideText: !!(d.hideText && d.imageUrl) }));
  return { head: name(content && content.tableHead), rows, cols, cells, extras };
}

/**
 * Raster → `{ tableHead, dropZones, draggables }`. Leere Zeilen- oder
 * Spaltennamen fallen weg, doppelte ebenso. Eine Zelle nur mit Bild bekommt
 * „Zeile: Spalte“ als Text für die Auswertung (bleibt verborgen).
 */
export function contentFromTable({ head = '', rows = [], cols = [], cells = [], extras = [] } = {}) {
  const keepRows = [];
  const keepCols = [];
  rows.forEach((r, i) => { const n = name(r); if (n && !keepRows.some((k) => k.n === n)) keepRows.push({ n, i }); });
  cols.forEach((c, i) => { const n = name(c); if (n && !keepCols.some((k) => k.n === n)) keepCols.push({ n, i }); });
  const dropZones = [];
  const draggables = [];
  for (const r of keepRows) {
    for (const c of keepCols) {
      const cell = (cells[r.i] && cells[r.i][c.i]) || blankCell();
      const label = cellLabel(r.n, c.n);
      const text = name(cell.text) || (cell.imageUrl ? `${r.n}: ${c.n}` : '');
      dropZones.push({ label, row: r.n, col: c.n, correctDraggable: hasCell(cell) ? text : '', group: '', imageUrl: '', hideText: false });
      if (hasCell(cell)) {
        draggables.push({ text, correctZone: label, multiple: false, imageUrl: name(cell.imageUrl), hideText: !!(cell.hideText && cell.imageUrl) });
      }
    }
  }
  for (const e of extras || []) {
    if (!hasCell(e)) continue;
    draggables.push({ text: name(e.text) || 'Ablenker', correctZone: '', multiple: false, imageUrl: name(e.imageUrl), hideText: !!(e.hideText && e.imageUrl) });
  }
  return { tableHead: name(head), dropZones, draggables };
}
