// Excel-Tabellen (.xlsx) lesen – nur die Zellinhalte als Text, je Blatt eine
// Liste von Zeilen. Gegenstück zu readSheet() für .ods in student-list.js.
//
// Eine .xlsx ist ein ZIP mit XML: Blattnamen in xl/workbook.xml, Texte meist
// zentral in xl/sharedStrings.xml, die Zellen in xl/worksheets/sheetN.xml.

import { unzip } from './odf-read.js';

const MAX_COLUMNS = 160;
const MAX_ROWS = 5000;

const xml = (bytes) => new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
const byTag = (node, name) => [...node.getElementsByTagName('*')].filter((n) => n.localName === name);
const textOf = (node) => byTag(node, 't').map((t) => t.textContent).join('');

/** Mit Passwort geschützte Excel-Dateien sind kein ZIP, sondern ein OLE-Container. */
function isEncryptedOffice(bytes) {
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

/** Spaltenbuchstaben aus "AB12" → 27 (0-basiert). */
function columnIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref || '')?.[0] || '';
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Pfad relativ zu xl/ auflösen ("worksheets/sheet1.xml", "/xl/…"). */
function resolve(target) {
  const t = String(target || '');
  return t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
}

export async function readXlsxSheets(bytes) {
  if (isEncryptedOffice(bytes)) {
    throw new Error('Die Excel-Datei ist mit einem Passwort geschützt. Bitte ohne Passwort speichern und erneut einlesen.');
  }
  const files = await unzip(bytes);
  if (!files['xl/workbook.xml']) throw new Error('Die Datei ist keine Excel-Tabelle.');

  const shared = files['xl/sharedStrings.xml'] ? byTag(xml(files['xl/sharedStrings.xml']), 'si').map(textOf) : [];
  const rels = {};
  if (files['xl/_rels/workbook.xml.rels']) {
    for (const r of byTag(xml(files['xl/_rels/workbook.xml.rels']), 'Relationship')) {
      rels[r.getAttribute('Id')] = resolve(r.getAttribute('Target'));
    }
  }

  const sheets = [];
  const book = byTag(xml(files['xl/workbook.xml']), 'sheet');
  book.forEach((s, i) => {
    const relId = [...s.attributes].find((a) => a.localName === 'id')?.value;
    const path = rels[relId] || `xl/worksheets/sheet${i + 1}.xml`;
    if (!files[path]) return;
    const rows = [];
    for (const row of byTag(xml(files[path]), 'row')) {
      const cells = [];
      for (const c of byTag(row, 'c')) {
        const col = columnIndex(c.getAttribute('r'));
        const at = col >= 0 ? col : cells.length;
        if (at >= MAX_COLUMNS) continue;
        const type = c.getAttribute('t');
        const v = byTag(c, 'v')[0]?.textContent ?? '';
        let text;
        if (type === 's') text = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') text = textOf(byTag(c, 'is')[0] || c);
        else if (type === 'b') text = v === '1' ? 'WAHR' : 'FALSCH';
        else text = v;
        while (cells.length < at) cells.push('');
        cells[at] = String(text).trim();
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.length) rows.push(cells);
      if (rows.length > MAX_ROWS) throw new Error('Die Tabelle ist zu groß.');
    }
    sheets.push({ name: s.getAttribute('name') || `Blatt ${i + 1}`, rows });
  });
  if (!sheets.length) throw new Error('Die Datei enthält keine Tabelle.');
  return sheets;
}
