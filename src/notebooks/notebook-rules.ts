/**
 * Regeln der Notebook-Struktur, ohne Datenbank – damit sie sich einzeln
 * prüfen lassen (notebook-rules.spec.ts).
 *
 * Book → Bereich → Abschnitt → Lernthema. Bereiche lassen sich ineinander
 * schachteln (Bereich › Bereich › Abschnitt), Abschnitte sind die unterste
 * Ordner-Ebene und enthalten nur Lernthemen. Zwischenebenen dürfen fehlen: Ein
 * Lernthema kann direkt in einem Book liegen, ein Abschnitt direkt in einem
 * Book. So muss niemand für ein einzelnes Lernthema erst Bereich und
 * Abschnitt anlegen.
 */

export type NodeKind = 'book' | 'area' | 'section';

export const NODE_KINDS: NodeKind[] = ['book', 'area', 'section'];

export const KIND_LABEL: Record<NodeKind, string> = {
  book: 'Book',
  area: 'Bereich',
  section: 'Abschnitt',
};

/** So tief dürfen Ordner reichen, das Book mitgezählt (Book › 6 Bereiche › Abschnitt). */
export const MAX_NODE_DEPTH = 8;

/**
 * Darf ein Knoten dieser Art unter `parentKind` hängen? `null` = oberste
 * Ebene. Nur Books stehen oben. Books und Bereiche nehmen Bereiche und
 * Abschnitte auf, Abschnitte keine Ordner mehr.
 */
export function canHoldNode(parentKind: NodeKind | null, kind: NodeKind): boolean {
  if (kind === 'book') return parentKind === null;
  if (parentKind === null) return false;
  return parentKind !== 'section';
}

type TreeNode = { id: string; parentId: string | null };

/** Ebene eines Knotens: Book = 1. */
export function nodeDepth(nodes: TreeNode[], id: string): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
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

/** Wie viele Ebenen ein Knoten samt allem darunter belegt (ohne Unterordner: 1). */
export function subtreeHeight(nodes: TreeNode[], id: string): number {
  const kids = nodes.filter((n) => n.parentId === id);
  return 1 + (kids.length ? Math.max(...kids.map((k) => subtreeHeight(nodes, k.id))) : 0);
}

/** Passt `id` samt Unterordnern unter `parentId` (null = ganz oben), ohne zu tief zu werden? */
export function fitsDepth(nodes: TreeNode[], id: string, parentId: string | null, extraLevels = 0): boolean {
  const base = parentId ? nodeDepth(nodes, parentId) : 0;
  return base + extraLevels + subtreeHeight(nodes, id) <= MAX_NODE_DEPTH;
}

/**
 * Umwandeln: Bereich ↔ Abschnitt, Bereich oder Abschnitt → Book. Liefert
 * den Grund, wenn es nicht geht, sonst null.
 *   area → section: nur ohne Unterordner – ein Abschnitt enthält nur Lernthemen
 *   → book: wandert dabei ganz nach oben
 *   book → …: nicht hier, ein Book hat keinen Platz darüber
 */
export function cannotConvert(kind: NodeKind, to: NodeKind, hasChildNodes: boolean): string | null {
  if (kind === to) return 'Das ist es schon.';
  if (kind === 'book') return 'Ein Book lässt sich nicht umwandeln – stattdessen seinen Inhalt verschieben.';
  if (to === 'section' && hasChildNodes) {
    return 'Ein Abschnitt enthält nur Lernthemen. Bitte zuerst die Bereiche und Abschnitte darin woandershin verschieben.';
  }
  return null;
}

/** Lernthemen dürfen in jedem Knoten liegen, ohne Knoten stehen sie unter „Unsortiert“. */
export function canHoldTopic(_parentKind: NodeKind | null): boolean {
  return true;
}

/**
 * Fügt `id` an Position `index` in die Geschwisterliste ein (vorher entfernt,
 * falls sie schon drin war) und liefert die neue Reihenfolge. Ein Index
 * außerhalb der Liste hängt hinten an.
 */
export function insertAt(siblingIds: string[], id: string, index?: number | null): string[] {
  const rest = siblingIds.filter((x) => x !== id);
  const at = index === undefined || index === null || index < 0 || index > rest.length ? rest.length : index;
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * Erstbefüllung aus den Tags: Ein Book je Themengebiet, darin ein Bereich je
 * Tag dieses Gebiets, darin die Lernthemen. Ein Thema, das nur das
 * Themengebiet selbst trägt, liegt direkt im Book.
 *
 * Jedes Thema hat genau einen Platz: Bei mehreren Gebieten zählt das
 * alphabetisch erste, darin der alphabetisch erste passende Tag. Themen ohne
 * Gebiet bleiben unsortiert. Books und Bereiche alphabetisch, Themen zuletzt
 * geänderte zuerst – wie in der bisherigen Liste.
 */
export function initialStructure(
  topics: Array<{ id: string; tagIds?: string[] | null; updatedAt?: Date | string }>,
  tags: Array<{ id: string; name: string; isArea?: boolean; areaIds?: string[] | null }>,
): {
  books: Array<{ tagId: string; title: string; topicIds: string[]; areas: Array<{ tagId: string; title: string; topicIds: string[] }> }>;
  unsorted: string[];
} {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'de');

  const placeOf = (topic: { tagIds?: string[] | null }) => {
    const own = (topic.tagIds || []).map((id) => byId.get(id)).filter(Boolean) as typeof tags;
    const areas = new Set<string>();
    for (const tag of own) {
      if (tag.isArea) areas.add(tag.id);
      else for (const a of tag.areaIds || []) if (byId.get(a)?.isArea) areas.add(a);
    }
    const area = [...areas].map((id) => byId.get(id)!).sort(byName)[0];
    if (!area) return null;
    const sub = own.filter((t) => !t.isArea && (t.areaIds || []).includes(area.id)).sort(byName)[0] || null;
    return { area, sub };
  };

  const time = (t: { updatedAt?: Date | string }) => (t.updatedAt ? new Date(t.updatedAt).getTime() || 0 : 0);
  const ordered = [...topics].sort((a, b) => time(b) - time(a));

  type Book = { tagId: string; title: string; topicIds: string[]; areas: Map<string, { tagId: string; title: string; topicIds: string[] }> };
  const books = new Map<string, Book>();
  const unsorted: string[] = [];
  for (const topic of ordered) {
    const place = placeOf(topic);
    if (!place) { unsorted.push(topic.id); continue; }
    if (!books.has(place.area.id)) books.set(place.area.id, { tagId: place.area.id, title: place.area.name, topicIds: [], areas: new Map() });
    const book = books.get(place.area.id)!;
    if (!place.sub) { book.topicIds.push(topic.id); continue; }
    if (!book.areas.has(place.sub.id)) book.areas.set(place.sub.id, { tagId: place.sub.id, title: place.sub.name, topicIds: [] });
    book.areas.get(place.sub.id)!.topicIds.push(topic.id);
  }
  return {
    books: [...books.values()]
      .sort((a, b) => a.title.localeCompare(b.title, 'de'))
      .map((b) => ({ ...b, areas: [...b.areas.values()].sort((x, y) => x.title.localeCompare(y.title, 'de')) })),
    unsorted,
  };
}

/**
 * Geerbte Tags eines Lernthemas: Es erhält die Tags aller Knoten über ihm.
 *
 * `own` sind die Tags am Thema, `previous` die zuletzt geerbten (am Platz
 * gemerkt). Zurück kommen die neuen Tags des Themas und was davon geerbt ist.
 * Ein Tag, den das Thema schon selbst trägt, gilt nicht als geerbt – er
 * bleibt also, wenn das Thema woanders hinwandert.
 */
export function inheritTags(own: string[] | null | undefined, previous: string[] | null | undefined, wanted: string[]) {
  const before = new Set(previous || []);
  const base = (own || []).filter((id) => !before.has(id));
  const baseSet = new Set(base);
  const added = [...new Set(wanted)].filter((id) => !baseSet.has(id));
  return { tagIds: [...base, ...added], inherited: added };
}

/** Alle Knoten-IDs unterhalb von `rootId` (einschließlich). */
export function subtreeIds(nodes: Array<{ id: string; parentId: string | null }>, rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parentId && out.has(n.parentId) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}
