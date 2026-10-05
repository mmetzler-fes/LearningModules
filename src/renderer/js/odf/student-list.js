// Schülerliste aus einer Datei lesen: die Klassenliste des SchülerLernTools
// (.ods, meist verschlüsselt) oder jede andere Tabelle bzw. CSV-Datei mit
// den Spalten "Name" und "Vorname".
//
// Übernommen werden nur Name, Vorname und – falls vorhanden – die
// Schüler-ID. Betrieb, Kurse und Noten der Klassenliste bleiben, wo sie sind.

import { openOdf, odfInfo, WrongPassword } from './odf-read.js';

export { WrongPassword };

const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
};
const SHEET_NAME = 'Schülerliste';
const MAX_COLUMNS = 160;
const MAX_ROWS = 5000;

/** Text eines Absatzes; <text:s/> steht in ODF für (mehrere) Leerzeichen. */
function paragraphText(p) {
  let out = '';
  for (const k of p.childNodes) {
    if (k.nodeType === 3) out += k.nodeValue;
    else if (k.localName === 's') out += ' '.repeat(Number(k.getAttributeNS(NS.text, 'c')) || 1);
    else if (k.localName === 'tab') out += '\t';
    else if (k.localName === 'line-break') out += ' ';
    else out += paragraphText(k);
  }
  return out;
}

/**
 * Liest ein Tabellenblatt als Liste von Zeilen (Arrays aus Text). Leere
 * Zeilen fallen weg; Wiederholungen, mit denen LibreOffice gleiche Zellen
 * zusammenfasst, werden aufgelöst.
 */
function readSheet(table) {
  const rows = [];
  for (const row of table.getElementsByTagNameNS(NS.table, 'table-row')) {
    const cells = [];
    for (const cell of row.childNodes) {
      if (cell.nodeType !== 1 || !/^(covered-)?table-cell$/.test(cell.localName)) continue;
      const text = [...cell.getElementsByTagNameNS(NS.text, 'p')].map(paragraphText).join(' ').trim();
      const times = Number(cell.getAttributeNS(NS.table, 'number-columns-repeated')) || 1;
      for (let i = 0; i < times && cells.length < MAX_COLUMNS; i++) cells.push(text);
    }
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    if (!cells.length) continue;
    const times = Math.min(Number(row.getAttributeNS(NS.table, 'number-rows-repeated')) || 1, MAX_ROWS);
    for (let i = 0; i < times; i++) rows.push(cells);
    if (rows.length > MAX_ROWS) throw new Error('Die Tabelle ist zu groß.');
  }
  return rows;
}

/** Zeilen aus CSV: Trennzeichen ; , oder Tab, Anführungszeichen wie in Calc/Excel. */
function readCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const sep = [';', '\t', ','].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const norm = (s) => String(s || '').trim().toLocaleLowerCase('de');

/**
 * Sucht in den ersten Zeilen die Kopfzeile mit "Name" und "Vorname" und
 * liest darunter die Schüler. In der Klassenliste des SchülerLernTools steht
 * darüber außerdem "Klasse | <Name>".
 */
function studentsFromRows(rows) {
  let className = '';
  for (const r of rows.slice(0, 10)) if (norm(r[0]) === 'klasse' && r[1]) className = r[1].trim();

  const headerIndex = rows.slice(0, 15).findIndex((r) => {
    const cells = r.map(norm);
    return cells.includes('vorname') && (cells.includes('name') || cells.includes('nachname'));
  });
  if (headerIndex < 0) {
    throw new Error('Keine Kopfzeile mit den Spalten „Name“ und „Vorname“ gefunden.');
  }
  const header = rows[headerIndex].map(norm);
  const colLast = header.indexOf('name') >= 0 ? header.indexOf('name') : header.indexOf('nachname');
  const colFirst = header.indexOf('vorname');
  const colId = header.indexOf('schüler-id');

  const students = [];
  for (const r of rows.slice(headerIndex + 1)) {
    const firstName = (r[colFirst] || '').trim();
    const lastName = (r[colLast] || '').trim();
    if (!firstName && !lastName) continue;
    students.push({ firstName, lastName, importId: colId >= 0 ? (r[colId] || '').trim() || null : null });
  }
  return { className, students };
}

/** Braucht die Datei ein Passwort? Nur bei .ods möglich. */
export async function needsPassword(file) {
  if (!/\.ods$/i.test(file.name)) return false;
  return (await odfInfo(new Uint8Array(await file.arrayBuffer()))).encrypted;
}

/**
 * Liest die Schülerliste aus einer Datei. Liefert
 * { className, students: [{ firstName, lastName, importId }] }.
 */
export async function readStudentList(file, password) {
  if (/\.(csv|txt)$/i.test(file.name)) return studentsFromRows(readCsv(await file.text()));
  if (!/\.ods$/i.test(file.name)) throw new Error('Bitte eine .ods- oder .csv-Datei wählen.');

  const files = await openOdf(new Uint8Array(await file.arrayBuffer()), password || null);
  if (!files['content.xml']) throw new Error('Die Datei ist beschädigt.');
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(files['content.xml']), 'application/xml');
  const tables = [...doc.getElementsByTagNameNS(NS.table, 'table')];
  if (tables.length === 0) throw new Error('Die Datei enthält keine Tabelle.');
  const table = tables.find((t) => t.getAttributeNS(NS.table, 'name') === SHEET_NAME) || tables[0];
  return studentsFromRows(readSheet(table));
}
