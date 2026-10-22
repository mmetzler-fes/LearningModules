import { CM } from './ink-geometry.js';

// ==================== STIFT-EDITOR: GEODREIECK (ZEICHNUNG) ====================
//
// Das Geodreieck als SVG in seinen eigenen Koordinaten (Punkte): die lange
// Kante liegt auf y = 0 von −L/2 bis L/2, die Spitze bei (0, −L/2). Die
// Skala bleibt bei jeder Größe in echten Zentimetern – ein größeres Dreieck
// hat mehr Striche, keine größeren. Die Griffe zum Drehen und Vergrößern
// sind auf dem Bildschirm immer gleich groß (1/zoom).

const MM = CM / 10;

/** Lage der Griffe in Koordinaten des Geodreiecks. */
export function rulerHandles(L, zoom) {
  const r = 15 / zoom;
  return {
    rotate: { x: 0, y: -L / 2 + 1.35 * CM, r },
    resize: { x: L / 2 - 1.35 * CM, y: -0.8 * CM, r },
  };
}

const n2 = (v) => Math.round(v * 100) / 100;

export function rulerSvg(L, zoom, angleText) {
  const h = L / 2;
  const out = [];
  const line = (x1, y1, x2, y2, cls = '') => out.push(`<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}"${cls ? ` class="${cls}"` : ''}/>`);
  const text = (x, y, s, size, cls = '') => out.push(`<text x="${n2(x)}" y="${n2(y)}" font-size="${n2(size)}"${cls ? ` class="${cls}"` : ''}>${s}</text>`);

  // Körper
  out.push(`<polygon class="ir-body" points="${n2(-h)},0 0,${n2(-h)} ${n2(h)},0"/>`);

  // Hilfslinien parallel zur langen Kante (alle 5 mm) und die Mittelsenkrechte
  for (let y = 1.5 * CM; y < h - 1.2 * CM; y += 0.5 * CM) {
    const half = h - y - 0.35 * CM;
    if (half > 0.6 * CM) line(-half, -y, half, -y, Math.round(y / (0.5 * CM)) % 2 ? 'ir-grid' : 'ir-grid ir-grid-cm');
  }
  line(0, -0.65 * CM, 0, -h + 0.45 * CM, 'ir-grid ir-grid-cm');

  // Zentimeter-Skala an der langen Kante, 0 in der Mitte
  const n = Math.floor((h - 0.25 * CM) / MM);
  for (let k = -n; k <= n; k++) {
    const len = k % 10 === 0 ? 3.2 * MM : k % 5 === 0 ? 2.3 * MM : 1.5 * MM;
    line(k * MM, 0, k * MM, -len, 'ir-tick');
    if (k % 10 === 0 && Math.abs(k * MM) < h - 0.5 * CM) text(k * MM, -4.4 * MM, Math.abs(k / 10), 2.4 * MM, 'ir-num');
  }

  // Winkelskala: zwei Zahlenreihen (gegenläufig) wie auf dem Geodreieck
  const R = 0.31 * L;
  for (let a = 0; a <= 180; a++) {
    const len = a % 10 === 0 ? 3 * MM : a % 5 === 0 ? 2 * MM : 1.2 * MM;
    const c = Math.cos((a * Math.PI) / 180);
    const s = Math.sin((a * Math.PI) / 180);
    line(R * c, -R * s, (R - len) * c, -(R - len) * s, 'ir-tick');
    if (a % 10 === 0 && a > 0 && a < 180) {
      text((R - 4.8 * MM) * c, -(R - 4.8 * MM) * s + 0.8 * MM, a, 2.1 * MM, 'ir-num');
      text((R - 7.6 * MM) * c, -(R - 7.6 * MM) * s + 0.7 * MM, 180 - a, 1.8 * MM, 'ir-num ir-num-in');
    }
  }

  // Gelber Halbkreis und Mittelpunkt
  const Y = 0.17 * L;
  out.push(`<path class="ir-arc" d="M${n2(-Y)},0 A${n2(Y)},${n2(Y)} 0 0 1 ${n2(Y)},0"/>`);
  out.push(`<circle class="ir-center" cx="0" cy="${n2(-0.9 * MM)}" r="${n2(0.9 * MM)}"/>`);

  // Griffe
  const g = rulerHandles(L, zoom);
  const fs = 14 / zoom;
  out.push(`<g class="ir-handle" data-handle="rotate"><circle cx="0" cy="${n2(g.rotate.y)}" r="${n2(g.rotate.r)}"/>
    <text x="0" y="${n2(g.rotate.y + fs * 0.36)}" font-size="${n2(fs)}">⟳</text></g>`);
  out.push(`<text class="ir-angle" x="0" y="${n2(g.rotate.y + g.rotate.r + fs * 1.1)}" font-size="${n2(fs * 0.95)}">${angleText}</text>`);
  out.push(`<g class="ir-handle" data-handle="resize"><circle cx="${n2(g.resize.x)}" cy="${n2(g.resize.y)}" r="${n2(g.resize.r)}"/>
    <text x="${n2(g.resize.x)}" y="${n2(g.resize.y + fs * 0.36)}" font-size="${n2(fs)}">⤢</text></g>`);

  return `<svg viewBox="${n2(-h)} ${n2(-h)} ${n2(L)} ${n2(h)}" xmlns="http://www.w3.org/2000/svg">${out.join('')}</svg>`;
}
