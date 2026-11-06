/**
 * Sicherung in die Nextcloud im Aufbau des Notizbuchs (docs/nextcloud.md#sicherung):
 * `Sicherung/<Book>/<Bereich>/…/<Lernthema>/` mit je Modul einer .zlm, den
 * Dateien der Anhänge und `_lernthema.json`. Ohne Datenbank, damit es sich
 * einzeln prüfen lässt (sicherung.spec.ts) – Nextcloud-Zugriff und Inhalte
 * kommen herein.
 *
 * Regeln:
 * - Die App schreibt nur, wenn sich in der App etwas geändert hat (Prüfwert)
 *   oder die Datei fehlt.
 * - Eine .zlm, die in der Nextcloud geändert wurde (ETag anders als zuletzt
 *   geschrieben), bleibt liegen und wird als „geändert“ gemeldet, bis die
 *   Lehrkraft sie übernimmt oder verwirft. Andere Dateien (Anhänge,
 *   _lernthema.json) wandern in dem Fall nach _Gesichert/<Datum>/ und werden neu geschrieben.
 * - Gelöschtes und Verschobenes: alte Datei nach _Gesichert bzw. an den neuen Ort.
 */

export const SICHERUNG = 'Sicherung';
export const SAVED = '_Gesichert';
export const TOPIC_META = '_lernthema.json';
export const KEEP_SAVED_DAYS = 180;

export interface SicherungNc {
  stat(parts: string[]): Promise<{ isFolder: boolean; size: number; etag: string } | null>;
  put(parts: string[], data: Buffer, contentType: string): Promise<string>;
  get(parts: string[]): Promise<{ type: string; data: Buffer } | null>;
  move(from: string[], to: string[]): Promise<void>;
  ensureFolder(parts: string[]): Promise<void>;
  list(parts: string[]): Promise<Array<{ name: string; isFolder: boolean }>>;
  remove(parts: string[]): Promise<void>;
}

/** Eine Datei, wie sie in der Sicherung liegen soll. */
export interface WantedFile {
  key: string;
  /** Pfad unterhalb von Sicherung/ */
  path: string[];
  /** Prüfwert des Inhalts in der App – ändert er sich, wird neu geschrieben. */
  hash: string;
  contentType: string;
  /** Darf die Lehrkraft die Datei draußen bearbeiten und zurückholen (.zlm)? */
  editable: boolean;
  data(): Promise<Buffer>;
  moduleId?: string;
  topicId?: string;
  title?: string;
}

export interface FileRecord {
  key: string;
  path: string[];
  etag: string;
  hash: string;
  /** ok | changed (draußen geändert, wartet) | discard (verwerfen: beim nächsten Lauf überschreiben) */
  state: 'ok' | 'changed' | 'discard';
  moduleId?: string;
  topicId?: string;
  title?: string;
  /** Seit wann draußen geändert. */
  changedAt?: string;
}

export interface SicherungReport {
  written: number;
  moved: number;
  saved: number;
  unchanged: number;
  changed: number;
  errors: Array<{ key: string; title?: string; error: string }>;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const dirOf = (p: string[]) => p.slice(0, -1);

/**
 * Namen unter Geschwistern eindeutig machen: „Titel“, „Titel (2)“ … (ohne
 * Rücksicht auf Groß/klein – manche Dateisysteme unterscheiden das nicht).
 */
export function uniqueNames<T>(items: T[], nameOf: (x: T) => string, ext = ''): Map<T, string> {
  const used = new Set<string>();
  const out = new Map<T, string>();
  for (const it of items) {
    const base = nameOf(it);
    let name = `${base}${ext}`;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i})${ext}`;
    used.add(name.toLowerCase());
    out.set(it, name);
  }
  return out;
}

/** Den Stand in der Nextcloud an `wanted` anpassen. `records`: zuletzt Geschriebenes je Schlüssel. */
export async function syncSicherung(
  nc: SicherungNc,
  root: string[],
  wanted: WantedFile[],
  records: Record<string, FileRecord>,
  opts: { now?: Date } = {},
): Promise<{ records: Record<string, FileRecord>; report: SicherungReport }> {
  const now = opts.now || new Date();
  const today = now.toISOString().slice(0, 10);
  const report: SicherungReport = { written: 0, moved: 0, saved: 0, unchanged: 0, changed: 0, errors: [] };
  const abs = (p: string[]) => [...root, ...p];
  const vacated = new Set<string>();
  const ensured = new Set<string>();
  const ensure = async (dir: string[]) => {
    const k = JSON.stringify(dir);
    if (ensured.has(k)) return;
    await nc.ensureFolder(abs(dir));
    ensured.add(k);
  };

  /** Datei nach _Gesichert/<Datum>/<gleicher Pfad> – nie überschreiben. */
  const backup = async (path: string[]) => {
    if (!(await nc.stat(abs(path)))) return;
    let dest = [SAVED, today, ...path];
    for (let i = 2; i < 50 && (await nc.stat(abs(dest))); i++) {
      const name = path[path.length - 1];
      const dot = name.lastIndexOf('.');
      dest = [SAVED, today, ...dirOf(path), dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`];
    }
    await ensure(dirOf(dest));
    await nc.move(abs(path), abs(dest));
    vacated.add(JSON.stringify(dirOf(path)));
    report.saved++;
  };

  const write = async (w: WantedFile): Promise<string> => {
    await ensure(dirOf(w.path));
    let etag = await nc.put(abs(w.path), await w.data(), w.contentType);
    if (!etag) etag = (await nc.stat(abs(w.path)))?.etag || '';
    report.written++;
    return etag;
  };

  const out: Record<string, FileRecord> = {};
  for (const w of wanted) {
    const old = records[w.key];
    const meta = { moduleId: w.moduleId, topicId: w.topicId, title: w.title };
    try {
      if (!old) {
        // Neu: Liegt dort schon etwas Fremdes, wird es vorher gesichert.
        await backup(w.path);
        out[w.key] = { key: w.key, path: w.path, etag: await write(w), hash: w.hash, state: 'ok', ...meta };
        continue;
      }
      const rec: FileRecord = { ...old, path: [...old.path], ...meta };
      out[w.key] = rec;
      const st = await nc.stat(abs(rec.path));
      const outside = !!st && !!rec.etag && st.etag !== rec.etag;
      if (outside && w.editable && rec.state !== 'discard') {
        // Draußen geändert: liegen lassen, melden. Erst nach Übernehmen oder Verwerfen geht es weiter.
        if (rec.state !== 'changed') { rec.state = 'changed'; rec.changedAt = now.toISOString(); }
        report.changed++;
        continue;
      }
      if (outside) await backup(rec.path);
      // Umgezogen (Lernthema verschoben, umbenannt …): Datei mitnehmen.
      if (!outside && st && !same(rec.path, w.path)) {
        await backup(w.path);
        await ensure(dirOf(w.path));
        await nc.move(abs(rec.path), abs(w.path));
        vacated.add(JSON.stringify(dirOf(rec.path)));
        rec.path = w.path;
        report.moved++;
      }
      // Fehlt, war draußen geändert (und ist gesichert), veraltet oder soll verworfen werden: neu schreiben.
      const missing = outside || !st;
      if (missing || rec.hash !== w.hash || rec.state === 'discard') {
        if (!same(rec.path, w.path)) { vacated.add(JSON.stringify(dirOf(rec.path))); rec.path = w.path; }
        rec.etag = await write(w);
        rec.hash = w.hash;
      } else report.unchanged++;
      rec.state = 'ok';
      delete rec.changedAt;
    } catch (err: any) {
      if (old) out[w.key] = { ...old, ...meta };
      report.errors.push({ key: w.key, title: w.title, error: String(err?.response?.message || err?.message || err).slice(0, 300) });
    }
  }

  // Was es in der App nicht mehr gibt: nach _Gesichert.
  for (const [key, rec] of Object.entries(records)) {
    if (out[key] || wanted.some((w) => w.key === key)) continue;
    await backup(rec.path).catch(() => undefined);
  }

  // Leer gewordene Ordner entfernen (nie die Wurzel oder _Gesichert).
  const dirs = [...vacated].map((d) => JSON.parse(d) as string[]).sort((a, b) => b.length - a.length);
  const tried = new Set<string>();
  for (const start of dirs) {
    for (let d = start; d.length && d[0] !== SAVED; d = dirOf(d)) {
      const key = JSON.stringify(d);
      if (tried.has(key)) break;
      tried.add(key);
      const entries = await nc.list(abs(d)).catch(() => null);
      if (!entries || entries.length) break;
      await nc.remove(abs(d));
    }
  }

  // Alte Sicherungen aufräumen.
  const cutoff = new Date(now.getTime() - KEEP_SAVED_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
  for (const e of await nc.list(abs([SAVED])).catch(() => [])) {
    if (e.isFolder && /^\d{4}-\d{2}-\d{2}$/.test(e.name) && e.name < cutoff) await nc.remove(abs([SAVED, e.name]));
  }

  return { records: out, report };
}
