/**
 * Kurzer Name eines Geräts aus dem User-Agent, z. B. „Windows · Edge“ – für
 * die Liste der Anmeldungen. Der Browser schickt einen genaueren Namen mit
 * (ein iPad meldet sich als Mac); dieser ist nur der Ersatz.
 */
export function deviceLabel(ua: string | undefined | null): string {
  const s = String(ua || '');
  const os = /iPad/.test(s) ? 'iPad' : /iPhone/.test(s) ? 'iPhone' : /Android/.test(s) ? 'Android'
    : /Windows/.test(s) ? 'Windows' : /CrOS/.test(s) ? 'Chromebook' : /Macintosh|Mac OS X/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'Gerät';
  const browser = /Edg\//.test(s) ? 'Edge' : /Firefox\/|FxiOS/.test(s) ? 'Firefox' : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  return `${os} · ${browser}`;
}

/** Vom Browser genannter Name: nur druckbare Zeichen, kurz. */
export function cleanLabel(value: unknown): string {
  return String(value ?? '').replace(/[^\p{L}\p{N} ·()._+-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
