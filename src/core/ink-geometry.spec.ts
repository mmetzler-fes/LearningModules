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
  segmentInRect(a: number[], b: number[], x0: number, y0: number, x1: number, y1: number): boolean;
  itemAt(items: any[], x: number, y: number, radius: number): any;
  extremesAlong(points: number[][], a: number[], b: number[]): number[][];
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

  it('Gerade Linie: Auswahl auch in ihrer Mitte, Antippen trifft das oberste Element', () => {
    const line = { type: 'stroke', width: 2, line: true, points: [[0, 50, 0.5], [200, 50, 0.5]] };
    expect(g.inSelection(line, { x: 90, y: 40, w: 20, h: 20 })).toBe(true); // keiner der beiden Punkte im Rechteck
    expect(g.inSelection(line, { x: 90, y: 60, w: 20, h: 20 })).toBe(false);
    expect(g.segmentInRect([0, 0], [10, 10], 20, 20, 30, 30)).toBe(false);
    const text = { id: 't', type: 'text', x: 95, y: 40, w: 30, h: 20 };
    expect(g.itemAt([line, text], 100, 50, 2)).toBe(text); // obenauf
    expect(g.itemAt([line], 100, 53, 3)).toBe(line);
    expect(g.itemAt([line], 100, 70, 3)).toBeNull();
  });

  it('Äußerste Punkte entlang einer Kante (Strich am Geodreieck wird zur Linie)', () => {
    const pts = [[50, 0, 0.5], [10, 0, 0.5], [90, 0, 0.5], [60, 0, 0.5]];
    expect(g.extremesAlong(pts, [0, 0], [100, 0])).toEqual([[10, 0, 0.5], [90, 0, 0.5]]);
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

interface Ruler {
  CM: number;
  rulerToPage(r: any, lx: number, ly: number): number[];
  pageToRuler(r: any, x: number, y: number): number[];
  rulerEdges(r: any): number[][][];
  inRuler(r: any, x: number, y: number): boolean;
  projectOnSegment(x: number, y: number, a: number[], b: number[]): number[];
  nearEdge(r: any, x: number, y: number, reach: number): number[][] | null;
  snapAngle(deg: number, step: number): number;
}
const R = loadBrowserModule<Ruler>('ink/ink-geometry.js');
const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

describe('Stift-Editor: Geodreieck (ink-geometry.js)', () => {
  const flat = { cx: 300, cy: 400, angle: 0, L: 16 * R.CM };

  it('Ecken: lange Kante waagrecht, Spitze darüber – gedreht um 90° senkrecht', () => {
    const [[A, B], , [T]] = R.rulerEdges(flat);
    expect(close(A, [300 - 8 * R.CM, 400])).toBe(true);
    expect(close(B, [300 + 8 * R.CM, 400])).toBe(true);
    expect(close(T, [300, 400 - 8 * R.CM])).toBe(true);
    const turned = { ...flat, angle: 90 };
    expect(close(R.rulerToPage(turned, 10, 0), [300, 410])).toBe(true);
    expect(close(R.pageToRuler(turned, 300, 410), [10, 0])).toBe(true);
  });

  it('Punkt auf dem Dreieck', () => {
    expect(R.inRuler(flat, 300, 350)).toBe(true);
    expect(R.inRuler(flat, 300, 405)).toBe(false); // unter der langen Kante
    expect(R.inRuler(flat, 300 + 7 * R.CM, 400 - 2 * R.CM)).toBe(false); // neben dem Schenkel
  });

  it('Stift an der Kante: Kante finden und genau darauf zeichnen', () => {
    const edge = R.nearEdge(flat, 320, 404, 6)!;
    expect(edge).not.toBeNull();
    expect(close(R.projectOnSegment(320, 404, edge[0], edge[1]), [320, 400])).toBe(true);
    expect(R.nearEdge(flat, 320, 420, 6)).toBeNull();
    // Am Ende der Kante bleibt der Strich auf der Kante.
    expect(close(R.projectOnSegment(9999, 400, edge[0], edge[1]), edge[1])).toBe(true);
  });

  it('Winkel in 1°- bzw. 5°-Schritten, immer 0 … 360', () => {
    expect(R.snapAngle(37.4, 1)).toBe(37);
    expect(R.snapAngle(37.4, 5)).toBe(35);
    expect(R.snapAngle(-3, 1)).toBe(357);
    expect(R.snapAngle(361, 1)).toBe(1);
  });
});
