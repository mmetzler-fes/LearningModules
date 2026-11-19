import { embeddedQuizIds } from '../core/public/student-view';

/** Dokumente und Anhänge (wie isDocLike im Browser). */
const DOC_LIKE = new Set(['document', 'worksheet', 'attachment']);

export interface ContentCounts {
  documents: number;
  /** Quizze, die in einem der Dokumente stehen und dort laufen. */
  embeddedQuizzes: number;
  /** Quizze (und Apps) außerhalb der Dokumente. */
  quizzes: number;
}

type Mod = {
  id: string;
  type?: string;
  content?: any;
  parentId?: string | null;
  embeddedOnly?: boolean;
  subModules?: Mod[];
};

/**
 * Inhalt eines Links für die Einstiegsseite – statt „3 Aufgaben“, das Dokumente und Quizze mischt.
 * Gleiche Regel wie contentCounts in doc-quiz.js (Browser), der den Text daraus macht.
 */
export function contentCounts(
  resolved: Array<{ modules: Mod[] }>,
): ContentCounts {
  const out: ContentCounts = { documents: 0, embeddedQuizzes: 0, quizzes: 0 };
  for (const { modules } of resolved) {
    const roots = modules.filter((m) => !m.parentId);
    const docs = roots.filter((m) => DOC_LIKE.has(m.type || ''));
    const inDocs = new Set(
      docs
        .flatMap((d) => [d, ...(d.subModules || [])])
        .flatMap((d) => embeddedQuizIds(d)),
    );
    const quizzes = roots.filter((m) => !DOC_LIKE.has(m.type || ''));
    const embedded = quizzes.filter(
      (m) => inDocs.has(m.id) || m.embeddedOnly,
    ).length;
    out.documents += docs.length;
    out.embeddedQuizzes += embedded;
    out.quizzes += quizzes.length - embedded;
  }
  return out;
}
