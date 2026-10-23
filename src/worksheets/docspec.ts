import { loadBrowserModule } from '../core/browser-module';

/**
 * Prüfen und Anzeigen des Modultyps „Dokument“ gibt es nur einmal: als
 * Browser-Modul src/renderer/lm-editor/src/doc/docspec.js (Submodul lm-editor). Der Server lädt dieselbe Datei –
 * so lehnt er dieselben Specs ab, die der Editor als fehlerhaft markiert.
 */
export interface DocSpecEngine {
  validateDocSpec(spec: unknown): string[];
  renderDocSpecHtml(spec: unknown, options?: { showSolutions?: boolean; showPageBreaks?: boolean; refs?: Record<string, { pfad: string; titel: string }> }): string;
  starmathToMathml(src: string): string;
  textLines(text: string): string[];
  richText(text: string): string;
  resolveRefText(text: string, refs: Record<string, { pfad: string; titel: string }> | null): string;
  resolveDocRefs<T>(value: T, refs: Record<string, { pfad: string; titel: string }> | null): T;
  docRefSlugs(value: unknown): string[];
  DOC_BLOCK_TYPES: string[];
}

export function docSpec(): DocSpecEngine {
  return loadBrowserModule<DocSpecEngine>('../lm-editor/src/doc/docspec.js');
}
