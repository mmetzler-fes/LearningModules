/**
 * Abgleich einer eingelesenen Schülerliste mit der Schülerliste einer Klasse.
 *
 * Gelesen wird die Datei im Browser (dort bleibt auch das Passwort der
 * Klassenliste); hier kommen nur noch Namen und Schüler-IDs an.
 *
 * Regeln:
 * - Gleiche Schüler-ID: derselbe Schüler – Namen werden aktualisiert.
 * - Sonst gleicher Name (ohne Groß-/Kleinschreibung): derselbe Schüler – er
 *   bekommt die Schüler-ID, damit der nächste Import ihn auch nach einer
 *   Namenskorrektur wiederfindet. Ein noch unbestätigter Eintrag aus einer
 *   Schüleranmeldung gilt damit als bestätigt.
 * - Sonst: neuer Schüler.
 * - Wer in der Datei fehlt, bleibt in der Klasse. Entfernen geht nur von
 *   Hand, damit kein Import Ergebnisse verwaist.
 */

export interface ImportRow {
  firstName: string;
  lastName: string;
  importId?: string | null;
}

export interface ExistingStudent {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  importId: string | null;
}

export interface ImportPlan {
  add: ImportRow[];
  update: Array<{ id: string; firstName: string; lastName: string; importId: string | null; status: 'confirmed' }>;
  unchanged: number;
  /** Namen, die in der Datei mehrfach vorkommen – angelegt werden sie trotzdem. */
  duplicates: string[];
}

const clean = (v: unknown) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 80);

/** Vergleichsschlüssel für einen Namen: Leerraum vereinheitlicht, klein geschrieben. */
export const nameKey = (firstName: string, lastName: string) =>
  `${clean(firstName)}|${clean(lastName)}`.toLocaleLowerCase('de');

export function planStudentImport(existing: ExistingStudent[], rows: ImportRow[]): ImportPlan {
  const plan: ImportPlan = { add: [], update: [], unchanged: 0, duplicates: [] };
  const byImportId = new Map(existing.filter((s) => s.importId).map((s) => [s.importId as string, s]));
  const byName = new Map<string, ExistingStudent>();
  for (const s of existing) if (!byName.has(nameKey(s.firstName, s.lastName))) byName.set(nameKey(s.firstName, s.lastName), s);
  const used = new Set<string>();
  const seen = new Set<string>();

  for (const raw of rows) {
    const row = { firstName: clean(raw.firstName), lastName: clean(raw.lastName), importId: clean(raw.importId) || null };
    if (!row.firstName && !row.lastName) continue;
    const key = nameKey(row.firstName, row.lastName);
    if (seen.has(key)) plan.duplicates.push(`${row.firstName} ${row.lastName}`.trim());
    seen.add(key);

    let match = row.importId ? byImportId.get(row.importId) : undefined;
    if (!match) {
      const candidate = byName.get(key);
      // Ein Eintrag mit anderer Schüler-ID ist ein anderer Schüler gleichen Namens.
      if (candidate && (!candidate.importId || !row.importId)) match = candidate;
    }
    if (!match || used.has(match.id)) {
      plan.add.push(row);
      continue;
    }
    used.add(match.id);

    const importId = row.importId || match.importId;
    const same =
      match.firstName === row.firstName &&
      match.lastName === row.lastName &&
      match.importId === importId &&
      match.status === 'confirmed';
    if (same) plan.unchanged++;
    else plan.update.push({ id: match.id, firstName: row.firstName, lastName: row.lastName, importId, status: 'confirmed' });
  }
  return plan;
}
