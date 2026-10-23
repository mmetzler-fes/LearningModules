import { loadBrowserModule } from '../browser-module';

/**
 * Die Formel-Logik der Formelaufgabe gibt es nur einmal: als Browser-Modul
 * src/renderer/lm-editor/src/modules/formula.js. Der Server lädt dieselbe Datei – so rechnen
 * Anzeige, Auswertung und Moodle-Import/-Export garantiert gleich.
 *
 * Die Datei hat keine Importe; geladen wird sie über browser-module.ts.
 */
export interface FormulaEngine {
  parseFormula(src: string): any;
  evaluate(src: string, values?: Record<string, number>): number;
  variablesOf(src: string): string[];
  toMoodleFormula(src: string): string;
  fromMoodleFormula(src: string): string;
  roundTo(v: number, decimals: number): number;
  formatNumber(v: number, decimals?: number): string;
  parseUserNumber(text: string): number;
  isWithinTolerance(given: number, correct: number, result?: any): boolean;
  generateValues(variables?: any[], results?: any[], random?: () => number): Record<string, number> | null;
  fillPlaceholders(text: string, values: Record<string, number>, variables?: any[]): string;
  checkFormulaTask(content?: any): string[];
  FormulaError: new (msg: string) => Error;
}

export function formulaEngine(): FormulaEngine {
  return loadBrowserModule<FormulaEngine>('../lm-editor/src/modules/formula.js');
}
