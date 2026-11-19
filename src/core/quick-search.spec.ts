import { loadBrowserModule } from './browser-module';

const { buildSearchIndex, searchItems, foldText } = loadBrowserModule<{
  buildSearchIndex(data: any): any[];
  searchItems(items: any[], q: string, limit?: number): any[];
  foldText(s: string): string;
}>('quick-search-index.js');

const data = {
  nodes: [
    { id: 'b', kind: 'book', title: 'Elektrotechnik', parentId: null },
    { id: 'a', kind: 'area', title: 'BPE 3 Grundlagen', parentId: 'b' },
  ],
  placements: [{ topicId: 't1', nodeId: 'a' }],
  topics: [
    {
      id: 't1',
      title: 'Ohmsches Gesetz',
      isOwn: true,
      modules: [
        { id: 'd', type: 'document', title: 'Ohmsches Gesetz' },
        { id: 'q', type: 'multipleChoice', title: 'Widerstand berechnen' },
      ],
    },
    { id: 't2', title: 'Mappe Übungen', isOwn: true, modules: [] },
  ],
};

describe('Schnellsuche (Strg+K)', () => {
  const items = buildSearchIndex(data);

  it('ein Lernthema mit einem gleichnamigen Dokument steht nur einmal da (📄)', () => {
    const hits = searchItems(items, 'ohm');
    expect([hits[0].kind, hits[0].icon, hits[0].title]).toEqual([
      'topic',
      '📄',
      'Ohmsches Gesetz',
    ]);
    // Das Dokument nicht noch einmal; das Quiz trifft über seinen Pfad.
    expect(hits.map((h) => h.id)).toEqual(['t1', 'q']);
    expect(hits[0].path).toEqual(['Elektrotechnik', 'BPE 3 Grundlagen']);
  });

  it('findet Quizze mit Pfad, alle Wörter auch im Pfad', () => {
    const hits = searchItems(items, 'widerstand bpe');
    expect(hits[0]).toMatchObject({
      kind: 'module',
      id: 'q',
      topicId: 't1',
      path: ['Elektrotechnik', 'BPE 3 Grundlagen', 'Ohmsches Gesetz'],
    });
  });

  it('Umlaute auch als ae/oe/ue, Titelanfang zuerst', () => {
    expect(foldText('Übungen')).toBe('uebungen');
    expect(searchItems(items, 'uebung')[0].title).toBe('Mappe Übungen');
    expect(searchItems(items, 'e')[0].title).toBe('Elektrotechnik');
    expect(searchItems(items, '  ')).toEqual([]);
  });
});
