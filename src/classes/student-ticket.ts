import * as crypto from 'crypto';

/**
 * Schülerausweis für einen Durchlauf über einen Klassenlink: Der Start
 * ordnet den eingegebenen Namen einem Schüler zu, der Ausweis hält das fest.
 * Beim Speichern zählt dann der Ausweis, nicht der Name, den der Browser
 * mitschickt – sonst wäre die strikte Anmeldung mit einem geänderten
 * Aufruf zu umgehen.
 *
 * Signiert mit HMAC, gültig für eine Weile; mehr als ein Unterrichtstag
 * braucht kein Durchlauf.
 */

const SECRET = `${process.env.JWT_SECRET || 'secretKey'}:student-ticket`;
const LIFETIME_MS = 12 * 60 * 60 * 1000;

export interface StudentTicket {
  /** Link-ID */
  l: string;
  /** Schüler-ID (Eintrag der Schülerliste) */
  s: string;
  /** Name, wie er im Ergebnis steht */
  n: string;
  /** Ablauf (ms seit 1970) */
  e: number;
  /** Mit PIN bestätigt: Kein zweites Fragen beim Stift-Editor. */
  v?: number;
  /** Nur Geräte-Ausweis: Prüfzeichen der PIN. */
  p?: string;
}

const sign = (payload: string) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

export function issueTicket(linkId: string, studentId: string, name: string, now = Date.now(), extra: { verified?: boolean } = {}): string {
  const payload = Buffer.from(JSON.stringify({ l: linkId, s: studentId, n: name, e: now + LIFETIME_MS, ...(extra.verified ? { v: 1 } : {}) })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Merkt sich die Anmeldung auf einem Gerät. Eine neue PIN macht den Ausweis ungültig (`p`). */
export const DEVICE_LIFETIME_MS = 300 * 24 * 60 * 60 * 1000;
export const pinTag = (pin: string | null | undefined) => crypto.createHmac('sha256', SECRET).update(`pin:${pin || ''}`).digest('base64url').slice(0, 12);

export function issueDeviceTicket(key: string, studentId: string, name: string, pin: string | null | undefined, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ l: key, s: studentId, n: name, e: now + DEVICE_LIFETIME_MS, p: pinTag(pin), v: 1 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Gültiger Ausweis für diesen Link – oder `null`. */
export function readTicket(ticket: unknown, linkId: string, now = Date.now()): StudentTicket | null {
  const [payload, mac] = String(ticket ?? '').split('.');
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as StudentTicket;
    return data.l === linkId && data.e > now && data.s ? data : null;
  } catch {
    return null;
  }
}
