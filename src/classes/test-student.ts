/**
 * Testschüler einer Lehrkraft, ohne Datenbank (test-student.spec.ts).
 * Siehe docs/klassen-und-schuljahr.md.
 */
import * as crypto from 'crypto';
import { normalizeName } from './name-match';

/** Kennung im Ergebnis: `test:<Lehrkraft>` – kein Eintrag der Schülerliste. */
export const TEST_PREFIX = 'test:';

export function testStudentId(teacherId: string): string {
  return `${TEST_PREFIX}${teacherId}`;
}

export function isTestStudent(studentId: string | null | undefined): boolean {
  return String(studentId || '').startsWith(TEST_PREFIX);
}

export const MIN_TEST_PASSWORD = 4;

export function hashTestPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}

export function verifyTestPassword(password: string, stored: string | null | undefined): boolean {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const given = crypto.scryptSync(String(password || ''), salt, 32);
  const want = Buffer.from(hash, 'hex');
  return want.length === given.length && crypto.timingSafeEqual(given, want);
}

/** Ist das der Name des Testschülers? Groß/klein, Leerzeichen und Akzente egal. */
export function isTestName(typed: string, testName: string | null | undefined): boolean {
  return !!testName && normalizeName(typed) === normalizeName(testName);
}

/** Name, wie er in Ergebnissen erscheint. */
export function testLabel(testName: string): string {
  return `🧪 ${testName}`;
}
