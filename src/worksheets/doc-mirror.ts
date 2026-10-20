/**
 * Abbild der Dokumente in der Nextcloud (Plan: Arbeitsblaetter-Plan.md, 3).
 *
 * Die App ist führend: Sie schreibt je Dokument .odt/.pdf (Blatt und Lösung)
 * und die Spec (_Quellen/…yaml) in die Ordner, die der Notebook-Struktur
 * entsprechen. Ohne Datenbank, damit es sich einzeln prüfen lässt
 * (doc-mirror.spec.ts) – den WebDAV-Zugriff und den Druck bekommt
 * mirrorDocs() hereingereicht.
 *
 * Eine Regel für alle Konflikte: Die App überschreibt nie eine Datei, die
 * sie nicht selbst genau so geschrieben hat (ETag). Solche Dateien wandern
 * zuerst nach _Gesichert/<Datum>/ – ebenso die Dateien gelöschter Dokumente.
 */

export const DOC_FOLDER = 'Arbeitsblätter';
export const SAVED_FOLDER = '_Gesichert';
export const SOURCES_FOLDER = '_Quellen';
/** So lange bleiben gesicherte Dateien liegen. */
export const KEEP_SAVED_DAYS = 180;

export type MirrorArt = 'odt' | 'loesung' | 'pdf' | 'loesung_pdf' | 'yaml';
export const PRINT_ARTS: MirrorArt[] = ['odt', 'loesung', 'pdf', 'loesung_pdf'];

export interface MirrorNc {
  stat(parts: string[]): Promise<{ isFolder: boolean; size: number; etag: string } | null>;
  put(parts: string[], data: Buffer, contentType: string): Promise<string>;
  move(from: string[], to: string[]): Promise<void>;
  ensureFolder(parts: string[]): Promise<void>;
  list(parts: string[]): Promise<Array<{ name: string; isFolder: boolean }>>;
  remove(parts: string[]): Promise<void>;
}

export interface MirrorFile { art: MirrorArt; path: string[]; etag: string }

export interface MirrorRecord {
  moduleId: string;
  storeKey: string;
  files: MirrorFile[];
  hash: string | null;
  status: 'ok' | 'error';
  error: string | null;
}

export interface DesiredDoc {
  moduleId: string;
  /** Ordner unterhalb von Arbeitsblätter/ */
  folder: string[];
  /** Dateiname ohne Endung, z. B. „01 Erste LED“ */
  base: string;
  formats: MirrorArt[];
  /** Prüfwert über alles, was im Druck steht – ändert er sich, wird neu gedruckt. */
  hash: string;
  handMaintained: boolean;
  /** Druck der gewünschten Formate (ohne yaml). */
  render(formats: MirrorArt[]): Promise<Partial<Record<MirrorArt, Buffer>>>;
  yaml: string;
}

export interface MirrorReport {
  written: number;
  moved: number;
  saved: number;
  errors: Array<{ moduleId: string; error: string }>;
}

const TYPES: Record<MirrorArt, string> = {
  odt: 'application/vnd.oasis.opendocument.text',
  loesung: 'application/vnd.oasis.opendocument.text',
  pdf: 'application/pdf',
  loesung_pdf: 'application/pdf',
  yaml: 'application/yaml',
};

export function fileName(base: string, art: MirrorArt): string {
  switch (art) {
    case 'odt': return `${base}.odt`;
    case 'loesung': return `${base} – Lösung.odt`;
    case 'pdf': return `${base}.pdf`;
    case 'loesung_pdf': return `${base} – Lösung.pdf`;
    default: return `${base}.yaml`;
  }
}

export function desiredPath(doc: Pick<DesiredDoc, 'folder' | 'base'>, art: MirrorArt): string[] {
  return art === 'yaml' ? [...doc.folder, SOURCES_FOLDER, fileName(doc.base, art)] : [...doc.folder, fileName(doc.base, art)];
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const dirOf = (p: string[]) => p.slice(0, -1);

/**
 * Den Stand in der Nextcloud an die Dokumente anpassen. `records` sind die
 * gemerkten Dateien je Dokument; zurück kommen die neuen Stände (fehlende =
 * Dokument gelöscht) und ein Bericht.
 */
export async function mirrorDocs(
  nc: MirrorNc,
  root: string[],
  docs: DesiredDoc[],
  records: Map<string, MirrorRecord>,
  opts: { storeKey: string; now?: Date },
): Promise<{ records: Map<string, MirrorRecord>; removed: string[]; report: MirrorReport }> {
  const now = opts.now || new Date();
  const today = now.toISOString().slice(0, 10);
  const report: MirrorReport = { written: 0, moved: 0, saved: 0, errors: [] };
  const vacated = new Set<string>();
  const abs = (p: string[]) => [...root, ...p];

  /** Datei nach _Gesichert/<Datum>/ (gleicher Pfad darunter). */
  const backup = async (path: string[]) => {
    if (!(await nc.stat(abs(path)))) return;
    let dest = [SAVED_FOLDER, today, ...path];
    for (let i = 2; i < 50 && (await nc.stat(abs(dest))); i++) {
      const name = path[path.length - 1];
      const dot = name.lastIndexOf('.');
      dest = [SAVED_FOLDER, today, ...dirOf(path), dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`];
    }
    await nc.ensureFolder(abs(dirOf(dest)));
    await nc.move(abs(path), abs(dest));
    vacated.add(JSON.stringify(dirOf(path)));
    report.saved++;
  };

  /** Schreiben; was dort liegt und nicht genau unsere Fassung ist, wird vorher gesichert. */
  const write = async (path: string[], data: Buffer, art: MirrorArt, known: MirrorFile | undefined): Promise<MirrorFile> => {
    const st = await nc.stat(abs(path));
    if (st && (!known || !same(known.path, path) || !known.etag || st.etag !== known.etag)) await backup(path);
    await nc.ensureFolder(abs(dirOf(path)));
    let etag = await nc.put(abs(path), data, TYPES[art]);
    if (!etag) etag = (await nc.stat(abs(path)))?.etag || '';
    report.written++;
    return { art, path, etag };
  };

  const out = new Map<string, MirrorRecord>();
  for (const doc of docs) {
    const old = records.get(doc.moduleId);
    const rec: MirrorRecord = old && old.storeKey === opts.storeKey
      ? { ...old, files: old.files.map((f) => ({ ...f, path: [...f.path] })) }
      : { moduleId: doc.moduleId, storeKey: opts.storeKey, files: [], hash: null, status: 'ok', error: null };
    out.set(doc.moduleId, rec);
    try {
      const arts: MirrorArt[] = [...doc.formats.filter((a) => PRINT_ARTS.includes(a)), 'yaml'];
      // 1. Nicht mehr gewünschte Formate sichern, verschobene Dokumente umziehen.
      for (const f of [...rec.files]) {
        if (!arts.includes(f.art)) {
          await backup(f.path);
          rec.files = rec.files.filter((x) => x !== f);
          continue;
        }
        const target = desiredPath(doc, f.art);
        if (same(f.path, target)) continue;
        const st = await nc.stat(abs(f.path));
        if (!st) { rec.files = rec.files.filter((x) => x !== f); continue; } // fehlt – wird neu geschrieben
        if (await nc.stat(abs(target))) await backup(target);
        await nc.ensureFolder(abs(dirOf(target)));
        await nc.move(abs(f.path), abs(target));
        vacated.add(JSON.stringify(dirOf(f.path)));
        f.path = target;
        report.moved++;
      }
      // 2. Neu drucken, wenn sich etwas geändert hat oder eine Datei fehlt.
      const missing = arts.filter((a) => !rec.files.some((f) => f.art === a));
      if (!doc.handMaintained && (rec.hash !== doc.hash || missing.length)) {
        const printArts = arts.filter((a) => a !== 'yaml');
        const printed = printArts.length ? await doc.render(printArts) : {};
        for (const art of arts) {
          const data = art === 'yaml' ? Buffer.from(doc.yaml, 'utf-8') : printed[art];
          if (!data) throw new Error(`${art} wurde nicht erzeugt`);
          const known = rec.files.find((f) => f.art === art);
          const written = await write(desiredPath(doc, art), data, art, known);
          rec.files = [...rec.files.filter((f) => f.art !== art), written];
        }
        rec.hash = doc.hash;
      }
      rec.status = 'ok';
      rec.error = null;
    } catch (err: any) {
      rec.status = 'error';
      rec.error = String(err?.response?.message || err?.message || err).slice(0, 300);
      report.errors.push({ moduleId: doc.moduleId, error: rec.error });
    }
  }

  // Dokumente, die es nicht mehr gibt: Dateien sichern.
  const removed: string[] = [];
  for (const [moduleId, rec] of records) {
    if (out.has(moduleId)) continue;
    if (rec.storeKey === opts.storeKey) {
      for (const f of rec.files) await backup(f.path).catch(() => undefined);
    }
    removed.push(moduleId);
  }

  // Leer gewordene Ordner entfernen (nie die Wurzel oder _Gesichert).
  const dirs = [...vacated].map((d) => JSON.parse(d) as string[]).sort((a, b) => b.length - a.length);
  const tried = new Set<string>();
  for (const start of dirs) {
    for (let d = start; d.length && d[0] !== SAVED_FOLDER; d = dirOf(d)) {
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
  for (const e of await nc.list(abs([SAVED_FOLDER])).catch(() => [])) {
    if (e.isFolder && /^\d{4}-\d{2}-\d{2}$/.test(e.name) && e.name < cutoff) await nc.remove(abs([SAVED_FOLDER, e.name]));
  }

  return { records: out, removed, report };
}
