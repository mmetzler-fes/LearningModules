import { adjustOffer, bookTitle, planTags, remap } from './handover-rules';

describe('Übergabe: Tags', () => {
  it('gleichnamige werden verwendet, fehlende angelegt', () => {
    let n = 0;
    const plan = planTags(
      [{ id: 'a', name: 'Arduino' }, { id: 'b', name: 'Python ' }, { id: 'c', name: 'SPS' }],
      [{ id: 'X', name: 'arduino' }],
      () => `new${++n}`,
    );
    expect(Object.fromEntries(plan.map)).toEqual({ a: 'X', b: 'new1', c: 'new2' });
    expect(plan.create.map((c) => c.from.name)).toEqual(['Python ', 'SPS']);
  });

  it('umschreiben, Unbekanntes bleibt', () => {
    expect(remap(['a', 'school1', 'b'], new Map([['a', 'X'], ['b', 'X']]))).toEqual(['X', 'school1']);
    expect(remap(null, new Map())).toBeNull();
  });
});

describe('Übergabe: Angebote', () => {
  const o = { allowCopy: true, allowUse: true, includeForeign: false, active: true };
  it('mit Urheberschaft unverändert', () => {
    expect(adjustOffer(o, true)).toEqual(o);
  });
  it('ohne: nur noch Use, mit den fremden Modulen', () => {
    expect(adjustOffer(o, false)).toEqual({ allowCopy: false, allowUse: true, includeForeign: true, active: true });
  });
  it('nur Copy: ruht', () => {
    expect(adjustOffer({ ...o, allowUse: false }, false).active).toBe(false);
  });
});

describe('Übergabe: Books', () => {
  it('Name des Absenders, nicht doppelt', () => {
    expect(bookTitle('Informatik', 'Kai')).toBe('Informatik (von Kai)');
    expect(bookTitle('Informatik (von Kai)', 'Kai')).toBe('Informatik (von Kai)');
  });
});
