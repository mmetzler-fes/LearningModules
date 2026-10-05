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
}

const sign = (payload: string) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

export function issueTicket(linkId: string, studentId: string, name: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ l: linkId, s: studentId, n: name, e: now + LIFETIME_MS })).toString('base64url');
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
