import { PointsService } from './points.service';

describe('Punkte: Einkauf und Untergrenze', () => {
  it('ohne Untergrenze geht jeder Einkauf, auch ins Minus', () => {
    expect(PointsService.canSpend(0, 500, null)).toBe(true);
    expect(PointsService.canSpend(-1000, 50, null)).toBe(true);
  });

  it('mit Untergrenze nur, solange der Stand danach nicht darunter liegt', () => {
    expect(PointsService.canSpend(200, 300, -150)).toBe(true); // danach −100
    expect(PointsService.canSpend(-100, 50, -150)).toBe(true); // genau −150
    expect(PointsService.canSpend(-100, 51, -150)).toBe(false);
    expect(PointsService.canSpend(10, 20, 0)).toBe(false); // Untergrenze 0 = kein Minus
  });
});
