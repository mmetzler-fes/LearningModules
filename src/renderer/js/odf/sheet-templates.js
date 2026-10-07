// Vorlage für die Schülerliste – als LibreOffice (.ods), Excel (.xlsx) oder
// CSV, im Browser erzeugt. Die Vorlage taugt für beide Wege: "Schülerliste
// einlesen" in einer Klasse und "Klassen einlesen" (dank der Zeile
// "Klasse | …" oben; weitere Klassen = weitere Blätter mit demselben Aufbau).

const enc = new TextEncoder();

// ---- ZIP (nur speichern, ohne Kompression – für kleine Vorlagen reicht das) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ name, data: string|Uint8Array }] in der gewünschten Reihenfolge. */
export function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    // Version 2.0, Flag 0x0800 = UTF-8-Dateinamen, Verfahren 0 = gespeichert, Datum 1.1.2026
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x5c21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length)];
    const local = new Uint8Array([...u32(0x04034b50), ...common, ...u16(0)]);
    parts.push(local, name, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  return new Blob([...parts, ...central, end]);
}

const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- Inhalt ----

export const TEMPLATE_ROWS = [
  ['Klasse', 'TG12'],
  [],
  ['Name', 'Vorname', 'Schüler-ID'],
  ['Mustermann', 'Max', ''],
  ['Musterfrau', 'Erika', ''],
];
const SHEET = 'Schülerliste';

// ---- LibreOffice (.ods) ----

export function buildOds(rows = TEMPLATE_ROWS) {
  const cell = (v) => (v === '' || v === undefined
    ? '<table:table-cell/>'
    : `<table:table-cell office:value-type="string"><text:p>${x(v)}</text:p></table:table-cell>`);
  const content = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
    + ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"'
    + ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">'
    + `<office:body><office:spreadsheet><table:table table:name="${x(SHEET)}">`
    + '<table:table-column table:number-columns-repeated="3"/>'
    + rows.map((r) => `<table:table-row>${(r.length ? r : ['']).map(cell).join('')}</table:table-row>`).join('')
    + '</table:table></office:spreadsheet></office:body></office:document-content>';
  const manifest = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
    + '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>'
    + '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
    + '</manifest:manifest>';
  // "mimetype" muss als erster Eintrag unkomprimiert vorne stehen.
  return zipStore([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.spreadsheet' },
    { name: 'content.xml', data: content },
    { name: 'META-INF/manifest.xml', data: manifest },
  ]);
}

// ---- Excel (.xlsx) ----

const colName = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

export function buildXlsx(rows = TEMPLATE_ROWS) {
  const sheetRows = rows.map((r, ri) => {
    const cells = r.map((v, ci) => (v === '' || v === undefined ? ''
      : `<c r="${colName(ci)}${ri + 1}" t="inlineStr"><is><t>${x(v)}</t></is></c>`)).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  const NS = 'http://schemas.openxmlformats.org';
  return zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<Types xmlns="${NS}/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<Relationships xmlns="${NS}/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
      + '</Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships">`
      + `<sheets><sheet name="${x(SHEET)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<Relationships xmlns="${NS}/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
      + '</Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<worksheet xmlns="${NS}/spreadsheetml/2006/main"><cols><col min="1" max="3" width="20" customWidth="1"/></cols>`
      + `<sheetData>${sheetRows}</sheetData></worksheet>` },
  ]);
}

// ---- CSV (UTF-8 mit BOM, damit Excel Umlaute erkennt) ----

export function buildCsv(rows = TEMPLATE_ROWS) {
  const q = (v) => (/[;"\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  return new Blob(['﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}
