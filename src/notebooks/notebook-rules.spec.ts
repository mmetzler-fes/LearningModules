import { canHoldNode, insertAt, initialStructure, inheritTags, subtreeIds } from './notebook-rules';

describe('Notebook-Regeln', () => {
  it('Books nur oben, darunter nur tiefere Ebenen', () => {
    expect(canHoldNode(null, 'book')).toBe(true);
    expect(canHoldNode(null, 'area')).toBe(false);
    expect(canHoldNode(null, 'section')).toBe(false);
    expect(canHoldNode('book', 'book')).toBe(false);
    expect(canHoldNode('book', 'area')).toBe(true);
    expect(canHoldNode('book', 'section')).toBe(true); // Bereich darf fehlen
    expect(canHoldNode('area', 'area')).toBe(false);
    expect(canHoldNode('area', 'section')).toBe(true);
    expect(canHoldNode('section', 'section')).toBe(false);
    expect(canHoldNode('section', 'area')).toBe(false);
  });

  it('fügt an der Position ein und verschiebt innerhalb der Liste', () => {
    expect(insertAt(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'x', 'b', 'c']);
    expect(insertAt(['a', 'b', 'c'], 'x')).toEqual(['a', 'b', 'c', 'x']);
    expect(insertAt(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(insertAt(['a', 'b', 'c'], 'a', 99)).toEqual(['b', 'c', 'a']);
  });

  it('Erstbefüllung: Book je Themengebiet, Bereich je Tag darunter', () => {
    const tags = [
      { id: 'inf', name: 'Informatik', isArea: true },
      { id: 'tech', name: 'Technik', isArea: true },
      { id: 'ard', name: 'Arduino', areaIds: ['tech', 'inf'] },
      { id: 'py', name: 'Python', areaIds: ['inf'] },
      { id: 'lose', name: 'Lose' },
    ];
    const topics = [
      { id: 't1', tagIds: ['ard'], updatedAt: '2026-01-01' },
      { id: 't2', tagIds: ['tech'], updatedAt: '2026-03-01' },
      { id: 't3', tagIds: ['lose'] },
      { id: 't4', tagIds: null },
      { id: 't5', tagIds: ['inf'], updatedAt: '2026-02-01' },
      { id: 't6', tagIds: ['py', 'ard'], updatedAt: '2026-04-01' },
    ];
    const { books, unsorted } = initialStructure(topics, tags);
    expect(books.map((b) => b.title)).toEqual(['Informatik', 'Technik']);
    const inf = books[0];
    // Nur das Gebiet → direkt ins Book; Tag darunter → Bereich.
    expect(inf.topicIds).toEqual(['t5']);
    expect(inf.areas.map((a) => a.title)).toEqual(['Arduino']);
    // Arduino gehört zu zwei Gebieten – es kommt ins alphabetisch erste;
    // t6 hat Python und Arduino – der alphabetisch erste Tag zählt.
    expect(inf.areas[0].topicIds).toEqual(['t6', 't1']);
    expect(books[1].topicIds).toEqual(['t2']);
    expect(unsorted.sort()).toEqual(['t3', 't4']);
  });

  it('vererbt Tags und nimmt beim Umziehen nur die geerbten wieder weg', () => {
    // Liegt in Informatik › Arduino, trägt selbst "Arduino" und "Löten".
    let r = inheritTags(['ard', 'loet'], [], ['inf', 'ard']);
    expect(r.tagIds).toEqual(['ard', 'loet', 'inf']);
    expect(r.inherited).toEqual(['inf']);
    // Umzug nach Technik: "Informatik" fällt weg, "Arduino" bleibt (eigener Tag).
    r = inheritTags(r.tagIds, r.inherited, ['tech']);
    expect(r.tagIds).toEqual(['ard', 'loet', 'tech']);
    expect(r.inherited).toEqual(['tech']);
    // Nach „Unsortiert“: nichts mehr geerbt.
    r = inheritTags(r.tagIds, r.inherited, []);
    expect(r.tagIds).toEqual(['ard', 'loet']);
  });

  it('findet den ganzen Teilbaum', () => {
    const nodes = [
      { id: 'b', parentId: null },
      { id: 'a', parentId: 'b' },
      { id: 's', parentId: 'a' },
      { id: 'b2', parentId: null },
    ];
    expect([...subtreeIds(nodes, 'b')].sort()).toEqual(['a', 'b', 's']);
  });
});
