import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Die Formel-Logik der Formelaufgabe gibt es nur einmal: als Browser-Modul
 * src/renderer/js/formula.js. Der Server lädt dieselbe Datei – so rechnen
 * Anzeige, Auswertung und Moodle-Import/-Export garantiert gleich.
 *
 * Die Datei hat keine Importe; "export" wird hier entfernt und die Namen
 * werden eingesammelt.
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

let engine: FormulaEngine | null = null;

export function formulaEngine(): FormulaEngine {
  if (engine) return engine;
  const candidates = [
    path.resolve(__dirname, '../../renderer/js/formula.js'), // src/core/formula (Tests)
    path.resolve(__dirname, '../../../src/renderer/js/formula.js'), // dist/core/formula
    path.resolve(process.cwd(), 'src/renderer/js/formula.js'),
  ];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) throw new Error('src/renderer/js/formula.js fehlt.');
  const names: string[] = [];
  const source = fs.readFileSync(file, 'utf-8').replace(/^export (class|function|const) (\w+)/gm, (_m, kind: string, name: string) => {
    names.push(name);
    return `${kind} ${name}`;
  });
  const sandbox: any = { Math, Number, String, Object, Error, Set, parseFloat, isFinite };
  vm.runInNewContext(`${source}\n;__out = { ${names.join(', ')} };`, sandbox, { filename: file });
  engine = sandbox.__out as FormulaEngine;
  return engine;
}
