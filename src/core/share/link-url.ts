/**
 * Gemeinsame Helfer für versendbare Links (Quick-Link und Themen-Link):
 * öffentliche Adresse ermitteln und QR-Code erzeugen.
 */

/**
 * Öffentliche Adresse der Anwendung. APP_URL hat Vorrang; sonst wird sie aus
 * dem Request abgeleitet, damit es hinter einem Reverse Proxy ohne
 * zusätzliche Konfiguration stimmt.
 */
export function baseUrl(req?: any): string {
  const configured = (process.env.APP_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  const headers = req?.headers || {};
  const proto = (headers['x-forwarded-proto'] || req?.protocol || 'http').toString().split(',')[0].trim();
  const host = (headers['x-forwarded-host'] || headers.host || 'localhost:3000').toString().split(',')[0].trim();
  return `${proto}://${host}`;
}

/** QR-Code als SVG – skaliert verlustfrei und lässt sich sauber ausdrucken. */
export async function renderQr(url: string): Promise<string | null> {
  try {
    const moduleName = 'qrcode';
    const qrcode: any = await import(moduleName);
    const toString = qrcode.toString || qrcode.default?.toString;
    return await toString(url, { type: 'svg', margin: 1, width: 240 });
  } catch {
    // Ohne QR-Code bleibt der Link trotzdem nutzbar.
    return null;
  }
}
