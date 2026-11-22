/**
 * Ein Lernthema enthält höchstens ein Dokument (Dokument, Arbeitsblatt oder Anhang). Mappen mit
 * mehreren Dokumenten entstehen nicht mehr: Kommt ein weiteres Dokument hinzu – beim Anlegen, beim
 * Import, beim Duplizieren –, bekommt es ein eigenes Lernthema direkt hinter dem bisherigen. Das neue
 * Lernthema erbt, was die Lehrkraft dort eingestellt hat: Platz im Notizbuch und in der Planung,
 * Freigabe (●, 🔒), Tags, Kategorien, Mitarbeit und die Links, die das ganze Lernthema freigeben.
 *
 * Klasseneigene Lernthemen (Klassennotizbuch) bleiben außen vor – sie haben eigene Regeln.
 */
import * as crypto from 'crypto';
import { EntityManager, In } from 'typeorm';
import { embeddedQuizIds } from '../core/public/student-view';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { PlanEntry } from '../core/entities/plan-entry.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { DOC_TYPES } from './sole-document';

type Mod = { id: string; type?: string | null; parentId?: string | null; content?: any };

/** Dokument, Arbeitsblatt oder Anhang auf oberster Ebene. */
export function isRootDoc(m: Mod | null | undefined): boolean {
  return !!m && !m.parentId && DOC_TYPES.has(m.type || '');
}

/** Hat das Lernthema schon ein Dokument (ohne die Module in `except`)? */
export function hasDocument(modules: Mod[] | null | undefined, except: ReadonlySet<string> = new Set()): boolean {
  return (modules || []).some((m) => isRootDoc(m) && !except.has(m.id));
}

/**
 * Module eines Imports nach Dokumenten aufteilen: je Dokument eine Gruppe mit den Quizzen, die es
 * einbettet (ein Quiz in mehreren Dokumenten bleibt beim ersten), samt Untermodulen. `loose`: Quizze
 * und Übungen, die kein Dokument einbettet. Die Reihenfolge bleibt erhalten.
 */
export function groupByDocument<M extends Mod>(modules: M[]): { groups: M[][]; loose: M[] } {
  const roots = modules.filter((m) => !m.parentId);
  const docs = roots.filter(isRootDoc);
  const home = new Map<string, number>(); // Wurzelmodul-ID → Gruppe
  docs.forEach((d, i) => home.set(d.id, i));
  docs.forEach((d, i) => {
    for (const q of embeddedQuizIds(d as any)) {
      const quiz = roots.find((m) => m.id === q);
      if (quiz && !isRootDoc(quiz) && !home.has(q)) home.set(q, i);
    }
  });
  const rootOf = (m: M): M => {
    const seen = new Set<string>();
    let cur = m;
    while (cur.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const up = modules.find((x) => x.id === cur.parentId);
      if (!up) break;
      cur = up;
    }
    return cur;
  };
  const groups: M[][] = docs.map(() => []);
  const loose: M[] = [];
  for (const m of modules) {
    const g = home.get(rootOf(m).id);
    if (g === undefined) loose.push(m);
    else groups[g].push(m);
  }
  return { groups, loose };
}

/**
 * Import (JSON, verschlüsselter Export …) mit mehreren Dokumenten: Das erste Dokument samt seiner
 * eingebetteten Quizze bleibt im Lernthema – ein Ziel, das schon eines hat, gibt seinen Platz nicht
 * her –, jedes weitere bekommt ein eigenes Lernthema dahinter. Quizze ohne Dokument bleiben im
 * ersten. Setzt `topicId` und `orderIndex` der Module; Ergebnis: die Lernthemen in Reihenfolge.
 */
export async function oneDocumentEach<M extends Mod & { topicId: string; orderIndex: number; title?: string }>(
  modules: M[],
  topic: LearningTopic,
  intoExisting: boolean,
  io: {
    existing: () => Promise<Mod[]>;
    sibling: (after: LearningTopic, title: string) => Promise<LearningTopic>;
    rename: (topic: LearningTopic) => Promise<unknown>;
  },
): Promise<string[]> {
  if (topic.classId) return [topic.id];
  const { groups } = groupByDocument(modules);
  const occupied = intoExisting && groups.length > 0 && hasDocument(await io.existing());
  if (groups.length < 2 && !occupied) return [topic.id];
  const topicIds = [topic.id];
  let cur = topic;
  for (const [i, group] of groups.entries()) {
    const doc = group.find((m) => isRootDoc(m))!;
    if (i > 0 || occupied) {
      cur = await io.sibling(cur, doc.title || '');
      topicIds.push(cur.id);
    } else if (!intoExisting && doc.title) {
      // Neues Lernthema mit einem Dokument: beide heißen gleich (sole-document.ts).
      topic.title = doc.title;
      await io.rename(topic);
    }
    for (const m of group) m.topicId = cur.id;
  }
  // Reihenfolge je Lernthema ohne Lücken.
  for (const id of topicIds) {
    modules.filter((m) => m.topicId === id && !m.parentId)
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
      .forEach((m, k) => { m.orderIndex = k; });
  }
  return topicIds;
}

/**
 * Neues Lernthema direkt hinter `topic` (gleiche Lehrkraft, gleiche Einstellungen). `actorId`: wer
 * es auslöst – auch dessen Platz im Notizbuch zählt, wenn er nicht der Eigentümer ist.
 */
export async function createSiblingTopic(
  manager: EntityManager,
  topic: LearningTopic,
  title: string,
  actorId: string,
): Promise<LearningTopic> {
  const topics = manager.getRepository(LearningTopic);
  const sibling = await topics.save(topics.create({
    id: crypto.randomUUID(),
    title: String(title || topic.title || 'Dokument').slice(0, 200),
    description: '',
    ownerId: topic.ownerId,
    selected: topic.selected,
    teacherOnly: topic.teacherOnly,
    visibility: topic.visibility || 'locked',
    permissions: topic.permissions ?? null,
    sharedWith: topic.sharedWith ?? null,
    sharedAccess: topic.sharedAccess ?? null,
    tagIds: topic.tagIds ?? null,
    categoryIds: topic.categoryIds ?? null,
    classId: null,
  } as Partial<LearningTopic>));

  // Notizbuch: gleich dahinter, bei der Eigentümerin und bei dem, der es auslöst.
  const places = manager.getRepository(NotebookPlacement);
  const owners = [...new Set([topic.ownerId, actorId].filter(Boolean))];
  for (const p of await places.find({ where: { topicId: topic.id, ownerId: In(owners) } })) {
    const after = (await places.find({ where: { ownerId: p.ownerId } }))
      .filter((x) => (x.nodeId ?? null) === (p.nodeId ?? null) && x.orderIndex > p.orderIndex);
    for (const x of after) x.orderIndex += 1;
    if (after.length) await places.save(after);
    await places.save(places.create({
      id: crypto.randomUUID(), ownerId: p.ownerId, topicId: sibling.id, nodeId: p.nodeId ?? null,
      orderIndex: p.orderIndex + 1, inheritedTagIds: p.inheritedTagIds ?? null,
    }));
  }

  // Planung: hinter jedem Eintrag des Lernthemas.
  const entries = manager.getRepository(PlanEntry);
  for (const e of await entries.find({ where: { topicId: topic.id, ownerId: In(owners) } })) {
    const after = (await entries.find({ where: { ownerId: e.ownerId, nodeId: e.nodeId } })).filter((x) => x.orderIndex > e.orderIndex);
    for (const x of after) x.orderIndex += 1;
    if (after.length) await entries.save(after);
    await entries.save(entries.create({ id: crypto.randomUUID(), ownerId: e.ownerId, nodeId: e.nodeId, topicId: sibling.id, orderIndex: e.orderIndex + 1 }));
  }

  // Links, Klassenlinks und Quick-Links, die das ganze Lernthema freigeben: das neue gleich dahinter.
  const links = manager.getRepository(TopicLink);
  const changed: TopicLink[] = [];
  for (const link of await links.find({ where: { ownerId: In(owners) } })) {
    const sel = Array.isArray(link.selection) ? link.selection : [];
    const at = sel.findIndex((s) => s?.topicId === topic.id && s.all);
    if (at < 0) continue;
    link.selection = [...sel.slice(0, at + 1), { topicId: sibling.id, all: true }, ...sel.slice(at + 1)];
    changed.push(link);
  }
  if (changed.length) await links.save(changed);
  return sibling;
}
