/**
 * Lernthema mit genau einem Dokument: Das Notizbuch zeigt Lernthema und Dokument als eine Zeile
 * (📄), deshalb heißen beide gleich. Wird das Dokument umbenannt, zieht das Lernthema immer mit
 * (auch wenn die Titel vorher abwichen – so werden sie wieder gleich). Wird das Lernthema umbenannt,
 * zieht das Dokument mit, solange beide bis dahin gleich hießen. Mit zwei oder mehr Dokumenten
 * (📘 Mappe) bleiben die Titel unabhängig.
 */
export interface SoleDocModule {
  id: string;
  type?: string;
  parentId?: string | null;
  title?: string;
}

/** Dokumente und Anhänge (wie isDocLike im Browser, quiz-usage.js). */
export const DOC_TYPES = new Set(['document', 'worksheet', 'attachment']);

/** Das eine Dokument des Lernthemas, sonst null. */
export function soleDocument<M extends SoleDocModule>(
  modules: M[] | undefined | null,
): M | null {
  const docs = (modules || []).filter(
    (m) => !m.parentId && DOC_TYPES.has(m.type || ''),
  );
  return docs.length === 1 ? docs[0] : null;
}

/** Neuer Titel des Dokuments, wenn das Lernthema von `before` in `after` umbenannt wird – sonst null. */
export function docTitleFollowingTopic(
  modules: SoleDocModule[] | undefined | null,
  before: string,
  after: string | undefined,
) {
  if (after === undefined || after === before || !after.trim()) return null;
  const doc = soleDocument(modules);
  return doc && (doc.title || '') === before
    ? { id: doc.id, title: after }
    : null;
}

/** Neuer Titel des Lernthemas, wenn das Dokument `moduleId` von `before` in `after` umbenannt wird – sonst null. */
export function topicTitleFollowingDoc(
  topicTitle: string,
  modules: SoleDocModule[] | undefined | null,
  moduleId: string,
  before: string,
  after: string | undefined,
) {
  if (after === undefined || after === before || !after.trim()) return null;
  const doc = soleDocument(modules);
  return doc && doc.id === moduleId && topicTitle !== after ? after : null;
}
