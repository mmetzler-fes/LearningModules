import { endOfDay, firstLoginOpen, loginDecision, unitCells } from './classbook-rules';

const same = (a: string, b: string | null | undefined) => a === b;

describe('Erstanmeldung', () => {
  it('offen bis zum Ende des Tages', () => {
    const now = new Date(2026, 9, 26, 10, 15);
    const until = endOfDay(now);
    expect(until.getDate()).toBe(26);
    expect(until.getHours()).toBe(23);
    expect(firstLoginOpen(until, now.getTime())).toBe(true);
    expect(firstLoginOpen(until, new Date(2026, 9, 27, 0, 1).getTime())).toBe(false);
    expect(firstLoginOpen(null)).toBe(false);
  });
});

describe('loginDecision', () => {
  const s = { status: 'confirmed', pin: '0420', pinShownAt: null as Date | null };

  it('unbestätigt und Testschüler: ohne PIN', () => {
    expect(loginDecision({ status: 'pending' }, undefined, false, same)).toBe('ok');
    expect(loginDecision(null, undefined, false, same)).toBe('ok');
  });

  it('PIN noch nie gesehen: bei offener Erstanmeldung zeigen, sonst nicht hinein', () => {
    expect(loginDecision(s, undefined, true, same)).toBe('show');
    expect(loginDecision(s, undefined, false, same)).toBe('closed');
  });

  it('PIN schon gesehen: muss stimmen – auch bei offener Erstanmeldung', () => {
    const seen = { ...s, pinShownAt: new Date() };
    expect(loginDecision(seen, undefined, true, same)).toBe('need');
    expect(loginDecision(seen, '0420', false, same)).toBe('ok');
    expect(loginDecision(seen, '1111', true, same)).toBe('wrong');
  });

  it('von der Lehrkraft gesagte PIN gilt, auch wenn sie nie angezeigt wurde', () => {
    expect(loginDecision(s, '0420', false, same)).toBe('ok');
  });
});

describe('unitCells', () => {
  const units = [{ id: 'a', ids: ['a'] }, { id: 'b', ids: ['b', 'b1', 'b2'] }, { id: 'c', ids: ['c'] }, { id: 'd', ids: ['d'] }];

  it('bester Durchlauf je Modul, Submodule zählen zum Modul', () => {
    const runs = [
      { details: [{ moduleId: 'a', isCorrect: false }, { moduleId: 'b1', isCorrect: true }, { moduleId: 'b2', isCorrect: false }] },
      { details: [{ moduleId: 'a', isCorrect: true }, { moduleId: 'c', informational: true }] },
    ];
    const cells = unitCells(units, runs, new Set(['d']));
    expect(cells.a).toEqual({ done: true, pct: 100, work: false });
    expect(cells.b).toEqual({ done: true, pct: 50, work: false });
    expect(cells.c).toEqual({ done: true, pct: null, work: false });
    expect(cells.d).toEqual({ done: false, pct: null, work: true });
  });

  it('Punkte statt richtig/falsch', () => {
    const cells = unitCells([{ id: 'a', ids: ['a'] }], [{ details: [{ moduleId: 'a', points: 0.5 }] }], new Set());
    expect(cells.a.pct).toBe(50);
  });
});
