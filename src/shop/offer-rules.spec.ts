import { earliestGrantSortKey, offerRoots, orderedTopicIds, withSubmodules } from './offer-rules';

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

describe('Angebote: Reihenfolge beim Erwerb', () => {
  it('Themen-Reihenfolge eines Auswahl-Angebots folgt der Autoren-Auswahl, nicht der DB-Reihenfolge', () => {
    // moduleIds wie vom Anbieter gewählt: zuerst ein Modul aus Thema Z, dann aus Thema A.
    const moduleIds = ['m-z', 'm-a'];
    // Die DB-Abfrage liefert absichtlich in umgekehrter (alphabetischer) Reihenfolge.
    const picked = [{ id: 'm-a', topicId: 'topic-a' }, { id: 'm-z', topicId: 'topic-z' }];
    expect(orderedTopicIds(moduleIds, picked)).toEqual(['topic-z', 'topic-a']);
  });

  it('jedes Thema nur einmal, auch bei mehreren Modulen desselben Themas', () => {
    const moduleIds = ['m-z1', 'm-a', 'm-z2'];
    const picked = [{ id: 'm-z1', topicId: 'topic-z' }, { id: 'm-a', topicId: 'topic-a' }, { id: 'm-z2', topicId: 'topic-z' }];
    expect(orderedTopicIds(moduleIds, picked)).toEqual(['topic-z', 'topic-a']);
  });

  it('Sortierschlüssel: frühester Erwerb zuerst, darin die Angebots-Reihenfolge', () => {
    const early = earliestGrantSortKey([{ createdAt: '2026-01-01T00:00:00Z', topicOrder: 2 }]);
    const late = earliestGrantSortKey([{ createdAt: '2026-02-01T00:00:00Z', topicOrder: 0 }]);
    expect(early[0]).toBeLessThan(late[0]);
  });

  it('Sortierschlüssel nimmt bei mehreren Rechten auf dasselbe Thema den frühesten Erwerb', () => {
    const [time, order] = earliestGrantSortKey([
      { createdAt: '2026-03-01T00:00:00Z', topicOrder: 5 },
      { createdAt: '2026-01-01T00:00:00Z', topicOrder: 1 },
    ]);
    expect(time).toBe(new Date('2026-01-01T00:00:00Z').getTime());
    expect(order).toBe(1);
  });
});
