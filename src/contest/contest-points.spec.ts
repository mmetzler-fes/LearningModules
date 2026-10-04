import { contestPoints } from './contest.service';

describe('contestPoints (Kahoot-Formel)', () => {
  it('gibt bei sofort richtiger Antwort die Höchstpunktzahl', () => {
    expect(contestPoints(1, 0, 30, 1000)).toBe(1000);
  });

  it('gibt bei Ablauf der Zeit noch die Hälfte', () => {
    expect(contestPoints(1, 30000, 30, 1000)).toBe(500);
  });

  it('quadriert die Richtigkeit', () => {
    expect(contestPoints(0.5, 0, 30, 1000)).toBe(250);
  });

  it('gibt für falsche Antworten nichts, egal wie schnell', () => {
    expect(contestPoints(0, 0, 30, 1000)).toBe(0);
  });

  it('begrenzt Zeit und Richtigkeit', () => {
    expect(contestPoints(2, 99999, 30, 1000)).toBe(500);
    expect(contestPoints(-1, 0, 30, 1000)).toBe(0);
  });
});
