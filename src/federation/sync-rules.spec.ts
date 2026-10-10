import { cleanCode, decide, newLinkCode, planModules, stable, topicHash } from './sync-rules';

const m = (key: string, extra: any = {}) => ({ key, parentKey: null, type: 'trueFalse', title: key, description: null, content: { a: 1, b: [2, 3] }, orderIndex: 0, moduleSelected: true, ...extra });

describe('Abgleich: Prüfsumme', () => {
  it('Reihenfolge der Schlüssel und Module egal, Inhalt nicht', () => {
    expect(stable({ b: 1, a: { d: 2, c: 3 } })).toBe(stable({ a: { c: 3, d: 2 }, b: 1 }));
    const h = topicHash('T', 'D', [m('x'), m('y')]);
    expect(topicHash('T', 'D', [m('y'), m('x', { content: { b: [2, 3], a: 1 } })])).toBe(h);
    expect(topicHash('T', 'D', [m('x'), m('y', { title: 'neu' })])).not.toBe(h);
    expect(topicHash('T2', 'D', [m('x'), m('y')])).not.toBe(h);
  });
});

describe('Abgleich: Entscheidung', () => {
  it('neu, unverändert, übernehmen, Konflikt', () => {
    expect(decide(null, 'n')).toBe('create');
    expect(decide({ syncHash: 'a', localHash: 'a' }, 'a')).toBe('unchanged');
    expect(decide({ syncHash: 'a', localHash: 'a' }, 'b')).toBe('update');
    expect(decide({ syncHash: 'a', localHash: 'x' }, 'b')).toBe('conflict');
    // hier und drüben gleich geändert: kein Konflikt
    expect(decide({ syncHash: 'a', localHash: 'b' }, 'b')).toBe('unchanged');
  });

  it('Module: ändern, neu, entfernen', () => {
    const p = planModules([{ key: 'x' }, { key: 'z' }], [m('x'), m('y')]);
    expect(p.update.map((u) => u.next.key)).toEqual(['x']);
    expect(p.create.map((c) => c.key)).toEqual(['y']);
    expect(p.remove.map((r) => r.key)).toEqual(['z']);
  });
});

describe('Abgleich: Code', () => {
  it('lesbar und tolerant bei der Eingabe', () => {
    const c = newLinkCode();
    expect(c).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(cleanCode(c.toLowerCase().replace('-', ' '))).toBe(c);
    expect(cleanCode('abc')).toBe('');
  });
});
