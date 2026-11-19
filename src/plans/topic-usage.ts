import { moduleOn, SelEntry } from '../classbook/classbook-rules';
import { PlanTreeNode, planOf, plansIncluding } from './plan-rules';

/**
 * „Wo steht das?“ für die Kopfzeile des Editors (Wunschliste: „📋 Verwendet in: BGY-J1, 2BFE1 |
 * 🟢 Freigeschaltet in: E2FS1“): Pfad im Notizbuch, Klassen, deren Klassennotizbuch das Lernthema
 * zugewiesen hat (mit „für Schüler an“), und Pläne. So sieht man beim Bearbeiten, wen eine Änderung trifft.
 */
export interface UsageModule {
  id: string;
  type?: string;
  parentId?: string | null;
  /** IDs der Quizze, die ein Dokument einbettet. */
  embeds?: string[];
}

export interface UsageInput {
  topicId: string;
  /** Nur für dieses Modul (Editor eines Moduls); sonst fürs ganze Lernthema. */
  moduleId?: string | null;
  /** ● im Lernnotizbuch – aus heißt für Schüler nirgends erreichbar. */
  topicOn: boolean;
  modules: UsageModule[];
  notebookNodes: Array<{
    id: string;
    title: string;
    parentId: string | null;
    kind: string;
  }>;
  placementNodeId: string | null;
  planNodes: PlanTreeNode[];
  planEntries: Array<{ nodeId: string; topicId: string }>;
  classLinks: Array<{
    id: string;
    classId: string | null;
    active: boolean;
    modes?: string[];
    selection?: SelEntry[] | null;
  }>;
  classes: Array<{ id: string; name: string; rolledOver?: string | null }>;
}

export interface TopicUsage {
  path: Array<{ kind: string; title: string }>;
  classes: Array<{ id: string; name: string; on: boolean }>;
  plans: Array<{ id: string; title: string }>;
}

export function topicUsage(input: UsageInput): TopicUsage {
  // Pfad: Book › Bereich › Abschnitt.
  const nbById = new Map(input.notebookNodes.map((n) => [n.id, n]));
  const path: TopicUsage['path'] = [];
  for (
    let cur = input.placementNodeId
      ? nbById.get(input.placementNodeId)
      : undefined;
    cur && path.length < 16;
    cur = cur.parentId ? nbById.get(cur.parentId) : undefined
  ) {
    path.unshift({ kind: cur.kind, title: cur.title });
  }

  // Ein Modul: direkt gewählt, oder ein Quiz in einem gewählten Dokument (kommt mit ihm).
  const subIds = (id: string) =>
    input.modules.filter((m) => m.parentId === id).map((m) => m.id);
  const rootOf = (id: string) => {
    const m = input.modules.find((x) => x.id === id);
    return m?.parentId || id;
  };
  const target = input.moduleId ? rootOf(input.moduleId) : null;
  const docsWith = target
    ? input.modules.filter(
        (m) => !m.parentId && (m.embeds || []).includes(target),
      )
    : [];
  const on = (entry: SelEntry | undefined) => {
    if (!entry) return false;
    if (!target) return entry.all || (entry.moduleIds || []).length > 0;
    return (
      moduleOn(entry, { id: target, subIds: subIds(target) }) ||
      docsWith.some((d) => moduleOn(entry, { id: d.id, subIds: subIds(d.id) }))
    );
  };

  const classes = new Map<string, { id: string; name: string; on: boolean }>();
  for (const link of input.classLinks) {
    const entry = (link.selection || []).find(
      (e) => e.topicId === input.topicId,
    );
    if (!entry || !link.classId) continue;
    // Nur die Klassenarbeit: steht nicht im Klassennotizbuch zum Üben.
    if (
      (link.modes || []).length &&
      (link.modes || []).every((m) => m === 'exam')
    )
      continue;
    const klasse = input.classes.find((c) => c.id === link.classId);
    // Vergangene Schuljahre (ins neue Jahr übernommen oder aufgelöst) zählen nicht mehr.
    if (!klasse || klasse.rolledOver) continue;
    const isOn = input.topicOn && link.active !== false && on(entry);
    const was = classes.get(klasse.id);
    classes.set(klasse.id, {
      id: klasse.id,
      name: klasse.name,
      on: !!was?.on || isOn,
    });
  }

  // Pläne, in denen das Lernthema steht – und Pläne, die einen davon als Teilplan einbinden.
  const plans = new Map<string, { id: string; title: string }>();
  for (const e of input.planEntries.filter(
    (x) => x.topicId === input.topicId,
  )) {
    const p = planOf(input.planNodes, e.nodeId);
    if (!p) continue;
    plans.set(p.id, { id: p.id, title: p.title || '' });
    for (const outer of plansIncluding(input.planNodes, p.id))
      plans.set(outer.id, { id: outer.id, title: outer.title || '' });
  }

  const byName = <T extends { name?: string; title?: string }>(a: T, b: T) =>
    String(a.name ?? a.title).localeCompare(String(b.name ?? b.title), 'de');
  return {
    path,
    classes: [...classes.values()].sort(byName),
    plans: [...plans.values()].sort(byName),
  };
}
