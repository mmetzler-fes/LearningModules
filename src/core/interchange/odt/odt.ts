import AdmZip from 'adm-zip';
import { loadBrowserModule } from '../../browser-module';

/**
 * .odt (Writer), .odp (Impress) und .odg (Draw) lesen – als HTML, aus dem
 * htmlToDocSpec das Dokument macht. Den Import gibt es nur einmal: als
 * gemeinsamer Kern src/renderer/lm-editor/src/import/odt-core.js, den auch der
 * Browser (lm-editor) benutzt. Hier steht nur das Auspacken mit adm-zip.
 */

export interface OdtResult {
  title: string;
  html: string;
  warnings: string[];
  stats: { headings: number; paragraphs: number; tables: number; images: number; drawings: number; exported: number };
}

export interface OdtOptions {
  /**
   * Zeichnungen, die LibreOffice schon gezeichnet hat (Renderer, POST
   * /export-drawings): Name im Dokument (`lmdraw-<n>`) → SVG und Breite.
   * Solche Elemente werden als Bild übernommen statt nachgebaut.
   */
  drawings?: Map<string, { svg: Buffer; widthMm: number }>;
  /**
   * Schon in der Nextcloud abgelegt (Zeichnung mit Quelle): Name → Link des
   * SVG und der .odg. Dann steht der Link im Bild statt der Daten, dazu die
   * Quelle (data-source) zum Bearbeiten in LibreOffice Draw.
   */
  stored?: Map<string, { url: string; source: string }>;
}

interface OdtPackage {
  text(name: string): string | undefined;
  file(name: string): { size: number; base64: string } | undefined;
}

interface OdtCore {
  odtPackageToHtml(pkg: OdtPackage, fileName: string, opts: { drawings?: Map<string, { svgBase64: string; widthMm: number }>; stored?: OdtOptions['stored'] }): OdtResult;
  wrapLine(text: string, size: number, bold: boolean, maxWidth: number): string[];
  usableTitle(t: string): boolean;
}

const core = () => loadBrowserModule<OdtCore>('../lm-editor/src/import/odt-core.js');
// Zeichen aus Words Symbolschrift (U+F057 …) → echte Zeichen (Ω …), wie im Browser (odt.js).
const symbolFont = () => loadBrowserModule<{ fixSymbolChars(text: string): string }>('../lm-editor/src/doc/symbol-font.js');

// Gegen ZIP-Bomben: höchstens so viel auspacken (wie im Browser).
const MAX_ENTRIES = 5000;
const MAX_UNPACKED = 300 * 1024 * 1024;

export function odtToHtml(buffer: Buffer, fileName = '', opts: OdtOptions = {}): OdtResult {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('Die Datei ist kein gültiges OpenDocument (.odt).');
  }
  const entries = zip.getEntries();
  const unpacked = entries.reduce((n, e) => n + (e.header?.size || 0), 0);
  if (entries.length > MAX_ENTRIES || unpacked > MAX_UNPACKED) throw new Error('Die Datei ist kein gültiges OpenDocument (.odt).');
  const pkg: OdtPackage = {
    text: (name) => {
      const text = zip.getEntry(name)?.getData().toString('utf8');
      return text === undefined ? undefined : symbolFont().fixSymbolChars(text);
    },
    file: (name) => {
      const entry = zip.getEntry(name);
      if (!entry || entry.isDirectory) return undefined;
      const data = entry.getData();
      return { size: data.length, get base64() { return data.toString('base64'); } };
    },
  };
  const drawings = opts.drawings
    ? new Map([...opts.drawings].map(([k, d]) => [k, { widthMm: d.widthMm, svgBase64: Buffer.from(symbolFont().fixSymbolChars(d.svg.toString('utf8')), 'utf8').toString('base64') }]))
    : undefined;
  return core().odtPackageToHtml(pkg, fileName, { drawings, stored: opts.stored });
}

export function wrapLine(text: string, size: number, bold: boolean, maxWidth: number): string[] {
  return core().wrapLine(text, size, bold, maxWidth);
}

export function usableTitle(t: string): boolean {
  return core().usableTitle(t);
}
