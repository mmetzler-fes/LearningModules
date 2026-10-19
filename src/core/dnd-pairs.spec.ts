import { loadBrowserModule } from './browser-module';

/** Paar-Logik des Editors: src/renderer/js/dnd-pairs.js */
interface DndPairs {
  contentFromPairs(pairs: any[]): { dropZones: any[]; draggables: any[] };
  pairsFromContent(content: any): { pairs: any[]; problems: string[] };
}
const d = loadBrowserModule<DndPairs>('dnd-pairs.js');
const s = (text = '', imageUrl = '', hideText = false) => ({ text, imageUrl, hideText });

describe('Drag and Drop als Paare (dnd-pairs.js)', () => {
  it('macht aus Paaren Zonen und Elemente, ohne linke Karte einen Ablenker', () => {
    const { dropZones, draggables } = d.contentFromPairs([
      { a: s('Hund'), b: s('dog') },
      { a: s('Katze'), b: s('cat') },
      { a: s(), b: s('mouse') },
      { a: s(), b: s() },
    ]);
    expect(dropZones.map((z) => [z.label, z.correctDraggable])).toEqual([['Hund', 'dog'], ['Katze', 'cat']]);
    expect(draggables.map((x) => [x.text, x.correctZone])).toEqual([['dog', 'Hund'], ['cat', 'Katze'], ['mouse', '']]);
  });

  it('gibt Seiten nur mit Bild einen verborgenen, eindeutigen Namen', () => {
    const { dropZones, draggables } = d.contentFromPairs([
      { a: s('', 'data:a'), b: s('Hund') },
      { a: s('Katze', 'data:k', true), b: s('', 'data:c') },
      { a: s('Katze'), b: s('Bild 2') },
    ]);
    expect(dropZones.map((z) => [z.label, z.hideText])).toEqual([['Karte 1', true], ['Katze', true], ['Katze (2)', false]]);
    // „Bild 2“ gibt es schon als echten Text – der automatische Name weicht aus.
    expect(draggables.map((x) => [x.text, x.correctZone, x.hideText])).toEqual([
      ['Hund', 'Karte 1', false], ['Bild 2 (2)', 'Katze', true], ['Bild 2', 'Katze (2)', false],
    ]);
  });

  it('liest Zonen als Paare und nennt, was dabei verloren geht', () => {
    const { pairs, problems } = d.pairsFromContent({
      dropZones: [{ label: 'A', group: 'G' }, { label: 'B', imageUrl: 'data:b', hideText: true }, { label: 'C' }],
      draggables: [{ text: 'a1', correctZone: 'A' }, { text: 'a2', correctZone: 'A' }, { text: 'b', correctZone: 'B', multiple: true }, { text: 'x', correctZone: '' }],
    });
    expect(pairs.map((p) => [p.a.text, p.b.text])).toEqual([['A', 'a1'], ['B', 'b'], ['C', ''], ['', 'a2'], ['', 'x']]);
    expect(pairs[1].a).toEqual(s('B', 'data:b', true));
    expect(problems).toHaveLength(3);
  });

  it('Paare → Zonen → Paare bleibt gleich', () => {
    const pairs = [{ a: s('Hund', 'data:h', true), b: s('dog') }, { a: s('Katze'), b: s('cat', 'data:c') }, { a: s(), b: s('mouse') }];
    expect(d.pairsFromContent(d.contentFromPairs(pairs))).toEqual({ pairs, problems: [] });
  });
});
