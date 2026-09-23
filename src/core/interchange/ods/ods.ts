import AdmZip from 'adm-zip';

/**
 * Minimaler Leser und Schreiber für OpenDocument-Tabellen (.ods).
 *
 * Bewusst ohne zusätzliche Abhängigkeit: Eine .ods-Datei ist ein ZIP mit
 * einer content.xml darin, und adm-zip liegt für den H5P-Import ohnehin
 * schon bei. Für eine Tabelle aus Text braucht es keine
 * Tabellenkalkulations-Bibliothek.
 *
 * Gelesen wird nur die erste Tabelle und nur als Text – Formeln, Zahlen,
 * Formate und Farben interessieren hier nicht. Wichtig ist dagegen, dass
 * Dateien gelesen werden können, die LibreOffice zwischendurch gespeichert
 * hat: Das Programm fasst gleiche Zellen zu `number-columns-repeated`
 * zusammen und verpackt Text in Formatierungs-Tags.
 */

const MIMETYPE = 'application/vnd.oasis.opendocument.spreadsheet';

// ---- Schreiben ----

const escapeXml = (value: string) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Steuerzeichen sind in XML 1.0 nicht erlaubt und würden die Datei
    // unbrauchbar machen – lieber weglassen als eine kaputte Tabelle liefern.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

/** Baut eine .ods-Datei aus einer Tabelle von Texten. */
export function writeOds(sheetName: string, rows: string[][]): Buffer {
  const body = rows
    .map((row) => {
      const cells = row
        .map(
          (cell) =>
            `<table:table-cell office:value-type="string"><text:p>${escapeXml(cell)}</text:p></table:table-cell>`,
        )
        .join('');
      return `<table:table-row>${cells}</table:table-row>`;
    })
    .join('');

  const content =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<office:document-content ` +
    `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
    `xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ` +
    `xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ` +
    `office:version="1.2">` +
    `<office:body><office:spreadsheet>` +
    `<table:table table:name="${escapeXml(sheetName)}">${body}</table:table>` +
    `</office:spreadsheet></office:body></office:document-content>`;

  const manifest =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">` +
    `<manifest:file-entry manifest:full-path="/" manifest:media-type="${MIMETYPE}"/>` +
    `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
    `</manifest:manifest>`;

  const zip = new AdmZip();
  // Die mimetype-Datei muss als erster Eintrag und unkomprimiert im Archiv
  // stehen – daran erkennen Programme das Format, ohne zu entpacken.
  zip.addFile('mimetype', Buffer.from(MIMETYPE, 'utf8'));
  const mime = zip.getEntry('mimetype');
  if (mime) mime.header.method = 0; // STORED
  zip.addFile('META-INF/manifest.xml', Buffer.from(manifest, 'utf8'));
  zip.addFile('content.xml', Buffer.from(content, 'utf8'));
  return zip.toBuffer();
}

// ---- Lesen ----

const decodeXml = (value: string) =>
  value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // &amp; zuletzt, sonst würde "&amp;lt;" zu "<" statt zu "&lt;".
    .replace(/&amp;/g, '&');

/** Wie oft eine Zeile oder Zelle wiederholt wird (LibreOffice fasst zusammen). */
const repeatOf = (attrs: string, kind: 'columns' | 'rows') => {
  const m = attrs.match(new RegExp(`table:number-${kind}-repeated="(\\d+)"`));
  const n = m ? parseInt(m[1], 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/** Der Text einer Zelle: alle <text:p> zusammen, ohne Formatierungs-Tags. */
function cellText(inner: string): string {
  const paragraphs = inner.match(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g);
  if (!paragraphs) return '';
  return paragraphs
    .map((p) => decodeXml(p.replace(/<[^>]+>/g, '')).trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * Liest die erste Tabelle einer .ods-Datei als Text.
 *
 * Nachlaufende Wiederholungen werden nicht ausgerollt: LibreOffice hängt an
 * jede Zeile gern tausend leere Zellen, und die als echte Spalten zu führen
 * würde nur Speicher kosten.
 */
export function readOds(buffer: Buffer): string[][] {
  let xml: string;
  try {
    const zip = new AdmZip(buffer);
    const entry = zip.getEntry('content.xml');
    if (!entry) throw new Error('content.xml fehlt');
    xml = zip.readAsText(entry);
  } catch (err: any) {
    throw new Error(`Die Datei lässt sich nicht als .ods lesen (${err.message}).`);
  }

  const table = xml.match(/<table:table[\s>][\s\S]*?<\/table:table>/);
  if (!table) return [];

  const rows: string[][] = [];
  const rowRe = /<table:table-row([^>]*?)(\/>|>([\s\S]*?)<\/table:table-row>)/g;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(table[0])) !== null) {
    const rowAttrs = rowMatch[1] || '';
    const rowInner = rowMatch[3] || '';

    const cells: string[] = [];
    const cellRe = /<table:(?:covered-)?table-cell([^>]*?)(\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g;

    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowInner)) !== null) {
      const attrs = cellMatch[1] || '';
      const text = cellMatch[3] ? cellText(cellMatch[3]) : '';
      const times = repeatOf(attrs, 'columns');
      // Eine leere Zelle tausendfach zu wiederholen ist Füllmaterial am
      // Zeilenende, keine Information.
      const effective = text === '' && times > 64 ? 1 : Math.min(times, 1024);
      for (let i = 0; i < effective; i++) cells.push(text);
    }

    while (cells.length && cells[cells.length - 1] === '') cells.pop();

    const rowTimes = repeatOf(rowAttrs, 'rows');
    const effectiveRows = cells.length === 0 && rowTimes > 64 ? 1 : Math.min(rowTimes, 1024);
    for (let i = 0; i < effectiveRows; i++) rows.push([...cells]);
  }

  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}
