import { puzzles } from './puzzles';

const p = puzzles();

describe('Reihenfolge (src/renderer/js/puzzles.js)', () => {
  const items = p.sortingItems({ items: [{ text: 'A' }, { text: '' }, { text: 'B', imageUrl: 'x.png' }, { text: 'C' }, { text: 'D' }] });

  it('überspringt leere Elemente und gibt Bildern ohne Text einen Namen', () => {
    expect(items.map((i) => i.text)).toEqual(['A', 'B', 'C', 'D']);
    expect(p.sortingLabel({ text: '', index: 2 })).toBe('Bild 3');
  });

  it('bewertet über Nachbarpaare', () => {
    const keys = ['a', 'b', 'c', 'd'];
    expect(p.scoreSorting(keys, ['a', 'b', 'c', 'd'])).toMatchObject({ isCorrect: true, points: 1 });
    // Ein Element verrutscht: zwei von drei Paaren stimmen noch
    expect(p.scoreSorting(keys, ['b', 'c', 'd', 'a'])).toMatchObject({ isCorrect: false, pairs: 2 });
    expect(p.scoreSorting(keys, ['d', 'c', 'b', 'a']).points).toBe(0);
  });

  it('behandelt gleiche Elemente als vertauschbar', () => {
    expect(p.scoreSorting(['x', 'y', 'x'], ['x', 'y', 'x']).isCorrect).toBe(true);
    // Das Paar x→y gibt es in der Lösung nur einmal
    expect(p.scoreSorting(['x', 'y', 'z'], ['x', 'y', 'x']).pairs).toBe(1);
  });

  it('mischt nie in die Lösung', () => {
    const two = p.sortingItems({ items: [{ text: 'A' }, { text: 'B' }] });
    for (let s = 1; s < 50; s++) {
      const mixed = p.shuffleForSorting(two, p.seededRandom(s));
      expect(mixed.map((i) => i.text)).toEqual(['B', 'A']);
    }
    const same = p.sortingItems({ items: [{ text: 'A' }, { text: 'A' }] });
    expect(p.shuffleForSorting(same).map((i) => i.text)).toEqual(['A', 'A']);
  });
});

describe('Kreuzworträtsel (src/renderer/js/puzzles.js)', () => {
  it('schreibt einen Buchstaben je Feld', () => {
    expect(p.crosswordLetters('Straße').join('')).toBe('STRAßE');
    expect(p.crosswordLetters('Öl-Tank').join('')).toBe('ÖLTANK');
    expect(p.crosswordLetters('New York').join('')).toBe('NEWYORK');
  });

  const content = {
    seed: 3,
    words: [
      { answer: 'Widerstand', clue: 'Bauteil, begrenzt den Strom' },
      { answer: 'Spannung', clue: 'Einheit Volt' },
      { answer: 'Strom', clue: 'Einheit Ampere' },
      { answer: 'Leistung', clue: 'Einheit Watt' },
      { answer: 'Ohm', clue: 'Einheit des Widerstands' },
      { answer: 'Diode', clue: 'Lässt Strom nur in eine Richtung' },
      { answer: 'Kondensator', clue: 'Speichert Ladung' },
      { answer: 'x', clue: 'zu kurz – fällt weg' },
    ],
  };

  it('legt jedes Wort genau an seine Felder, ohne Widerspruch', () => {
    const { words, layout } = p.buildCrossword(content);
    expect(words).toHaveLength(7);
    expect(layout.entries).toHaveLength(7);
    for (const e of layout.entries) {
      const letters = words[e.wordIndex].letters;
      p.entryCells(e).forEach(([r, c], i) => expect(layout.cells[r][c]).toBe(letters[i]));
    }
    expect(new Set(layout.entries.map((e: any) => e.wordIndex)).size).toBe(7);
  });

  it('lässt keine Unsinnswörter entstehen', () => {
    const { words, layout } = p.buildCrossword(content);
    // Jede zusammenhängende Buchstabenfolge (waagerecht wie senkrecht) muss ein Eintrag sein.
    const runs: string[] = [];
    const scan = (get: (a: number, b: number) => string | null, outer: number, inner: number, dir: string) => {
      for (let a = 0; a < outer; a++) {
        let start = -1;
        for (let b = 0; b <= inner; b++) {
          const ch = b < inner ? get(a, b) : null;
          if (ch && start < 0) start = b;
          if (!ch && start >= 0) {
            if (b - start > 1) runs.push(`${dir}:${dir === 'across' ? a : start},${dir === 'across' ? start : a},${b - start}`);
            start = -1;
          }
        }
      }
    };
    scan((r, c) => layout.cells[r][c], layout.rows, layout.cols, 'across');
    scan((c, r) => layout.cells[r][c], layout.cols, layout.rows, 'down');
    const entries = layout.entries.map((e: any) => `${e.dir}:${e.row},${e.col},${words[e.wordIndex].letters.length}`);
    expect(runs.sort()).toEqual(entries.sort());
  });

  it('ist durch den Startwert bestimmt', () => {
    const a = p.buildCrossword(content).layout;
    const b = p.buildCrossword(content).layout;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // „Neu anordnen“ soll tatsächlich andere Gitter bringen
    const layouts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => JSON.stringify(p.buildCrossword({ ...content, seed }).layout.cells)));
    expect(layouts.size).toBeGreaterThanOrEqual(4);
  });

  it('nummeriert zeilenweise, gemeinsamer Anfang teilt die Nummer', () => {
    const { layout } = p.buildCrossword(content);
    const starts = layout.entries.map((e: any) => [e.row, e.col, e.number]);
    for (let i = 1; i < starts.length; i++) {
      const [r0, c0, n0] = starts[i - 1];
      const [r1, c1, n1] = starts[i];
      if (r0 === r1 && c0 === c1) expect(n1).toBe(n0);
      else expect(n1).toBe(n0 + 1);
    }
  });

  it('stellt Wörter ohne gemeinsamen Buchstaben frei', () => {
    const { layout } = p.buildCrossword({ words: [{ answer: 'ABC' }, { answer: 'XYZ' }] });
    expect(layout.entries).toHaveLength(2);
    expect(layout.islands).toBe(1);
  });

  it('bewertet je Wort', () => {
    const puzzle = p.buildCrossword(content);
    const all = p.scoreCrossword(puzzle, (r, c) => puzzle.layout.cells[r][c] || '');
    expect(all.correct).toBe(all.total);
    const none = p.scoreCrossword(puzzle, () => '');
    expect(none.correct).toBe(0);
    expect(none.perEntry[0].given).toMatch(/^_+$/);
  });
});
