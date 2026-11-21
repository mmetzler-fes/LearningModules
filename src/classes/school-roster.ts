import { normalizeLoginId } from './login-id';
import { splitSchoolYearPrefix } from './school-year';

/**
 * Klassenliste der Schule (Schuladmin → 🎓 Klassen der Schule, docs/klassen-und-schuljahr.md):
 * eine Tabelle mit Nachname, Vorname, Klasse und UserID für alle Klassen. Hier steht der Abgleich
 * ohne Datenbank – mit der Schulliste beim Einlesen und mit der Klasse einer Lehrkraft beim
 * „Über den Schuladmin aktualisieren“.
 *
 * Zuordnung eines Schülers aus der Datei zu einem vorhandenen Eintrag, in dieser Reihenfolge:
 * 1. gleiche UserID (Benutzername des Schulkontos, Teil vor dem @);
 * 2. gleicher Name (ohne Groß-/Kleinschreibung);
 * 3. Name und Vorname zusammen unterscheiden sich um höchstens einen Buchstaben oder einen Dreher (Tippfehler,
 *    „Mueller“/„Müller“ zählt nicht dazu) – nur wenn genau ein Eintrag passt. Der Name wird
 *    dann aus der Datei übernommen.
 * Zwei Einträge mit verschiedenen UserIDs sind nie derselbe Schüler. Wer in der Datei fehlt, bleibt.
 */

export interface RosterRow {
  firstName: string;
  lastName: string;
  loginId?: string | null;
}

export interface RosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  loginId?: string | null;
  status?: string;
}

export interface RosterPlan {
  add: RosterRow[];
  update: Array<{ id: string; firstName: string; lastName: string; loginId: string | null }>;
  unchanged: number;
  /** Namen, die über „ein Buchstabe Unterschied“ zugeordnet und korrigiert wurden: „alt → neu“. */
  renamed: string[];
  duplicates: string[];
}

const clean = (v: unknown) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 80);
const key = (firstName: string, lastName: string) => `${clean(firstName)}|${clean(lastName)}`.toLocaleLowerCase('de');
const full = (r: { firstName: string; lastName: string }) => `${r.firstName} ${r.lastName}`.trim();

/** Unterscheiden sich a und b um höchstens einen Buchstaben (einfügen, weglassen, ersetzen, Dreher)? */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  // Gleich lang: ein Buchstabe ersetzt – oder zwei benachbarte vertauscht (Buchstabendreher „Adrain“).
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** Zeile aus der Datei vereinheitlicht; null ohne Namen. */
export function cleanRosterRow(raw: Partial<RosterRow> | null | undefined): RosterRow | null {
  const row: RosterRow = { firstName: clean(raw?.firstName), lastName: clean(raw?.lastName), loginId: normalizeLoginId(raw?.loginId) };
  return row.firstName || row.lastName ? row : null;
}

/**
 * Sucht zu jeder Zeile den passenden Eintrag (siehe oben). Liefert je Zeile den Eintrag oder null,
 * dazu, ob nur über „ein Buchstabe“ zugeordnet wurde.
 */
export function matchRoster<T extends RosterStudent>(existing: T[], rows: RosterRow[]): Array<{ row: RosterRow; match: T | null; fuzzy: boolean }> {
  const used = new Set<string>();
  const byLogin = new Map<string, T>();
  for (const s of existing) {
    const lid = normalizeLoginId(s.loginId);
    if (lid && !byLogin.has(lid)) byLogin.set(lid, s);
  }
  const free = (s: T | undefined) => !!s && !used.has(s.id);
  // Gleiche Namen bei verschiedenen UserIDs: zwei Schüler.
  const compatible = (s: T, row: RosterRow) => !row.loginId || !normalizeLoginId(s.loginId) || normalizeLoginId(s.loginId) === row.loginId;
  const out: Array<{ row: RosterRow; match: T | null; fuzzy: boolean }> = rows.map((row) => ({ row, match: null, fuzzy: false }));

  // Erst alle sicheren Treffer (UserID, gleicher Name), dann die Tippfehler – sonst nähme „Max Maier“
  // den Eintrag, der in derselben Datei noch genau als „Max Meier“ steht.
  for (const o of out) {
    const s = o.row.loginId ? byLogin.get(o.row.loginId) : undefined;
    if (free(s)) { o.match = s as T; used.add((s as T).id); }
  }
  for (const o of out.filter((x) => !x.match)) {
    const k = key(o.row.firstName, o.row.lastName);
    const s = existing.find((e) => !used.has(e.id) && key(e.firstName, e.lastName) === k && compatible(e, o.row));
    if (s) { o.match = s; used.add(s.id); }
  }
  for (const o of out.filter((x) => !x.match)) {
    const k = key(o.row.firstName, o.row.lastName);
    const near = existing.filter((e) => !used.has(e.id) && compatible(e, o.row) && withinOneEdit(key(e.firstName, e.lastName), k));
    if (near.length === 1) { o.match = near[0]; o.fuzzy = true; used.add(near[0].id); }
  }
  return out;
}

/** Abgleich: neu anlegen, aktualisieren (Name, UserID), unverändert. */
export function planRosterSync(existing: RosterStudent[], rawRows: Array<Partial<RosterRow>>): RosterPlan {
  const plan: RosterPlan = { add: [], update: [], unchanged: 0, renamed: [], duplicates: [] };
  const rows: RosterRow[] = [];
  const seen = new Set<string>();
  for (const raw of rawRows) {
    const row = cleanRosterRow(raw);
    if (!row) continue;
    const k = row.loginId || key(row.firstName, row.lastName);
    if (seen.has(k)) { plan.duplicates.push(full(row)); continue; }
    seen.add(k);
    rows.push(row);
  }
  for (const { row, match, fuzzy } of matchRoster(existing, rows)) {
    if (!match) { plan.add.push(row); continue; }
    const loginId = row.loginId || normalizeLoginId(match.loginId);
    const same = match.firstName === row.firstName && match.lastName === row.lastName
      && (normalizeLoginId(match.loginId) || null) === (loginId || null) && (match.status ?? 'confirmed') === 'confirmed';
    if (same) { plan.unchanged++; continue; }
    if (fuzzy) plan.renamed.push(`${full(match)} → ${full(row)}`);
    plan.update.push({ id: match.id, firstName: row.firstName, lastName: row.lastName, loginId: loginId || null });
  }
  return plan;
}

/** Wie viele Schüler der Datei stehen schon im vorhandenen Eintrag (UserID oder gleicher Name)? */
export function rosterOverlap(existing: RosterStudent[], rawRows: Array<Partial<RosterRow>>): number {
  const rows = rawRows.map(cleanRosterRow).filter((r): r is RosterRow => !!r);
  const logins = new Set(existing.map((s) => normalizeLoginId(s.loginId)).filter(Boolean));
  const names = new Set(existing.map((s) => key(s.firstName, s.lastName)));
  return rows.filter((r) => (r.loginId && logins.has(r.loginId)) || names.has(key(r.firstName, r.lastName))).length;
}

/**
 * Ab wann gilt eine Klasse mit anderem Namen als dieselbe? Teilweise gleiche Schüler: die Hälfte
 * der Klasse in der Datei, höchstens aber 3 – einzelne Klassenwechsler blockieren so nichts.
 */
export const overlapLimit = (rows: number) => Math.max(1, Math.min(3, Math.ceil(rows / 2)));

/** Zeilen der Datei nach Klasse: Reihenfolge der Datei, Schuljahr aus einem Vorsatz „SJ26-27-…“. */
export function groupByClass(rows: Array<Partial<RosterRow> & { className?: string }>, fallbackYear: string) {
  const groups = new Map<string, { name: string; schoolYear: string; students: RosterRow[] }>();
  for (const r of rows) {
    const split = splitSchoolYearPrefix(clean(r?.className).slice(0, 60));
    const name = split.name.slice(0, 40);
    const row = cleanRosterRow(r);
    if (!name || !row) continue;
    const schoolYear = split.schoolYear || fallbackYear;
    const k = `${schoolYear}|${name.toLocaleLowerCase('de')}`;
    if (!groups.has(k)) groups.set(k, { name, schoolYear, students: [] });
    groups.get(k)!.students.push(row);
  }
  return [...groups.values()];
}
