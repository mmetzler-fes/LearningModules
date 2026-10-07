import { formulaEngine } from './formula-engine';

const f = formulaEngine();

describe('Formel-Logik (src/renderer/js/formula.js)', () => {
  it('rechnet mit Rangfolge, Potenz und Vorzeichen', () => {
    expect(f.evaluate('2 + 3 * 4')).toBe(14);
    expect(f.evaluate('(2 + 3) * 4')).toBe(20);
    expect(f.evaluate('2 ^ 3 ^ 2')).toBe(512);
    expect(f.evaluate('-2 ^ 2')).toBe(-4);
    expect(f.evaluate('U / R', { U: 12, R: 4 })).toBe(3);
    expect(f.evaluate('{U}^2 / {R}', { U: 10, R: 5 })).toBe(20);
    expect(f.evaluate('sqrt(R^2 + X^2)', { R: 3, X: 4 })).toBe(5);
    expect(f.evaluate('rad2deg(atan(X / R))', { X: 1, R: 1 })).toBeCloseTo(45);
    expect(f.evaluate('2 * pi * f * L', { f: 50, L: 0.1 })).toBeCloseTo(31.4159, 3);
    expect(f.evaluate('pi()')).toBeCloseTo(Math.PI);
    expect(f.evaluate('1.5e-3 * 1000')).toBeCloseTo(1.5);
    expect(f.evaluate('3 · 4 × 2')).toBe(24);
  });

  it('meldet Fehler verständlich', () => {
    expect(() => f.parseFormula('2 *')).toThrow(/endet zu früh/);
    expect(() => f.parseFormula('2U')).toThrow(/Rechenzeichen vor „U“/);
    expect(() => f.parseFormula('wurzel(2)')).toThrow(/Unbekannte Funktion „wurzel“/);
    expect(() => f.parseFormula('1,5 * 2')).toThrow(/mit Punkt schreiben/);
    expect(() => f.parseFormula('pow(2)')).toThrow(/2 Argumente/);
    expect(() => f.evaluate('U / R', { U: 1 })).toThrow(/Unbekannte Variable „R“/);
  });

  it('findet Variablen, aber keine Konstanten', () => {
    expect(f.variablesOf('2 * pi * f * L + e').sort()).toEqual(['L', 'f']);
    expect(f.variablesOf('{e} * 2')).toEqual(['e']);
  });

  it('Moodle-Schreibweise hin und zurück', () => {
    expect(f.toMoodleFormula('U^2 / R')).toBe('pow({U}, 2) / {R}');
    expect(f.toMoodleFormula('a - (b - c)')).toBe('{a} - ({b} - {c})');
    expect(f.toMoodleFormula('a / (b * c)')).toBe('{a} / ({b} * {c})');
    expect(f.toMoodleFormula('(a + b) * c')).toBe('({a} + {b}) * {c}');
    expect(f.toMoodleFormula('2 * pi * f + ln(x) + e')).toBe('2 * pi() * {f} + log({x}) + exp(1)');
    expect(f.fromMoodleFormula('pow({U}, 2) / {R}')).toBe('pow(U, 2) / R');
    // Rundreise rechnet gleich
    const src = 'sqrt(R^2 + (2*pi*f*L - 1/(2*pi*f*C))^2)';
    const vals = { R: 100, f: 50, L: 0.2, C: 0.00001 };
    expect(f.evaluate(f.fromMoodleFormula(f.toMoodleFormula(src)), vals)).toBeCloseTo(f.evaluate(src, vals), 9);
  });

  it('liest Schülereingaben', () => {
    expect(f.parseUserNumber('1,5')).toBe(1.5);
    expect(f.parseUserNumber(' 1.5 ')).toBe(1.5);
    expect(f.parseUserNumber('-0,25')).toBe(-0.25);
    expect(f.parseUserNumber('1,5e-3')).toBe(0.0015);
    expect(f.parseUserNumber('1.234,5')).toBe(1234.5);
    expect(f.parseUserNumber('12 000')).toBe(12000);
    expect(f.parseUserNumber('abc')).toBeNaN();
    expect(f.parseUserNumber('')).toBeNaN();
  });

  it('Toleranz relativ, absolut und gerundeter Wert', () => {
    expect(f.isWithinTolerance(0.255, 0.2553, { tolerance: 1, toleranceType: 'relative' })).toBe(true);
    expect(f.isWithinTolerance(0.25, 0.2553, { tolerance: 1, toleranceType: 'relative' })).toBe(false);
    expect(f.isWithinTolerance(0.26, 0.2553, { tolerance: 0, decimals: 2 })).toBe(true); // gerundet angegeben
    expect(f.isWithinTolerance(10.4, 10, { tolerance: 0.5, toleranceType: 'absolute' })).toBe(true);
    expect(f.isWithinTolerance(10.6, 10, { tolerance: 0.5, toleranceType: 'absolute' })).toBe(false);
    expect(f.isWithinTolerance(NaN, 10, {})).toBe(false);
  });

  it('Zufallswerte im Bereich, gerundet, ohne Division durch 0', () => {
    let calls = 0;
    const rnd = () => [0, 0.5][calls++ % 2]; // erst R = 0 → wird neu gezogen
    const v = f.generateValues([{ name: 'U', min: 10, max: 20, decimals: 1 }, { name: 'R', min: 0, max: 10, decimals: 0 }],
      [{ formula: 'U / R' }], () => (calls++ < 2 ? 0 : 0.5));
    expect(v).toEqual({ U: 15, R: 5 });
    for (let i = 0; i < 50; i++) {
      const w = f.generateValues([{ name: 'x', min: 1, max: 2, decimals: 2 }], [])!;
      expect(w.x).toBeGreaterThanOrEqual(1);
      expect(w.x).toBeLessThanOrEqual(2);
      expect(Math.round(w.x * 100)).toBeCloseTo(w.x * 100, 9);
    }
    void rnd;
  });

  it('setzt Werte und Teilergebnisse in den Text', () => {
    const vars = [{ name: 'U', decimals: 1 }, { name: 'R', decimals: 0 }];
    expect(f.fillPlaceholders('U = {U} V, R = {R} Ω, I ≈ {={U}/{R}} A', { U: 12, R: 47 }, vars))
      .toBe('U = 12,0 V, R = 47 Ω, I ≈ 0,255 A');
    expect(f.fillPlaceholders('{X} bleibt', { U: 1 }, vars)).toBe('{X} bleibt');
  });

  it('prüft Aufgaben für den Editor', () => {
    expect(f.checkFormulaTask({ variables: [{ name: 'U', min: 1, max: 2 }], results: [{ label: 'I', formula: 'U/R' }] }))
      .toEqual(['I: Variable „R“ ist nicht festgelegt']);
    expect(f.checkFormulaTask({ variables: [{ name: 'U', min: 5, max: 1 }], results: [{ formula: 'U*' }] }))
      .toEqual(['Variable „U“: Maximum kleiner als Minimum', 'U*: Die Formel endet zu früh']);
    expect(f.checkFormulaTask({ variables: [], results: [] })).toEqual(['Mindestens ein Ergebnis mit Formel angeben']);
    expect(f.checkFormulaTask({ variables: [{ name: 'U', min: 1, max: 2 }, { name: 'R', min: 1, max: 2 }], results: [{ formula: 'U/R' }] })).toEqual([]);
  });
});
