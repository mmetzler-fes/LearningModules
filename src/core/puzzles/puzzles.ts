import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Logik von Reihenfolge und Kreuzworträtsel steht nur einmal: im
 * Browser-Modul src/renderer/js/puzzles.js. Der Server lädt dieselbe Datei
 * wie bei der Formelaufgabe (formula-engine.ts) – "export" wird entfernt
 * und die Namen eingesammelt.
 */
export interface Puzzles {
  seededRandom(seed: number): () => number;
  shuffled<T>(list: T[], random?: () => number): T[];
  sortingItems(content: any): Array<{ text: string; imageUrl: string; index: number; key: string }>;
  sortingLabel(item: { text: string; index: number }): string;
  scoreSorting(expected: string[], given: string[]): { isCorrect: boolean; points: number; pairs: number; totalPairs: number };
  shuffleForSorting<T extends { key: string }>(items: T[], random?: () => number): T[];
  crosswordLetters(text: string): string[];
  crosswordWords(content: any): Array<{ index: number; text: string; letters: string[]; clue: string; imageUrl: string }>;
  layoutCrossword(words: string[][], seed?: number, attempts?: number): {
    rows: number;
    cols: number;
    cells: Array<Array<string | null>>;
    entries: Array<{ number: number; dir: 'across' | 'down'; row: number; col: number; length: number; wordIndex: number }>;
    islands: number;
  };
  entryCells(entry: { dir: string; row: number; col: number; length: number }): Array<[number, number]>;
  buildCrossword(content: any): any;
  scoreCrossword(puzzle: any, letterAt: (r: number, c: number) => string): { perEntry: any[]; correct: number; total: number };
}

let loaded: Puzzles | null = null;

export function puzzles(): Puzzles {
  if (loaded) return loaded;
  const candidates = [
    path.resolve(__dirname, '../../renderer/js/puzzles.js'), // src/core/puzzles (Tests)
    path.resolve(__dirname, '../../../src/renderer/js/puzzles.js'), // dist/core/puzzles
    path.resolve(process.cwd(), 'src/renderer/js/puzzles.js'),
  ];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) throw new Error('src/renderer/js/puzzles.js fehlt.');
  const names: string[] = [];
  const source = fs.readFileSync(file, 'utf-8').replace(/^export (class|function|const) (\w+)/gm, (_m, kind: string, name: string) => {
    names.push(name);
    return `${kind} ${name}`;
  });
  const sandbox: any = {};
  vm.runInNewContext(`${source}\n;__out = { ${names.join(', ')} };`, sandbox, { filename: file });
  loaded = sandbox.__out as Puzzles;
  return loaded;
}
