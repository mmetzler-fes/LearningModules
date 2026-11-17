// ==================== QUIZ-VERWEISE IM AUSDRUCK FÜR ONENOTE ====================
//
// Im gedruckten Dokument steht bei jedem Quiz ein QR-Code und darunter bzw.
// daneben die Adresse – beide als echte PDF-Verweise (wie im GoodNotes-Heft).
// In OneNote landet der Ausdruck als Seitenbild; Verweise darin gehen verloren.
// Diese Datei sucht die Stellen der Adressen in den Verweisen einer Seite
// (pdf.js-Annotationen), damit die Ausgabe dort einen klickbaren OneNote-Link
// über das Bild legen kann. Ohne Importe – getestet in src/core/onenote-links.spec.ts.

/** Quiz-Kennung aus einer Adresse (`…&mod=<id>`), sonst null. */
export function quizIdOf(url) {
  const m = /[?&]mod=([^&#]+)/.exec(String(url || ''));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * `annots`: Annotationen einer Seite (pdf.js: `{ subtype, url, rect: [x1, y1, x2, y2] }`,
 * PDF-Punkte, Ursprung unten links), `pageHeight` in Punkten.
 * Ergebnis je Quiz in der Reihenfolge auf der Seite:
 * `[{ url, id, qr: {x, y, w, h} | null, text: {x, y, w, h} | null }]` in Zoll, Ursprung oben links.
 * `text` umfasst alle Zeilen der Adresse (bricht sie um, sind es mehrere Verweise).
 */
export function quizLinkSpots(annots, pageHeight) {
  const byUrl = new Map();
  for (const a of annots || []) {
    if (!a || a.subtype !== 'Link' || !a.url || !Array.isArray(a.rect)) continue;
    const id = quizIdOf(a.url);
    if (!id) continue;
    const [x1, y1, x2, y2] = a.rect;
    const r = { x: Math.min(x1, x2), y: pageHeight - Math.max(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    if (r.w <= 0 || r.h <= 0) continue;
    if (!byUrl.has(a.url)) byUrl.set(a.url, { url: a.url, id, qr: null, text: null });
    const spot = byUrl.get(a.url);
    // QR-Code: gut quadratisch und groß (3,5 cm ≈ 99 pt); sonst eine Zeile der Adresse.
    const square = r.h > 40 && Math.abs(r.w - r.h) < 0.25 * Math.max(r.w, r.h);
    if (square) spot.qr = spot.qr || r;
    else spot.text = spot.text ? union(spot.text, r) : r;
  }
  const inch = (r) => (r ? { x: r.x / 72, y: r.y / 72, w: r.w / 72, h: r.h / 72 } : null);
  return [...byUrl.values()]
    .sort((a, b) => ((a.qr || a.text).y - (b.qr || b.text).y))
    .map((s) => ({ ...s, qr: inch(s.qr), text: inch(s.text) }));
}

function union(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
