/**
 * Regeln für Kategorien, ohne Datenbank (category-rules.spec.ts).
 * Siehe docs/kategorien.md.
 */

export type Facet = 'subject' | 'stage';

export interface CategoryLike {
  id: string;
  facet: Facet;
  parentId: string | null;
  label: string;
  status: 'active' | 'proposed' | 'hidden';
  proposedBy?: string | null;
  source?: string;
}

/** Wie tief eine Facette reicht: Fach bis Ebene 3, Bildungsstufe bis Ebene 2. */
export const MAX_DEPTH: Record<Facet, number> = { subject: 3, stage: 2 };

/** Höchstzahl Kategorien an einem Lernthema, Tag oder Angebot. */
export const MAX_PER_ITEM = 20;

export const MAX_LABEL = 60;

/** Ebene einer Kategorie (1 = oberste); 0, wenn unbekannt. */
export function depthOf(id: string, byId: Map<string, CategoryLike>): number {
  let d = 0;
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    d++;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return d;
}

/** Die Kategorie und alle darüber, von unten nach oben. */
export function withAncestors(id: string, byId: Map<string, CategoryLike>): string[] {
  const out: string[] = [];
  let cur = byId.get(id);
  while (cur && !out.includes(cur.id)) {
    out.push(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** Die Kategorien samt allem darunter – für die Suche: „Elektrotechnik“ findet auch „SPS-Programmierung“. */
export function withDescendants(ids: string[], all: CategoryLike[]): Set<string> {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of all) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Wählbar für diesen Benutzer: aktiv, oder ein eigener Vorschlag. */
export function selectable(c: CategoryLike, userId: string): boolean {
  return c.status === 'active' || (c.status === 'proposed' && c.proposedBy === userId);
}

/**
 * Bereinigt eine Auswahl: nur bekannte Kategorien, die der Benutzer wählen
 * darf. Was schon vorher zugeordnet war, bleibt auch dann, wenn es inzwischen
 * ausgeblendet oder der Vorschlag eines anderen ist – sonst ginge es beim
 * nächsten Speichern unbemerkt verloren.
 */
export function cleanIds(
  input: unknown,
  byId: Map<string, CategoryLike>,
  userId: string,
  previous: string[] | null = null,
): string[] {
  const raw = Array.isArray(input) ? [...new Set(input.map(String))] : [];
  const before = new Set(previous || []);
  return raw
    .filter((id) => {
      const c = byId.get(id);
      return !!c && (selectable(c, userId) || before.has(id));
    })
    .slice(0, MAX_PER_ITEM);
}

/** Kategorien eines Lernthemas: eigene und die seiner Tags. */
export function effectiveOf(
  own: string[] | null | undefined,
  tagIds: string[] | null | undefined,
  tagCategories: Map<string, string[]>,
): string[] {
  const out = new Set(own || []);
  for (const t of tagIds || []) for (const c of tagCategories.get(t) || []) out.add(c);
  return [...out];
}

/** Enthält die Auswahl ein Fach? */
export function hasSubject(ids: string[], byId: Map<string, CategoryLike>): boolean {
  return ids.some((id) => byId.get(id)?.facet === 'subject');
}

/**
 * Darf unter `parent` ein Unterbegriff entstehen? Liefert einen Grund, wenn
 * nicht – sonst null.
 */
export function cannotAddUnder(parent: CategoryLike | undefined, byId: Map<string, CategoryLike>): string | null {
  if (!parent) return 'Oberbegriff nicht gefunden.';
  if (parent.status === 'hidden') return 'Unter einem ausgeblendeten Begriff lässt sich nichts ergänzen.';
  const depth = depthOf(parent.id, byId);
  if (depth >= MAX_DEPTH[parent.facet]) {
    return parent.facet === 'subject'
      ? 'Fächer haben höchstens drei Ebenen – bitte einen Begriff der ersten oder zweiten Ebene wählen.'
      : 'Bildungsstufen haben höchstens zwei Ebenen – bitte eine Stufe der ersten Ebene wählen.';
  }
  return null;
}

/** Gibt es unter demselben Oberbegriff schon einen Begriff dieses Namens (ohne Groß/klein)? */
export function siblingWithLabel(parentId: string, label: string, all: CategoryLike[]): CategoryLike | undefined {
  const norm = label.trim().toLocaleLowerCase('de');
  return all.find((c) => c.parentId === parentId && c.label.trim().toLocaleLowerCase('de') === norm && c.status !== 'hidden');
}

/** Saubere Bezeichnung oder null. */
export function cleanLabel(v: unknown): string | null {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s && s.length <= MAX_LABEL ? s : null;
}

export interface VocabFiles {
  discipline: { concepts: Array<{ id: string; uri: string; label: string }> };
  context: { concepts: Array<{ id: string; uri: string; label: string }> };
  shared: { items: Array<{ id: string; facet: Facet; parent: string; label: string; retired?: boolean }> };
}

/** Die ausgelieferten Kategorien als Zeilen (ohne Status – den behält der Server). */
export function seedRows(v: VocabFiles) {
  const rows: Array<{ id: string; facet: Facet; parentId: string | null; label: string; source: 'oeh' | 'shared'; uri: string | null; orderIndex: number; retired: boolean }> = [];
  const sorted = (list: Array<{ id: string; uri: string; label: string }>) => [...list].sort((a, b) => a.label.localeCompare(b.label, 'de'));
  sorted(v.discipline.concepts).forEach((c, i) => rows.push({ id: `oeh-d:${c.id}`, facet: 'subject', parentId: null, label: c.label, source: 'oeh', uri: c.uri, orderIndex: i, retired: false }));
  // Bildungsstufen in ihrer natürlichen Reihenfolge, nicht alphabetisch.
  v.context.concepts.forEach((c, i) => rows.push({ id: `oeh-c:${c.id}`, facet: 'stage', parentId: null, label: c.label, source: 'oeh', uri: c.uri, orderIndex: i, retired: false }));
  v.shared.items.forEach((c, i) => rows.push({ id: c.id, facet: c.facet, parentId: c.parent, label: c.label, source: 'shared', uri: null, orderIndex: i, retired: !!c.retired }));
  return rows;
}
