/**
 * Regeln für Wirkung und Bewertung, ohne Datenbank (impact-rules.spec.ts).
 *
 * Anerkennung hängt am Inhalt, nicht an einem Konto: Jede Kopie kennt ihr
 * Original (`originId`), und gezählt wird am Original. Siehe
 * docs/nutzung-und-bewertung.md.
 */

export interface OriginLike {
  id: string;
  originId?: string | null;
  parentId?: string | null;
}

/** Das ursprüngliche Modul – bei einem Original es selbst. */
export function originOf(m: OriginLike): string {
  return m.originId || m.id;
}

/** Monat eines Zeitpunkts, z. B. „2026-10“. */
export function periodOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MAX_MODULES_PER_RUN = 500;

/** Modul-IDs eines Durchlaufs (`payload.details[].moduleId`), jede einmal. */
export function moduleIdsOfRun(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  const out = new Set<string>();
  for (const d of details) {
    const id = d && typeof d.moduleId === 'string' ? d.moduleId.slice(0, 64) : '';
    if (id) out.add(id);
    if (out.size >= MAX_MODULES_PER_RUN) break;
  }
  return [...out];
}

/**
 * Für welche Originale ein Durchlauf zählt: Untermodule zählen für ihr
 * Elternmodul, sonst käme ein Kombi-Modul mehrfach in die Statistik.
 * `modules` sind die bearbeiteten Module samt ihren Elternmodulen.
 */
export function originsOfRun(moduleIds: string[], modules: OriginLike[]): string[] {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const out = new Set<string>();
  for (const id of moduleIds) {
    const m = byId.get(id);
    if (!m) continue;
    const root = m.parentId ? byId.get(m.parentId) : m;
    if (root) out.add(originOf(root));
  }
  return [...out];
}

export interface UsageRow {
  teacherId: string;
  classId: string;
  runs: number;
}

export interface UsageSummary {
  /** Bearbeitungen insgesamt (je Modul und Durchlauf eine) */
  runs: number;
  /** davon über Links anderer Lehrkräfte */
  runsByOthers: number;
  /** andere Lehrkräfte, deren Schüler damit gearbeitet haben */
  teachers: string[];
  /** Klassen (Lehrkraft + Klasse), auch eigene */
  classes: number;
}

/** Zähler zusammenfassen; `creatorId` ist der, dessen Wirkung gezeigt wird. */
export function summarizeUsage(rows: UsageRow[], creatorId: string): UsageSummary {
  let runs = 0;
  let runsByOthers = 0;
  const teachers = new Set<string>();
  const classes = new Set<string>();
  for (const r of rows) {
    runs += r.runs;
    if (r.teacherId !== creatorId) {
      runsByOthers += r.runs;
      teachers.add(r.teacherId);
    }
    if (r.classId) classes.add(`${r.teacherId}|${r.classId}`);
  }
  return { runs, runsByOthers, teachers: [...teachers], classes: classes.size };
}

export interface RatingLike {
  stars: number | null;
  thanks: boolean;
}

export interface RatingSummary {
  /** Durchschnitt auf eine Stelle gerundet; null ohne Sterne */
  avg: number | null;
  /** Zahl der Sterne-Bewertungen */
  count: number;
  thanks: number;
}

export function summarizeRatings(rows: RatingLike[]): RatingSummary {
  const rated = rows.filter((r) => typeof r.stars === 'number' && r.stars >= 1 && r.stars <= 5);
  const sum = rated.reduce((n, r) => n + (r.stars as number), 0);
  return {
    avg: rated.length ? Math.round((sum / rated.length) * 10) / 10 : null,
    count: rated.length,
    thanks: rows.filter((r) => r.thanks).length,
  };
}

/** Gültige Sterne (1–5) oder null. */
export function cleanStars(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

export const MAX_COMMENT = 1000;

/**
 * Freundlicher Hinweis zum Teilen: wer schon einiges übernommen und noch
 * nichts geteilt hat. `after` 0 schaltet ihn ab.
 */
export function shouldHintSharing(taken: number, shared: number, after: number): boolean {
  return after > 0 && shared === 0 && taken >= after;
}

export interface CopyMatchLike {
  id: string;
  title: string;
  type: string;
  creatorId?: string | null;
  parentId?: string | null;
  orderIndex?: number;
}

/**
 * Für Kopien aus der Zeit vor `originId`: welches Modul des Quell-Lernthemas
 * zu welchem Modul der Kopie gehört. Gleich sind Titel, Art und Creator; bei
 * mehreren Kandidaten entscheidet die Reihenfolge. Untermodule werden nur
 * innerhalb ihres zugeordneten Elternmoduls gesucht.
 *
 * Liefert Kopie-ID → Quell-ID.
 */
export function matchCopies(source: CopyMatchLike[], copy: CopyMatchLike[]): Map<string, string> {
  const out = new Map<string, string>();
  const key = (m: CopyMatchLike) => `${m.type}\u0000${m.title}\u0000${m.creatorId || ''}`;
  const byOrder = (a: CopyMatchLike, b: CopyMatchLike) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0);

  const pair = (src: CopyMatchLike[], cpy: CopyMatchLike[]) => {
    const used = new Set<string>();
    for (const c of [...cpy].sort(byOrder)) {
      const hit = [...src].sort(byOrder).find((s) => !used.has(s.id) && key(s) === key(c));
      if (!hit) continue;
      used.add(hit.id);
      out.set(c.id, hit.id);
    }
  };

  pair(source.filter((m) => !m.parentId), copy.filter((m) => !m.parentId));
  for (const [copyId, srcId] of [...out]) {
    pair(source.filter((m) => m.parentId === srcId), copy.filter((m) => m.parentId === copyId));
  }
  return out;
}
