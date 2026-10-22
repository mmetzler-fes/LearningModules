import { loadBrowserModule } from './browser-module';

/** Geometrie des Stift-Editors: src/renderer/js/ink/ink-geometry.js */
interface InkGeometry {
  A4: { w: number; h: number };
  MM: number;
  smooth(points: number[][], k?: number): number[][];
  widthAt(base: number, pressure: number): number;
  strokeOutline(points: number[][], base: number): string;
  polyline(points: number[][]): string;
  hitsStroke(item: any, x: number, y: number, radius: number): boolean;
  bounds(item: any): { x: number; y: number; w: number; h: number };
  inSelection(item: any, rect: { x: number; y: number; w: number; h: number }): boolean;
  moved(item: any, dx: number, dy: number): any;
  ruling(kind: string, w: number, h: number): number[][];
}
const g = loadBrowserModule<InkGeometry>('ink/ink-geometry.js');

describe('Stift-Editor: Geometrie (ink-geometry.js)', () => {
  const stroke = { type: 'stroke', width: 2, points: [[10, 10, 0.5], [50, 10, 0.5], [90, 10, 0.5]] };

  it('Druck macht den Strich dünner oder dicker', () => {
    expect(g.widthAt(2, 0)).toBeLessThan(g.widthAt(2, 0.5));
    expect(g.widthAt(2, 1)).toBeGreaterThan(g.widthAt(2, 0.5));
    expect(g.widthAt(2, 7)).toBe(g.widthAt(2, 1));
  });

  it('Umriss: Fläche mit runden Enden, ein Punkt wird ein Kreis', () => {
    expect(g.strokeOutline(stroke.points, 2)).toMatch(/^M.*Z.*a.*Z$/);
    expect(g.strokeOutline([[5, 5, 0.5]], 2)).toMatch(/^M[\d.]+,5a/);
    expect(g.strokeOutline([], 2)).toBe('');
  });

  it('Glätten lässt Anfang und Ende stehen', () => {
    const pts = [[0, 0, 0.5], [10, 9, 0.5], [20, 0, 0.5], [30, 9, 0.5]];
    const s = g.smooth(pts);
    expect(s[0]).toEqual(pts[0]);
    expect(s[3]).toEqual(pts[3]);
    expect(s[1][1]).toBeLessThan(9);
  });

  it('Radierer trifft den Strich – die Strichbreite zählt mit', () => {
    expect(g.hitsStroke(stroke, 50, 12, 1.5)).toBe(true);
    expect(g.hitsStroke(stroke, 50, 20, 3)).toBe(false);
    expect(g.hitsStroke({ type: 'stroke', width: 2, points: [[5, 5, 0.5]] }, 6, 6, 1)).toBe(true);
  });

  it('Auswahl: Strich, sobald ein Punkt im Rechteck liegt; Text bei Überschneidung', () => {
    expect(g.inSelection(stroke, { x: 40, y: 0, w: 20, h: 20 })).toBe(true);
    expect(g.inSelection(stroke, { x: 60, y: 30, w: -30, h: -25 })).toBe(true); // rückwärts aufgezogen
    expect(g.inSelection(stroke, { x: 0, y: 30, w: 100, h: 20 })).toBe(false);
    const text = { type: 'text', x: 100, y: 100, w: 80, h: 20 };
    expect(g.inSelection(text, { x: 170, y: 110, w: 50, h: 50 })).toBe(true);
    expect(g.inSelection(text, { x: 190, y: 110, w: 50, h: 50 })).toBe(false);
  });

  it('Verschieben und Rechteck', () => {
    expect(g.moved(stroke, 5, -5).points[0]).toEqual([15, 5, 0.5]);
    expect(stroke.points[0]).toEqual([10, 10, 0.5]); // Original bleibt
    expect(g.moved({ type: 'text', x: 1, y: 2 }, 3, 4)).toMatchObject({ x: 4, y: 6 });
    expect(g.bounds(stroke)).toEqual({ x: 9, y: 9, w: 82, h: 2 });
  });

  it('Karo alle 5 mm, Linien mit Rand', () => {
    const karo = g.ruling('karo', g.A4.w, g.A4.h);
    expect(karo.filter((l) => l[1] === 0).length).toBe(41); // 210 mm: 41 Linien innen, keine am Rand
    const linien = g.ruling('linien', g.A4.w, g.A4.h);
    expect(linien.length).toBeGreaterThan(25);
    expect(linien.every((l) => l[0] > 0 && l[1] === l[3])).toBe(true);
    expect(g.ruling('leer', 100, 100)).toEqual([]);
  });
});
