import { offerRoots, splitPrice, withSubmodules } from './offer-rules';

const mods = [
  { id: 'a', creatorId: 'S' },
  { id: 'a1', parentId: 'a', creatorId: 'S' },
  { id: 'b', creatorId: 'C' },
  { id: 'c', creatorId: 'S' },
];

describe('Angebote: Umfang', () => {
  it('eigene immer, fremde nur auf Wunsch', () => {
    expect(offerRoots(mods, 'S', { includeForeign: false }).map((m) => m.id)).toEqual(['a', 'c']);
    expect(offerRoots(mods, 'S', { includeForeign: true }).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('beim Kopieren gemischter Angebote: Nutzungsrecht nur für die fremden', () => {
    expect(offerRoots(mods, 'S', { includeForeign: true, onlyForeign: true }).map((m) => m.id)).toEqual(['b']);
  });

  it('feste Auswahl', () => {
    expect(offerRoots(mods, 'S', { includeForeign: true, onlyIds: new Set(['b', 'c']) }).map((m) => m.id)).toEqual(['b', 'c']);
    expect(offerRoots(mods, 'S', { includeForeign: false, onlyIds: new Set(['b', 'c']) }).map((m) => m.id)).toEqual(['c']);
  });

  it('Untermodule kommen mit', () => {
    expect(withSubmodules(mods, new Set(['a'])).map((m) => m.id)).toEqual(['a', 'a1']);
  });
});

describe('Angebote: Punkte auf die Creator verteilen', () => {
  const known = new Set(['S', 'C', 'D', 'K']);

  it('nach Modulzahl, Rest an den Anbieter', () => {
    // 2 Module von S, 1 von C, Preis 10 → C 3, S 6 + 1 Rest
    expect(splitPrice(10, ['S', 'S', 'C'], 'S', 'K', known)).toEqual({ S: 7, C: 3 });
  });

  it('gelöschte Konten und der Käufer selbst zählen für den Anbieter', () => {
    expect(splitPrice(9, ['S', 'X', 'K'], 'S', 'K', known)).toEqual({ S: 9 });
  });

  it('kostenlos: keine Buchungen', () => {
    expect(splitPrice(0, ['S', 'C'], 'S', 'K', known)).toEqual({});
  });

  it('nur fremde Module: alles an deren Creator', () => {
    expect(splitPrice(12, ['C', 'D'], 'S', 'K', known)).toEqual({ C: 6, D: 6 });
  });
});
