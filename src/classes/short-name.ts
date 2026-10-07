import { normalizeName } from './name-match';

interface Named {
  id: string;
  firstName: string;
  lastName: string;
}

/**
 * Kurzer Anzeigename für die Quiz-Arena: der Vorname – und nur wenn er in der
 * Klasse mehrfach vorkommt, so viele Buchstaben des Nachnamens wie nötig
 * ("Max Ma.", "Max Mai." …). Gleich lautende Namen bleiben voll ausgeschrieben.
 *
 * Eindeutig gemacht wird gegen die ganze Klassenliste, nicht nur gegen die
 * Anwesenden – so ändert sich ein Name nicht, wenn jemand dazukommt.
 */
export function shortName(student: Named, classmates: Named[]): string {
  const first = String(student.firstName || '').trim();
  const last = String(student.lastName || '').trim();
  if (!first) return last;
  const key = normalizeName(first);
  const sameFirst = classmates.filter((c) => c.id !== student.id && normalizeName(c.firstName) === key);
  if (!sameFirst.length || !last) return first;
  const others = sameFirst.map((c) => normalizeName(c.lastName));
  const mine = normalizeName(last);
  for (let n = 1; n <= last.length; n++) {
    const prefix = mine.slice(0, n);
    if (!others.some((o) => o.startsWith(prefix))) {
      return n >= last.length ? `${first} ${last}` : `${first} ${last.slice(0, n)}.`;
    }
  }
  return `${first} ${last}`;
}
