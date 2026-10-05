/**
 * Schuljahre im Format "SJ26-27" – so heißen sie auch im SchülerLernTool,
 * dort als Vorsatz vor dem Klassennamen ("SJ26-27-E1ME1").
 *
 * Das aktuelle Schuljahr setzt der Hauptadmin von Hand, in oder nach den
 * Sommerferien. Solange er das noch nie getan hat, gilt der Kalender: ab
 * dem 1. August das neue Schuljahr.
 */

const PATTERN = /^SJ(\d{2})-(\d{2})$/;

/** Gültig ist nur ein Paar aufeinanderfolgender Jahre (SJ26-27, SJ99-00). */
export function isSchoolYear(value: unknown): value is string {
  const m = PATTERN.exec(String(value ?? ''));
  return !!m && (Number(m[1]) + 1) % 100 === Number(m[2]);
}

/** Schuljahr nach Kalender: ab August das neue. */
export function schoolYearOfDate(date: Date): string {
  const start = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1;
  const two = (n: number) => String(n % 100).padStart(2, '0');
  return `SJ${two(start)}-${two(start + 1)}`;
}

/** Verschiebt ein Schuljahr um `delta` Jahre (SJ26-27 + 1 = SJ27-28). */
export function shiftSchoolYear(year: string, delta: number): string {
  const m = PATTERN.exec(year);
  if (!m) throw new Error(`Kein Schuljahr: ${year}`);
  const two = (n: number) => String(((n % 100) + 100) % 100).padStart(2, '0');
  const start = Number(m[1]) + delta;
  return `SJ${two(start)}-${two(start + 1)}`;
}

/**
 * Sortierschlüssel, neuestes zuerst. Zweistellige Jahre reichen, solange
 * niemand ein Schuljahr aus dem letzten Jahrhundert anlegt: 00 bis 69 gelten
 * als 2000er, der Rest als 1900er.
 */
export function compareSchoolYearsDesc(a: string, b: string): number {
  const full = (y: string) => {
    const n = Number(PATTERN.exec(y)?.[1] ?? 0);
    return n < 70 ? 2000 + n : 1900 + n;
  };
  return full(b) - full(a);
}

/**
 * Erkennt das Schuljahr als Vorsatz im Klassennamen ("SJ26-27-E1ME1",
 * "SJ26-27 TG12") und trennt es ab. Ohne Vorsatz bleibt der Name, wie er ist.
 */
export function splitSchoolYearPrefix(name: string): { schoolYear: string | null; name: string } {
  const m = /^(SJ\d{2}-\d{2})[\s_-]+(.+)$/i.exec(String(name ?? '').trim());
  if (!m) return { schoolYear: null, name: String(name ?? '').trim() };
  const year = m[1].toUpperCase();
  return isSchoolYear(year) ? { schoolYear: year, name: m[2].trim() } : { schoolYear: null, name: String(name).trim() };
}
