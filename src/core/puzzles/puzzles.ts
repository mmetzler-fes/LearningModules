import { loadBrowserModule } from '../browser-module';

/**
 * Logik von Reihenfolge und Kreuzworträtsel steht nur einmal: im
 * Browser-Modul src/renderer/js/puzzles.js. Der Server lädt dieselbe Datei
 * (browser-module.ts).
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

export function puzzles(): Puzzles {
  return loadBrowserModule<Puzzles>('puzzles.js');
}
