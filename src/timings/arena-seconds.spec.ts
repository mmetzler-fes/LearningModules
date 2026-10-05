import { arenaSeconds } from './arena-seconds';

describe('arenaSeconds', () => {
  it('braucht mindestens drei Messungen', () => {
    expect(arenaSeconds([])).toBeNull();
    expect(arenaSeconds([10000, 12000])).toBeNull();
  });

  it('rechnet Median + 3 × MAD (als Standardabweichung), auf 5 s aufgerundet', () => {
    // Median 12 s, MAD 2 s → 12 + 3 × 1,4826 × 2 ≈ 20,9 s → 25 s
    expect(arenaSeconds([10000, 12000, 14000])).toBe(25);
  });

  it('ein einzelner Ausreißer verschiebt die Zeit kaum', () => {
    // Median 13 s, MAD 2 s → ≈ 21,9 s → 25 s (Mittelwert + 3σ ergäbe 170 s)
    expect(arenaSeconds([10000, 12000, 14000, 100000])).toBe(25);
  });

  it('gleiche Zeiten ergeben den Median', () => {
    expect(arenaSeconds([7000, 7000, 7000])).toBe(10);
  });

  it('bleibt zwischen 5 und 600 Sekunden', () => {
    expect(arenaSeconds([500, 600, 700])).toBe(5);
    expect(arenaSeconds([600000, 600000, 100000])).toBe(600);
  });
});
