// Quizze im Dokument (Block `quiz`): welche Module ein Dokument einbettet
// und wie ein Durchlauf daraus seine Schritte bildet.
//
// Ohne import und DOM – der Server lädt die Datei für die Tests
// (src/core/browser-module.ts).

/** Module-IDs der Quiz-Blöcke eines Dokuments – auch in Aufgaben und Kästen. */
export function quizIdsOf(mod) {
  let content = mod.content || {};
  if (typeof content === 'string') { try { content = JSON.parse(content); } catch (_) { content = {}; } }
  const out = [];
  const walk = (blocks) => (Array.isArray(blocks) ? blocks : []).forEach((b) => {
    if (!b || typeof b !== 'object') return;
    if (b.type === 'quiz' && b.module) out.push(String(b.module));
    walk(b.blocks);
  });
  walk(content.spec?.content);
  return out;
}

/**
 * Schritte eines Durchlaufs. Quizze, die ein Dokument einbettet, laufen dort
 * und nicht noch einmal als eigener Schritt – außer in der Lernbegleitung,
 * die jede Aufgabe einzeln begleitet. `onlyModule`: nur dieses eine Modul
 * (QR-Code eines Quiz im gedruckten Dokument).
 */
export function planRun(modules, { companion = false, onlyModule = null } = {}) {
  const only = onlyModule && modules.find((m) => m.id === onlyModule);
  if (only) return { steps: [only], embedded: new Map() };
  if (companion) return { steps: modules, embedded: new Map() };
  const byId = new Map(modules.map((m) => [m.id, m]));
  const embedded = new Map();
  for (const doc of modules.filter((m) => m.type === 'document')) {
    for (const id of quizIdsOf(doc)) {
      const m = byId.get(id);
      if (m && m.id !== doc.id && m.type !== 'document' && (m._topicId ?? null) === (doc._topicId ?? null)) embedded.set(id, m);
    }
  }
  return { steps: modules.filter((m) => !embedded.has(m.id)), embedded };
}
