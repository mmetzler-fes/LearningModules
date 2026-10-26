import { endOfDay, firstLoginOpen, loginDecision, unitCells, examState, toggleSelection, explicitSelection, moduleOn } from './classbook-rules';

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

describe('examState', () => {
  const now = new Date();
  it('nur ein Durchlauf: begonnen oder abgegeben nur mit Freigabe weiter', () => {
    expect(examState(null, true)).toBe('open');
    expect(examState({ submittedAt: null }, true)).toBe('locked');
    expect(examState({ submittedAt: now }, true)).toBe('submitted');
    expect(examState({ submittedAt: now, reentryAllowed: true }, true)).toBe('reentry');
  });
  it('ohne „nur ein Durchlauf“: weiterschreiben, nach der Abgabe neu', () => {
    expect(examState({ submittedAt: null }, false)).toBe('running');
    expect(examState({ submittedAt: now }, false)).toBe('open');
  });
});

describe('toggleSelection', () => {
  const avail = [
    { topicId: 'A', modules: [{ id: 'a1', subIds: [] }, { id: 'a2', subIds: ['a2x'] }] },
    { topicId: 'B', modules: [{ id: 'b1', subIds: [] }] },
  ];

  it('Lernthema an: seine jetzigen Module; aus: leere Liste (bleibt zum Wiedereinschalten)', () => {
    const on = toggleSelection([], avail, { topicId: 'B', enabled: true });
    expect(on).toEqual([{ topicId: 'B', all: false, moduleIds: ['b1'] }]);
    expect(toggleSelection(on, avail, { topicId: 'B', enabled: false })).toEqual([{ topicId: 'B', all: false, moduleIds: [] }]);
  });

  it('Modul an/aus macht „ganzes Thema“ ausdrücklich; letztes Modul aus = Thema aus', () => {
    const sel = [{ topicId: 'A', all: true }];
    const off = toggleSelection(sel, avail, { topicId: 'A', moduleId: 'a1', enabled: false });
    expect(off).toEqual([{ topicId: 'A', all: false, moduleIds: ['a2'] }]);
    expect(toggleSelection(off, avail, { topicId: 'A', moduleId: 'a2', enabled: false })).toEqual([{ topicId: 'A', all: false, moduleIds: [] }]);
  });

  it('Modul eines ausgeschalteten Themas schaltet das Thema mit diesem Modul ein; Reihenfolge wie verfügbar', () => {
    const sel = [{ topicId: 'B', all: false, moduleIds: ['b1'] }];
    expect(toggleSelection(sel, avail, { topicId: 'A', moduleId: 'a2', enabled: true }))
      .toEqual([{ topicId: 'A', all: false, moduleIds: ['a2'] }, { topicId: 'B', all: false, moduleIds: ['b1'] }]);
  });

  it('gewähltes Submodul zählt fürs Modul', () => {
    expect(moduleOn({ topicId: 'A', all: false, moduleIds: ['a2x'] }, avail[0].modules[1])).toBe(true);
  });

  it('explicitSelection: neue Module bleiben aus', () => {
    expect(explicitSelection([{ topicId: 'A', all: true }], avail)).toEqual([{ topicId: 'A', all: false, moduleIds: ['a1', 'a2'] }]);
  });
});
