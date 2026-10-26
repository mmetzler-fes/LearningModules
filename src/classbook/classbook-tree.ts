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
