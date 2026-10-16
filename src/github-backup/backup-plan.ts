import { gitBlobSha, TreeEntry } from './github-api';

/**
 * Was ein Lauf ins Repository schreibt – ohne Netz, damit testbar.
 *
 * Jedes Thema liegt in `themen/<titel>--<themen-id>.json`. Der Pfad bleibt,
 * wie er beim ersten Sichern entstand, auch wenn das Thema später umbenannt
 * wird: GitHub verfolgt Umbenennungen in der Versionsliste nicht, ein neuer
 * Name würde die älteren Stände abschneiden. Erkannt wird ein Thema an der
 * ID hinter dem letzten "--" – benennt jemand die Datei auf GitHub um, wird
 * künftig dorthin geschrieben. Den aktuellen Titel je Datei führt
 * `themen/index.json`.
 *
 * Dateien, zu denen es kein Thema mehr gibt, bleiben unangetastet: Löschen
 * ist Sache der Lehrkraft, direkt auf GitHub.
 */

export const TOPIC_DIR = 'themen/';
export const INDEX_PATH = 'themen/index.json';

export interface BackupTopic {
  id: string;
  title: string;
  /** Fertiger Dateiinhalt (JSON-Export). */
  content: string;
  modules: number;
}

export interface IndexEntry {
  datei: string;
  id: string;
  titel: string;
  module: number | null;
}

/** Thema-ID aus einem Pfad wie `themen/mathe--<id>.json`, sonst null. */
export function topicIdOf(path: string): string | null {
  if (!path.startsWith(TOPIC_DIR) || !path.endsWith('.json') || path === INDEX_PATH) return null;
  const name = path.slice(TOPIC_DIR.length, -'.json'.length);
  if (name.includes('/')) return null;
  const at = name.lastIndexOf('--');
  const id = at >= 0 ? name.slice(at + 2) : '';
  return id || null;
}

/** Lesbarer, URL-freundlicher Dateiname aus einem Titel. */
export function slug(title: string) {
  const map: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue' };
  const s = String(title || '')
    .replace(/[äöüßÄÖÜ]/g, (c) => map[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return s || 'thema';
}

export function topicPath(t: { id: string; title: string }) {
  return `${TOPIC_DIR}${slug(t.title)}--${t.id}.json`;
}

/** Bisheriger Index aus dem Repository – kaputt oder fehlend ergibt eine leere Liste. */
export function parseIndex(text: string | null): IndexEntry[] {
  if (!text) return [];
  try {
    const list = JSON.parse(text)?.themen;
    return Array.isArray(list) ? list.filter((e: any) => e && typeof e.datei === 'string') : [];
  } catch {
    return [];
  }
}

export function renderIndex(entries: IndexEntry[]) {
  const sorted = [...entries].sort((a, b) => a.datei.localeCompare(b.datei));
  return JSON.stringify(
    {
      hinweis: 'Von LearningModules geschrieben: aktueller Titel je Datei. Gelöschte Themen bleiben stehen, bis die Datei gelöscht wird.',
      themen: sorted,
    },
    null,
    2,
  ) + '\n';
}

export interface BackupPlan {
  files: Array<{ path: string; content: string }>;
  created: string[];
  updated: string[];
  unchanged: number;
}

export function planBackup(tree: TreeEntry[], topics: BackupTopic[], oldIndex: IndexEntry[]): BackupPlan {
  const byPath = new Map(tree.map((e) => [e.path, e.sha]));
  const pathOfId = new Map<string, string>();
  for (const e of tree) {
    const id = topicIdOf(e.path);
    // Gibt es mehrere Dateien zum selben Thema, gewinnt die erste in Sortierung.
    if (id && !pathOfId.has(id)) pathOfId.set(id, e.path);
  }

  const plan: BackupPlan = { files: [], created: [], updated: [], unchanged: 0 };
  for (const t of topics) {
    const existing = pathOfId.get(t.id);
    const path = existing || topicPath(t);
    if (!existing) {
      plan.files.push({ path, content: t.content });
      plan.created.push(t.title);
      pathOfId.set(t.id, path);
    } else if (byPath.get(path) !== gitBlobSha(t.content)) {
      plan.files.push({ path, content: t.content });
      plan.updated.push(t.title);
    } else plan.unchanged++;
  }

  // Index: alle Themendateien, die es nach dem Lauf gibt.
  const current = new Map(topics.map((t) => [t.id, t]));
  const old = new Map(oldIndex.map((e) => [e.datei, e]));
  const index: IndexEntry[] = [];
  for (const [id, datei] of pathOfId) {
    const t = current.get(id);
    const prev = old.get(datei);
    index.push({
      datei,
      id,
      titel: t ? t.title : prev?.titel || datei.slice(TOPIC_DIR.length, datei.lastIndexOf('--')) || id,
      module: t ? t.modules : prev?.module ?? null,
    });
  }
  const indexContent = renderIndex(index);
  if (byPath.get(INDEX_PATH) !== gitBlobSha(indexContent)) plan.files.push({ path: INDEX_PATH, content: indexContent });
  return plan;
}

/**
 * Für die Wiederherstellung: die gewählten Hauptmodule samt ihren
 * Untermodulen aus einem gesicherten Thema.
 */
export function pickModules(modules: any[], rootIds: string[]) {
  const chosen = new Set(rootIds.map(String));
  const roots = new Set(modules.filter((m) => m && !m.parentId && chosen.has(String(m.id))).map((m) => String(m.id)));
  return modules.filter((m) => m && (m.parentId ? roots.has(String(m.parentId)) : roots.has(String(m.id))));
}
