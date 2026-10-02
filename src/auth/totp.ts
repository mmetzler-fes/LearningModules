import * as crypto from 'crypto';

/**
 * Zeitbasierte Einmalpasswörter nach RFC 6238 (TOTP) – kompatibel mit den
 * üblichen Authenticator-Apps (Google/Microsoft Authenticator, FreeOTP,
 * Aegis, 2FAS, Bitwarden …): SHA-1, 6 Ziffern, 30 Sekunden.
 *
 * Bewusst ohne Zusatzbibliothek: Das Verfahren ist kurz, und so hängt die
 * Anmeldung an keinem weiteren Paket.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Neues Geheimnis: 160 Bit, wie von RFC 4226 empfohlen. */
export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** Der aktuelle Zeitschritt (Anzahl 30-Sekunden-Intervalle seit 1970). */
export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(bin).padStart(DIGITS, '0');
}

/**
 * Prüft einen Code und liefert den Zeitschritt, zu dem er passt – oder null.
 * Ein Schritt Toleranz in beide Richtungen fängt abweichende Uhren ab.
 * Codes bis einschließlich `lastStep` gelten als verbraucht: Ein
 * mitgelesener Code lässt sich so nicht ein zweites Mal verwenden.
 */
export function verifyCode(secret: string, code: string, lastStep: number | null = null): number | null {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = currentStep();
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = codeAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return step;
  }
  return null;
}

/** Inhalt des QR-Codes für die Authenticator-App. */
export function otpauthUrl(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---- Wiederherstellungscodes ----

/**
 * Zehn Codes der Form "k7m2-x9pq" – lesbar, ohne verwechselbare Zeichen.
 * Gespeichert wird nur ihr Hash; im Klartext sieht sie der Benutzer genau
 * einmal.
 */
export function generateRecoveryCodes(count = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const part = () => Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return Array.from({ length: count }, () => `${part()}-${part()}`);
}

/** Codes sind zufällig und lang genug – ein schneller Hash reicht hier. */
export function hashRecoveryCode(code: string): string {
  const clean = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return crypto.createHash('sha256').update(`lm-recovery:${clean}`).digest('hex');
}
