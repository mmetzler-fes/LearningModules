// ==================== WO EIN QUIZ EINGEBETTET IST ====================
//
// Dokumente betten Quizze per Verweis ein, auch aus anderen Lernthemen (docs/dokumente.md). Hier steht,
// in welchen Dokumenten ein Quiz steckt – für „Verwendet in …“ und die Warnung beim Löschen. Die Angaben
// kommen mit den Lernthemen (`quizIds` am Dokument, topics.service.ts attachQuizIds).

/** Quiz-ID → [{ doc, topic }] über alle eigenen Lernthemen in `topics`. */
export function quizUsage(topics) {
  const out = new Map();
  for (const topic of topics || []) {
    if (topic.isOwn === false) continue;
    for (const doc of topic.modules || []) {
      if (doc.type !== 'document') continue;
      for (const id of new Set(doc.quizIds || [])) out.set(id, [...(out.get(id) || []), { doc, topic }]);
    }
  }
  return out;
}

/** „im Dokument „A“ (Lernthema X)“ bzw. „in 3 Dokumenten („A“, „B“ aus X, …)“. */
export function usageText(uses, here = null) {
  const name = ({ doc, topic }) => `„${doc.title || 'Dokument'}“${topic.id !== here ? ` (${topic.title})` : ''}`;
  return uses.length === 1 ? `im Dokument ${name(uses[0])}` : `in ${uses.length} Dokumenten: ${uses.map(name).join(', ')}`;
}

/** Wie viele Dokumente die Quizze eines Lernthemas einbetten, die außerhalb liegen – für das Löschen des Lernthemas. */
export function usesOutside(topics, topic) {
  const usage = quizUsage(topics);
  const ids = new Set((topic.modules || []).map((m) => m.id));
  const found = [];
  for (const [id, uses] of usage) {
    if (!ids.has(id)) continue;
    for (const u of uses) if (u.topic.id !== topic.id && !found.some((f) => f.doc.id === u.doc.id)) found.push(u);
  }
  return found;
}
