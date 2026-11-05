import { escapeHtml } from './utils.js';

/**
 * Quiz einfügen – für den Dokument-Editor (docspec-editor.js) und das ⊕ im Stift-Editor
 * (ink/ink-open.js). Wählbar ist jedes eigene Quiz aus dem Lernnotizbuch, auch aus anderen
 * Lernthemen: Das Dokument verweist nur darauf (docs/dokumente.md). Zuerst stehen die Quizze dieses
 * Lernthemas, dann die des Abschnitts, dann alle mit Suche. Dokumente, Untermodule und das Dokument
 * selbst (`own`) fehlen – sie sind kein Quiz. Ergebnis: `{ type: 'quiz', module, title }` oder null.
 */
const isQuiz = (m, own) => m && m.id && m.id !== own && !m.parentId && m.type !== 'document' && m.type !== 'htmlAppUnit';
const SHOW_MAX = 150;

async function notebookTree() {
  try {
    const token = sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token') || '';
    const res = await fetch('/api/notebooks', { headers: { Authorization: `Bearer ${token}` } });
    return res.ok ? await res.json() : null;
  } catch (_) { return null; }
}

/** Gruppen: [{ title, items: [{ id, title, type, topicTitle, path, off }] }]. */
function groupsOf(tree, modules, own, topicId) {
  const here = (modules || []).filter((m) => isQuiz(m, own)).map((m) => ({ id: m.id, title: m.title || m.type, type: m.type, off: m.moduleSelected === false }));
  const groups = [{ key: 'here', title: 'In diesem Lernthema', items: here }];
  if (!tree || !Array.isArray(tree.topics)) return groups;
  const nodes = new Map((tree.nodes || []).map((n) => [n.id, n]));
  const placeOf = new Map((tree.placements || []).map((p) => [p.topicId, p.nodeId || null]));
  const pathOf = (nodeId) => {
    const parts = [];
    for (let n = nodes.get(nodeId); n; n = nodes.get(n.parentId)) parts.unshift(n.title);
    return parts.length ? parts.join(' › ') : 'Unsortiert';
  };
  const mine = tree.topics.filter((t) => t.isOwn !== false && t.id !== topicId);
  const itemsOf = (t) => (t.modules || []).filter((m) => isQuiz(m, own)).map((m) => ({
    id: m.id, title: m.title || m.type, type: m.type, topicTitle: t.title, path: pathOf(placeOf.get(t.id)), off: m.moduleSelected === false, // ob das Lernthema freigegeben ist, zählt nicht: das Dokument nimmt das Quiz mit
  }));
  const section = placeOf.get(topicId) ?? null;
  const near = mine.filter((t) => (placeOf.get(t.id) ?? null) === section).flatMap(itemsOf);
  const nearIds = new Set(near.map((x) => x.id));
  if (near.length) groups.push({ key: 'near', title: 'In diesem Abschnitt', items: near });
  groups.push({ key: 'all', title: 'Alle Lernthemen', items: mine.flatMap(itemsOf).filter((x) => !nearIds.has(x.id)), search: true });
  return groups;
}

export async function pickQuiz(modules, own = null, topicId = null) {
  const tree = await notebookTree();
  const groups = groupsOf(tree, modules, own, topicId);
  const all = groups.flatMap((g) => g.items);
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<div class="import-modules-card ds-quiz-picker">
        <h3>🧩 Quiz einfügen</h3>
        <p class="hint">${all.length
          ? 'Ein Quiz aus deinem Lernnotizbuch – auch aus einem anderen Lernthema. Das Dokument verweist nur darauf: Änderst du das Quiz, ändert es sich überall. Im Durchlauf bearbeiten Schüler es direkt im Blatt, im Druck stehen QR-Code und Adresse.'
          : 'Es gibt noch kein Quiz. Lege es zuerst als Modul in einem Lernthema an und füge es dann hier ein.'}</p>
        <input type="search" class="search-input ds-quiz-search" placeholder="Quiz oder Lernthema suchen …" aria-label="Quiz suchen">
        <div class="ds-quiz-groups"></div>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary ds-q-cancel">Abbrechen</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const box = overlay.querySelector('.ds-quiz-groups');
    const search = overlay.querySelector('.ds-quiz-search');
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const hit = (x) => !q || `${x.title} ${x.topicTitle || ''} ${x.path || ''}`.toLowerCase().includes(q);
      box.innerHTML = groups.map((g) => {
        const items = g.items.filter(hit);
        if (!items.length && g.key !== 'here') return '';
        const shown = items.slice(0, SHOW_MAX);
        const more = items.length - shown.length;
        return `<section class="ds-quiz-group"><h4>${escapeHtml(g.title)}</h4>
          ${items.length ? '' : '<p class="hint">Keine Quizze.</p>'}
          <div class="ds-quiz-choices">${shown.map((x) => `<button type="button" class="btn btn-secondary ds-quiz-choice" data-id="${escapeHtml(x.id)}"
            title="${escapeHtml(x.path ? `${x.path} › ${x.topicTitle}` : x.title)}">${escapeHtml(x.title)}${x.topicTitle ? `<small class="ds-quiz-from">aus: ${escapeHtml(x.topicTitle)}</small>` : ''}${x.off ? '<small class="ds-quiz-from">○ ausgeschaltet</small>' : ''}</button>`).join('')}</div>
          ${more > 0 ? `<p class="hint">… und ${more} weitere – Suche eingrenzen.</p>` : ''}</section>`;
      }).join('');
      box.querySelectorAll('.ds-quiz-choice').forEach((btn) => btn.addEventListener('click', () => {
        const m = all.find((x) => x.id === btn.dataset.id);
        done({ type: 'quiz', module: m.id, title: m.title || 'Quiz' });
      }));
    };
    const done = (v) => { overlay.remove(); resolve(v); };
    search.addEventListener('input', render);
    overlay.querySelector('.ds-q-cancel').addEventListener('click', () => done(null));
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) done(null); });
    render();
    search.focus();
  });
}
