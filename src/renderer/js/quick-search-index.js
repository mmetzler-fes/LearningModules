// Schnellsuche (Strg+K): alles im Notizbuch – Books, Bereiche, Abschnitte, Lernthemen, Dokumente, Quizze –
// mit Pfad. Ohne import und DOM: die Tests laden die Datei (src/core/browser-module.ts).

const NODE_ICON = { book: '📕', area: '📂', section: '📑' };
const DOC_TYPES = ['document', 'worksheet', 'attachment'];

/** Kleinbuchstaben, ohne Akzente; ä/ö/ü/ß auch als ae/oe/ue/ss findbar. */
export function foldText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Wie quiz-usage.js topicIcon: 📄 ein Dokument, 🧩 nur Quizze, sonst 📘. */
function topicIconOf(modules) {
  const roots = (modules || []).filter((m) => m && !m.parentId);
  const docs = roots.filter((m) => DOC_TYPES.includes(m.type)).length;
  if (docs === 1) return '📄';
  if (!docs && roots.length) return '🧩';
  return '📘';
}

/**
 * Einträge aus der Antwort von GET /api/notebooks: { kind, id, topicId?, title, icon, path }.
 * `kind`: 'node' | 'topic' | 'module'. Ein Lernthema mit genau einem Dokument ist eine Zeile (📄):
 * das Dokument steht nicht noch einmal da, wenn es so heißt wie das Lernthema.
 */
export function buildSearchIndex(data, typeIcon = () => '🧩') {
  const nodes = new Map((data?.nodes || []).map((n) => [n.id, n]));
  const pathOf = (nodeId) => {
    const out = [];
    for (let cur = nodes.get(nodeId); cur && out.length < 16; cur = cur.parentId ? nodes.get(cur.parentId) : null) out.unshift(cur.title);
    return out;
  };
  const place = new Map((data?.placements || []).map((p) => [p.topicId, p.nodeId]));
  const items = [];
  for (const n of data?.nodes || []) {
    items.push({ kind: 'node', id: n.id, title: n.title || '', icon: NODE_ICON[n.kind] || '📁', path: pathOf(n.parentId) });
  }
  const seen = new Set();
  for (const t of [...(data?.topics || []), ...(data?.granted || [])]) {
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    const path = pathOf(place.get(t.id));
    const mods = t.modules || [];
    items.push({ kind: 'topic', id: t.id, topicId: t.id, title: t.title || '', icon: topicIconOf(mods), path, own: t.isOwn !== false });
    const docs = mods.filter((m) => !m.parentId && DOC_TYPES.includes(m.type));
    for (const m of mods) {
      if (docs.length === 1 && m.id === docs[0].id && (m.title || '') === (t.title || '')) continue;
      const isDoc = DOC_TYPES.includes(m.type);
      items.push({ kind: 'module', id: m.id, topicId: t.id, title: m.title || '', icon: isDoc ? '📄' : typeIcon(m.type), path: [...path, t.title || ''], own: t.isOwn !== false });
    }
  }
  for (const it of items) it.key = foldText([it.title, ...it.path].join(' '));
  return items;
}

/**
 * Treffer zu `query`: jedes Wort muss im Titel oder Pfad vorkommen. Vorn steht, was im Titel
 * beginnt, dann was im Titel vorkommt; Lernthemen vor Modulen vor Ordnern; dann kürzere Titel.
 */
export function searchItems(items, query, limit = 30) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const KIND = { topic: 0, module: 1, node: 2 };
  const scored = [];
  for (const it of items) {
    if (!words.every((w) => it.key.includes(w))) continue;
    const title = foldText(it.title);
    const score = (title.startsWith(words[0]) ? 0 : words.every((w) => title.includes(w)) ? 1 : 2) * 10 + KIND[it.kind];
    scored.push({ it, score });
  }
  scored.sort((a, b) => a.score - b.score || a.it.title.length - b.it.title.length || a.it.title.localeCompare(b.it.title, 'de'));
  return scored.slice(0, limit).map((s) => s.it);
}
