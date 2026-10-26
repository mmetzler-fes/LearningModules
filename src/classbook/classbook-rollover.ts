/**
 * Klassennotizbuch beim Schuljahreswechsel (docs/klassennotizbuch.md) – ohne
 * Datenbank (classbook-rollover.spec.ts). Die neue Klasse bekommt Struktur,
 * klasseneigene Lernthemen und Zuweisungen; ausgeschaltet, bis die Lehrkraft
 * im neuen Jahr einschaltet.
 */

export interface SelectionEntry {
  topicId: string;
  all: boolean;
  moduleIds?: string[];
}

/** Auswahl eines Klassenlinks ausschalten; Lernthemen auf ihre neuen IDs. */
export function switchedOff(selection: SelectionEntry[] | null | undefined, topicIds: Map<string, string> = new Map()): SelectionEntry[] {
  return (selection || []).map((e) => ({ topicId: topicIds.get(e.topicId) || e.topicId, all: false, moduleIds: [] }));
}

interface NodeRow { id: string; kind: 'area' | 'section'; title: string; parentId: string | null; orderIndex: number }
interface PlaceRow { id: string; nodeId: string | null; orderIndex: number }
interface ModuleRow { id: string; topicId: string; parentId?: string | null; [k: string]: any }

/**
 * Kopie für die neue Klasse (ohne „Links mitnehmen“): Bereiche/Abschnitte mit
 * neuen IDs, klasseneigene Lernthemen samt Modulen (Submodule hängen an der
 * Kopie ihres Elternmoduls), Zuweisungen als ausgeschaltete Kopien ohne
 * Link-Schlüssel, je auf dem entsprechenden Platz. `newId` liefert IDs.
 */
export function planCopy(input: {
  nodes: NodeRow[];
  places: PlaceRow[];
  topics: Array<{ id: string; [k: string]: any }>;
  modules: ModuleRow[];
  links: Array<{ id: string; selection?: SelectionEntry[] | null; [k: string]: any }>;
  newId: () => string;
  /** Welche Zuweisungen ausgeschaltet werden (Vorgabe: alle) – reine Klassenarbeiten stehen nicht im Baum. */
  switchOff?: (link: { selection?: SelectionEntry[] | null; [k: string]: any }) => boolean;
}) {
  const off = input.switchOff || (() => true);
  const nodeIds = new Map(input.nodes.map((n) => [n.id, input.newId()]));
  const topicIds = new Map(input.topics.map((t) => [t.id, input.newId()]));
  const moduleIds = new Map(input.modules.map((m) => [m.id, input.newId()]));
  const linkIds = new Map(input.links.map((l) => [l.id, input.newId()]));
  const placeOf = new Map(input.places.map((p) => [p.id, p]));
  return {
    nodes: input.nodes.map((n) => ({ ...n, id: nodeIds.get(n.id)!, parentId: n.parentId ? nodeIds.get(n.parentId) ?? null : null })),
    topics: input.topics.map((t) => ({ ...t, id: topicIds.get(t.id)! })),
    modules: input.modules.map((m) => ({
      ...m, id: moduleIds.get(m.id)!, topicId: topicIds.get(m.topicId) || m.topicId,
      parentId: m.parentId ? moduleIds.get(m.parentId) ?? null : null,
    })),
    links: input.links.map((l) => ({
      ...l, id: linkIds.get(l.id)!,
      selection: off(l) ? switchedOff(l.selection, topicIds) : (l.selection || []).map((e) => ({ ...e, topicId: topicIds.get(e.topicId) || e.topicId })),
      token: null, examToken: null, contestHostToken: null, customized: true,
    })),
    places: input.links.filter((l) => placeOf.has(l.id)).map((l) => {
      const p = placeOf.get(l.id)!;
      return { id: linkIds.get(l.id)!, nodeId: p.nodeId ? nodeIds.get(p.nodeId) ?? null : null, orderIndex: p.orderIndex };
    }),
  };
}
