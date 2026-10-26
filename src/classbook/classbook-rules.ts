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

/** Eintrag der Auswahl eines Klassenlinks (wie LinkTopicSelection). */
export interface SelEntry {
  topicId: string;
  all: boolean;
  moduleIds?: string[];
}

/** Was eine Zuweisung enthalten kann: Lernthemen mit ihren Modulen (und deren Submodulen). */
export interface AvailTopic {
  topicId: string;
  modules: Array<{ id: string; subIds: string[] }>;
}

/** Ist das Modul in der Auswahl? Ein gewähltes Submodul zählt fürs Modul. */
export function moduleOn(entry: SelEntry | undefined | null, m: { id: string; subIds: string[] }): boolean {
  return !!entry && (entry.all || (entry.moduleIds || []).some((id) => id === m.id || m.subIds.includes(id)));
}

/**
 * Lernthema oder Modul im Klassennotizbuch ein- oder ausschalten. Die
 * Auswahl wird dabei ausdrücklich (Modul-IDs statt „ganzes Thema“) – so sind
 * später ergänzte Module zunächst aus. Ein Lernthema einschalten schaltet
 * seine jetzigen Module ein; ohne eingeschaltetes Modul ist es aus – es
 * bleibt aber mit leerer Liste stehen, damit es sich wieder einschalten lässt
 * (der Durchlauf überspringt Lernthemen ohne Module).
 * Reihenfolge wie in `available`, Unbekanntes bleibt hinten.
 */
export function toggleSelection(selection: SelEntry[], available: AvailTopic[], change: { topicId: string; moduleId?: string; enabled: boolean }): SelEntry[] {
  const topic = available.find((t) => t.topicId === change.topicId);
  if (!topic) return selection;
  const entry = selection.find((e) => e.topicId === change.topicId);
  const roots = topic.modules.map((m) => m.id);
  let ids: string[];
  if (!change.moduleId) {
    ids = change.enabled ? roots : [];
  } else {
    const on = new Set(topic.modules.filter((m) => moduleOn(entry, m)).map((m) => m.id));
    if (change.enabled) on.add(change.moduleId); else on.delete(change.moduleId);
    ids = roots.filter((id) => on.has(id));
  }
  const merged = [...selection.filter((e) => e.topicId !== change.topicId), { topicId: topic.topicId, all: false, moduleIds: ids }];
  const order = available.map((t) => t.topicId);
  return [...order.flatMap((id) => merged.filter((e) => e.topicId === id)), ...merged.filter((e) => !order.includes(e.topicId))];
}

/** „Ganzes Thema“ durch die jetzigen Module ersetzen – neue kommen dann ausgeschaltet dazu. */
export function explicitSelection(selection: SelEntry[], available: AvailTopic[]): SelEntry[] {
  return selection.map((e) => {
    if (!e.all) return e;
    const topic = available.find((t) => t.topicId === e.topicId);
    return { topicId: e.topicId, all: false, moduleIds: topic ? topic.modules.map((m) => m.id) : [] };
  });
}
