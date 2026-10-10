import { offerRoots, withSubmodules } from './offer-rules';

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
