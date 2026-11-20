/**
 * Gespeicherte Ergebnisse für Interessierte außerhalb der Ergebnis-Logik (z. B. LTI: Note an Moodle).
 * Bewusst einfach: synchrone Liste von Zuhörern, Fehler bleiben beim Zuhörer.
 */
export interface SavedResult {
  id: string;
  linkId?: string | null;
  studentId?: string | null;
  classId?: string | null;
}

const listeners: Array<(r: SavedResult) => void | Promise<void>> = [];

export function onResultSaved(fn: (r: SavedResult) => void | Promise<void>) {
  listeners.push(fn);
}

export function resultSaved(r: SavedResult) {
  for (const fn of listeners) {
    try { void Promise.resolve(fn(r)).catch(() => undefined); } catch { /* Zuhörer-Fehler kosten kein Ergebnis */ }
  }
}
