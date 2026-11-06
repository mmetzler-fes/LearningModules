/**
 * Regeln der Planungsebene ohne Datenbank (plan-rules.spec.ts), siehe docs/planung.md.
 *
 * Ordner (Bildungsgang, Beruf …) → Plan → Bereiche und Abschnitte → Lernthemen.
 * Ordner nehmen Ordner und Pläne auf. In einem Plan geht es zu wie im
 * Klassennotizbuch: Bereiche nehmen Bereiche und Abschnitte auf, Abschnitte
 * nur Lernthemen. Ein Teilplan-Verweis (`include`) bindet einen anderen Plan an
 * seiner Stelle ein; er steht wie ein Bereich, hat aber keinen eigenen Inhalt.
 */

export type PlanKind = 'folder' | 'plan' | 'area' | 'section' | 'include';

export const PLAN_KINDS: PlanKind[] = ['folder', 'plan', 'area', 'section', 'include'];

export const PLAN_KIND_LABEL: Record<PlanKind, string> = {
  folder: 'Ordner',
  plan: 'Plan',
  area: 'Bereich',
  section: 'Abschnitt',
  include: 'Teilplan',
};

/** Ebenen unter einem Plan – wie im Klassennotizbuch (MAX_CLASS_DEPTH), dorthin wird er übertragen. */
export const MAX_IN_PLAN = 7;

/** Ordner höchstens so tief geschachtelt. */
export const MAX_FOLDER_DEPTH = 6;

export interface PlanTreeNode {
  id: string;
  kind: PlanKind;
  parentId: string | null;
  orderIndex: number;
  title?: string;
  refId?: string | null;
}

export interface PlanTreeEntry {
  id: string;
  nodeId: string;
  topicId: string;
  orderIndex: number;
}

/** Darf ein Knoten dieser Art hier hinein? `null` = oberste Ebene. */
export function canHoldPlanNode(parentKind: PlanKind | null, kind: PlanKind): boolean {
  if (kind === 'folder' || kind === 'plan') return parentKind === null || parentKind === 'folder';
  return parentKind === 'plan' || parentKind === 'area';
}

/** Lernthemen stehen in Plänen, Bereichen und Abschnitten – nicht in Ordnern und Teilplan-Verweisen. */
export function canHoldTopic(kind: PlanKind | null): boolean {
  return kind === 'plan' || kind === 'area' || kind === 'section';
}

function byIdOf(nodes: PlanTreeNode[]) {
  return new Map(nodes.map((n) => [n.id, n]));
}

/** Der Knoten und seine Vorfahren, von ihm nach oben. */
export function pathUp(nodes: PlanTreeNode[], id: string | null): PlanTreeNode[] {
  const byId = byIdOf(nodes);
  const out: PlanTreeNode[] = [];
  for (let cur = id ? byId.get(id) : undefined; cur && out.length < 64; cur = cur.parentId ? byId.get(cur.parentId) : undefined) out.push(cur);
  return out;
}

/** Plan, in dem ein Knoten liegt (er selbst, wenn er einer ist); null in Ordnern. */
export function planOf(nodes: PlanTreeNode[], id: string | null): PlanTreeNode | null {
  return pathUp(nodes, id).find((n) => n.kind === 'plan') || null;
}

/** Alle Knoten-IDs unterhalb von `rootId` (einschließlich). */
export function planSubtree(nodes: PlanTreeNode[], rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) if (n.parentId && out.has(n.parentId) && !out.has(n.id)) { out.add(n.id); grew = true; }
  }
  return out;
}

/** Pläne, die ein Plan direkt einbindet. */
export function directIncludes(nodes: PlanTreeNode[], planId: string): string[] {
  const inside = planSubtree(nodes, planId);
  return nodes.filter((n) => n.kind === 'include' && inside.has(n.id) && n.refId).map((n) => n.refId!);
}

/** Bindet `planId` den Plan `targetId` ein, direkt oder über Teilpläne? */
export function includesPlan(nodes: PlanTreeNode[], planId: string, targetId: string): boolean {
  const seen = new Set<string>();
  const stack = [planId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const ref of directIncludes(nodes, cur)) {
      if (ref === targetId) return true;
      stack.push(ref);
    }
  }
  return false;
}

/** Darf der Plan `refId` in den Plan `intoPlanId`? Fehlermeldung oder null. */
export function includeError(nodes: PlanTreeNode[], intoPlanId: string, refId: string): string | null {
  if (refId === intoPlanId) return 'Ein Plan kann sich nicht selbst einbinden.';
  if (includesPlan(nodes, refId, intoPlanId)) return 'Das ergäbe einen Kreis: Der Teilplan bindet diesen Plan schon ein.';
  return null;
}

/** Ebenen innerhalb des Plans bis einschließlich `id` (direkt im Plan = 1, der Plan selbst = 0). */
export function depthInPlan(nodes: PlanTreeNode[], id: string): number {
  const up = pathUp(nodes, id);
  const i = up.findIndex((n) => n.kind === 'plan');
  return i < 0 ? 0 : i;
}

function heightOf(nodes: PlanTreeNode[], id: string): number {
  const kids = nodes.filter((n) => n.parentId === id);
  return 1 + (kids.length ? Math.max(...kids.map((k) => heightOf(nodes, k.id))) : 0);
}

/** Ordner-Tiefe (oberste Ebene = 1) bis zu diesem Ordner. */
function folderDepth(nodes: PlanTreeNode[], id: string | null): number {
  return pathUp(nodes, id).filter((n) => n.kind === 'folder').length;
}

/** Fehlermeldung, wenn `kind` nicht unter `parentId` passt, sonst null. */
export function placeError(nodes: PlanTreeNode[], kind: PlanKind, parentId: string | null): string | null {
  const parent = parentId ? nodes.find((n) => n.id === parentId) || null : null;
  if (parentId && !parent) return 'Ziel nicht gefunden.';
  if (!canHoldPlanNode(parent?.kind ?? null, kind)) {
    if (kind === 'folder' || kind === 'plan') return `Ein ${PLAN_KIND_LABEL[kind]} gehört in einen Ordner oder ganz nach oben.`;
    if (parent?.kind === 'section') return 'Ein Abschnitt enthält nur Lernthemen.';
    return `Ein ${PLAN_KIND_LABEL[kind]} gehört in einen Plan oder Bereich.`;
  }
  if (kind === 'folder' && folderDepth(nodes, parentId) + 1 > MAX_FOLDER_DEPTH) return `Höchstens ${MAX_FOLDER_DEPTH} Ordner-Ebenen.`;
  if (kind !== 'folder' && kind !== 'plan' && parentId && depthInPlan(nodes, parentId) + 1 > MAX_IN_PLAN) return `Höchstens ${MAX_IN_PLAN} Ebenen in einem Plan.`;
  return null;
}

/**
 * Wohin darf ein vorhandener Knoten? Nicht in sich selbst, nur wo seine Art
 * passt, nicht zu tief; ein Bereich mit Teilplänen nicht in einen Plan, den
 * einer dieser Teilpläne einbindet.
 */
export function planMoveError(nodes: PlanTreeNode[], id: string, parentId: string | null): string | null {
  const node = nodes.find((n) => n.id === id);
  if (!node) return 'Eintrag nicht gefunden.';
  if (parentId && planSubtree(nodes, id).has(parentId)) return 'Das kann nicht in sich selbst liegen.';
  const others = nodes.filter((n) => n.id !== id);
  const why = placeError(others, node.kind, parentId);
  if (why) return why;
  if (node.kind === 'folder') {
    const deepest = Math.max(1, ...[...planSubtree(nodes, id)].map((x) => folderDepth(nodes, x) - folderDepth(nodes, node.parentId)));
    if (folderDepth(nodes, parentId) + deepest > MAX_FOLDER_DEPTH) return `Höchstens ${MAX_FOLDER_DEPTH} Ordner-Ebenen.`;
    return null;
  }
  if (node.kind === 'plan') return null;
  if (parentId && depthInPlan(nodes, parentId) + heightOf(nodes, id) > MAX_IN_PLAN) return `Höchstens ${MAX_IN_PLAN} Ebenen in einem Plan.`;
  const target = planOf(nodes, parentId);
  if (target && target.id !== planOf(nodes, id)?.id) {
    const inside = planSubtree(nodes, id);
    for (const inc of nodes.filter((n) => n.kind === 'include' && inside.has(n.id) && n.refId)) {
      const err = includeError(nodes, target.id, inc.refId!);
      if (err) return err;
    }
  }
  return null;
}

/** Ein Eintrag des ausgerollten Plans: Bereich/Abschnitt mit Inhalt oder Lernthema. */
export type PlanItem =
  | { type: 'node'; key: string; kind: 'area' | 'section'; title: string; children: PlanItem[]; include?: string }
  | { type: 'topic'; topicId: string };

/**
 * Plan ausrollen, wie ihn eine Klasse bekommt: Bereiche und Abschnitte vor
 * den Lernthemen desselben Knotens (wie im Klassennotizbuch), Teilpläne als
 * Bereich mit ihrem Inhalt. Jedes Lernthema nur einmal, das erste gewinnt.
 * `key` bleibt über Änderungen gleich: die Knoten-ID, in einem Teilplan mit
 * dem Weg der Teilplan-Verweise davor (`<include>/<knoten>`).
 */
export function expandPlan(nodes: PlanTreeNode[], entries: PlanTreeEntry[], planId: string): PlanItem[] {
  const used = new Set<string>();
  const sorted = <T extends { orderIndex: number }>(xs: T[]) => [...xs].sort((a, b) => a.orderIndex - b.orderIndex);
  const walk = (parentId: string, prefix: string, stack: string[], depth: number): PlanItem[] => {
    const out: PlanItem[] = [];
    for (const n of sorted(nodes.filter((x) => x.parentId === parentId))) {
      const key = prefix + n.id;
      if (n.kind === 'include') {
        if (!n.refId || stack.includes(n.refId)) continue;
        const ref = nodes.find((x) => x.id === n.refId && x.kind === 'plan');
        if (!ref) continue;
        const children = depth < MAX_IN_PLAN ? walk(ref.id, `${key}/`, [...stack, ref.id], depth + 1) : [];
        out.push({ type: 'node', key, kind: 'area', title: n.title || ref.title || 'Teilplan', children, include: ref.id });
      } else if (n.kind === 'area' || n.kind === 'section') {
        out.push({ type: 'node', key, kind: n.kind, title: n.title || '', children: depth < MAX_IN_PLAN ? walk(n.id, prefix, stack, depth + 1) : [] });
      }
    }
    for (const e of sorted(entries.filter((x) => x.nodeId === parentId))) {
      if (used.has(e.topicId)) continue;
      used.add(e.topicId);
      out.push({ type: 'topic', topicId: e.topicId });
    }
    return out;
  };
  return walk(planId, '', [planId], 0);
}

/** Alle Lernthemen eines ausgerollten Plans, in Reihenfolge. */
export function planTopicIds(items: PlanItem[]): string[] {
  return items.flatMap((i) => (i.type === 'topic' ? [i.topicId] : planTopicIds(i.children)));
}

/** Pläne, die `planId` als Teilplan einbinden (direkt). */
export function plansIncluding(nodes: PlanTreeNode[], planId: string): PlanTreeNode[] {
  const out = new Map<string, PlanTreeNode>();
  for (const inc of nodes.filter((n) => n.kind === 'include' && n.refId === planId)) {
    const p = planOf(nodes, inc.id);
    if (p) out.set(p.id, p);
  }
  return [...out.values()];
}
