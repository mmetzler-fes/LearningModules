import { loadBrowserModule } from '../core/browser-module';

/**
 * Prüfen und Anzeigen des Modultyps „Dokument“ gibt es nur einmal: als
 * Browser-Modul src/renderer/js/docspec.js. Der Server lädt dieselbe Datei –
 * so lehnt er dieselben Specs ab, die der Editor als fehlerhaft markiert.
 */
export interface DocSpecEngine {
  validateDocSpec(spec: unknown): string[];
  renderDocSpecHtml(spec: unknown, options?: { showSolutions?: boolean; showPageBreaks?: boolean }): string;
  starmathToMathml(src: string): string;
  textLines(text: string): string[];
  richText(text: string): string;
  DOC_BLOCK_TYPES: string[];
}

export function docSpec(): DocSpecEngine {
  return loadBrowserModule<DocSpecEngine>('docspec.js');
}
