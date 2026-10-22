import { escapeHtml, escapeAttr, copyOneNotePage } from '../utils.js';
import { downloadBlob } from '../api.js';
import { pickClass } from './classes.js';
import { TagPicker, chipHtml } from './tags.js';
import { openFeedbackDialog } from './feedback.js';
import { openImportDialog } from './import-dialog.js';
import { NotebookPreview } from './notebook-preview.js';

// ==================== NOTEBOOKS ====================
//
// Lernthemen in Books, Bereichen und Abschnitten – wie in OneNote. Jede
// Zeile ist einzeilig, alles ist anfangs zugeklappt, Aktionen liegen im
// Kontextmenü (⋯ oder Rechtsklick). Bearbeitet werden nur Module; dafür
// öffnet sich der gewohnte Modul-Editor und führt hierher zurück.

const KIND = {
  book: { icon: '📓', label: 'Book', a: 'ein Book' },
  area: { icon: '📂', label: 'Bereich', a: 'einen Bereich' },
  section: { icon: '📑', label: 'Abschnitt', a: 'einen Abschnitt' },
};
/**
 * Wie auf dem Server (notebook-rules.ts): Books oben; Books und Bereiche
 * nehmen Bereiche und Abschnitte auf – Bereiche also auch ineinander –,
 * Abschnitte nur noch Lernthemen.
 */
function canHoldNode(parentKind, kind) {
  if (kind === 'book') return parentKind === null;
  if (parentKind === null) return false;
  return parentKind !== 'section';
}

const OPEN_KEY = 'lm_nb_open';

function loadOpen() {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]')); } catch (_) { return new Set(); }
}

function failed(res) {
  return !res || res.success === false || (res.statusCode && res.statusCode >= 400);
}

export class NotebooksView {
  constructor(app) {
    this.app = app;
    this._tree = document.getElementById('notebookTree');
    this._mirrorBar = document.getElementById('nbMirrorBar');
    document.getElementById('btnDocTemplates')?.addEventListener('click', () => this._templatesDialog());
    this._search = document.getElementById('notebookSearch');
    this._data = null;
    this._open = loadOpen();
    this._drag = null;
    // Mehrfachauswahl: Schlüssel ('m:<id>' bzw. 't:<id>') → { type, id, topicId }.
    // Immer nur eine Sorte; `_selMode` zeigt Kästchen (auch ohne Strg).
    this._sel = new Map();
    this._selMode = false;
    this._selAnchor = null;
    this._selBar = document.getElementById('nbSelBar');
    this._btnSelect = document.getElementById('btnNotebookSelect');
    this._btnSelect?.addEventListener('click', () => this._setSelMode(!this._selMode));

    document.getElementById('btnNotebookNewBook')?.addEventListener('click', () => this._createNode('book', null));
    document.getElementById('btnNotebookImport')?.addEventListener('click', () => this._import(null));
    document.getElementById('btnNotebookExpand')?.addEventListener('click', () => this._expandAll(true));
    document.getElementById('btnNotebookCollapse')?.addEventListener('click', () => this._expandAll(false));
    this._search?.addEventListener('input', () => this._render());

    // Kontextmenü schließen: Klick daneben, Escape, Scrollen.
    document.addEventListener('click', (e) => { if (!e.target.closest('.nb-menu')) this._closeMenu(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!this._menu && this._sel.size && !document.querySelector('.confirm-overlay:not(.hidden)')) this._clearSel();
      this._closeMenu();
    });
    window.addEventListener('resize', () => this._closeMenu());
    this._preview = new NotebookPreview(this);
  }

  async refresh() {
    const data = await this.app.api.getNotebooks();
    if (failed(data) || !Array.isArray(data.nodes)) {
      this._tree.innerHTML = `<div class="empty-state"><p>Fehler: ${escapeHtml(data?.message || 'Notebooks nicht abrufbar')}</p></div>`;
      return;
    }
    this._data = data;
    void this._loadMirror();
    // Module mit offenem Entwurf (nicht gespeicherte Änderungen) markieren.
    try {
      const drafts = await this.app.api.listDrafts();
      this._draftIds = new Set((Array.isArray(drafts) ? drafts : []).map((d) => d.moduleId).filter(Boolean));
    } catch (_) { this._draftIds = new Set(); }
    // Die Modul-Ansichten lesen Tags und Rechte aus state.topics.
    this.app.state.topics = data.topics;
    if (!(this.app.state.tags || []).length) await this.app.loadTags();
    this._index();
    this._render();
    this._preview.refresh();
  }

  // ---------- Daten ----------

  _index() {
    const { nodes, placements, topics, granted } = this._data;
    this._nodes = new Map(nodes.map((n) => [n.id, n]));
    this._topics = new Map([...topics, ...granted].map((t) => [t.id, t]));
    // Per Use erworbene Books, Bereiche, Abschnitte: ein Eintrag wie ein
    // Lernthema (Platz „offer:<id>“), darin die Struktur des Anbieters.
    for (const m of this._data.mirrors || []) {
      const key = 'offer:' + m.offerId;
      this._topics.set(key, { id: key, title: m.title, isMirror: true, mirror: m, modules: [] });
    }
    this._childNodes = new Map();
    for (const n of [...nodes].sort((a, b) => a.orderIndex - b.orderIndex)) {
      const key = n.parentId || '';
      if (!this._childNodes.has(key)) this._childNodes.set(key, []);
      this._childNodes.get(key).push(n);
    }
    this._childTopics = new Map();
    this._placeOf = new Map();
    for (const p of [...placements].sort((a, b) => a.orderIndex - b.orderIndex)) {
      if (!this._topics.has(p.topicId)) continue;
      const key = p.nodeId || '';
      if (!this._childTopics.has(key)) this._childTopics.set(key, []);
      this._childTopics.get(key).push(this._topics.get(p.topicId));
      this._placeOf.set(p.topicId, p);
    }
  }

  _nodesIn(id) { return this._childNodes.get(id || '') || []; }
  _topicsIn(id) { return this._childTopics.get(id || '') || []; }

  /** Alle Lernthemen unterhalb eines Knotens. */
  _topicsBelow(id) {
    const out = [...this._topicsIn(id)];
    for (const n of this._nodesIn(id)) out.push(...this._topicsBelow(n.id));
    return out;
  }

  _isInside(nodeId, ancestorId) {
    for (let n = this._nodes.get(nodeId); n; n = this._nodes.get(n.parentId)) if (n.id === ancestorId) return true;
    return false;
  }

  _path(nodeId) {
    const out = [];
    for (let n = this._nodes.get(nodeId); n; n = this._nodes.get(n.parentId)) out.unshift(n.title);
    return out.join(' › ');
  }

  // ---------- Auf- und Zuklappen ----------

  _saveOpen() {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...this._open])); } catch (_) {}
  }

  _toggle(key) {
    if (this._open.has(key)) this._open.delete(key); else this._open.add(key);
    this._saveOpen();
    this._render();
  }

  _expandAll(open) {
    this._open = new Set();
    if (open) {
      for (const n of this._data.nodes) this._open.add('n:' + n.id);
      this._open.add('n:');
    }
    this._saveOpen();
    this._render();
  }

  // ---------- Zeichnen ----------

  _render() {
    if (!this._data) return;
    const query = (this._search?.value || '').trim().toLowerCase();
    this._query = query;
    this._tree.innerHTML = '';

    const frag = document.createDocumentFragment();
    const unsorted = this._topicsIn(null);
    if (unsorted.length) frag.appendChild(this._renderUnsorted(unsorted));
    for (const book of this._nodesIn(null)) {
      const el = this._renderNode(book, 0);
      if (el) frag.appendChild(el);
    }
    this._tree.appendChild(frag);
    this._syncSel();

    if (!this._tree.children.length) {
      this._tree.innerHTML = query
        ? '<div class="empty-state"><p>Nichts gefunden.</p></div>'
        : `<div class="empty-state"><span class="empty-icon">📓</span>
            <p>Noch keine Notebooks. Mit <strong>➕ Neues Book</strong> geht es los – oder lege Lernthemen an, sie erscheinen dann unter „Unsortiert“.</p></div>`;
    }
  }

  _matches(text) {
    return !this._query || String(text || '').toLowerCase().includes(this._query);
  }

  /** Bei aktiver Suche: Passt der Knoten selbst oder etwas darin? */
  _nodeHasMatch(node) {
    if (this._matches(node.title)) return true;
    return this._topicsIn(node.id).some((t) => this._topicHasMatch(t)) || this._nodesIn(node.id).some((n) => this._nodeHasMatch(n));
  }

  _topicHasMatch(topic) {
    if (topic.isMirror) return this._matches(topic.title) || topic.mirror.topics.some((t) => this._topicHasMatch(t));
    return this._matches(topic.title) || (topic.modules || []).some((m) => this._matches(m.title));
  }

  _isOpen(key) {
    return !!this._query || this._open.has(key);
  }

  _row({ key, depth, icon, title, num = '', meta = '', extra = '', twisty = true, open = false, cls = '', drag = null }) {
    const row = document.createElement('div');
    row.className = `nb-row ${cls} ${this._preview?.currentKey === key ? 'nb-current' : ''}`;
    row.style.setProperty('--depth', depth);
    row.dataset.key = key;
    if (drag) row.draggable = true;
    row.innerHTML = `
      ${twisty ? `<button type="button" class="nb-twisty" aria-expanded="${open}" title="${open ? 'Zuklappen' : 'Aufklappen'}">${open ? '▾' : '▸'}</button>` : '<span class="nb-twisty-space"></span>'}
      <span class="nb-icon" aria-hidden="true">${icon}</span>
      ${num ? `<span class="nb-num" title="Nummer der Dokumente">${escapeHtml(num)}</span>` : ''}
      <span class="nb-title" title="${escapeAttr(title)}">${escapeHtml(title)}</span>
      ${meta ? `<span class="nb-meta">${meta}</span>` : ''}
      ${extra}
      <button type="button" class="nb-menu-btn" title="Aktionen" aria-label="Aktionen">⋯</button>`;
    if (twisty) {
      row.querySelector('.nb-twisty').addEventListener('click', (e) => { e.stopPropagation(); this._toggle(key); });
      row.querySelector('.nb-title').addEventListener('click', () => this._toggle(key));
    }
    if (drag) this._bindDrag(row, drag);
    return row;
  }

  /** Die Zeile hervorheben, die rechts in der Vorschau steht. */
  _markCurrent() {
    const key = this._preview?.currentKey;
    this._tree.querySelectorAll('.nb-row.nb-current').forEach((r) => r.classList.remove('nb-current'));
    if (key) this._tree.querySelector(`.nb-row[data-key="${CSS.escape(key)}"]`)?.classList.add('nb-current');
  }

  _menuOn(row, items) {
    const open = (x, y) => this._openMenu(items(), x, y);
    row.querySelector('.nb-menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      open(r.right, r.bottom);
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      open(e.clientX, e.clientY);
    });
  }

  _renderUnsorted(topics) {
    const shown = this._query ? topics.filter((t) => this._topicHasMatch(t)) : topics;
    if (!shown.length) return document.createDocumentFragment();
    const wrap = document.createElement('div');
    const open = this._isOpen('n:');
    const row = this._row({
      key: 'n:', depth: 0, icon: '📥', title: 'Unsortiert', open, cls: 'nb-node nb-unsorted',
      meta: `${shown.length} Lernthem${shown.length === 1 ? 'a' : 'en'}`,
    });
    row.querySelector('.nb-menu-btn').remove();
    this._bindDrop(row, { type: 'node', id: null, kind: null });
    wrap.appendChild(row);
    if (open) for (const t of shown) wrap.appendChild(this._renderTopic(t, 1));
    return wrap;
  }

  _renderNode(node, depth) {
    if (this._query && !this._nodeHasMatch(node)) return null;
    const key = 'n:' + node.id;
    const open = this._isOpen(key);
    const topicCount = this._topicsBelow(node.id).length;
    const kids = this._nodesIn(node.id);
    const parts = [];
    if (kids.length) parts.push(`${kids.length} ${kids.length === 1 ? (kids[0].kind === 'area' ? 'Bereich' : 'Abschnitt') : 'Unterordner'}`);
    parts.push(`${topicCount} Lernthem${topicCount === 1 ? 'a' : 'en'}`);

    const wrap = document.createElement('div');
    const row = this._row({
      key, depth, icon: KIND[node.kind].icon, title: node.title, open, num: this._data.nodeNumbers?.[node.id] || '',
      cls: `nb-node nb-kind-${node.kind}`, meta: parts.join(' · '), extra: this._chips(node.tagIds) + this._docBadge(node),
      drag: { type: 'node', id: node.id, kind: node.kind },
    });
    row.querySelector('.nb-title').addEventListener('click', () => { if (this._preview.open) this._preview.showNode(node); });
    this._menuOn(row, () => this._nodeMenu(node));
    this._bindDrop(row, { type: 'node', id: node.id, kind: node.kind });
    wrap.appendChild(row);
    if (open) {
      for (const kid of kids) {
        const el = this._renderNode(kid, depth + 1);
        if (el) wrap.appendChild(el);
      }
      for (const t of this._topicsIn(node.id)) {
        if (this._query && !this._topicHasMatch(t)) continue;
        wrap.appendChild(this._renderTopic(t, depth + 1));
      }
    }
    return wrap;
  }

  _renderTopic(topic, depth, inMirror = false) {
    if (topic.isMirror) return this._renderMirror(topic, depth);
    const key = 't:' + topic.id;
    // Bei der Suche nur aufklappen, wenn ein Modul passt – sonst wird es unübersichtlich.
    const open = this._query ? (topic.modules || []).some((m) => this._matches(m.title)) : this._open.has(key);
    const roots = (topic.modules || []).filter((m) => !m.parentId);
    const own = topic.isOwn;
    const status = own
      ? `<button type="button" class="nb-status ${topic.selected ? 'on' : ''}" title="${topic.selected ? 'Für Schüler freigegeben – klicken zum Sperren' : 'Nicht freigegeben – klicken zum Freigeben'}">${topic.selected ? '●' : '○'}</button>`
      : `<span class="nb-badge" title="Zur Nutzung erworben – gehört ${escapeAttr(topic.ownerName || '')}">🔗 ${escapeHtml(topic.ownerName || '')}</span>`;
    const wrap = document.createElement('div');
    const row = this._row({
      key, depth, icon: own ? '📘' : '📗', title: topic.title, open,
      cls: `nb-topic ${own ? '' : 'nb-granted'} ${own && !topic.selected ? 'nb-off' : ''}`,
      meta: `${roots.length} Modul${roots.length === 1 ? '' : 'e'}`,
      extra: status,
      drag: inMirror ? null : { type: 'topic', id: topic.id },
    });
    row.querySelector('.nb-status')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.app.api.toggleTopicSelection(topic.id, !topic.selected);
      topic.selected = !topic.selected;
      this._render();
    });
    row.querySelector('.nb-title').addEventListener('click', () => { if (this._preview.open) this._preview.showTopic(topic); });
    this._menuOn(row, () => (own ? this._topicMenu(topic) : inMirror ? this._mirrorTopicMenu(topic) : this._grantedMenu(topic)));
    if (inMirror) { row.draggable = false; row.classList.add('nb-mirror-row'); } else {
      this._bindDrop(row, { type: 'topic', id: topic.id, own });
      this._selectable(row, { type: 'topic', id: topic.id, own });
    }
    wrap.appendChild(row);

    if (open) {
      const modules = (topic.modules || []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
      if (!roots.length) {
        const empty = document.createElement('div');
        empty.className = 'nb-row nb-empty';
        empty.style.setProperty('--depth', depth + 1);
        empty.innerHTML = own
          ? '<span class="nb-twisty-space"></span><span class="hint">Noch keine Module – über ⋯ › „Neues Modul“.</span>'
          : '<span class="nb-twisty-space"></span><span class="hint">Keine Module sichtbar.</span>';
        wrap.appendChild(empty);
      }
      // Bei der Suche nur passende Module – außer das Thema selbst passt.
      const show = (m) => !this._query || this._matches(topic.title) || this._matches(m.title)
        || modules.some((k) => k.parentId === m.id && this._matches(k.title));
      for (const root of roots.sort((a, b) => a.orderIndex - b.orderIndex)) {
        if (!show(root)) continue;
        wrap.appendChild(this._renderModule(topic, root, depth + 1));
        for (const kid of modules.filter((m) => m.parentId === root.id)) {
          if (show(kid) || this._matches(root.title)) wrap.appendChild(this._renderModule(topic, kid, depth + 2));
        }
      }
    }
    return wrap;
  }

  _renderModule(topic, mod, depth) {
    const type = (typeof H5P_TYPES !== 'undefined' && H5P_TYPES[mod.type]) || {};
    const own = topic.isOwn;
    const on = mod.moduleSelected !== false;
    const row = this._row({
      key: 'm:' + mod.id, depth, icon: type.icon || '🧩', title: mod.title, twisty: false, num: this._data.docNumbers?.[mod.id] || '',
      cls: `nb-module ${on ? '' : 'nb-off'} ${this._query && this._matches(mod.title) ? 'nb-hit' : ''}`,
      meta: escapeHtml(type.name || mod.type),
      extra: (this._draftIds?.has(mod.id) ? '<span class="nb-badge" title="Nicht gespeicherte Änderungen – beim Bearbeiten wiederherstellbar">📝 Entwurf</span>' : '')
        + (this._mirrorErrors?.has(mod.id) ? `<span class="nb-badge nb-warn" title="${escapeAttr(`Nextcloud: ${this._mirrorErrors.get(mod.id)}`)}">☁️ ⚠</span>` : '') + (own
        ? `<button type="button" class="nb-status ${on ? 'on' : ''}" title="${on ? 'Aktiv – klicken zum Deaktivieren' : 'Inaktiv – klicken zum Aktivieren'}">${on ? '●' : '○'}</button>
           <button type="button" class="nb-edit" title="Bearbeiten">✏️</button>`
        : ''),
      drag: own && !mod.parentId ? { type: 'module', id: mod.id, topicId: topic.id } : null,
    });
    // Mit Vorschau: Klick zeigt das Modul rechts, Doppelklick (oder ✏️) öffnet den Editor.
    const open = () => this.app.modulesView.openFrom('teacher-notebooks', topic.id, mod, own ? 'edit' : 'preview');
    const title = row.querySelector('.nb-title');
    title.addEventListener('click', () => { if (this._preview.open) this._preview.showModule(topic, mod); else open(); });
    title.addEventListener('dblclick', () => { if (this._preview.open) open(); });
    row.querySelector('.nb-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.modulesView.openFrom('teacher-notebooks', topic.id, mod, 'edit');
    });
    row.querySelector('.nb-status')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.app.api.toggleModuleSelection(topic.id, mod.id, !on);
      mod.moduleSelected = !on;
      this._render();
    });
    this._menuOn(row, () => this._moduleMenu(topic, mod));
    if (own && !mod.parentId) {
      this._bindDrop(row, { type: 'module', id: mod.id, topicId: topic.id });
      this._selectable(row, { type: 'module', id: mod.id, topicId: topic.id });
    }
    return row;
  }

  // ---------- Erworbene Bereiche (Spiegel) ----------

  /**
   * Ein per Use erworbenes Book, Bereich oder Abschnitt: die Struktur des
   * Anbieters, schreibgeschützt und immer aktuell. Als Ganzes lässt es sich
   * verschieben; darin ändert sich nur, was der Anbieter ändert.
   */
  _renderMirror(item, depth) {
    const m = item.mirror;
    const key = 'x:' + m.offerId;
    const open = this._isOpen(key);
    const root = m.nodes.find((n) => !n.parentId);
    const count = m.topics.length;
    const wrap = document.createElement('div');
    const row = this._row({
      key, depth, icon: KIND[m.kind]?.icon || '📂', title: m.title, open,
      cls: 'nb-node nb-mirror',
      meta: `${count} Lernthem${count === 1 ? 'a' : 'en'}${m.onlyForeign ? ' · nur die erworbenen Module (zu deiner Kopie)' : ''}`,
      extra: `<span class="nb-badge" title="Zur Nutzung erworben – gehört ${escapeAttr(m.sellerName)}; was dort dazukommt, erscheint hier automatisch">🔗 ${escapeHtml(m.sellerName)}</span>`,
      drag: { type: 'topic', id: item.id },
    });
    this._menuOn(row, () => this._mirrorMenu(item));
    this._bindDrop(row, { type: 'topic', id: item.id, own: false });
    wrap.appendChild(row);
    if (open && root) this._renderMirrorChildren(wrap, m, root.id, depth + 1);
    return wrap;
  }

  _renderMirrorChildren(wrap, m, nodeId, depth) {
    const topicsById = new Map(m.topics.map((t) => [t.id, t]));
    for (const n of m.nodes.filter((x) => x.parentId === nodeId).sort((a, b) => a.orderIndex - b.orderIndex)) {
      const key = `x:${m.offerId}:${n.id}`;
      const open = this._isOpen(key);
      const row = this._row({ key, depth, icon: KIND[n.kind].icon, title: n.title, open, cls: 'nb-node nb-mirror-row' });
      row.querySelector('.nb-menu-btn').remove();
      wrap.appendChild(row);
      if (open) this._renderMirrorChildren(wrap, m, n.id, depth + 1);
    }
    for (const p of m.placements.filter((x) => x.nodeId === nodeId).sort((a, b) => a.orderIndex - b.orderIndex)) {
      const t = topicsById.get(p.topicId);
      if (!t || (this._query && !this._topicHasMatch(t))) continue;
      wrap.appendChild(this._renderTopic({ ...t, isOwn: false }, depth, true));
    }
  }

  _mirrorMenu(item) {
    const m = item.mirror;
    const items = [
      { label: '🔗 Quick-Link', title: 'Ein Link mit allen Lernthemen darin – Schüler wählen ihre Klasse', run: () => this._quickLinkNode({ id: item.id, title: m.title, kind: m.kind }) },
      { label: '↔️ Verschieben nach…', run: () => this._moveTopicDialog(item) },
    ];
    // Das Nutzungsrecht zu einer Kopie gehört zur Kopie.
    if (!m.onlyForeign) {
      items.push('-', {
        label: '↩ Zurückgeben', danger: true,
        run: async () => {
          const grants = m.grants.filter((g) => !g.onlyForeign);
          if (await this.app.topicsView.returnGrant({ title: m.title, grants })) this.refresh();
        },
      });
    }
    return items;
  }

  _mirrorTopicMenu(topic) {
    return [
      { label: '🔗 Quick-Link', run: () => this.app.topicsView._createQuickClassLink({ id: topic.id, title: topic.title, selected: true }) },
      { label: '👁 Ansehen', run: () => this.app.topicsView._openSharedTopicViewer(topic) },
      this._rateItem(topic.id),
    ];
  }

  /** Bewerten eines genutzten oder kopierten Lernthemas (bei einer Kopie: das Original). */
  _rateItem(topicId, label = '⭐ Bewerten') {
    return { label, title: 'Nützlichkeit bewerten, Danke sagen, Rückmeldung an die Creator', run: () => openFeedbackDialog(this.app, topicId) };
  }

  // ---------- Anbieten ----------

  /**
   * Module auswählen und als eigenes Angebot in den Shop stellen – aus einem
   * Lernthema oder allen eigenen Lernthemen unter einem Knoten.
   */
  async _offerSelection({ nodeId = null, topicId = null }) {
    const topics = topicId
      ? [this._topics.get(topicId)]
      : this._topicsBelow(nodeId).filter((t) => t.isOwn);
    const withModules = topics.filter((t) => t && (t.modules || []).some((m) => !m.parentId));
    if (!withModules.length) { this.app.showToast('Darin gibt es keine eigenen Lernthemen mit Modulen.', 'error'); return; }
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card nb-dialog">
        <h3>🧩 Module auswählen und anbieten</h3>
        <p class="hint">Die Auswahl wird ein eigenes Angebot im Shop. Erworbene Module (✳) lassen sich nur zur Nutzung anbieten.</p>
        <div class="nb-targets nb-pick">${withModules.map((t) => `
          <label class="nb-pick-topic"><input type="checkbox" class="nb-pick-all" data-topic="${escapeAttr(t.id)}" /> 📘 <strong>${escapeHtml(t.title)}</strong></label>
          ${(t.modules || []).filter((m) => !m.parentId).sort((a, b) => a.orderIndex - b.orderIndex).map((m) => `
            <label class="nb-pick-module"><input type="checkbox" class="nb-pick-mod" data-topic="${escapeAttr(t.id)}" value="${escapeAttr(m.id)}" />
              ${escapeHtml(m.title)}${m.isMine === false ? ' <span class="hint" title="erworben – nur zur Nutzung">✳</span>' : ''}</label>`).join('')}`).join('')}
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn btn-primary btn-ok" disabled>Weiter zum Angebot</button>
          <button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const ok = overlay.querySelector('.btn-ok');
    const chosen = () => [...overlay.querySelectorAll('.nb-pick-mod:checked')].map((c) => c.value);
    const sync = () => { ok.disabled = chosen().length === 0; };
    overlay.querySelectorAll('.nb-pick-all').forEach((all) => all.addEventListener('change', () => {
      overlay.querySelectorAll(`.nb-pick-mod[data-topic="${all.dataset.topic}"]`).forEach((c) => { c.checked = all.checked; });
      sync();
    }));
    overlay.querySelectorAll('.nb-pick-mod').forEach((c) => c.addEventListener('change', sync));
    overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
    ok.addEventListener('click', () => {
      const ids = chosen();
      overlay.remove();
      this.app.shopView.openForModules(ids);
    });
  }

  // ---------- Kontextmenü ----------

  _openMenu(items, x, y) {
    this._closeMenu();
    const menu = document.createElement('div');
    menu.className = 'nb-menu';
    menu.setAttribute('role', 'menu');
    for (const item of items) {
      if (item === '-') { menu.appendChild(Object.assign(document.createElement('hr'), { className: 'nb-menu-sep' })); continue; }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.className = item.danger ? 'nb-menu-item danger' : 'nb-menu-item';
      btn.textContent = item.label;
      if (item.title) btn.title = item.title;
      if (item.disabled) btn.disabled = true;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeMenu();
        Promise.resolve(item.run()).catch((err) => this.app.showToast('Fehler: ' + err.message, 'error'));
      });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    // Im Fenster halten.
    const r = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(x - r.width, window.innerWidth - r.width - 8));
    const top = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.querySelector('button')?.focus();
    this._menu = menu;
  }

  _closeMenu() {
    this._menu?.remove();
    this._menu = null;
  }

  _nodeMenu(node) {
    const items = [];
    if (node.kind !== 'section') items.push({ label: '➕ Neuer Bereich', run: () => this._createNode('area', node.id) });
    if (node.kind !== 'section') items.push({ label: '➕ Neuer Abschnitt', run: () => this._createNode('section', node.id) });
    items.push({ label: '➕ Neues Lernthema', run: () => this._createTopic(node.id) });
    items.push('-');
    items.push({ label: '🔗 Quick-Link', title: 'Ein Link mit allen Lernthemen darin – Schüler wählen ihre Klasse', run: () => this._quickLinkNode(node) });
    items.push({ label: '🛒 Teilen', title: 'Im Shop anbieten – Käufer mit „Use“ bekommen auch, was später dazukommt', run: () => this.app.shopView.openForNode(node.id) });
    items.push({ label: '🧩 Module auswählen und anbieten…', run: () => this._offerSelection({ nodeId: node.id }) });
    items.push({ label: '✅ Alle Lernthemen freigeben', run: () => this._setSelected(node, true) });
    items.push({ label: '⛔ Alle Lernthemen sperren', run: () => this._setSelected(node, false) });
    items.push('-');
    items.push({ label: '⬇️ Download (ZIP)', title: 'Struktur und alle eigenen Lernthemen darin als JSON', run: () => this._download(node) });
    items.push({ label: '📥 Hier importieren', run: () => this._import(node.id) });
    items.push({ label: '↔️ Verschieben nach…', run: () => this._moveNodeDialog(node) });
    items.push({ label: '📋 Kopieren', run: () => this._copyNode(node) });
    items.push({ label: '✏️ Umbenennen', run: () => this._renameNode(node) });
    // Hoch- und runterstufen
    if (node.kind === 'area') {
      const hasFolders = this._nodesIn(node.id).length > 0;
      items.push({
        label: '⤵ In Abschnitt umwandeln',
        title: hasFolders ? 'Geht erst, wenn keine Bereiche oder Abschnitte mehr darin liegen – ein Abschnitt enthält nur Lernthemen' : 'Bleibt an seinem Platz, enthält danach nur noch Lernthemen',
        disabled: hasFolders,
        run: () => this._convertNode(node, 'section'),
      });
    }
    if (node.kind === 'section') items.push({ label: '⤴ In Bereich umwandeln', title: 'Kann danach selbst Bereiche und Abschnitte aufnehmen', run: () => this._convertNode(node, 'area') });
    if (node.kind !== 'book') {
      items.push({ label: '⤴ Zu Book machen', title: 'Wandert samt Inhalt ganz nach oben', run: () => this._convertNode(node, 'book') });
      items.push({ label: '📂 Bereich darüber einfügen…', title: 'Neuer Bereich an dieser Stelle – dieser Eintrag kommt hinein', run: () => this._wrapNode(node) });
    }
    items.push({ label: '🏷 Tags', title: 'Tags vererben sich auf alle Lernthemen darunter', run: () => this._editNodeTags(node) });
    if (this._docsEnabled()) {
      items.push('-');
      items.push({ label: '📄 Dokument-Einstellungen…', title: 'Kurs, Kopfzeile, Nummerierung und KI-Vorgaben für die Dokumente darunter', run: () => this._editDocSettings(node) });
      items.push({ label: '⬇️ Als Kurs exportieren', title: 'Dokumente darunter als Kurs für den Arbeitsblatt-Generator (ZIP)', run: () => this._exportCourse(node) });
      items.push({ label: '📚 Als Skript (PDF)', title: 'Alle Arbeitsblätter darunter als Skript mit Inhaltsverzeichnis – zum Nachlesen, ohne Karopapier', run: () => this._script(node, 'pdf') });
      items.push({ label: '📚 Skript als .odt / Lösung', title: 'Skript für LibreOffice, dazu die Fassung mit sichtbaren Lösungen', run: () => this._script(node, 'odt') });
      items.push({ label: '📓 Dokumente als OneNote-Seite', title: 'Gliederung der Dokumente mit Klassenlink und QR-Code in die Zwischenablage', run: () => this._oneNoteDocs(node) });
    }
    items.push('-');
    items.push({ label: '🗑 Löschen', danger: true, run: () => this._deleteNode(node) });
    return items;
  }

  // ---------- Dokumente (Modultyp „Dokument“, Freischaltung 'worksheets') ----------

  /** Vorlagen verwalten: eigene, und als Schuladmin die der Schule. */
  async _templatesDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<div class="import-modules-card nb-dialog nb-templates">
        <h3>🖨 Vorlagen für den Druck</h3>
        <p class="hint">LibreOffice-Vorlagen (.ott) mit <code>{{TITEL}}</code> in der Kopfzeile und einem Absatz <code>{{INHALT}}</code>.
          Welche gilt: am Ordner gewählt → dein Standard (★) → Standard der Schule → Grundvorlage.</p>
        <div class="nb-tpl-list"></div>
        <form class="nb-tpl-upload">
          <h4>Neue Vorlage</h4>
          <div class="ai-prompt-row">
            <label>Datei <input type="file" name="file" accept=".ott,.odt,application/vnd.oasis.opendocument.text-template,application/vnd.oasis.opendocument.text" required></label>
            <label>Name <input name="name" maxlength="80" placeholder="z. B. Schulvorlage AB"></label>
            <label>Art <select name="kind"><option value="arbeitsblatt">Arbeitsblatt (auch Text)</option><option value="klassenarbeit">Klassenarbeit</option><option value="skript">Skript (mit Inhaltsverzeichnis)</option></select></label>
            <label class="nb-tpl-scope hidden">Für <select name="scope"><option value="own">mich</option><option value="school">die ganze Schule</option></select></label>
          </div>
          <div class="confirm-actions"><button type="submit" class="btn btn-primary">⬆ Hochladen und prüfen</button></div>
          <p class="hint nb-tpl-msg"></p>
        </form>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary btn-close">Schließen</button></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.btn-close').addEventListener('click', () => overlay.remove());
    const list = overlay.querySelector('.nb-tpl-list');
    const msg = overlay.querySelector('.nb-tpl-msg');
    const load = async () => {
      const res = await this.app.api.listDocTemplates();
      if (failed(res)) { list.innerHTML = `<p class="hint">Fehler: ${escapeHtml(res?.message || '?')}</p>`; return; }
      overlay.querySelector('.nb-tpl-scope').classList.toggle('hidden', !res.mayManageSchool);
      const kinds = { arbeitsblatt: 'Arbeitsblatt', klassenarbeit: 'Klassenarbeit', skript: 'Skript' };
      list.innerHTML = res.templates.length ? `<table class="nb-tpl-table"><thead><tr><th></th><th>Name</th><th>Art</th><th>Für</th><th></th></tr></thead><tbody>
        ${res.templates.map((t) => {
          const mine = t.scope === 'own' || res.mayManageSchool;
          return `<tr data-id="${escapeAttr(t.id)}">
            <td><button type="button" class="nb-tpl-star" ${mine ? '' : 'disabled'} title="${t.isDefault ? 'Standard – klicken zum Aufheben' : 'Als Standard für diese Art setzen'}">${t.isDefault ? '★' : '☆'}</button></td>
            <td>${escapeHtml(t.name)}${!t.hasContent ? ' <span class="nb-warn" title="Kein Absatz {{INHALT}} – der Inhalt kommt ans Ende">⚠</span>' : ''}</td>
            <td>${kinds[t.kind] || t.kind}</td><td>${t.scope === 'own' ? 'mich' : 'Schule'}</td>
            <td><button type="button" class="btn btn-secondary btn-sm nb-tpl-sample">🖨 Probeblatt</button>
              ${mine ? '<button type="button" class="btn btn-danger btn-sm nb-tpl-del">🗑</button>' : ''}</td></tr>`;
        }).join('')}</tbody></table>` : '<p class="hint">Noch keine Vorlagen – es gilt die Grundvorlage.</p>';
      list.querySelectorAll('tr[data-id]').forEach((tr) => {
        const t = res.templates.find((x) => x.id === tr.dataset.id);
        tr.querySelector('.nb-tpl-star').addEventListener('click', async () => { await this.app.api.setDocTemplateDefault(t.id, !t.isDefault); load(); });
        tr.querySelector('.nb-tpl-del')?.addEventListener('click', async () => {
          if (!(await this.app.appConfirm(`Vorlage „${t.name}“ löschen? Dokumente, die sie nutzen, bekommen den Standard bzw. die Grundvorlage.`))) return;
          await this.app.api.deleteDocTemplate(t.id);
          load();
        });
        tr.querySelector('.nb-tpl-sample').addEventListener('click', async (e) => {
          const win = window.open('', '_blank');
          e.target.disabled = true;
          try { win.location.href = URL.createObjectURL(await this.app.api.docTemplateSample(t.id)); } catch (err) { win?.close(); this.app.showToast('Fehler: ' + err.message, 'error'); }
          e.target.disabled = false;
        });
      });
    };
    overlay.querySelector('.nb-tpl-upload').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      msg.textContent = 'Wird hochgeladen und geprüft …';
      const res = await this.app.api.uploadDocTemplate(f.file.files[0], { name: f.name.value, kind: f.kind.value, scope: f.scope.value });
      if (failed(res) || !res.success) { msg.textContent = `❌ ${res?.message || 'Hochladen fehlgeschlagen'}`; return; }
      msg.textContent = res.warnings?.length ? `✅ Hochgeladen – ⚠️ ${res.warnings.join(' ⚠️ ')}` : '✅ Hochgeladen.';
      e.target.reset();
      load();
    });
    load();
  }

  /** Stand des Nextcloud-Abbilds über dem Baum. */
  async _loadMirror() {
    document.getElementById('btnDocTemplates')?.classList.toggle('hidden', !this._docsEnabled());
    if (!this._mirrorBar) return;
    if (!this._docsEnabled()) { this._mirrorBar.classList.add('hidden'); return; }
    const st = await this.app.api.getDocMirror().catch(() => null);
    if (!st || failed(st)) { this._mirrorBar.classList.add('hidden'); return; }
    this._renderMirror(st);
  }

  _renderMirror(st) {
    const bar = this._mirrorBar;
    const hadErrors = this._mirrorErrors?.size || 0;
    this._mirrorErrors = new Map((st.errors || []).map((e) => [e.moduleId, e.error]));
    bar.classList.remove('hidden');
    if (!st.store) {
      bar.innerHTML = '<span class="hint">☁️ Dokumente kommen in die Nextcloud, sobald eine verbunden ist (Home-Menü → ☁️ Nextcloud).</span>';
      return;
    }
    const mb = st.size != null ? ` · ${(st.size / 1024 / 1024).toFixed(1)} MB` : '';
    const when = st.lastSync ? ` · zuletzt ${new Date(st.lastSync).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : '';
    const errs = st.errors?.length ? ` · <span class="nb-warn" title="${escapeAttr(st.errors.map((e) => `${e.title}: ${e.error}`).join('\n'))}">⚠ ${st.errors.length} Fehler</span>` : '';
    bar.innerHTML = `<span>☁️ Nextcloud: <code>${escapeHtml(st.folder)}</code> – ${st.documents} Dokument${st.documents === 1 ? '' : 'e'}, ${st.files} Dateien${mb}${when}${errs}${st.running ? ' · läuft …' : ''}</span>
      <button type="button" class="btn btn-secondary btn-sm">⟳ Jetzt abgleichen</button>`;
    bar.querySelector('button').addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Wird abgeglichen …';
      const res = await this.app.api.syncDocMirror().catch((err) => ({ message: err.message }));
      if (failed(res) || !res.status) {
        this.app.showToast('Fehler: ' + (res?.message || 'Abgleich fehlgeschlagen'), 'error');
        e.target.disabled = false;
        e.target.textContent = '⟳ Jetzt abgleichen';
        return;
      }
      const r = res.report;
      if (res.skipped) this.app.showToast('Abgleich übersprungen: ' + ({ store: 'keine Nextcloud verbunden', renderer: 'kein Renderer eingetragen', feature: 'nicht freigeschaltet' }[res.skipped] || res.skipped), 'info');
      else this.app.showToast(`Nextcloud abgeglichen: ${r.written} geschrieben, ${r.moved} verschoben, ${r.saved} gesichert${r.errors.length ? `, ${r.errors.length} Fehler` : ''}.`, r.errors.length ? 'info' : 'success');
      this._renderMirror(res.status);
      if (hadErrors || res.status.errors?.length) this._render();
    });
  }

  _docsEnabled() {
    return (this.app.state.currentUser?.features || []).includes('worksheets');
  }

  /** Dokumente unterhalb eines Ordners in der Reihenfolge des Baums: „2.1 Der AD-Wandler“. */
  _docLines(nodeId) {
    const lines = [];
    const docs = (t) => (t.modules || []).filter((m) => m.type === 'document').sort((a, b) => a.orderIndex - b.orderIndex);
    const walk = (id) => {
      for (const k of this._nodesIn(id)) walk(k.id);
      for (const t of this._topicsIn(id)) {
        if (t.isMirror) continue;
        for (const m of docs(t)) lines.push(`${this._data.docNumbers?.[m.id] ? `${this._data.docNumbers[m.id]} ` : ''}${m.title}`);
      }
    };
    walk(nodeId);
    return lines;
  }

  /** Skript eines Ordners: PDF im neuen Fenster bzw. .odt und Lösung als Download. */
  async _script(node, kind) {
    const win = kind === 'pdf' ? window.open('', '_blank') : null;
    this.app.showToast('Skript wird erzeugt – das kann bei vielen Blättern eine Weile dauern …', 'info');
    try {
      const outputs = kind === 'pdf' ? ['pdf'] : ['odt', 'loesung'];
      let notes = [];
      for (const output of outputs) {
        const { blob, name, warnings } = await this.app.api.docScript(node.id, output);
        notes = warnings;
        if (win) win.location.href = URL.createObjectURL(blob);
        else downloadBlob(blob, name);
      }
      this.app.showToast(notes.length ? `Skript erzeugt – Hinweise: ${notes.join(' · ')}` : 'Skript erzeugt.', notes.length ? 'info' : 'success');
    } catch (err) {
      win?.close();
      this.app.showToast('Fehler: ' + err.message, 'error');
    }
  }

  /** OneNote-Seite: Gliederung der Dokumente, Klassenlink und QR-Code. */
  async _oneNoteDocs(node) {
    const lines = this._docLines(node.id);
    if (!lines.length) { this.app.showToast('Darin liegen keine Dokumente.', 'error'); return; }
    const classes = await pickClass(this.app, {
      title: `📓 OneNote-Seite – ${node.title}`,
      hint: 'Für welche Klasse? Die Seite enthält die Gliederung der Dokumente und einen Klassenlink zu allen Lernthemen darin – Schüler sehen die Dokumente dort und können sie als PDF holen.',
      multiple: false,
    });
    const klasse = Array.isArray(classes) ? classes[0] : classes;
    if (!klasse) return;
    const link = await this.app.api.classLinkFromNotebookNode(node.id, klasse.id);
    if (!link?.id) { this.app.showToast('Fehler: ' + (link?.message || 'Link konnte nicht erzeugt werden.'), 'error'); return; }
    const share = await this.app.api.shareLink(link.id, false, 'practice');
    if (!share?.url) { this.app.showToast('Fehler: ' + (share?.message || 'Link konnte nicht erzeugt werden.'), 'error'); return; }
    const box = document.createElement('div');
    box.innerHTML = share.qrSvg || '';
    const ok = await copyOneNotePage({ title: `${node.title} – ${klasse.name}`, lines, svg: box.querySelector('svg'), url: share.url });
    this.app.showToast(ok ? 'OneNote-Seite kopiert – in OneNote einfügen mit Strg+V.' : 'Kopieren klappt hier nicht – bitte den Link aus der Link-Ansicht nehmen.', ok ? 'success' : 'error');
  }

  /** Kleines Zeichen an Ordnern mit eigenen Dokument-Einstellungen. */
  _docBadge(node) {
    const s = node.docSettings;
    if (!s) return '';
    const bits = [s.kurs && `Kurs „${s.kurs}“`, s.numberRoot && 'Zählung beginnt hier', s.numberFlat && 'durchgezählt'].filter(Boolean);
    return bits.length ? `<span class="nb-badge" title="${escapeAttr(bits.join(' · '))}">📄</span>` : '';
  }

  async _editDocSettings(node) {
    const s = node.docSettings || {};
    const inherited = this._inheritedDocSettings(node.parentId);
    const tplRes = await this.app.api.listDocTemplates().catch(() => null);
    const tpls = Array.isArray(tplRes?.templates) ? tplRes.templates : [];
    const tplSelect = (kind, label) => `<label>${label} <select name="tpl_${kind}"><option value="">wie darüber bzw. Standard</option>
      ${tpls.filter((t) => t.kind === kind).map((t) => `<option value="${escapeAttr(t.id)}" ${s.templates?.[kind] === t.id ? 'selected' : ''}>${escapeHtml(t.name)}${t.scope === 'school' ? ' (Schule)' : ''}</option>`).join('')}</select></label>`;
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <form class="import-modules-card nb-dialog nb-doc-settings">
        <h3>📄 Dokument-Einstellungen – ${escapeHtml(node.title)}</h3>
        <p class="hint">Gelten für alle Dokumente darunter; leere Felder übernehmen, was darüber eingestellt ist.</p>
        <div class="form-group"><label>Kursname</label>
          <input name="kurs" maxlength="120" value="${escapeAttr(s.kurs || '')}" placeholder="${escapeAttr(inherited.kurs || 'z. B. Arduino')}"></div>
        <div class="form-group"><label>Kopfzeile (Titelmuster)</label>
          <input name="titelmuster" maxlength="200" value="${escapeAttr(s.titelmuster || '')}" placeholder="${escapeAttr(inherited.titelmuster || '{kurs} {pfad} – {titel}')}">
          <span class="hint">Platzhalter: {kurs} {pfad} (z. B. 2.1) {nummer} (nur die letzte Stelle) {titel} {abschnitt} {autor}</span></div>
        <div class="form-group"><label>Autor</label>
          <input name="autor" maxlength="120" value="${escapeAttr(s.autor || '')}" placeholder="${escapeAttr(inherited.autor || '')}"></div>
        <div class="form-group">
          <label class="nb-check"><input type="checkbox" name="numberRoot" ${s.numberRoot || (s.numberRoot !== false && s.kurs) || node.kind === 'book' ? 'checked' : ''} ${node.kind === 'book' ? 'disabled' : ''}> Zählung beginnt hier
            <span class="hint">– Ordner darüber erscheinen nicht in der Nummer${node.kind === 'book' ? ' (bei einem Book immer)' : '; mit eigenem Kursnamen von selbst'}</span></label>
          <label class="nb-check"><input type="checkbox" name="numberFlat" ${s.numberFlat ? 'checked' : ''}> Darunter durchzählen
            <span class="hint">– keine weiteren Ebenen, Unterordner gliedern nur noch</span></label>
        </div>
        <div class="form-group"><label>Vorlage für den Druck</label>
          <div class="ai-prompt-row">${tplSelect('arbeitsblatt', 'Arbeitsblatt / Text')}${tplSelect('klassenarbeit', 'Klassenarbeit')}${tplSelect('skript', 'Skript')}</div>
          <span class="hint">Vorlagen verwalten: 🖨 Vorlagen über dem Baum.</span></div>
        <div class="form-group"><label>Dateien in der Nextcloud</label>
          <div class="nb-formats">${[['odt', 'Blatt .odt'], ['loesung', 'Lösung .odt'], ['pdf', 'Blatt .pdf'], ['loesung_pdf', 'Lösung .pdf']].map(([f, l]) =>
            `<label class="nb-check"><input type="checkbox" name="format" value="${f}" ${(s.formats || inherited.formats || ['odt', 'loesung', 'pdf', 'loesung_pdf']).includes(f) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
          <span class="hint">Dazu immer die Quelle unter _Quellen/ (YAML).</span></div>
        <div class="form-group"><label>KI-Vorgaben</label>
          <textarea name="aiGuidelines" rows="6" maxlength="20000" placeholder="Fachliche Vorgaben für die KI, z. B. Hardware, Programmiersprache, Niveau">${escapeHtml(s.aiGuidelines || '')}</textarea></div>
        <div class="confirm-actions">
          <button type="submit" class="btn btn-primary">Speichern</button>
          <button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const close = () => overlay.remove();
    overlay.querySelector('.btn-cancel').addEventListener('click', close);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const res = await this.app.api.updateDocSettings(node.id, {
        kurs: f.kurs.value, titelmuster: f.titelmuster.value, autor: f.autor.value, aiGuidelines: f.aiGuidelines.value,
        // Ein Ordner mit eigenem Kurs zählt von selbst neu – abgewählt heißt dann ausdrücklich nein.
        numberRoot: node.kind === 'book' ? null : f.numberRoot.checked ? true : (f.kurs.value.trim() ? false : null),
        numberFlat: f.numberFlat.checked ? true : null,
        formats: [...form.querySelectorAll('input[name="format"]:checked')].map((x) => x.value),
        templates: { arbeitsblatt: f.tpl_arbeitsblatt.value || undefined, klassenarbeit: f.tpl_klassenarbeit.value || undefined, skript: f.tpl_skript.value || undefined },
      });
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Speichern fehlgeschlagen'), 'error'); return; }
      close();
      await this.refresh();
    });
  }

  /** Was oberhalb eines Ordners eingestellt ist – als Platzhalter im Dialog. */
  _inheritedDocSettings(nodeId) {
    const out = {};
    for (let n = nodeId ? this._nodes.get(nodeId) : null; n; n = n.parentId ? this._nodes.get(n.parentId) : null) {
      for (const k of ['kurs', 'titelmuster', 'autor', 'formats']) if (!out[k] && n.docSettings?.[k]) out[k] = n.docSettings[k];
    }
    return out;
  }

  async _exportCourse(node) {
    const res = await this.app.api.exportCourse(node.id);
    if (!res.success) { this.app.showToast('Fehler: ' + (res.error || 'Export fehlgeschlagen'), 'error'); return; }
    const notes = res.skipped?.length ? ` Hinweise: ${res.skipped.join(' · ')}` : '';
    this.app.showToast(`${res.count} Dokument${res.count === 1 ? '' : 'e'} als Kurs exportiert.${notes}`, notes ? 'info' : 'success');
  }

  _topicMenu(topic) {
    const me = this.app.state.currentUser?.id;
    const fromShop = topic.copiedFromOwnerId && topic.copiedFromOwnerId !== me;
    return [
      { label: '🔗 Quick-Link', run: () => this.app.topicsView._createQuickClassLink(topic) },
      { label: '🛒 Teilen', title: 'Im Shop anbieten oder weitergeben', run: () => this.app.shopView.openForTopic(topic.id) },
      { label: '🧩 Module auswählen und anbieten…', run: () => this._offerSelection({ topicId: topic.id }) },
      { label: '⬇️ Download', title: 'JSON, Moodle-XML, H5P oder verschlüsselt', run: () => this.app.topicsView.openExportDialog(topic) },
      '-',
      { label: '➕ Neues Modul', run: () => this.app.modulesView.openFrom('teacher-notebooks', topic.id, null) },
      { label: '📥 Module importieren', title: 'Datei oder eingefügter Text (z. B. KI-Antwort) als Module in dieses Thema', run: () => this._import(null, topic) },
      { label: '📦 Modulliste öffnen', title: 'Die gewohnte Modulverwaltung dieses Themas', run: () => this.app.modulesView.openTopicModules(topic.id) },
      '-',
      { label: '↔️ Verschieben nach…', run: () => this._moveTopicDialog(topic) },
      { label: '📋 Kopieren', run: () => this._copyTopic(topic) },
      { label: '✏️ Umbenennen / Beschreibung', run: () => this._editTopic(topic) },
      ...(fromShop ? [this._rateItem(topic.id, '⭐ Original bewerten')] : []),
      '-',
      { label: '🗑 Löschen', danger: true, run: async () => { if (await this.app.topicsView.deleteTopic(topic)) this.refresh(); } },
    ];
  }

  _grantedMenu(topic) {
    return [
      { label: '🔗 Quick-Link', run: () => this.app.topicsView._createQuickClassLink({ id: topic.id, title: topic.title, selected: true }) },
      { label: '👁 Ansehen', run: () => this.app.topicsView._openSharedTopicViewer(topic) },
      { label: '↔️ Verschieben nach…', run: () => this._moveTopicDialog(topic) },
      this._rateItem(topic.id),
      '-',
      { label: '↩ Zurückgeben', danger: true, run: async () => { if (await this.app.topicsView.returnGrant(topic)) this.refresh(); } },
    ];
  }

  _moduleMenu(topic, mod) {
    const open = (action) => this.app.modulesView.openFrom('teacher-notebooks', topic.id, mod, action);
    if (!topic.isOwn) return [{ label: '👁 Vorschau', run: () => open('preview') }];
    const items = [
      { label: '👁 Vorschau', run: () => open('preview') },
      { label: '✏️ Bearbeiten', run: () => open('edit') },
      { label: '📋 Duplizieren', run: () => this._transferModule(topic, mod, topic.id, 'copy') },
    ];
    if (!mod.parentId) {
      items.push({ label: '↔️ Verschieben nach…', run: () => this._moduleTargetDialog(topic, mod, 'move') });
      items.push({ label: '📄 Kopieren nach…', run: () => this._moduleTargetDialog(topic, mod, 'copy') });
    }
    items.push('-', { label: '🗑 Löschen', danger: true, run: () => this._deleteModule(topic, mod) });
    return items;
  }

  // ---------- Aktionen ----------

  async _ask(title, label, value = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <form class="import-modules-card nb-dialog">
          <h3>${escapeHtml(title)}</h3>
          <label class="nb-field">${escapeHtml(label)}<input type="text" maxlength="120" required value="${escapeAttr(value)}" /></label>
          <div class="confirm-actions">
            <button type="submit" class="btn btn-primary">OK</button>
            <button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button>
          </div>
        </form>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('input');
      input.focus();
      input.select();
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(input.value.trim() || null); });
      overlay.querySelector('.btn-cancel').addEventListener('click', () => done(null));
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    });
  }

  /** Kleine Tag-Chips in der Zeile (nur die eigenen Tags des Knotens). */
  _chips(tagIds) {
    const byId = new Map((this.app.state.tags || []).map((t) => [t.id, t]));
    const chips = (tagIds || []).map((id) => byId.get(id)).filter(Boolean).map((t) => chipHtml(t)).join('');
    return chips ? `<span class="nb-chips">${chips}</span>` : '';
  }

  /** Geerbte Tags eines Ortes: alle Tags der Knoten über und an `nodeId`. */
  _inheritedAt(nodeId) {
    const out = [];
    for (let n = this._nodes.get(nodeId); n; n = this._nodes.get(n.parentId)) out.unshift(...(n.tagIds || []));
    return [...new Set(out)];
  }

  async _editNodeTags(node) {
    const above = this._inheritedAt(node.parentId);
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <form class="import-modules-card nb-dialog">
        <h3>🏷 Tags – ${escapeHtml(node.title)}</h3>
        <p class="hint">Alle Lernthemen in ${escapeHtml(KIND[node.kind].a === 'ein Book' ? 'diesem Book' : `diesem ${KIND[node.kind].label}`)} – auch in Unterordnern – tragen diese Tags zusätzlich.</p>
        ${above.length ? `<p class="hint">Von oben geerbt: ${this._chips(above)}</p>` : ''}
        <div class="nb-tags"></div>
        <div class="confirm-actions">
          <button type="submit" class="btn btn-primary">Speichern</button>
          <button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    const picker = new TagPicker(this.app, overlay.querySelector('.nb-tags'));
    picker.render(node.tagIds || []);
    const close = () => overlay.remove();
    overlay.querySelector('.btn-cancel').addEventListener('click', close);
    overlay.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await this.app.api.updateNotebookNode(node.id, { tagIds: picker.selectedIds });
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Speichern fehlgeschlagen'), 'error'); return; }
      close();
      await this.app.loadTags();
      await this.refresh();
    });
  }

  async _createNode(kind, parentId) {
    const title = await this._ask(`➕ ${KIND[kind].label} anlegen`, 'Name');
    if (!title) return;
    const res = await this.app.api.createNotebookNode(kind, title, parentId);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Anlegen fehlgeschlagen'), 'error'); return; }
    if (parentId) this._open.add('n:' + parentId);
    this._saveOpen();
    await this.refresh();
  }

  /** Hoch- oder runterstufen. */
  async _convertNode(node, kind) {
    const res = await this.app.api.convertNotebookNode(node.id, kind);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Umwandeln fehlgeschlagen'), 'error'); return; }
    const asNoun = { book: 'ein Book', area: 'ein Bereich', section: 'ein Abschnitt' };
    this.app.showToast(`„${node.title}“ ist jetzt ${asNoun[kind]}.`, 'success');
    await this.refresh();
  }

  /** Bereich darüber einfügen: neuer Bereich an dieser Stelle, der Eintrag kommt hinein. */
  async _wrapNode(node) {
    const title = await this._ask(`📂 Bereich über „${node.title}“ einfügen`, 'Name des neuen Bereichs');
    if (!title) return;
    const res = await this.app.api.wrapNotebookNode(node.id, title);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Einfügen fehlgeschlagen'), 'error'); return; }
    this._open.add('n:' + res.id);
    this._saveOpen();
    await this.refresh();
  }

  async _renameNode(node) {
    const title = await this._ask(`✏️ ${KIND[node.kind].label} umbenennen`, 'Name', node.title);
    if (!title || title === node.title) return;
    const res = await this.app.api.updateNotebookNode(node.id, { title });
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Umbenennen fehlgeschlagen'), 'error'); return; }
    await this.refresh();
  }

  async _deleteNode(node) {
    const count = this._topicsBelow(node.id).length;
    const where = node.parentId ? `„${this._nodes.get(node.parentId)?.title}“` : '„Unsortiert“';
    const ok = await this.app.appConfirm(
      `${KIND[node.kind].label} „${node.title}“ samt Unterordnern löschen?` +
      (count ? `\n\nDie ${count} Lernthem${count === 1 ? 'a darin bleibt' : 'en darin bleiben'} erhalten und ${count === 1 ? 'rückt' : 'rücken'} nach ${where}.` : ''),
    );
    if (!ok) return;
    const res = await this.app.api.deleteNotebookNode(node.id);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Löschen fehlgeschlagen'), 'error'); return; }
    this.app.showToast(`${KIND[node.kind].label} gelöscht.`, 'info');
    await this.refresh();
  }

  async _createTopic(nodeId) {
    const title = await this._ask('➕ Neues Lernthema', 'Titel');
    if (!title) return;
    const topic = await this.app.api.saveTopic({ title, description: '' });
    if (failed(topic) || !topic.id) { this.app.showToast('Fehler: ' + (topic?.message || 'Anlegen fehlgeschlagen'), 'error'); return; }
    await this.app.api.moveInNotebook('topic', topic.id, nodeId, null);
    this._open.add('n:' + nodeId);
    this._open.add('t:' + topic.id);
    this._saveOpen();
    await this.refresh();
  }

  /** Titel, Beschreibung und Tags eines eigenen Lernthemas. */
  async _editTopic(topic) {
    // Geerbte Tags kommen vom Platz und lassen sich hier nicht abwählen.
    const inherited = this._placeOf.get(topic.id)?.inheritedTagIds || [];
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <form class="import-modules-card nb-dialog">
        <h3>✏️ Lernthema</h3>
        <label class="nb-field">Titel<input type="text" name="title" maxlength="200" required value="${escapeAttr(topic.title)}" /></label>
        <label class="nb-field">Beschreibung<textarea name="description" rows="3">${escapeHtml(topic.description || '')}</textarea></label>
        ${inherited.length ? `<div class="nb-field">Geerbt von Book, Bereich oder Abschnitt<span>${this._chips(inherited)}</span></div>` : ''}
        <div class="nb-field">Eigene Tags<div class="nb-tags"></div></div>
        <div class="confirm-actions">
          <button type="submit" class="btn btn-primary">Speichern</button>
          <button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    const picker = new TagPicker(this.app, overlay.querySelector('.nb-tags'));
    picker.render((topic.tagIds || []).filter((id) => !inherited.includes(id)));
    const close = () => overlay.remove();
    overlay.querySelector('.btn-cancel').addEventListener('click', close);
    overlay.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const res = await this.app.api.saveTopic({
        id: topic.id,
        title: form.title.value.trim(),
        description: form.description.value.trim(),
        tagIds: [...new Set([...picker.selectedIds, ...inherited])],
      }, true);
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Speichern fehlgeschlagen'), 'error'); return; }
      close();
      await this.refresh();
    });
  }

  async _copyTopic(topic) {
    const res = await this.app.api.copyTopicInNotebook(topic.id);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Kopieren fehlgeschlagen'), 'error'); return; }
    this.app.showToast(`„${topic.title}“ kopiert – die Kopie ist noch nicht freigegeben.`, 'success');
    await this.refresh();
  }

  async _copyNode(node) {
    const res = await this.app.api.copyNotebookNode(node.id);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Kopieren fehlgeschlagen'), 'error'); return; }
    const skipped = res.skipped?.length
      ? ` Nicht kopiert (zur Nutzung erworben): ${res.skipped.join(', ')}.`
      : '';
    this.app.showToast(`${KIND[node.kind].label} kopiert – ${res.copiedTopics} Lernthem${res.copiedTopics === 1 ? 'a' : 'en'}, noch nicht freigegeben.${skipped}`, 'success');
    await this.refresh();
  }

  async _setSelected(node, selected) {
    const res = await this.app.api.setNotebookNodeSelected(node.id, selected);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Ändern fehlgeschlagen'), 'error'); return; }
    this.app.showToast(`${res.changed} Lernthem${res.changed === 1 ? 'a' : 'en'} ${selected ? 'freigegeben' : 'gesperrt'}.`, 'info');
    await this.refresh();
  }

  async _quickLinkNode(node) {
    const mirror = this._topics.get(node.id)?.mirror;
    const below = mirror ? mirror.topics : this._topicsBelow(node.id).flatMap((t) => (t.isMirror ? t.mirror.topics : [t]));
    if (!below.length) { this.app.showToast('Darin ist noch kein Lernthema.', 'error'); return; }
    // Gesperrte eigene Themen kämen nicht mit – lieber vorher fragen.
    const locked = below.filter((t) => t.isOwn && !t.selected && (t.modules || []).length);
    if (locked.length) {
      const names = locked.slice(0, 5).map((t) => `„${t.title}“`).join(', ') + (locked.length > 5 ? ` und ${locked.length - 5} weitere` : '');
      const release = await this.app.appConfirm(
        `${locked.length} Lernthem${locked.length === 1 ? 'a ist' : 'en sind'} noch nicht für Schüler freigegeben: ${names}.\n\n` +
        'Jetzt alle freigeben und in den Quick-Link aufnehmen? Mit „Abbrechen“ entsteht der Link ohne sie.',
      );
      if (release) {
        await this.app.api.setNotebookNodeSelected(node.id, true);
        await this.refresh();
      }
    }
    // Ein Link mit allen Lernthemen darin. Später dazugekommene holt jedes
    // Öffnen in denselben Link (openQuickLink).
    await this.app.linksView.openQuickLink({ kind: 'node', id: node.id, title: node.title });
  }

  async _download(node) {
    const res = await this.app.api.exportNotebookNode(node.id);
    if (!res.success) { this.app.showToast('Fehler: ' + (res.error || 'Download fehlgeschlagen'), 'error'); return; }
    const skipped = res.skipped?.length ? ` Nicht enthalten (keine eigenen Module oder zur Nutzung erworben): ${res.skipped.join(', ')}.` : '';
    this.app.showToast(`${res.count} Lernthem${res.count === 1 ? 'a' : 'en'} heruntergeladen.${skipped}`, skipped ? 'info' : 'success');
  }

  /**
   * Einlesen über den Import-Dialog (views/import-dialog.js): mit `topic` als
   * Module in dieses Thema; sonst eine Notebook-Datei (ZIP aus „Download“)
   * als neuer Knoten bzw. ein Lernthema (Datei oder eingefügter Text) in den
   * Knoten `parentId`.
   */
  _import(parentId, topic = null) {
    const done = async () => { this._saveOpen(); await this.refresh(); };
    openImportDialog(this.app, {
      topicId: topic ? topic.id : null,
      h5p: !topic,
      extraFile: topic ? null : {
        ext: 'zip',
        label: this._docsEnabled()
          ? '🗂 Notebook-Datei oder Kurs aus dem Arbeitsblatt-Generator (ZIP mit kurs.yaml) – wird als Book, Bereich oder Abschnitt eingelesen.'
          : '🗂 Notebook-Datei – wird als Book, Bereich oder Abschnitt mit allen Lernthemen eingelesen.',
        run: async (file) => {
          const res = await this.app.api.importNotebook(file, parentId);
          if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Import fehlgeschlagen'), 'error'); return false; }
          const failedNote = (res.failed?.length ? ` Nicht einlesbar: ${res.failed.join(', ')}.` : '')
            + (res.warnings?.length ? ` Hinweise: ${res.warnings.join(' · ')}` : '');
          this.app.showToast(`„${res.title}“ eingelesen – ${res.importedTopics} Lernthem${res.importedTopics === 1 ? 'a' : 'en'}.${failedNote}`, failedNote ? 'info' : 'success');
          if (parentId) this._open.add('n:' + parentId);
          this._open.add('n:' + res.id);
          await done();
          return true;
        },
      },
      onDone: async (res) => {
        if (topic) this._open.add('t:' + topic.id);
        else {
          await this.app.api.moveInNotebook('topic', res.topicId, parentId, null);
          this._open.add('n:' + (parentId || ''));
        }
        await done();
      },
    });
  }

  async _deleteModule(topic, mod) {
    const users = topic.useCount
      ? `\n\n${topic.useCount} Person${topic.useCount === 1 ? ' verwendet' : 'en verwenden'} dieses Thema über den Shop – das Modul verschwindet auch bei ihnen.`
      : '';
    if (!(await this.app.appConfirm(`Modul „${mod.title}“ löschen?${users}`))) return;
    const res = await this.app.api.deleteModule(topic.id, mod.id);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Löschen fehlgeschlagen'), 'error'); return; }
    await this.refresh();
  }

  async _transferModule(topic, mod, targetTopicId, mode, beforeId = null) {
    const res = await this.app.api.transferModules(topic.id, targetTopicId, [mod.id], mode);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Fehlgeschlagen'), 'error'); return; }
    if (beforeId && mode === 'move') {
      // Verschoben landet hinten – an die Stelle des Ziels rücken.
      const target = this._topics.get(targetTopicId);
      const ids = (target.modules || []).filter((m) => !m.parentId).sort((a, b) => a.orderIndex - b.orderIndex).map((m) => m.id);
      const at = ids.indexOf(beforeId);
      ids.splice(at < 0 ? ids.length : at, 0, mod.id);
      await this.app.api.reorderModules(targetTopicId, ids);
    }
    this._open.add('t:' + targetTopicId);
    this._saveOpen();
    await this.refresh();
  }

  // ---------- Ziel wählen ----------

  /** Liste möglicher Ziele mit Einrückung; liefert den gewählten Wert oder undefined. */
  _pickTarget(title, entries, hint = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      // Ein Eintrag kann zusätzlich einen kleinen Knopf tragen (e.extra: { label, value }),
      // z. B. „neues Lernthema hier“ an einem Abschnitt.
      overlay.innerHTML = `
        <div class="import-modules-card nb-dialog">
          <h3>${escapeHtml(title)}</h3>
          ${hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ''}
          <div class="nb-targets">${entries.map((e, i) => `
            <div class="nb-target-row" style="--depth:${e.depth}">
              <button type="button" class="nb-target ${e.heading ? 'nb-target-heading' : ''}" data-i="${i}" ${e.disabled ? 'disabled' : ''}>
                ${e.icon} ${escapeHtml(e.label)}${e.note ? ` <span class="hint">${escapeHtml(e.note)}</span>` : ''}
              </button>
              ${e.extra ? `<button type="button" class="btn btn-secondary btn-sm nb-target-extra" data-i="${i}">${escapeHtml(e.extra.label)}</button>` : ''}
            </div>`).join('')}
          </div>
          <div class="confirm-actions"><button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button></div>
        </div>`;
      document.body.appendChild(overlay);
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelectorAll('.nb-target').forEach((b) => b.addEventListener('click', () => done(entries[Number(b.dataset.i)].value)));
      overlay.querySelectorAll('.nb-target-extra').forEach((b) => b.addEventListener('click', () => done(entries[Number(b.dataset.i)].extra.value)));
      overlay.querySelector('.btn-cancel').addEventListener('click', () => done(undefined));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(undefined); });
    });
  }

  /** Alle Knoten als Ziel-Einträge, in Baumreihenfolge. */
  _nodeEntries(test) {
    const out = [];
    const walk = (parentId, depth) => {
      for (const n of this._nodesIn(parentId)) {
        const verdict = test(n);
        if (verdict !== null) out.push({ icon: KIND[n.kind].icon, label: n.title, depth, value: n.id, disabled: !verdict });
        walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  async _moveNodeDialog(node) {
    if (node.kind === 'book') {
      this.app.showToast('Ein Book steht immer ganz oben – die Reihenfolge lässt sich per Ziehen ändern.', 'info');
      return;
    }
    const entries = this._nodeEntries((n) => (n.id === node.id || this._isInside(n.id, node.id) ? false : canHoldNode(n.kind, node.kind)));
    const target = await this._pickTarget(`↔️ „${node.title}“ verschieben nach …`, entries);
    if (target === undefined || target === node.parentId) return;
    const res = await this.app.api.moveInNotebook('node', node.id, target, null);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Verschieben fehlgeschlagen'), 'error'); return; }
    this._open.add('n:' + target);
    this._saveOpen();
    await this.refresh();
  }

  async _moveTopicDialog(topic) {
    const entries = [
      { icon: '📥', label: 'Unsortiert', depth: 0, value: null },
      ...this._nodeEntries(() => true),
    ];
    const target = await this._pickTarget(`↔️ „${topic.title}“ verschieben nach …`, entries);
    if (target === undefined) return;
    const res = await this.app.api.moveInNotebook('topic', topic.id, target, null);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Verschieben fehlgeschlagen'), 'error'); return; }
    this._open.add('n:' + (target || ''));
    this._saveOpen();
    await this.refresh();
  }

  /** Eigene Lernthemen als Ziel für ein Modul, gruppiert nach ihrem Platz. */
  /**
   * Ziel für ein Modul: ein eigenes Lernthema. Books, Bereiche und
   * Abschnitte sind nur Überschriften – mit „➕ neues Lernthema hier“ lässt
   * sich aber auch ein leerer Abschnitt wählen: Dort entsteht dann ein
   * Lernthema, und das Modul kommt hinein.
   */
  async _moduleTargetDialog(topic, mod, mode) {
    const target = await this._pickModuleTarget(
      `${mode === 'move' ? '↔️ Verschieben' : '📄 Kopieren'}: „${mod.title}“ nach …`,
      mode === 'move' ? topic.id : null, topic.id, mod.title,
    );
    if (target) await this._transferModule(topic, mod, target, mode);
  }

  /**
   * Eigenes Lernthema als Ziel wählen – oder in einem Abschnitt ein neues
   * anlegen. `blocked`: nicht wählbar (Verschieben in sich selbst), `here`:
   * als „(hier)“ markiert. Liefert die Themen-ID oder null.
   */
  async _pickModuleTarget(title, blocked, here, newTitle) {
    const entries = [];
    const addTopics = (nodeId, depth) => {
      for (const t of this._topicsIn(nodeId)) {
        if (!t.isOwn) continue;
        entries.push({ icon: '📘', label: t.title, depth, value: t.id, disabled: t.id === blocked, note: t.id === here ? '(hier)' : '' });
      }
    };
    const newHere = (nodeId) => ({ label: '➕ neues Lernthema hier', value: { newIn: nodeId } });
    entries.push({ icon: '📥', label: 'Unsortiert', depth: 0, value: undefined, disabled: true, heading: true, extra: newHere(null) });
    addTopics(null, 1);
    const walk = (parentId, depth) => {
      for (const n of this._nodesIn(parentId)) {
        entries.push({ icon: KIND[n.kind].icon, label: n.title, depth, value: undefined, disabled: true, heading: true, extra: newHere(n.id) });
        walk(n.id, depth + 1);
        addTopics(n.id, depth + 1);
      }
    };
    walk(null, 0);
    const target = await this._pickTarget(title, entries,
      'Ein Modul gehört in ein Lernthema (📘). Für einen leeren Abschnitt: „➕ neues Lernthema hier“.');
    if (!target) return null;
    if (typeof target === 'object' && 'newIn' in target) {
      const name = await this._ask('➕ Neues Lernthema für das Modul', 'Titel', newTitle);
      if (!name) return null;
      const created = await this.app.api.saveTopic({ title: name, description: '' });
      if (failed(created) || !created.id) { this.app.showToast('Fehler: ' + (created?.message || 'Anlegen fehlgeschlagen'), 'error'); return null; }
      await this.app.api.moveInNotebook('topic', created.id, target.newIn, null);
      if (target.newIn) this._open.add('n:' + target.newIn);
      return created.id;
    }
    return target;
  }

  // ---------- Mehrfachauswahl ----------

  _setSelMode(on) {
    this._selMode = on;
    this._btnSelect?.classList.toggle('active', on);
    this._btnSelect?.setAttribute('aria-pressed', String(on));
    if (!on) this._sel.clear();
    this._render();
  }

  /**
   * Zeile auswählbar machen. Strg/⌘+Klick schaltet um, Umschalt+Klick wählt
   * bis zur zuletzt geklickten Zeile; im Auswahlmodus genügt ein Klick.
   * Knöpfe in der Zeile (⋯, ●, ✏️, ▸) behalten ihre Aufgabe.
   */
  _selectable(row, item) {
    const key = (item.type === 'module' ? 'm:' : 't:') + item.id;
    row.dataset.selKey = key;
    row.classList.toggle('nb-selected', this._sel.has(key));
    if (this._selMode) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'nb-select';
      box.checked = this._sel.has(key);
      box.title = 'Auswählen';
      box.tabIndex = -1;
      row.prepend(box);
    }
    row.addEventListener('click', (e) => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey || this._selMode)) return;
      if (e.target.closest('.nb-menu-btn, .nb-status, .nb-edit, .nb-twisty')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey && this._selAnchor) this._selectRange(this._selAnchor, key, item.type);
      else this._toggleSel(key, item);
      this._selAnchor = key;
    }, true);
  }

  _toggleSel(key, item) {
    const first = this._sel.values().next().value;
    if (first && first.type !== item.type) this._sel.clear();
    if (this._sel.has(key)) this._sel.delete(key); else this._sel.set(key, item);
    this._syncSel();
  }

  /** Alle sichtbaren Zeilen derselben Sorte zwischen zwei Schlüsseln. */
  _selectRange(fromKey, toKey, type) {
    const prefix = type === 'module' ? 'm:' : 't:';
    const rows = [...this._tree.querySelectorAll(`[data-sel-key^="${prefix}"]`)];
    const a = rows.findIndex((r) => r.dataset.selKey === fromKey);
    const b = rows.findIndex((r) => r.dataset.selKey === toKey);
    if (a < 0 || b < 0) return;
    const first = this._sel.values().next().value;
    if (first && first.type !== type) this._sel.clear();
    for (const r of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) {
      const k = r.dataset.selKey;
      const id = k.slice(2);
      this._sel.set(k, type === 'module'
        ? { type, id, topicId: this._moduleTopic(id) }
        : { type, id, own: this._topics.get(id)?.isOwn });
    }
    this._syncSel();
  }

  _moduleTopic(moduleId) {
    for (const t of this._topics.values()) if ((t.modules || []).some((m) => m.id === moduleId)) return t.id;
    return null;
  }

  _clearSel() {
    this._sel.clear();
    this._selAnchor = null;
    this._syncSel();
  }

  /** Gewählte Einträge in Baumreihenfolge (sichtbare zuerst). */
  _selItems() {
    const order = [...this._tree.querySelectorAll('[data-sel-key]')].map((r) => r.dataset.selKey);
    return [...this._sel.entries()]
      .sort(([a], [b]) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9))
      .map(([, v]) => v);
  }

  /** Zeilen markieren und die Leiste der Auswahl zeigen – ohne den Baum neu aufzubauen. */
  _syncSel() {
    this._tree.querySelectorAll('[data-sel-key]').forEach((r) => {
      const on = this._sel.has(r.dataset.selKey);
      r.classList.toggle('nb-selected', on);
      const box = r.querySelector(':scope > .nb-select');
      if (box) box.checked = on;
    });
    const bar = this._selBar;
    if (!bar) return;
    const items = this._selItems();
    bar.classList.toggle('hidden', !items.length);
    if (!items.length) { bar.innerHTML = ''; return; }
    const modules = items[0].type === 'module';
    const n = items.length;
    const label = modules ? `${n} Modul${n === 1 ? '' : 'e'}` : `${n} Lernthem${n === 1 ? 'a' : 'en'}`;
    const actions = modules
      ? [['move', '↔️ Verschieben nach…'], ['copy', '📄 Kopieren nach…'], ['on', '● Aktivieren'], ['off', '○ Deaktivieren'], ['delete', '🗑 Löschen']]
      : [['move', '↔️ Verschieben nach…'], ['on', '● Freigeben'], ['off', '○ Sperren']];
    bar.innerHTML = `<strong>☑ ${label} ausgewählt</strong>
      ${actions.map(([act, text]) => `<button type="button" class="btn btn-${act === 'delete' ? 'danger' : 'secondary'} btn-sm" data-act="${act}">${text}</button>`).join('')}
      <button type="button" class="btn btn-secondary btn-sm" data-act="clear" title="Auswahl aufheben (Esc)">✕</button>
      <span class="hint">Ziehen einer gewählten Zeile nimmt alle mit.</span>`;
    bar.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this._selAction(b.dataset.act)));
  }

  async _selAction(act) {
    const items = this._selItems();
    if (act === 'clear' || !items.length) { this._clearSel(); return; }
    const modules = items[0].type === 'module';
    const n = items.length;
    try {
      if (modules && (act === 'move' || act === 'copy')) {
        const sources = [...new Set(items.map((i) => i.topicId))];
        const target = await this._pickModuleTarget(
          `${act === 'move' ? '↔️ Verschieben' : '📄 Kopieren'}: ${n} Modul${n === 1 ? '' : 'e'} nach …`,
          act === 'move' && sources.length === 1 ? sources[0] : null, sources.length === 1 ? sources[0] : null,
          this._topics.get(sources[0])?.title || 'Neues Lernthema',
        );
        if (!target) return;
        if (act === 'move') await this._moveModules(items, target);
        else await this._copyModules(items, target);
      } else if (!modules && act === 'move') {
        const target = await this._pickTarget(`↔️ ${n} Lernthem${n === 1 ? 'a' : 'en'} verschieben nach …`,
          [{ icon: '📥', label: 'Unsortiert', depth: 0, value: null }, ...this._nodeEntries(() => true)]);
        if (target === undefined) return;
        await this._moveTopics(items, target, null);
      } else if (act === 'on' || act === 'off') {
        for (const i of items) {
          if (modules) await this.app.api.toggleModuleSelection(i.topicId, i.id, act === 'on');
          else if (i.own) await this.app.api.toggleTopicSelection(i.id, act === 'on');
        }
        const skipped = modules ? 0 : items.filter((i) => !i.own).length;
        this.app.showToast(`${n - skipped} ${modules ? (act === 'on' ? 'aktiviert' : 'deaktiviert') : (act === 'on' ? 'freigegeben' : 'gesperrt')}.${skipped ? ` ${skipped} erworbene übersprungen.` : ''}`, 'success');
        await this.refresh();
        this._syncSel();
        return;
      } else if (modules && act === 'delete') {
        if (!(await this.app.appConfirm(`${n} Modul${n === 1 ? '' : 'e'} löschen? Das lässt sich nicht rückgängig machen.`))) return;
        for (const i of items) {
          const res = await this.app.api.deleteModule(i.topicId, i.id);
          if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Löschen fehlgeschlagen'), 'error'); break; }
        }
      } else return;
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
    }
    this._clearSel();
    await this.refresh();
  }

  /**
   * Module (aus einem oder mehreren Lernthemen) in ein Lernthema verschieben,
   * in ihrer Reihenfolge – mit `beforeId` vor dieses Modul, sonst ans Ende.
   */
  async _moveModules(items, targetTopicId, beforeId = null) {
    const groups = new Map();
    for (const i of items) groups.set(i.topicId, [...(groups.get(i.topicId) || []), i.id]);
    for (const [src, ids] of groups) {
      if (src === targetTopicId) continue;
      const res = await this.app.api.transferModules(src, targetTopicId, ids, 'move');
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Verschieben fehlgeschlagen'), 'error'); break; }
    }
    if (beforeId || groups.has(targetTopicId)) {
      await this.refresh();
      const all = (this._topics.get(targetTopicId)?.modules || []).filter((m) => !m.parentId)
        .sort((a, b) => a.orderIndex - b.orderIndex).map((m) => m.id);
      const moving = items.map((i) => i.id).filter((id) => all.includes(id));
      const rest = all.filter((id) => !moving.includes(id));
      const at = beforeId ? rest.indexOf(beforeId) : -1;
      rest.splice(at < 0 ? rest.length : at, 0, ...moving);
      await this.app.api.reorderModules(targetTopicId, rest);
    }
    this._open.add('t:' + targetTopicId);
    this._saveOpen();
    this._clearSel();
    await this.refresh();
  }

  async _copyModules(items, targetTopicId) {
    const groups = new Map();
    for (const i of items) groups.set(i.topicId, [...(groups.get(i.topicId) || []), i.id]);
    for (const [src, ids] of groups) {
      const res = await this.app.api.transferModules(src, targetTopicId, ids, 'copy');
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Kopieren fehlgeschlagen'), 'error'); break; }
    }
    this._open.add('t:' + targetTopicId);
    this._saveOpen();
  }

  /**
   * Lernthemen in einen Knoten (null = Unsortiert) verschieben. Mit `index`
   * an diese Stelle, in ihrer Reihenfolge: erst alle ans Ende, dann eines
   * nach dem anderen an seinen Platz – so stören die noch nicht platzierten
   * die Zählung nicht.
   */
  async _moveTopics(items, parentId, index) {
    for (const i of items) {
      const res = await this.app.api.moveInNotebook('topic', i.id, parentId, null);
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Verschieben fehlgeschlagen'), 'error'); await this.refresh(); return; }
    }
    if (index !== null && index !== undefined) {
      for (const [k, i] of items.entries()) await this.app.api.moveInNotebook('topic', i.id, parentId, index + k);
    }
    this._open.add('n:' + (parentId || ''));
    this._saveOpen();
    this._clearSel();
    await this.refresh();
  }

  // ---------- Ziehen und Ablegen ----------

  _bindDrag(row, drag) {
    row.addEventListener('dragstart', (e) => {
      // Gewählte Zeile: alle gewählten ziehen mit.
      const key = row.dataset.selKey;
      this._drag = key && this._sel.has(key) && this._sel.size > 1 ? { ...drag, multi: this._selItems() } : drag;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', drag.id); } catch (_) {}
      row.classList.add('nb-dragging');
    });
    row.addEventListener('dragend', () => {
      this._drag = null;
      row.classList.remove('nb-dragging');
      this._tree.querySelectorAll('.nb-drop-into, .nb-drop-before').forEach((el) => el.classList.remove('nb-drop-into', 'nb-drop-before'));
    });
  }

  /**
   * Was passiert, wenn `drag` auf `target` fällt: { mode: 'into'|'before', … }
   * oder null, wenn es dort nicht hingehört.
   */
  _dropPlan(drag, target, zone = 'middle') {
    if (!drag) return null;
    if (drag.multi) {
      // Nicht auf einen der gezogenen Einträge.
      if (drag.multi.some((i) => i.id === target.id)) return null;
      if (drag.type === 'module' && target.type === 'topic' && target.own) {
        return drag.multi.every((i) => i.topicId === target.id) ? null : { mode: 'into', topicId: target.id };
      }
    }
    if (drag.type === 'node') {
      if (target.type !== 'node' || !target.kind || target.id === drag.id || this._isInside(target.id, drag.id)) return null;
      const node = this._nodes.get(target.id);
      const parentKind = node.parentId ? this._nodes.get(node.parentId)?.kind : null;
      const before = canHoldNode(parentKind ?? null, drag.kind)
        ? { mode: 'before', parentId: node.parentId, index: this._nodesIn(node.parentId).filter((n) => n.id !== drag.id).findIndex((n) => n.id === node.id) }
        : null;
      const into = canHoldNode(target.kind, drag.kind) ? { mode: 'into', parentId: target.id } : null;
      // Oberes Drittel der Zeile: davor einsortieren, sonst hinein – so lassen
      // sich gleichrangige Bereiche umsortieren und trotzdem ineinanderlegen.
      if (zone === 'top') return before || into;
      return into || before;
    }
    if (drag.type === 'topic') {
      if (target.type === 'node') return { mode: 'into', parentId: target.id };
      if (target.type === 'topic' && target.id !== drag.id) {
        const place = this._placeOf.get(target.id);
        const siblings = this._topicsIn(place?.nodeId || null).filter((t) => t.id !== drag.id);
        return { mode: 'before', parentId: place?.nodeId || null, index: siblings.findIndex((t) => t.id === target.id) };
      }
      return null;
    }
    if (drag.type === 'module') {
      if (target.type === 'topic' && target.own && target.id !== drag.topicId) return { mode: 'into', topicId: target.id };
      if (target.type === 'module' && target.id !== drag.id) return { mode: 'before', topicId: target.topicId, beforeId: target.id };
      return null;
    }
    return null;
  }

  _bindDrop(row, target) {
    const zoneOf = (e) => {
      const r = row.getBoundingClientRect();
      return e.clientY - r.top < r.height / 3 ? 'top' : 'middle';
    };
    row.addEventListener('dragover', (e) => {
      const plan = this._dropPlan(this._drag, target, zoneOf(e));
      if (!plan) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.toggle('nb-drop-into', plan.mode === 'into');
      row.classList.toggle('nb-drop-before', plan.mode === 'before');
    });
    row.addEventListener('dragleave', () => row.classList.remove('nb-drop-into', 'nb-drop-before'));
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      row.classList.remove('nb-drop-into', 'nb-drop-before');
      const drag = this._drag;
      const plan = this._dropPlan(drag, target, zoneOf(e));
      this._drag = null;
      if (!plan) return;
      try {
        if (drag.multi) {
          if (drag.type === 'module') await this._moveModules(drag.multi, plan.topicId, plan.beforeId || null);
          else if (plan.mode === 'into') await this._moveTopics(drag.multi, plan.parentId, null);
          else {
            const moving = new Set(drag.multi.map((i) => i.id));
            const index = this._topicsIn(plan.parentId).filter((t) => !moving.has(t.id)).findIndex((t) => t.id === target.id);
            await this._moveTopics(drag.multi, plan.parentId, index < 0 ? null : index);
          }
          return;
        }
        if (drag.type === 'module') {
          const topic = this._topics.get(drag.topicId);
          const mod = (topic.modules || []).find((m) => m.id === drag.id);
          if (plan.topicId === drag.topicId) {
            const ids = (topic.modules || []).filter((m) => !m.parentId).sort((a, b) => a.orderIndex - b.orderIndex).map((m) => m.id).filter((id) => id !== drag.id);
            ids.splice(Math.max(0, ids.indexOf(plan.beforeId)), 0, drag.id);
            await this.app.api.reorderModules(drag.topicId, ids);
            await this.refresh();
          } else {
            await this._transferModule(topic, mod, plan.topicId, 'move', plan.beforeId || null);
          }
          return;
        }
        const res = await this.app.api.moveInNotebook(drag.type, drag.id, plan.parentId, plan.mode === 'before' ? plan.index : null);
        if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Verschieben fehlgeschlagen'), 'error'); return; }
        if (plan.mode === 'into') { this._open.add('n:' + (plan.parentId || '')); this._saveOpen(); }
        await this.refresh();
      } catch (err) {
        this.app.showToast('Fehler: ' + err.message, 'error');
      }
    });
  }
}
