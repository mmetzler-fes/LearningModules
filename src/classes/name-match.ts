/**
 * Ordnet den Namen, den ein Schüler bei der Anmeldung eingibt, genau einem
 * Eintrag der Schülerliste zu – oder keinem.
 *
 * Eingabe: Vorname(n), danach optional der Nachname oder sein Anfang. Zwei
 * Lesarten, die Treffer beider zählen zusammen:
 * - alles ist Vorname: "Adrian", "Anna Lena", auch nur "Lena" – jedes
 *   eingegebene Wort ist ein Wort des Vornamens;
 * - das letzte Wort ist der Anfang des Nachnamens: "Adrian A", "Anna Lena Mü".
 * Passt genau einer, ist er es. Wer den vollen Namen exakt eingibt, wird
 * immer erkannt – sonst käme "Max Mai" neben "Max Maier" nie hinein.
 *
 * Verglichen wird ohne Groß-/Kleinschreibung, Umlaute wie ihre Umschreibung
 * (Ömer = Oemer), Akzente ohne Akzent.
 */

export interface MatchableStudent {
  id: string;
  firstName: string;
  lastName: string;
}

export type MatchResult<T> =
  | { kind: 'match'; student: T }
  | { kind: 'none' }
  | { kind: 'ambiguous'; count: number };

/** Umlaute wie ihre Umschreibung; dazu Buchstaben, die sich nicht in Grundbuchstabe + Akzent zerlegen. */
const SPECIAL: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', ı: 'i', ł: 'l', ø: 'o', æ: 'ae', œ: 'oe', đ: 'd' };

/** Vergleichsform eines Namensteils. */
export function normalizeName(value: string): string {
  return String(value ?? '')
    .toLocaleLowerCase('de')
    .replace(/[äöüßıłøæœđ]/g, (c) => SPECIAL[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (value: string) => normalizeName(value).split(/[\s-]+/).filter(Boolean);
const compact = (value: string) => normalizeName(value).replace(/[\s-]/g, '');

export function matchStudent<T extends MatchableStudent>(input: string, students: T[]): MatchResult<T> {
  const typed = words(input);
  if (typed.length === 0) return { kind: 'none' };

  const full = compact(input);
  const exact = students.filter((s) => compact(`${s.firstName} ${s.lastName}`) === full);
  if (exact.length === 1) return { kind: 'match', student: exact[0] };

  const hits = new Set<T>();
  for (const s of students) {
    const first = words(s.firstName);
    const last = compact(s.lastName);
    const allFirst = typed.every((w) => first.includes(w));
    const firstThenLast =
      typed.length >= 2 &&
      !!last &&
      last.startsWith(typed[typed.length - 1]) &&
      typed.slice(0, -1).every((w) => first.includes(w));
    if (allFirst || firstThenLast) hits.add(s);
  }
  if (hits.size === 1) return { kind: 'match', student: [...hits][0] };
  return hits.size === 0 ? { kind: 'none' } : { kind: 'ambiguous', count: hits.size };
}

/**
 * Neuer Eintrag aus einer Anmeldung, die niemandem zugeordnet werden konnte:
 * das letzte Wort als Nachname, der Rest als Vorname. Ein einzelnes Wort ist
 * der Vorname.
 */
export function splitTypedName(input: string): { firstName: string; lastName: string } {
  const parts = String(input ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}
