/**
 * Nummern und Kopfzeilen der Dokumente (Modultyp „Dokument“) aus der
 * Notebook-Struktur einer Lehrkraft. Ohne Datenbank, damit sie sich einzeln
 * prüfen lässt (numbering.spec.ts).
 *
 * Gezählt wird je Ordner in der Reihenfolge des Baums: erst die Unterordner,
 * dann die Lernthemen, darin die Dokumente in Modulreihenfolge. Die Nummer
 * trägt die Positionen der Ordner davor mit („2.1“ = Ordner 2, Blatt 1),
 * gezählt ab dem Zählbeginn:
 *   - jedes Book,
 *   - ein Ordner mit „Zählung beginnt hier“ (numberRoot) oder mit eigenem
 *     Kursnamen – sofern numberRoot dort nicht ausdrücklich false ist.
 * „Darunter durchzählen“ (numberFlat) zählt alle Dokumente darunter auf einer
 * Ebene, Unterordner gliedern dann nur noch. Nummeriert werden nur
 * Arbeitsblätter; Klassenarbeiten und Texte stehen ohne Nummer.
 * Ordner ohne nummerierte Dokumente bekommen keine Nummer (keine Lücken).
 */

export interface DocSettings {
  kurs?: string;
  titelmuster?: string;
  autor?: string;
  meta?: Record<string, string>;
  numberRoot?: boolean;
  numberFlat?: boolean;
  aiGuidelines?: string;
  skript?: { titel?: string; kopfzeile?: string; slug?: string };
  /** Formate im Nextcloud-Abbild (odt, loesung, pdf, loesung_pdf); ohne Angabe alle. */
  formats?: string[];
  /** Vorlage je Art (WorksheetTemplate.id); ohne Angabe Standard der Lehrkraft bzw. Schule. */
  templates?: { arbeitsblatt?: string; klassenarbeit?: string };
}

export const PRINT_FORMATS = ['odt', 'loesung', 'pdf', 'loesung_pdf'];

export interface NumNode {
  id: string;
  kind: string;
  title: string;
  parentId: string | null;
  orderIndex: number;
  docSettings?: DocSettings | null;
}
export interface NumPlacement { topicId: string; nodeId: string | null; orderIndex: number }
export interface NumModule {
  id: string;
  topicId: string;
  type: string;
  title: string;
  parentId?: string | null;
  orderIndex: number;
  content?: any;
}

export interface CourseInfo { kurs: string; titelmuster: string; autor: string; meta: Record<string, string> }

export interface DocInfo {
  moduleId: string;
  topicId: string;
  nodeId: string | null;
  /** „2.1“ – leer bei Dokumenten ohne Nummer */
  pfad: string;
  /** letzte Stelle der Nummer, null ohne Nummer */
  nummer: number | null;
  /** Zählbereich: Knoten, an dem die Zählung beginnt ('' = Unsortiert) */
  scope: string;
  slug: string;
  title: string;
  /** Titel des Ordners, in dem das Dokument liegt ({abschnitt}) */
  folder: string;
  /** Art des Dokuments (arbeitsblatt, klassenarbeit, text) */
  kind: string;
  course: CourseInfo;
  /** fertige Kopfzeile */
  header: string;
}

export interface Numbering {
  docs: Map<string, DocInfo>;
  /** Ordnernummer je Knoten, z. B. „2“ oder „2.1“ */
  nodeNumbers: Map<string, string>;
  /** Verweisziele je Zählbereich: slug → Nummer und Titel */
  refs: Map<string, Record<string, { pfad: string; titel: string }>>;
}

export const DEFAULT_TITELMUSTER = '{kurs} {pfad} – {titel}';

const byOrder = (a: { orderIndex: number }, b: { orderIndex: number }) => a.orderIndex - b.orderIndex;

export function isDocument(m: NumModule): boolean {
  return m.type === 'document';
}

export function isNumbered(m: NumModule): boolean {
  return (m.content?.kind ?? 'arbeitsblatt') === 'arbeitsblatt';
}

/** Kurzname für Verweise: ASCII, Unterstriche („Der AD-Wandler“ → der_ad_wandler). */
export function slugify(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'dokument';
}

/**
 * Titelmuster füllen. Leere Platzhalter hinterlassen keine Reste:
 * „{kurs} {pfad} – {titel}“ ohne Kurs und Nummer ergibt nur den Titel.
 */
export function formatHeader(pattern: string, vars: Record<string, string>): string {
  const filled = String(pattern || DEFAULT_TITELMUSTER).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));
  return filled
    .replace(/\s+/g, ' ')
    .replace(/\s+([–-])\s+([–-])\s+/g, ' $2 ')
    .trim()
    .replace(/^[–-]\s*/, '')
    .replace(/\s*[–-]$/, '')
    .trim();
}

/**
 * Einstellungen, die an einem Ordner gelten: von oben nach unten
 * zusammengeführt, das Nähere gewinnt (meta wird gemischt).
 */
export function settingsAt(nodes: NumNode[], nodeId: string | null): DocSettings {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: NumNode[] = [];
  const seen = new Set<string>();
  for (let n = nodeId ? byId.get(nodeId) : undefined; n && !seen.has(n.id); n = n.parentId ? byId.get(n.parentId) : undefined) {
    seen.add(n.id);
    chain.unshift(n);
  }
  const out: DocSettings = {};
  for (const n of chain) {
    const s = n.docSettings || {};
    for (const key of ['kurs', 'titelmuster', 'autor', 'aiGuidelines'] as const) if (s[key]) out[key] = s[key];
    if (Array.isArray(s.formats)) out.formats = s.formats;
    if (s.templates && typeof s.templates === 'object') out.templates = { ...(out.templates || {}), ...s.templates };
    if (s.meta && typeof s.meta === 'object') out.meta = { ...(out.meta || {}), ...s.meta };
  }
  return out;
}

const LIMITS = { kurs: 120, titelmuster: 200, autor: 120, aiGuidelines: 20000 } as const;

/**
 * Eingaben aus dem Dialog „Dokument-Einstellungen“ bereinigen. Was der
 * Dialog nicht kennt (skript vom Import), bleibt erhalten. Ergebnis null,
 * wenn nichts übrig ist.
 */
export function sanitizeDocSettings(input: any, existing: DocSettings | null | undefined): DocSettings | null {
  const out: DocSettings = { ...(existing || {}) };
  const src = input && typeof input === 'object' ? input : {};
  for (const key of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
    if (!(key in src)) continue;
    const v = typeof src[key] === 'string' ? src[key].trim().slice(0, LIMITS[key]) : '';
    if (v) out[key] = v; else delete out[key];
  }
  for (const key of ['numberRoot', 'numberFlat'] as const) {
    if (!(key in src)) continue;
    if (src[key] === true || src[key] === false) out[key] = src[key]; else delete out[key];
  }
  if ('formats' in src) {
    if (Array.isArray(src.formats)) out.formats = PRINT_FORMATS.filter((f) => src.formats.includes(f));
    else delete out.formats;
  }
  if ('templates' in src) {
    const t: Record<string, string> = {};
    for (const kind of ['arbeitsblatt', 'klassenarbeit']) {
      const v = src.templates?.[kind];
      if (typeof v === 'string' && /^[\w-]{1,64}$/.test(v)) t[kind] = v;
    }
    if (Object.keys(t).length) out.templates = t; else delete out.templates;
  }
  if ('meta' in src) {
    const meta: Record<string, string> = {};
    if (src.meta && typeof src.meta === 'object' && !Array.isArray(src.meta)) {
      for (const [k, v] of Object.entries(src.meta).slice(0, 20)) {
        if (/^[A-Za-z0-9_]{1,40}$/.test(k) && (typeof v === 'string' || typeof v === 'number')) meta[k] = String(v).slice(0, 200);
      }
    }
    if (Object.keys(meta).length) out.meta = meta; else delete out.meta;
  }
  return Object.keys(out).length ? out : null;
}

export function numberDocuments(nodes: NumNode[], placements: NumPlacement[], modules: NumModule[]): Numbering {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const kidsOf = new Map<string | null, NumNode[]>();
  for (const n of nodes) {
    const key = n.parentId && nodeById.has(n.parentId) ? n.parentId : null;
    if (!kidsOf.has(key)) kidsOf.set(key, []);
    kidsOf.get(key)!.push(n);
  }
  for (const list of kidsOf.values()) list.sort(byOrder);
  const topicsOf = new Map<string | null, string[]>();
  for (const p of [...placements].sort(byOrder)) {
    const key = p.nodeId && nodeById.has(p.nodeId) ? p.nodeId : null;
    if (!topicsOf.has(key)) topicsOf.set(key, []);
    topicsOf.get(key)!.push(p.topicId);
  }
  // Dokumente je Thema in der Reihenfolge der Modulliste (Untermodule nach ihrem Elternmodul).
  const docsOf = new Map<string, NumModule[]>();
  const byTopic = new Map<string, NumModule[]>();
  for (const m of modules) {
    if (!byTopic.has(m.topicId)) byTopic.set(m.topicId, []);
    byTopic.get(m.topicId)!.push(m);
  }
  for (const [topicId, mods] of byTopic) {
    const roots = mods.filter((m) => !m.parentId).sort(byOrder);
    const ordered: NumModule[] = [];
    for (const r of roots) {
      ordered.push(r);
      ordered.push(...mods.filter((m) => m.parentId === r.id).sort(byOrder));
    }
    docsOf.set(topicId, ordered.filter(isDocument));
  }

  const isRoot = (n: NumNode) => !n.parentId || !nodeById.has(n.parentId) || n.docSettings?.numberRoot === true
    || (n.docSettings?.numberRoot !== false && !!n.docSettings?.kurs);

  const docs = new Map<string, DocInfo>();
  const nodeNumbers = new Map<string, string>();
  const refs = new Map<string, Record<string, { pfad: string; titel: string }>>();
  const docsIn = (nodeId: string | null) => (topicsOf.get(nodeId) || []).flatMap((t) => docsOf.get(t) || []);

  /** Gibt es unterhalb nummerierte Dokumente, die in diesem Zählbereich zählen? */
  const memo = new Map<string, boolean>();
  const hasNumbered = (n: NumNode): boolean => {
    if (memo.has(n.id)) return memo.get(n.id)!;
    const v = docsIn(n.id).some(isNumbered) || (kidsOf.get(n.id) || []).some((k) => !isRoot(k) && hasNumbered(k));
    memo.set(n.id, v);
    return v;
  };

  const courseAt = (nodeId: string | null): CourseInfo => {
    const s = settingsAt(nodes, nodeId);
    return { kurs: s.kurs || '', titelmuster: s.titelmuster || DEFAULT_TITELMUSTER, autor: s.autor || '', meta: s.meta || {} };
  };

  const assign = (m: NumModule, nodeId: string | null, scope: string, path: number[] | null) => {
    const course = courseAt(nodeId);
    const pfad = path ? path.join('.') : '';
    const folder = nodeId ? nodeById.get(nodeId)?.title || '' : '';
    const used = refs.get(scope) || {};
    let slug = String(m.content?.slug || '') || slugify(m.title);
    for (let i = 2; used[slug]; i++) slug = `${String(m.content?.slug || '') || slugify(m.title)}-${i}`;
    used[slug] = { pfad, titel: m.title };
    refs.set(scope, used);
    docs.set(m.id, {
      moduleId: m.id, topicId: m.topicId, nodeId, pfad, nummer: path ? path[path.length - 1] : null, scope, slug, title: m.title, folder, kind: String(m.content?.kind || 'arbeitsblatt'), course,
      header: formatHeader(course.titelmuster, {
        kurs: course.kurs, pfad, nummer: path ? String(path[path.length - 1]) : '', titel: m.title, autor: course.autor, abschnitt: folder,
      }),
    });
  };

  /** Alle Dokumente darunter auf einer Ebene (numberFlat). */
  const flat = (n: NumNode, scope: string, prefix: number[], counter: { i: number }) => {
    for (const k of kidsOf.get(n.id) || []) flat(k, scope, prefix, counter);
    for (const d of docsIn(n.id)) assign(d, n.id, scope, isNumbered(d) ? [...prefix, ++counter.i] : null);
  };

  const walk = (n: NumNode, scope: string, prefix: number[]) => {
    if (n.docSettings?.numberFlat) {
      flat(n, scope, prefix, { i: 0 });
      return;
    }
    let i = 0;
    for (const k of kidsOf.get(n.id) || []) {
      if (isRoot(k)) { walk(k, k.id, []); continue; }
      if (!hasNumbered(k)) { walk(k, scope, []); continue; } // nur ungezählte Dokumente darin
      i++;
      nodeNumbers.set(k.id, [...prefix, i].join('.'));
      walk(k, scope, [...prefix, i]);
    }
    for (const d of docsIn(n.id)) assign(d, n.id, scope, isNumbered(d) ? [...prefix, ++i] : null);
  };

  for (const book of kidsOf.get(null) || []) walk(book, book.id, []);
  let u = 0;
  for (const d of docsIn(null)) assign(d, null, '', isNumbered(d) ? [++u] : null);
  return { docs, nodeNumbers, refs };
}
