// ==================== STIFT-EDITOR: GEOMETRIE ====================
//
// Reine Rechnungen ohne DOM (getestet in src/core/ink-geometry.spec.ts):
// Umriss eines Stiftstrichs mit Druck, Treffer für Radierer und Auswahl,
// Linien und Karos des Hintergrunds. Koordinaten in PDF-Punkten der Seite
// (A4 = 595 × 842), Punkte als [x, y, Druck 0…1].

/** A4 in PDF-Punkten; 1 mm = 72 / 25,4 pt. */
export const A4 = { w: 595.28, h: 841.89 };
export const MM = 72 / 25.4;

/** Punkte leicht glätten (gleitender Mittelwert), Anfang und Ende bleiben. */
export function smooth(points, k = 2) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    let x = 0; let y = 0; let p = 0; let n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(points.length - 1, i + k); j++) {
      x += points[j][0]; y += points[j][1]; p += points[j][2] ?? 0.5; n++;
    }
    out.push([x / n, y / n, p / n]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Breite an einem Punkt: dünn bei leichtem Druck, voll bei kräftigem. */
export function widthAt(base, pressure) {
  const p = Math.max(0, Math.min(1, pressure ?? 0.5));
  return base * (0.35 + 0.95 * p);
}

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * SVG-Pfad (Füllfläche) eines Strichs mit Druck: links die Punkte plus
 * halbe Breite, rechts zurück, runde Enden. Ein einzelner Punkt wird ein Kreis.
 */
export function strokeOutline(points, base) {
  const pts = smooth(points);
  if (!pts.length) return '';
  const circle = (x, y, r) => `M${r2(x - r)},${r2(y)}a${r2(r)},${r2(r)} 0 1,0 ${r2(2 * r)},0a${r2(r)},${r2(r)} 0 1,0 ${r2(-2 * r)},0Z`;
  if (pts.length === 1) return circle(pts[0][0], pts[0][1], widthAt(base, pts[0][2]) / 2);
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const w = widthAt(base, pts[i][2]) / 2;
    left.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
    right.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  const line = (list) => list.map((q) => `${r2(q[0])},${r2(q[1])}`).join('L');
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `M${line(left)}L${line(right.reverse())}Z`
    + circle(first[0], first[1], widthAt(base, first[2]) / 2)
    + circle(last[0], last[1], widthAt(base, last[2]) / 2);
}

/** SVG-Linie durch die Punkte (Textmarker: gleich breit, runde Enden). */
export function polyline(points) {
  if (!points.length) return '';
  const pts = points.length === 1 ? [points[0], [points[0][0] + 0.01, points[0][1]]] : points;
  return 'M' + pts.map((q) => `${r2(q[0])},${r2(q[1])}`).join('L');
}

/** Abstand eines Punkts zur Strecke a–b. */
export function distToSegment(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/** Berührt der Radierer (Kreis um x, y) den Strich? Die Strichbreite zählt mit. */
export function hitsStroke(item, x, y, radius) {
  const pts = item.points || [];
  const reach = radius + (item.width || 1) / 2;
  if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= reach;
  for (let i = 1; i < pts.length; i++) if (distToSegment(x, y, pts[i - 1], pts[i]) <= reach) return true;
  return false;
}

/** Umgebendes Rechteck eines Elements (Strich oder Textfeld). */
export function bounds(item) {
  if (item.type === 'text') return { x: item.x, y: item.y, w: item.w || 160, h: item.h || (item.size || 14) * 1.4 };
  const pts = item.points || [];
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const pad = (item.width || 1) / 2;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

/**
 * Liegt das Element in der Auswahl? Ein Strich, sobald einer seiner Punkte im
 * Rechteck liegt; ein Textfeld, sobald sich die Rechtecke überschneiden.
 */
export function inSelection(item, rect) {
  const x0 = Math.min(rect.x, rect.x + rect.w);
  const x1 = Math.max(rect.x, rect.x + rect.w);
  const y0 = Math.min(rect.y, rect.y + rect.h);
  const y1 = Math.max(rect.y, rect.y + rect.h);
  if (item.type === 'text') {
    const b = bounds(item);
    return b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0;
  }
  return (item.points || []).some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
}

/** Element verschieben (neue Kopie). */
export function moved(item, dx, dy) {
  if (item.type === 'text') return { ...item, x: item.x + dx, y: item.y + dy };
  return { ...item, points: item.points.map(([x, y, p]) => [x + dx, y + dy, p]) };
}

/**
 * Linien des Hintergrunds für eine Seite: Karo (5 mm) oder Linien (8 mm,
 * mit Rand). Liefert Strecken [x0, y0, x1, y1] in Punkten.
 */
export function ruling(kind, w, h) {
  const out = [];
  if (kind === 'karo') {
    const step = 5 * MM;
    // Keine Linie genau auf dem Rand (Rundung: 42 × 5 mm ≈ 595,27 pt).
    for (let x = step; x < w - 0.5; x += step) out.push([x, 0, x, h]);
    for (let y = step; y < h - 0.5; y += step) out.push([0, y, w, y]);
  } else if (kind === 'linien') {
    const step = 8 * MM;
    for (let y = 30 * MM; y < h - 15 * MM; y += step) out.push([20 * MM, y, w - 15 * MM, y]);
  }
  return out;
}
