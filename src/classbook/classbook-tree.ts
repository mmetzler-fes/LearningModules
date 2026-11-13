/**
 * Baum des Klassennotizbuchs ohne Datenbank (classbook-tree.spec.ts): Bereiche
 * und Abschnitte wie im Notizbuch, darin die Zuweisungen (Lernthemen).
 * Siehe docs/klassennotizbuch.md.
 */

export type ClassNodeKind = 'area' | 'section';

export interface TreeNode {
  id: string;
  kind: ClassNodeKind;
  parentId: string | null;
  orderIndex: number;
}

export interface TreeEntry {
  id: string;
  nodeId: string | null;
  orderIndex: number;
}

/** Eine Zuweisung mit ihren Themen und Modulen, für `leavesInOrder`. */
export interface TreeLink extends TreeEntry {
  topics: Array<{ topicId: string; moduleIds: string[] }>;
}

/** Ein Lernmodul, erreicht über eine bestimmte Zuweisung und ihr Lernthema. */
export interface LeafRef {
  linkId: string;
  topicId: string;
  moduleId: string;
}

/**
 * Wo die Klasse gerade ist – auf jeder Ebene, nicht mehr nur an einem Modul.
 * Strukturell dasselbe wie `ClassNotebookMarker` (core/entities/class-notebook.entity.ts),
 * hier lokal definiert, damit dieses Modul ohne Datenbank-Importe bleibt.
 */
export type MarkerAnchor =
  | { level: 'root' }
  | { level: 'node'; nodeId: string }
  | { level: 'link'; linkId: string }
  | { level: 'topic'; linkId: string; topicId: string }
  | { level: 'module'; linkId: string; topicId: string; moduleId: string };

/**
 * Alte, vor der Mehrebenen-Erweiterung gespeicherte Marker haben kein `level`
 * – als Modul-Marker lesen. `null`/leer bleibt `null`.
 */
export function normalizeMarker(raw: any): MarkerAnchor | null {
  if (!raw) return null;
  if (raw.level) return raw;
  if (raw.linkId && raw.topicId && raw.moduleId) return { level: 'module', linkId: raw.linkId, topicId: raw.topicId, moduleId: raw.moduleId };
  return null;
}

/**
 * Aus dem Notizbuch übernommene Bereiche, deren Quelle dort gelöscht ist und in denen nichts mehr liegt –
 * auch nicht in Unterbereichen. Selbst angelegte Bereiche bleiben immer stehen.
 */
export function deadMirrorNodes(
  nodes: Array<{ id: string; parentId: string | null; sourceNodeId?: string | null }>,
  occupied: ReadonlySet<string>,
  sourceAlive: (sourceNodeId: string) => boolean,
): Set<string> {
  const isDead = (node: { id: string; sourceNodeId?: string | null }): boolean =>
    !!node.sourceNodeId && !sourceAlive(node.sourceNodeId) && !occupied.has(node.id)
    && nodes.filter((n) => n.parentId === node.id).every(isDead);
  return new Set(nodes.filter(isDead).map((n) => n.id));
}

/** Wie im Notizbuch: höchstens so viele Ebenen unter der Klasse. */
export const MAX_CLASS_DEPTH = 7;

/** Darf ein Bereich/Abschnitt hier hinein? Oben und in Bereichen ja, in Abschnitten nicht (die enthalten nur Lernthemen). */
export function canHoldNode(parent: TreeNode | null): boolean {
  return !parent || parent.kind === 'area';
}

/** Tiefe eines Knotens (oberste Ebene = 1). */
export function depthOf(nodes: TreeNode[], id: string | null): number {
  let d = 0;
  for (let cur = id ? nodes.find((n) => n.id === id) : undefined; cur && d < 100; cur = cur.parentId ? nodes.find((n) => n.id === cur!.parentId) : undefined) d++;
  return d;
}

/** Liegt `id` in `ancestorId` (oder ist es selbst)? */
export function isInside(nodes: TreeNode[], id: string | null, ancestorId: string): boolean {
  for (let cur = id ? nodes.find((n) => n.id === id) : undefined, i = 0; cur && i < 100; cur = cur.parentId ? nodes.find((n) => n.id === cur!.parentId) : undefined, i++) {
    if (cur.id === ancestorId) return true;
  }
  return false;
}

/** Ein Knoten und alle seine Vorfahren, von ihm selbst nach oben – zum Aufklappen entlang eines Pfads. */
export function ancestorsOf(nodes: TreeNode[], nodeId: string | null): string[] {
  const out: string[] = [];
  for (let cur = nodeId ? nodes.find((n) => n.id === nodeId) : undefined, i = 0; cur && i < MAX_CLASS_DEPTH + 1; cur = cur.parentId ? nodes.find((n) => n.id === cur!.parentId) : undefined, i++) {
    out.push(cur.id);
  }
  return out;
}

/** Tiefe des Unterbaums unter einem Knoten (er selbst = 1). */
function heightOf(nodes: TreeNode[], id: string): number {
  const kids = nodes.filter((n) => n.parentId === id);
  return 1 + (kids.length ? Math.max(...kids.map((k) => heightOf(nodes, k.id))) : 0);
}

/**
 * Wohin darf ein Knoten? Fehlermeldung oder null. Nicht in sich selbst, nicht
 * in einen Abschnitt, nicht tiefer als erlaubt.
 */
export function nodeMoveError(nodes: TreeNode[], id: string, parentId: string | null): string | null {
  const parent = parentId ? nodes.find((n) => n.id === parentId) || null : null;
  if (parentId && !parent) return 'Ziel nicht gefunden.';
  if (parentId && isInside(nodes, parentId, id)) return 'Ein Bereich kann nicht in sich selbst liegen.';
  if (!canHoldNode(parent)) return 'Ein Abschnitt enthält nur Lernthemen.';
  if (depthOf(nodes, parentId) + heightOf(nodes, id) > MAX_CLASS_DEPTH) return `Höchstens ${MAX_CLASS_DEPTH} Ebenen.`;
  return null;
}

/**
 * Reihenfolge unter einem Elternteil neu: `item` an `index` (leer = ans Ende),
 * die übrigen in ihrer Reihenfolge. Liefert id → orderIndex für alle Geschwister.
 */
export function reorder<T extends { id: string; orderIndex: number }>(siblings: T[], itemId: string, index: number | null | undefined): Map<string, number> {
  const rest = siblings.filter((s) => s.id !== itemId).sort((a, b) => a.orderIndex - b.orderIndex).map((s) => s.id);
  const at = index === null || index === undefined || index < 0 || index > rest.length ? rest.length : index;
  rest.splice(at, 0, itemId);
  return new Map(rest.map((id, i) => [id, i]));
}

/**
 * Knoten löschen: Was darin liegt (Bereiche, Abschnitte, Lernthemen), rückt eine
 * Ebene höher ans Ende. Liefert die Änderungen.
 */
export function dissolve(nodes: TreeNode[], entries: TreeEntry[], id: string) {
  const node = nodes.find((n) => n.id === id);
  if (!node) return { nodes: [] as Array<{ id: string; parentId: string | null; orderIndex: number }>, entries: [] as Array<{ id: string; nodeId: string | null; orderIndex: number }> };
  const up = node.parentId;
  const nodeBase = Math.max(-1, ...nodes.filter((n) => n.parentId === up && n.id !== id).map((n) => n.orderIndex)) + 1;
  const entryBase = Math.max(-1, ...entries.filter((e) => e.nodeId === up).map((e) => e.orderIndex)) + 1;
  return {
    nodes: nodes.filter((n) => n.parentId === id).sort((a, b) => a.orderIndex - b.orderIndex)
      .map((n, i) => ({ id: n.id, parentId: up, orderIndex: nodeBase + i })),
    entries: entries.filter((e) => e.nodeId === id).sort((a, b) => a.orderIndex - b.orderIndex)
      .map((e, i) => ({ id: e.id, nodeId: up, orderIndex: entryBase + i })),
  };
}

/**
 * Für Schüler ausgeblendete Knoten: selbst ausgeblendet (`studentHidden`)
 * oder unter einem ausgeblendeten Bereich.
 */
export function veiledNodeIds(nodes: Array<TreeNode & { studentHidden?: boolean }>): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const veiled = new Set<string>();
  for (const n of nodes) {
    // Den Weg nach oben gehen (höchstens so tief wie erlaubt – schützt vor Kreisen).
    let cur: (TreeNode & { studentHidden?: boolean }) | undefined = n;
    for (let depth = 0; cur && depth <= MAX_CLASS_DEPTH + 1; depth++) {
      if (cur.studentHidden) { veiled.add(n.id); break; }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return veiled;
}

/**
 * Alle Lernmodule unter einem Anker (Buch = Wurzel, Bereich/Abschnitt,
 * Zuweisung, Lernthema oder Modul) in Dokumentreihenfolge: Unterknoten vor den
 * direkten Zuweisungen desselben Knotens, Themen und Module in ihrer
 * gespeicherten Reihenfolge – wie Schüler und Lehrkraft den Baum sehen
 * (classbook-student.js: level(), class-results.js: _level()).
 */
export function leavesInOrder(nodes: TreeNode[], links: TreeLink[], anchor: MarkerAnchor): LeafRef[] {
  const leavesOfLink = (l: TreeLink): LeafRef[] => l.topics.flatMap((t) => t.moduleIds.map((moduleId) => ({ linkId: l.id, topicId: t.topicId, moduleId })));

  const under = (parentId: string | null): LeafRef[] => {
    const childNodes = nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.orderIndex - b.orderIndex);
    const direct = links.filter((l) => l.nodeId === parentId).sort((a, b) => a.orderIndex - b.orderIndex);
    return [...childNodes.flatMap((n) => under(n.id)), ...direct.flatMap(leavesOfLink)];
  };

  if (anchor.level === 'root') return under(null);
  if (anchor.level === 'node') return under(anchor.nodeId);
  if (anchor.level === 'link') {
    const link = links.find((l) => l.id === anchor.linkId);
    return link ? leavesOfLink(link) : [];
  }
  if (anchor.level === 'topic') {
    const link = links.find((l) => l.id === anchor.linkId);
    const topic = link?.topics.find((t) => t.topicId === anchor.topicId);
    return topic ? topic.moduleIds.map((moduleId) => ({ linkId: anchor.linkId, topicId: anchor.topicId, moduleId })) : [];
  }
  // 'module': nur, wenn es im Baum auch wirklich (noch) da ist – sonst verschwindet der Merker stillschweigend.
  const link = links.find((l) => l.id === anchor.linkId);
  const topic = link?.topics.find((t) => t.topicId === anchor.topicId);
  return topic?.moduleIds.includes(anchor.moduleId) ? [{ linkId: anchor.linkId, topicId: anchor.topicId, moduleId: anchor.moduleId }] : [];
}

/**
 * Gemeinsamer Anfang mehrerer Pfade: wohin ein Link über mehrere Lernthemen
 * gehört. Liegen sie in verschiedenen Zweigen, ist es die letzte gemeinsame Ebene.
 */
/**
 * Reihenfolge nach `key` (z. B. Platz im Notizbuch), aber nur unter den Einträgen
 * mit Schlüssel: Sie tauschen ihre Plätze untereinander, Einträge ohne Schlüssel
 * (klasseneigene, selbst angelegte) bleiben, wo sie sind.
 */
export function slotSort<T extends { orderIndex: number }>(items: T[], key: (x: T) => number | null): T[] {
  const cur = [...items].sort((a, b) => a.orderIndex - b.orderIndex);
  const keyed = cur.filter((x) => key(x) !== null).sort((a, b) => key(a)! - key(b)!);
  let k = 0;
  return cur.map((x) => (key(x) !== null ? keyed[k++] : x));
}

export function commonPath<T>(paths: T[][]): T[] {
  if (!paths.length) return [];
  const [first, ...rest] = paths;
  let n = first.length;
  for (const p of rest) {
    let i = 0;
    while (i < n && i < p.length && p[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n);
}

/** 🔗 Eigener Link auf einen Teil des Klassennotizbuchs: ein Bereich/Abschnitt mit allem darunter oder eine Zuweisung. */
export type ClassbookScope = { nodeId: string; title: string } | { linkId: string; title: string };

/**
 * Teilbaum für einen eigenen Link (`ClassbookScope`): nur die Knoten darunter –
 * der Bereich selbst rückt an die oberste Ebene – und nur die Zuweisungen darin.
 * Ohne Bereich (`null`) bleibt alles, wie es ist.
 */
export function scopeTree<N extends TreeNode, L extends { id: string }, P extends { nodeId: string | null }>(
  scope: ClassbookScope | null,
  nodes: N[],
  placeOf: Map<string, P>,
  links: L[],
): { nodes: N[]; placeOf: Map<string, P>; links: L[]; inScope: (linkId: string) => boolean } {
  if (!scope) return { nodes, placeOf, links, inScope: () => true };
  if ('linkId' in scope) {
    const inScope = (id: string) => id === scope.linkId;
    const own = placeOf.get(scope.linkId);
    // Die Zuweisung allein steht oben.
    const places = new Map(own ? [[scope.linkId, { ...own, nodeId: null }]] : []);
    return { nodes: [], placeOf: places, links: links.filter((l) => inScope(l.id)), inScope };
  }
  const ids = new Set<string>(nodes.some((n) => n.id === scope.nodeId) ? [scope.nodeId] : []);
  for (let grew = true; grew;) {
    grew = false;
    for (const n of nodes) if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) { ids.add(n.id); grew = true; }
  }
  const inScope = (id: string) => { const nodeId = placeOf.get(id)?.nodeId; return !!nodeId && ids.has(nodeId); };
  return {
    nodes: nodes.filter((n) => ids.has(n.id)).map((n) => (n.id === scope.nodeId ? { ...n, parentId: null } : n)),
    placeOf,
    links: links.filter((l) => inScope(l.id)),
    inScope,
  };
}
