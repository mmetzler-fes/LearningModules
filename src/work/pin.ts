/**
 * PIN der Schüler und Bremse gegen Raten – ohne Datenbank (pin.spec.ts).
 * Siehe docs/bearbeitungen.md.
 */
import * as crypto from 'crypto';

/** Zufällige PIN aus 4 Ziffern (auch mit führender Null). */
export function newPin(): string {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

/** Eingabe vergleichen: Leerzeichen egal, sonst genau 4 Ziffern. */
export function pinMatches(typed: unknown, pin: string | null | undefined): boolean {
  const t = String(typed ?? '').replace(/\s+/g, '');
  if (!pin || !/^\d{4}$/.test(t)) return false;
  return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(pin));
}

export const PIN_MAX_FAILS = 5;
export const PIN_LOCK_MS = 10 * 60 * 1000;

/**
 * Fehlversuche je Schüler: nach 5 falschen PINs 10 Minuten Pause. Bei
 * 10 000 Möglichkeiten reicht das, damit niemand eine PIN in einer
 * Unterrichtsstunde errät. Im Speicher des Servers – ein Neustart setzt
 * die Zähler zurück, das ist hinnehmbar.
 */
export class PinGuard {
  private readonly fails = new Map<string, { count: number; until: number }>();

  /** Gesperrt? Dann die verbleibenden Minuten, sonst 0. */
  lockedFor(key: string, now = Date.now()): number {
    const f = this.fails.get(key);
    if (!f || f.until <= now) return 0;
    return Math.ceil((f.until - now) / 60000);
  }

  failed(key: string, now = Date.now()) {
    const f = this.fails.get(key);
    const count = f && f.until <= now && f.count >= PIN_MAX_FAILS ? 1 : (f?.count || 0) + 1;
    this.fails.set(key, { count, until: count >= PIN_MAX_FAILS ? now + PIN_LOCK_MS : 0 });
  }

  passed(key: string) {
    this.fails.delete(key);
  }
}
