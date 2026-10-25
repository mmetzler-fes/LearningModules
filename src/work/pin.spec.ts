import { newPin, pinMatches, PinGuard, PIN_LOCK_MS } from './pin';

describe('PIN der Schüler', () => {
  it('vier Ziffern, auch mit führender Null', () => {
    for (let i = 0; i < 200; i++) expect(newPin()).toMatch(/^\d{4}$/);
  });

  it('vergleicht genau, Leerzeichen egal', () => {
    expect(pinMatches('0420', '0420')).toBe(true);
    expect(pinMatches(' 04 20 ', '0420')).toBe(true);
    expect(pinMatches('420', '0420')).toBe(false);
    expect(pinMatches('0421', '0420')).toBe(false);
    expect(pinMatches('0420', null)).toBe(false);
  });

  it('sperrt nach fünf Fehlversuchen zehn Minuten, ein Treffer setzt zurück', () => {
    const g = new PinGuard();
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) g.failed('s1', t);
    expect(g.lockedFor('s1', t)).toBe(0);
    g.failed('s1', t);
    expect(g.lockedFor('s1', t)).toBe(10);
    expect(g.lockedFor('s1', t + PIN_LOCK_MS)).toBe(0);
    g.failed('s1', t + PIN_LOCK_MS);
    expect(g.lockedFor('s1', t + PIN_LOCK_MS)).toBe(0);
    g.passed('s1');
    expect(g.lockedFor('s1', t)).toBe(0);
  });
});
