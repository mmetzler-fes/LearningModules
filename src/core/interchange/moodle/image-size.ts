/**
 * Breite und Höhe eines Bildes aus seinen ersten Bytes – für die Umrechnung
 * von Moodle-Pixelpositionen in Prozent. PNG, GIF, JPEG, WebP und SVG.
 */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (!buf || buf.length < 24) return null;
  // PNG: IHDR direkt nach der Signatur
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return ok(buf.readUInt32BE(16), buf.readUInt32BE(20));
  }
  // GIF
  if (buf.toString('ascii', 0, 3) === 'GIF') {
    return ok(buf.readUInt16LE(6), buf.readUInt16LE(8));
  }
  // JPEG: Segmente bis zum Start-of-Frame durchgehen
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return ok(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5));
      }
      i += 2 + len;
    }
    return null;
  }
  // WebP (VP8X, VP8, VP8L)
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return ok(1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3));
    if (chunk === 'VP8 ') return ok(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return ok((b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1);
    }
  }
  // SVG: width/height oder viewBox
  const head = buf.subarray(0, 4096).toString('utf-8');
  const svg = /<svg[^>]*>/i.exec(head)?.[0];
  if (svg) {
    const num = (a: string) => parseFloat(new RegExp(`\\b${a}\\s*=\\s*["']([\\d.]+)`, 'i').exec(svg)?.[1] || '');
    const vb = /viewBox\s*=\s*["'][\d.\-]+[\s,]+[\d.\-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
    return ok(num('width') || parseFloat(vb?.[1] || ''), num('height') || parseFloat(vb?.[2] || ''));
  }
  return null;
}

function ok(width: number, height: number) {
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
}
