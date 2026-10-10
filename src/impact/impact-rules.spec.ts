import {
  cleanStars, matchCopies, moduleIdsOfRun, originOf, originsOfRun, periodOf, shouldHintSharing, summarizeRatings, summarizeUsage,
} from './impact-rules';

describe('Wirkung: Herkunft', () => {
  it('ein Original ist sein eigener Ursprung, eine Kopie zeigt auf ihn', () => {
    expect(originOf({ id: 'a' })).toBe('a');
    expect(originOf({ id: 'k', originId: 'a' })).toBe('a');
  });

  it('Untermodule zählen für ihr Elternmodul, Unbekanntes gar nicht', () => {
    const mods = [
      { id: 'k', originId: 'a' },
      { id: 'k1', originId: 'a1', parentId: 'k' },
      { id: 'b' },
    ];
    expect(originsOfRun(['k1', 'k', 'b', 'x'], mods).sort()).toEqual(['a', 'b']);
  });

  it('Modul-IDs eines Durchlaufs', () => {
    expect(moduleIdsOfRun([{ moduleId: 'a' }, { moduleId: 'a' }, { moduleId: 3 }, null, { moduleId: 'b' }])).toEqual(['a', 'b']);
    expect(moduleIdsOfRun('kaputt')).toEqual([]);
  });

  it('Monat', () => {
    expect(periodOf(new Date(2026, 9, 10))).toBe('2026-10');
    expect(periodOf(new Date(2027, 0, 1))).toBe('2027-01');
  });
});

describe('Wirkung: Zähler', () => {
  it('eigene Durchläufe zählen mit, als Lehrkräfte nur die anderen', () => {
    const s = summarizeUsage([
      { teacherId: 'me', classId: 'c1', runs: 10 },
      { teacherId: 'k1', classId: 'c2', runs: 5 },
      { teacherId: 'k1', classId: '', runs: 2 },
      { teacherId: 'k2', classId: 'c2', runs: 1 },
    ], 'me');
    expect(s).toEqual({ runs: 18, runsByOthers: 8, teachers: ['k1', 'k2'], classes: 3 });
  });
});

describe('Bewertung', () => {
  it('Durchschnitt nur über Sterne, Danke zählt extra', () => {
    expect(summarizeRatings([
      { stars: 5, thanks: true },
      { stars: 4, thanks: false },
      { stars: null, thanks: true },
      { stars: 4, thanks: false },
    ])).toEqual({ avg: 4.3, count: 3, thanks: 2 });
    expect(summarizeRatings([])).toEqual({ avg: null, count: 0, thanks: 0 });
  });

  it('nur ganze Sterne von 1 bis 5', () => {
    expect(cleanStars(3)).toBe(3);
    expect(cleanStars('5')).toBe(5);
    expect(cleanStars(0)).toBeNull();
    expect(cleanStars(6)).toBeNull();
    expect(cleanStars(2.5)).toBeNull();
    expect(cleanStars(null)).toBeNull();
  });
});

describe('Hinweis zum Teilen', () => {
  it('erst ab der Schwelle und nur ohne eigenes Teilen', () => {
    expect(shouldHintSharing(5, 0, 5)).toBe(true);
    expect(shouldHintSharing(4, 0, 5)).toBe(false);
    expect(shouldHintSharing(9, 1, 5)).toBe(false);
    expect(shouldHintSharing(99, 0, 0)).toBe(false);
  });
});

describe('Alte Kopien ihrem Original zuordnen', () => {
  it('nach Art, Titel und Creator, bei Gleichen nach Reihenfolge', () => {
    const source = [
      { id: 's1', title: 'Quiz', type: 'mc', creatorId: 'C', orderIndex: 0 },
      { id: 's2', title: 'Quiz', type: 'mc', creatorId: 'C', orderIndex: 1 },
      { id: 's3', title: 'Lücken', type: 'blanks', creatorId: 'C', orderIndex: 2 },
      { id: 's3a', title: 'Teil', type: 'tf', creatorId: 'C', parentId: 's3' },
    ];
    const copy = [
      { id: 'k1', title: 'Quiz', type: 'mc', creatorId: 'C', orderIndex: 0 },
      { id: 'k2', title: 'Quiz', type: 'mc', creatorId: 'C', orderIndex: 1 },
      { id: 'k3', title: 'Lücken', type: 'blanks', creatorId: 'C', orderIndex: 2 },
      { id: 'k3a', title: 'Teil', type: 'tf', creatorId: 'C', parentId: 'k3' },
      { id: 'k4', title: 'Neu', type: 'mc', creatorId: 'K', orderIndex: 3 },
    ];
    expect(Object.fromEntries(matchCopies(source, copy))).toEqual({ k1: 's1', k2: 's2', k3: 's3', k3a: 's3a' });
  });
});
