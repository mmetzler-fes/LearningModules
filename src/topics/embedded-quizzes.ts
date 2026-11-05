import { In, Repository } from 'typeorm';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { embeddedQuizIds } from '../core/public/student-view';
import { isRemovedUnit } from '../html-apps/html-app-rules';
import { withoutLocked } from './student-lock';

/**
 * Quizze, die ein Dokument aus einem anderen Lernthema einbettet (Verweis, siehe docs/dokumente.md).
 * Sie kommen mit dem Dokument zu den Schülern, auch wenn ihr eigenes Lernthema nicht freigegeben ist.
 * Nur Quizze derselben Lehrkraft (auch per Copy erworbene, die gehören ihr), nicht ausgeschaltet,
 * nicht gesperrt. Was schon im Lernthema des Dokuments liegt, regelt dessen Freigabe wie bisher.
 *
 * Ergebnis: die Quizze (mit Untermodulen) mit `embeddedOnly: true` – sie laufen im Dokument,
 * nicht als eigene Aufgabe.
 */
export async function foreignEmbeddedQuizzes(
  repos: { modules: Repository<LearningModule>; topics: Repository<LearningTopic> },
  docs: LearningModule[],
  ownerId: string,
  /** Module, die schon dazugehören oder im Lernthema des Dokuments liegen: nicht noch einmal. */
  known: ReadonlySet<string>,
): Promise<LearningModule[]> {
  const wanted = [...new Set(docs.flatMap((d) => embeddedQuizIds(d)))].filter((id) => !known.has(id));
  if (!wanted.length) return [];
  const found = await repos.modules.find({ where: { id: In(wanted) } });
  const topicIds = [...new Set(found.map((m) => m.topicId).filter(Boolean))];
  const topics = topicIds.length ? await repos.topics.find({ where: { id: In(topicIds) } }) : [];
  const ownTopics = new Map(topics.filter((t) => t.ownerId === ownerId).map((t) => [t.id, t]));
  const usable = found.filter((m) => ownTopics.has(m.topicId) && !m.parentId && m.type !== 'document'
    && m.moduleSelected !== false && !isRemovedUnit(m));
  if (!usable.length) return [];
  const kids = await repos.modules.find({ where: { parentId: In(usable.map((m) => m.id)) } });
  const out: LearningModule[] = [];
  for (const [topicId, topic] of ownTopics) {
    const here = usable.filter((m) => m.topicId === topicId);
    if (!here.length) continue;
    const hereKids = kids.filter((k) => here.some((m) => m.id === k.parentId) && k.moduleSelected !== false);
    // Gesperrt (🔒 Nur Lehrkraft, Klassenarbeit) bleibt gesperrt – auch über ein fremdes Dokument.
    const open = withoutLocked(topic, [...here, ...hereKids], true);
    for (const m of open.filter((x) => !x.parentId)) {
      const subs = open.filter((k) => k.parentId === m.id).sort((a, b) => a.orderIndex - b.orderIndex);
      out.push(Object.assign(new LearningModule(), m, { embeddedOnly: true }, subs.length ? { subModules: subs } : {}));
    }
  }
  return out;
}

/**
 * Für Kopie, Shop und Export: die Quizze aus anderen Lernthemen, die `docs` einbetten und `ownerId`
 * gehören – samt Untermodulen, flach, ohne Rücksicht auf Freigabe und Sperre (eine Kopie ist
 * vollständig). Was schon in `known` steckt, kommt nicht noch einmal.
 */
export async function ownEmbeddedQuizzes(
  repos: { modules: Repository<LearningModule>; topics: Repository<LearningTopic> },
  docs: LearningModule[],
  ownerId: string,
  known: ReadonlySet<string>,
): Promise<LearningModule[]> {
  const wanted = [...new Set(docs.filter((d) => d.type === 'document').flatMap((d) => embeddedQuizIds(d)))].filter((id) => !known.has(id));
  if (!wanted.length) return [];
  const found = await repos.modules.find({ where: { id: In(wanted) } });
  const topicIds = [...new Set(found.map((m) => m.topicId).filter(Boolean))];
  const own = new Set((topicIds.length ? await repos.topics.find({ where: { id: In(topicIds) } }) : []).filter((t) => t.ownerId === ownerId).map((t) => t.id));
  const roots = found.filter((m) => own.has(m.topicId) && !m.parentId && m.type !== 'document');
  if (!roots.length) return [];
  const kids = await repos.modules.find({ where: { parentId: In(roots.map((m) => m.id)) } });
  return [...roots, ...kids.filter((k) => !known.has(k.id))];
}
