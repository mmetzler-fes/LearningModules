/**
 * Regeln des Klassennotizbuchs ohne Datenbank (classbook-rules.spec.ts).
 * Siehe docs/klassennotizbuch.md.
 */

/** Kennung, unter der ein Schülerausweis des Klassennotizbuchs gilt (statt einer Link-ID). */
export const classbookTicketKey = (classId: string) => `classbook:${classId}`;

/** Ende des Tages (23:59:59) – so lange bleibt die Erstanmeldung offen. */
export function endOfDay(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function firstLoginOpen(until: Date | string | null | undefined, now = Date.now()): boolean {
  return !!until && new Date(until).getTime() > now;
}

/**
 * Anmeldung mit Name und PIN:
 * - `ok` – PIN stimmt (oder es braucht keine: Testschüler, unbestätigt),
 * - `show` – Erstanmeldung offen, PIN noch nie gesehen: jetzt anzeigen,
 * - `need` – PIN fehlt; `closed`: und sie wurde noch nie angezeigt,
 * - `wrong` – falsche PIN.
 */
export type LoginDecision = 'ok' | 'show' | 'need' | 'closed' | 'wrong';

export function loginDecision(
  student: { status?: string; pin?: string | null; pinShownAt?: Date | string | null } | null,
  typedPin: string | undefined,
  open: boolean,
  matches: (typed: string, pin: string | null | undefined) => boolean,
): LoginDecision {
  if (!student || student.status === 'pending') return 'ok';
  if (typedPin) return matches(typedPin, student.pin) ? 'ok' : 'wrong';
  if (student.pinShownAt) return 'need';
  return open ? 'show' : 'closed';
}

/** Antwort eines Durchlaufs (payload.details), so weit die Übersicht sie braucht. */
export interface DetailLike {
  moduleId?: string;
  isCorrect?: boolean;
  points?: number;
  informational?: boolean;
  ungraded?: boolean;
}

/** Stand eines Schülers in einem Modul: erledigt, bester Anteil richtig (null = nicht bewertbar), Blatt bearbeitet. */
export interface UnitCell {
  done: boolean;
  pct: number | null;
  work: boolean;
}

/** Modul der Übersicht mit allen Modul-IDs, die zu ihm zählen (Submodule). */
export interface Unit {
  id: string;
  ids: string[];
}

/**
 * Je Modul der beste Durchlauf: Anteil richtig über seine bewertbaren
 * Antworten (Punkte, sonst richtig/falsch). Informationsseiten zählen als
 * erledigt, ohne Anteil. `works`: Modul-IDs mit Bearbeitung (Stift).
 */
export function unitCells(units: Unit[], runs: Array<{ details?: DetailLike[] }>, works: Set<string>): Record<string, UnitCell> {
  const out: Record<string, UnitCell> = {};
  for (const unit of units) {
    const ids = new Set(unit.ids);
    let done = false;
    let pct: number | null = null;
    for (const run of runs) {
      const mine = (run.details || []).filter((d) => d && d.moduleId && ids.has(d.moduleId));
      if (!mine.length) continue;
      done = true;
      const graded = mine.filter((d) => !d.informational && !d.ungraded);
      if (!graded.length) continue;
      const score = graded.reduce((s, d) => s + (typeof d.points === 'number' ? d.points : d.isCorrect ? 1 : 0), 0);
      const p = Math.round((score / graded.length) * 100);
      if (pct === null || p > pct) pct = p;
    }
    const work = unit.ids.some((id) => works.has(id));
    out[unit.id] = { done, pct, work };
  }
  return out;
}

/**
 * Klassenarbeit im Klassennotizbuch des Schülers – nach denselben Regeln wie
 * ExamService.begin: `open` starten, `running` weiterschreiben (ohne „nur ein
 * Durchlauf“), `reentry` von der Lehrkraft freigegeben, `locked` begonnen
 * und nur mit Freigabe weiter, `submitted` abgegeben.
 */
export type ExamState = 'open' | 'running' | 'reentry' | 'locked' | 'submitted';

export function examState(attempt: { submittedAt?: Date | null; reentryAllowed?: boolean } | null | undefined, singleAttempt: boolean): ExamState {
  if (!attempt) return 'open';
  if (attempt.reentryAllowed) return 'reentry';
  if (!singleAttempt) return attempt.submittedAt ? 'open' : 'running';
  return attempt.submittedAt ? 'submitted' : 'locked';
}
