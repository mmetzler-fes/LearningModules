import * as posix from 'path/posix';
import { load as yamlLoad } from 'js-yaml';
import { DEFAULT_TITELMUSTER, DocSettings } from './numbering';

/**
 * Kurse im Format des Arbeitsblatt-Generators (worksheet-renderer/README.md)
 * lesen – ohne Datenbank, damit es sich einzeln prüfen lässt.
 *
 *   kurs.yaml                 Kursname, Titelmuster, Autor, meta
 *   CLAUDE.md                 fachliche Vorgaben → KI-Vorgaben des Books
 *   NN_thema/arbeitsblatt.yaml  je Blatt ein Lernthema mit einem Dokument
 *   skripte/*.yaml            je Skript ein Abschnitt mit seinen Blättern
 *   quellcodes/, quellen/     worauf `file:` zeigt – Code wird eingesetzt,
 *                             Bilder kommen als data: ins Dokument
 */

export interface CourseFiles {
  /** Dateipfade (posix, ohne führendes ./) */
  names: string[];
  read(name: string): Buffer | null;
}

export interface CourseSheet {
  folder: string;
  title: string;
  kind: 'arbeitsblatt' | 'klassenarbeit';
  /** Inhalt des Moduls „Dokument“ */
  content: { kind: string; slug: string; spec: Record<string, any> };
}

export interface CoursePlan {
  title: string;
  settings: DocSettings;
  sections: Array<{ title: string; skript: { titel?: string; kopfzeile?: string; slug?: string }; sheets: string[] }>;
  /** Blätter in keinem Skript – direkt ins Book */
  loose: string[];
  exams: string[];
  sheets: Map<string, CourseSheet>;
  warnings: string[];
}

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', gif: 'image/gif', webp: 'image/webp' };
/** Was die App aus kurs.yaml bzw. der Spec selbst bestimmt. */
const SPEC_DROP = ['nummer', 'titel', 'slug', 'template', 'skript_template', 'kuerzel', 'kurs', 'titelmuster', 'autor'];

export class CourseFormatError extends Error {}

const natural = (a: string, b: string) => a.localeCompare(b, 'de', { numeric: true });

function parseYaml(text: string, where: string): any {
  try {
    return yamlLoad(text) ?? {};
  } catch (e: any) {
    throw new CourseFormatError(`${where}: kein gültiges YAML (${e.reason || e.message}).`);
  }
}

/** „Arduino (ESP32) – Grundlagen“ → „Grundlagen“ */
function sectionTitle(skript: any, fallback: string): string {
  const raw = String(skript.kopfzeile || skript.titel || fallback);
  const parts = raw.split(' – ');
  return (parts.length > 1 ? parts[parts.length - 1] : raw).trim().slice(0, 120) || fallback;
}

/** Generator-Platzhalter {nummer} wird in der App zur Pfadnummer. */
export function importTitelmuster(pattern: unknown): string {
  return typeof pattern === 'string' && pattern.trim() ? pattern.replace(/\{nummer\}/g, '{pfad}') : DEFAULT_TITELMUSTER;
}

export function readCourse(files: CourseFiles): CoursePlan {
  const kursFiles = files.names.filter((n) => posix.basename(n) === 'kurs.yaml').sort((a, b) => a.split('/').length - b.split('/').length);
  if (!kursFiles.length) throw new CourseFormatError('Kein Kurs: kurs.yaml fehlt.');
  const kursPath = kursFiles[0];
  const dir = posix.dirname(kursPath) === '.' ? '' : posix.dirname(kursPath);
  const inDir = (p: string) => (dir ? `${dir}/${p}` : p);
  const text = (name: string) => files.read(name)?.toString('utf-8') ?? null;
  const warnings: string[] = [];

  const kurs = parseYaml(text(kursPath) || '', 'kurs.yaml');
  const settings: DocSettings = { titelmuster: importTitelmuster(kurs.titelmuster) };
  if (kurs.kurs) settings.kurs = String(kurs.kurs).slice(0, 120);
  if (kurs.autor) settings.autor = String(kurs.autor).slice(0, 120);
  if (kurs.meta && typeof kurs.meta === 'object' && Object.keys(kurs.meta).length) {
    settings.meta = Object.fromEntries(Object.entries(kurs.meta).map(([k, v]) => [k, String(v)]));
  }
  const guidelines = text(inDir('CLAUDE.md'));
  if (guidelines?.trim()) settings.aiGuidelines = guidelines.trim().slice(0, 20000);
  if (kurs.template) warnings.push(`Vorlage ${kurs.template}: in der App gilt vorerst die Grundvorlage – eigene Vorlagen kommen später.`);

  // Blätter: direkte Unterordner mit arbeitsblatt.yaml
  const sheetRe = new RegExp(`^${dir ? `${escapeRe(dir)}/` : ''}([^/]+)/arbeitsblatt\\.yaml$`);
  const folders = files.names.map((n) => sheetRe.exec(n)?.[1]).filter((f): f is string => !!f).sort(natural);
  if (!folders.length) throw new CourseFormatError('Der Kurs enthält keine Blätter (Ordner mit arbeitsblatt.yaml).');

  const sheets = new Map<string, CourseSheet>();
  for (const folder of folders) {
    const where = `${folder}/arbeitsblatt.yaml`;
    const raw = parseYaml(text(inDir(where)) || '', where);
    const search = [inDir(folder), dir, ''];
    const content = inlineFiles(raw.content, search, files, folder, warnings);
    const examLike = /klassenarbeit/i.test(String(raw.template || '')) || /^ka[_-]/i.test(folder)
      || (raw.nummer !== undefined && !/^\d+$/.test(String(raw.nummer)));
    const spec: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) if (!SPEC_DROP.includes(k)) spec[k] = v;
    spec.content = Array.isArray(content) ? content : [];
    const kind = examLike ? 'klassenarbeit' : 'arbeitsblatt';
    sheets.set(folder, { folder, title: String(raw.titel || folder).slice(0, 200), kind, content: { kind, slug: folder, spec } });
  }

  // Skripte → Abschnitte, in der Reihenfolge ihres ersten Blatts
  const placed = new Set<string>();
  const regular = folders.filter((f) => sheets.get(f)!.kind === 'arbeitsblatt');
  const skriptRe = new RegExp(`^${dir ? `${escapeRe(dir)}/` : ''}skripte/[^/]+\\.ya?ml$`);
  const skripte = files.names.filter((n) => skriptRe.test(n)).map((n) => {
    const s = parseYaml(text(n) || '', posix.basename(n));
    const list = s.blaetter === 'alle' ? regular : (Array.isArray(s.blaetter) ? s.blaetter.map(String) : []);
    const unknown = list.filter((f: string) => !sheets.has(f));
    if (unknown.length) warnings.push(`Skript ${posix.basename(n)}: unbekannte Blätter ${unknown.join(', ')}`);
    return { file: n, s, list: list.filter((f: string) => sheets.has(f)) as string[] };
  }).filter((x) => x.list.length).sort((a, b) => natural([...a.list].sort(natural)[0], [...b.list].sort(natural)[0]));

  const sections: CoursePlan['sections'] = [];
  for (const { file, s, list } of skripte) {
    const own = list.filter((f) => !placed.has(f));
    if (!own.length) continue;
    own.forEach((f) => placed.add(f));
    const skript: { titel?: string; kopfzeile?: string; slug?: string } = {};
    if (s.titel) skript.titel = String(s.titel);
    if (s.kopfzeile) skript.kopfzeile = String(s.kopfzeile);
    skript.slug = String(s.slug || posix.basename(file).replace(/\.ya?ml$/, ''));
    sections.push({ title: sectionTitle(s, posix.basename(file)), skript, sheets: own });
  }
  const exams = folders.filter((f) => sheets.get(f)!.kind === 'klassenarbeit' && !placed.has(f));
  const loose = folders.filter((f) => !placed.has(f) && !exams.includes(f));

  const title = String(kurs.kurs || (dir ? posix.basename(dir) : 'Kurs')).slice(0, 120);
  return { title, settings, sections, loose, exams, sheets, warnings };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Datei im Kurs suchen: neben der Spec, im Kurs, im Projekt – nie außerhalb. */
function resolveFile(name: string, search: string[], files: CourseFiles): { path: string; data: Buffer } | null {
  for (const base of search) {
    const path = posix.normalize(base ? `${base}/${name}` : name);
    if (path.startsWith('..') || posix.isAbsolute(path)) continue;
    const data = files.read(path);
    if (data) return { path, data };
  }
  return null;
}

/** `file:` in Code- und Bildblöcken durch den Inhalt ersetzen (rekursiv). */
function inlineFiles(blocks: any, search: string[], files: CourseFiles, folder: string, warnings: string[]): any {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.map((block) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return block;
    let out: any = block;
    if (typeof block.file === 'string' && (block.type === 'code' || block.type === 'image')) {
      const found = resolveFile(block.file, search, files);
      if (!found) {
        warnings.push(`${folder}: Datei ${block.file} fehlt im ZIP.`);
      } else if (block.type === 'code') {
        let code = found.data.toString('utf-8').replace(/\r\n/g, '\n');
        if (block.from_line || block.to_line) {
          const lines = code.split('\n');
          code = lines.slice(block.from_line ? block.from_line - 1 : 0, block.to_line || lines.length).join('\n');
        }
        const { file: _f, from_line: _a, to_line: _b, ...rest } = block;
        out = { ...rest, code };
      } else {
        const mime = IMAGE_MIME[posix.extname(found.path).slice(1).toLowerCase()];
        if (!mime) {
          warnings.push(`${folder}: ${block.file} ist kein Bild (PNG, JPEG, SVG).`);
        } else {
          const { file: _f, ...rest } = block;
          // Im Generator ist die Breite eine Zahl in cm (Vorgabe 12); die App braucht die Einheit.
          const width = String(block.width ?? '12').trim();
          out = { ...rest, src: `data:${mime};base64,${found.data.toString('base64')}`, width: /^\d+(\.\d+)?$/.test(width) ? `${width}cm` : width };
        }
      }
    }
    return Array.isArray(out.blocks) ? { ...out, blocks: inlineFiles(out.blocks, search, files, folder, warnings) } : out;
  });
}

// ==================== Export ====================

export interface ExportDoc {
  title: string;
  kind: string;
  slug: string;
  spec: Record<string, any>;
  /** Abschnitt, in dem das Dokument liegt – wird zum Skript */
  section: { key: string; title: string; skript?: { titel?: string; kopfzeile?: string; slug?: string } } | null;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** Titelmuster für kurs.yaml: Der Generator kennt nur {kurs}, {nummer} und {titel}. */
export function exportTitelmuster(pattern: string | undefined): string {
  return String(pattern || DEFAULT_TITELMUSTER)
    .replace(/\{pfad\}/g, '{nummer}')
    .replace(/\{(?!kurs\}|nummer\}|titel\})\w+\}/g, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function exportSlug(text: string): string {
  return String(text || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'blatt';
}

/**
 * Dokumente → Dateien eines Kursordners (Pfad → Inhalt), bereit für
 * `kurse/<kuerzel>/` im Kurs-Projekt. Arbeitsblätter zählen durchgehend,
 * Verweise werden mit diesen Nummern aufgelöst, Bilder aus der App werden zu
 * Dateien neben dem Blatt.
 */
export function writeCourse(
  course: { title: string; settings: DocSettings },
  docs: ExportDoc[],
  resolveRefs: (spec: any, refs: Record<string, { pfad: string; titel: string }>) => any,
  dump: (value: any) => string,
): { kuerzel: string; files: Record<string, Buffer>; warnings: string[] } {
  const kuerzel = exportSlug(course.settings.kurs || course.title);
  const files: Record<string, Buffer> = {};
  const warnings: string[] = [];
  const put = (path: string, data: string | Buffer) => { files[`${kuerzel}/${path}`] = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8'); };

  // Ordnernamen und Nummern
  let nr = 0;
  const used = new Set<string>();
  const entries = docs.map((d) => {
    const base = exportSlug(d.slug.replace(/^\d+[_-]/, '').replace(/^ka[_-]/i, '')) || exportSlug(d.title);
    const nummer = d.kind === 'arbeitsblatt' ? ++nr : null;
    let folder = nummer !== null ? `${String(nummer).padStart(2, '0')}_${base}` : d.kind === 'klassenarbeit' ? `ka_${base}` : base;
    for (let i = 2; used.has(folder); i++) folder = `${folder.replace(/-\d+$/, '')}-${i}`;
    used.add(folder);
    return { ...d, folder, nummer };
  });
  const refs = Object.fromEntries(entries.map((e) => [e.slug, { pfad: e.nummer !== null ? String(e.nummer) : '', titel: e.title }]));

  for (const e of entries) {
    let n = 0;
    const walk = (blocks: any): any => (Array.isArray(blocks) ? blocks.map((b) => {
      if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
      let out = b;
      if (b.type === 'image' && typeof b.src === 'string') {
        const m = /^data:([^;,]+);base64,(.*)$/s.exec(b.src);
        const ext = m ? EXT[m[1].toLowerCase()] : undefined;
        const { src: _s, alt: _a, ...rest } = b;
        if (m && ext) {
          const name = `bilder/bild-${++n}.${ext}`;
          put(`${e.folder}/${name}`, Buffer.from(m[2], 'base64'));
          out = { ...rest, file: name };
        } else {
          warnings.push(`${e.folder}: Bild ohne Datei (${String(b.src).slice(0, 60)}) – als Hinweis exportiert.`);
          out = { type: 'note', text: `[${b.caption || 'Bild'}]` };
        }
      }
      return Array.isArray(out.blocks) ? { ...out, blocks: walk(out.blocks) } : out;
    }) : blocks);
    const spec = resolveRefs(e.spec, refs);
    const { content, ...rest } = spec || {};
    const sheet: Record<string, any> = {
      ...(e.nummer !== null ? { nummer: e.nummer } : e.kind === 'klassenarbeit' ? { nummer: 'KA' } : {}),
      titel: e.title,
      ...rest,
      content: walk(content || []),
    };
    put(`${e.folder}/arbeitsblatt.yaml`, dump(sheet));
  }

  const s = course.settings;
  const kurs: Record<string, any> = { kurs: s.kurs || course.title, kuerzel, titelmuster: exportTitelmuster(s.titelmuster) };
  if (s.autor) kurs.autor = s.autor;
  if (s.meta && Object.keys(s.meta).length) kurs.meta = s.meta;
  put('kurs.yaml', `# Aus LearningModules exportiert.\n${dump(kurs)}`);
  if (s.aiGuidelines) put('CLAUDE.md', `${s.aiGuidelines.trim()}\n`);

  // Skripte: je Abschnitt mit Arbeitsblättern
  const bySection = new Map<string, { section: NonNullable<ExportDoc['section']>; folders: string[] }>();
  for (const e of entries) {
    if (!e.section || e.nummer === null) continue;
    if (!bySection.has(e.section.key)) bySection.set(e.section.key, { section: e.section, folders: [] });
    bySection.get(e.section.key)!.folders.push(e.folder);
  }
  const skriptNames = new Set<string>();
  for (const { section, folders } of bySection.values()) {
    const sk = section.skript || {};
    let name = exportSlug(sk.slug || section.title);
    for (let i = 2; skriptNames.has(name); i++) name = `${exportSlug(sk.slug || section.title)}_${i}`;
    skriptNames.add(name);
    const skript: Record<string, any> = { titel: sk.titel || section.title };
    if (sk.slug) skript.slug = sk.slug;
    if (sk.kopfzeile) skript.kopfzeile = sk.kopfzeile;
    skript.blaetter = folders;
    put(`skripte/${name}.yaml`, dump(skript));
  }
  return { kuerzel, files, warnings };
}
