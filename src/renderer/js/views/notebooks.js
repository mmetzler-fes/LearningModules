import { escapeHtml, escapeAttr, showImportReport } from '../utils.js';
import { pickClass } from './classes.js';
import { TagPicker, chipHtml } from './tags.js';
import { openFeedbackDialog } from './feedback.js';
import { CategoryPicker, openCategoryDialog } from './categories.js';

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
const DEPTH = { book: 0, area: 1, section: 2 };

/** Wie auf dem Server (notebook-rules.ts): Books oben, darunter nur tiefere Ebenen. */
function canHoldNode(parentKind, kind) {
  if (kind === 'book') return parentKind === null;
  if (parentKind === null) return false;
  return DEPTH[parentKind] < DEPTH[kind];
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
    this._search = document.getElementById('notebookSearch');
    this._data = null;
    this._open = loadOpen();
    this._drag = null;

    document.getElementById('btnNotebookNewBook')?.addEventListener('click', () => this._createNode('book', null));
    document.getElementById('btnNotebookImport')?.addEventListener('click', () => this._import(null));
    document.getElementById('btnNotebookExpand')?.addEventListener('click', () => this._expandAll(true));
    document.getElementById('btnNotebookCollapse')?.addEventListener('click', () => this._expandAll(false));
    this._search?.addEventListener('input', () => this._render());

    // Kontextmenü schließen: Klick daneben, Escape, Scrollen.
    document.addEventListener('click', (e) => { if (!e.target.closest('.nb-menu')) this._closeMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this._closeMenu(); });
    window.addEventListener('resize', () => this._closeMenu());
  }

  async refresh() {
    const data = await this.app.api.getNotebooks();
    if (failed(data) || !Array.isArray(data.nodes)) {
      this._tree.innerHTML = `<div class="empty-state"><p>Fehler: ${escapeHtml(data?.message || 'Notebooks nicht abrufbar')}</p></div>`;
      return;
    }
    this._data = data;
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

  _row({ key, depth, icon, title, meta = '', extra = '', twisty = true, open = false, cls = '', drag = null }) {
    const row = document.createElement('div');
    row.className = `nb-row ${cls}`;
    row.style.setProperty('--depth', depth);
    row.dataset.key = key;
    if (drag) row.draggable = true;
    row.innerHTML = `
      ${twisty ? `<button type="button" class="nb-twisty" aria-expanded="${open}" title="${open ? 'Zuklappen' : 'Aufklappen'}">${open ? '▾' : '▸'}</button>` : '<span class="nb-twisty-space"></span>'}
      <span class="nb-icon" aria-hidden="true">${icon}</span>
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
      key, depth, icon: KIND[node.kind].icon, title: node.title, open,
      cls: `nb-node nb-kind-${node.kind}`, meta: parts.join(' · '), extra: this._chips(node.tagIds),
      drag: { type: 'node', id: node.id, kind: node.kind },
    });
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
    this._menuOn(row, () => (own ? this._topicMenu(topic) : inMirror ? this._mirrorTopicMenu(topic) : this._grantedMenu(topic)));
    if (inMirror) { row.draggable = false; row.classList.add('nb-mirror-row'); } else this._bindDrop(row, { type: 'topic', id: topic.id, own });
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
      key: 'm:' + mod.id, depth, icon: type.icon || '🧩', title: mod.title, twisty: false,
      cls: `nb-module ${on ? '' : 'nb-off'} ${this._query && this._matches(mod.title) ? 'nb-hit' : ''}`,
      meta: escapeHtml(type.name || mod.type),
      extra: (this._draftIds?.has(mod.id) ? '<span class="nb-badge" title="Nicht gespeicherte Änderungen – beim Bearbeiten wiederherstellbar">📝 Entwurf</span>' : '') + (own
        ? `<button type="button" class="nb-status ${on ? 'on' : ''}" title="${on ? 'Aktiv – klicken zum Deaktivieren' : 'Inaktiv – klicken zum Aktivieren'}">${on ? '●' : '○'}</button>
           <button type="button" class="nb-edit" title="Bearbeiten">✏️</button>`
        : ''),
      drag: own && !mod.parentId ? { type: 'module', id: mod.id, topicId: topic.id } : null,
    });
    row.querySelector('.nb-title').addEventListener('click', () => this.app.modulesView.openFrom('teacher-notebooks', topic.id, mod, own ? 'edit' : 'preview'));
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
    if (own && !mod.parentId) this._bindDrop(row, { type: 'module', id: mod.id, topicId: topic.id });
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
      { label: '🔗 Quick-Link', title: 'Ein Klassenlink mit allen Lernthemen darin', run: () => this._quickLinkNode({ id: item.id, title: m.title, kind: m.kind }) },
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
    if (node.kind === 'book') items.push({ label: '➕ Neuer Bereich', run: () => this._createNode('area', node.id) });
    if (node.kind !== 'section') items.push({ label: '➕ Neuer Abschnitt', run: () => this._createNode('section', node.id) });
    items.push({ label: '➕ Neues Lernthema', run: () => this._createTopic(node.id) });
    items.push('-');
    items.push({ label: '🔗 Quick-Link', title: 'Ein Klassenlink mit allen Lernthemen darin', run: () => this._quickLinkNode(node) });
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
    items.push({ label: '🏷 Tags', title: 'Tags vererben sich auf alle Lernthemen darunter', run: () => this._editNodeTags(node) });
    items.push({ label: '🗂 Alles darin einordnen…', title: 'Fach und Bildungsstufe für alle eigenen Lernthemen darin', run: () => this._categorizeNode(node) });
    items.push('-');
    items.push({ label: '🗑 Löschen', danger: true, run: () => this._deleteNode(node) });
    return items;
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
      { label: '📦 Modulliste öffnen', title: 'Die gewohnte Modulverwaltung dieses Themas', run: () => this.app.modulesView.openTopicModules(topic.id) },
      '-',
      { label: '↔️ Verschieben nach…', run: () => this._moveTopicDialog(topic) },
      { label: '📋 Kopieren', run: () => this._copyTopic(topic) },
      { label: '✏️ Umbenennen / Beschreibung', run: () => this._editTopic(topic) },
      { label: '🗂 Einordnen…', title: 'Fach und Bildungsstufe – für alle gleich, damit andere es im Shop finden', run: () => this._categorizeTopic(topic) },
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

  /** Fach und Bildungsstufe eines eigenen Lernthemas. */
  async _categorizeTopic(topic) {
    const res = await openCategoryDialog(this.app, {
      title: `🗂 Einordnen: <em>${escapeHtml(topic.title)}</em>`,
      intro: 'Fach und Bildungsstufe sind für alle gleich – so finden andere dein Material im Shop.',
      selected: topic.categoryIds || [],
    });
    if (!res) return;
    const saved = await this.app.api.saveTopic({ id: topic.id, categoryIds: res.ids }, true);
    if (failed(saved)) { this.app.showToast('Fehler: ' + (saved?.message || 'Speichern fehlgeschlagen'), 'error'); return; }
    this.app.showToast('Eingeordnet', 'success');
    await this.refresh();
  }

  /** Alle eigenen Lernthemen eines Books, Bereichs oder Abschnitts auf einmal einordnen. */
  async _categorizeNode(node) {
    const res = await openCategoryDialog(this.app, {
      title: `🗂 Alles in ${KIND[node.kind].icon} <em>${escapeHtml(node.title)}</em> einordnen`,
      intro: 'Die gewählten Kategorien kommen zu allen eigenen Lernthemen darin dazu – auch in Unterordnern. Was die Lernthemen schon tragen, bleibt. „Entfernen“ nimmt die gewählten wieder weg.',
      actions: [
        { id: 'add', label: '➕ Hinzufügen', primary: true },
        { id: 'remove', label: '➖ Entfernen', danger: true },
      ],
    });
    if (!res) return;
    if (!res.ids.length) { this.app.showToast('Bitte mindestens eine Kategorie wählen.', 'error'); return; }
    const out = await this.app.api.categorizeNode(node.id, res.ids, res.action);
    if (failed(out)) { this.app.showToast('Fehler: ' + (out?.message || '?'), 'error'); return; }
    this.app.showToast(`${out.topics} Lernthem${out.topics === 1 ? 'a' : 'en'} ${res.action === 'add' ? 'eingeordnet' : 'geändert'}.`, 'success');
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
        <div class="nb-field">Fach und Bildungsstufe<div class="nb-cats"></div></div>
        <div class="nb-field">Eigene Tags<div class="nb-tags"></div></div>
        <div class="confirm-actions">
          <button type="submit" class="btn btn-primary">Speichern</button>
          <button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    const picker = new TagPicker(this.app, overlay.querySelector('.nb-tags'));
    picker.render((topic.tagIds || []).filter((id) => !inherited.includes(id)));
    const cats = new CategoryPicker(this.app, overlay.querySelector('.nb-cats'));
    cats.render(topic.categoryIds || []);
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
        categoryIds: cats.selectedIds,
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
    const classes = await pickClass(this.app, {
      title: `🔗 Quick-Link – ${node.title}`,
      hint: `Ein Klassenlink mit allen Lernthemen aus ${KIND[node.kind].a === 'ein Book' ? 'diesem Book' : `diesem ${KIND[node.kind].label}`}. Kommen später Lernthemen dazu, holt ein neuer Quick-Link sie in denselben Link.`,
      multiple: true,
    });
    if (!classes || !classes.length) return;
    await this.app.linksView.createClassLinks(classes, (k) => this.app.api.classLinkFromNotebookNode(node.id, k.id), 'practice');
  }

  async _download(node) {
    const res = await this.app.api.exportNotebookNode(node.id);
    if (!res.success) { this.app.showToast('Fehler: ' + (res.error || 'Download fehlgeschlagen'), 'error'); return; }
    const skipped = res.skipped?.length ? ` Nicht enthalten (keine eigenen Module oder zur Nutzung erworben): ${res.skipped.join(', ')}.` : '';
    this.app.showToast(`${res.count} Lernthem${res.count === 1 ? 'a' : 'en'} heruntergeladen.${skipped}`, skipped ? 'info' : 'success');
  }

  /**
   * Einlesen: Notebook-Datei (ZIP aus „Download“) als neuer Knoten, sonst
   * eine Themen-Datei (JSON, Moodle-XML, verschlüsselt) als Lernthema hierher.
   */
  _import(parentId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.json,.lmenc,.xml';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      if (/\.zip$/i.test(file.name)) {
        const res = await this.app.api.importNotebook(file, parentId);
        if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Import fehlgeschlagen'), 'error'); return; }
        const failedNote = res.failed?.length ? ` Nicht einlesbar: ${res.failed.join(', ')}.` : '';
        this.app.showToast(`„${res.title}“ eingelesen – ${res.importedTopics} Lernthem${res.importedTopics === 1 ? 'a' : 'en'}.${failedNote}`, failedNote ? 'info' : 'success');
        if (parentId) this._open.add('n:' + parentId);
        this._open.add('n:' + res.id);
      } else {
        const res = await this.app.api.importTopicFile(file);
        if (!res || !res.success) { this.app.showToast('Fehler: ' + (res?.message || 'Import fehlgeschlagen'), 'error'); return; }
        await this.app.api.moveInNotebook('topic', res.topicId, parentId, null);
        showImportReport(res);
        this.app.showToast(`„${res.topicTitle}“ eingelesen – ${res.importedCount} Modul(e).`, 'success');
        this._open.add('n:' + (parentId || ''));
      }
      this._saveOpen();
      await this.refresh();
    };
    input.click();
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
    const entries = [];
    const addTopics = (nodeId, depth) => {
      for (const t of this._topicsIn(nodeId)) {
        if (!t.isOwn) continue;
        entries.push({ icon: '📘', label: t.title, depth, value: t.id, disabled: t.id === topic.id && mode === 'move', note: t.id === topic.id ? '(hier)' : '' });
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
    const target = await this._pickTarget(
      `${mode === 'move' ? '↔️ Verschieben' : '📄 Kopieren'}: „${mod.title}“ nach …`,
      entries,
      'Ein Modul gehört in ein Lernthema (📘). Für einen leeren Abschnitt: „➕ neues Lernthema hier“.',
    );
    if (!target) return;
    if (typeof target === 'object' && 'newIn' in target) {
      const title = await this._ask('➕ Neues Lernthema für das Modul', 'Titel', mod.title);
      if (!title) return;
      const created = await this.app.api.saveTopic({ title, description: '' });
      if (failed(created) || !created.id) { this.app.showToast('Fehler: ' + (created?.message || 'Anlegen fehlgeschlagen'), 'error'); return; }
      await this.app.api.moveInNotebook('topic', created.id, target.newIn, null);
      if (target.newIn) this._open.add('n:' + target.newIn);
      await this._transferModule(topic, mod, created.id, mode);
      return;
    }
    await this._transferModule(topic, mod, target, mode);
  }

  // ---------- Ziehen und Ablegen ----------

  _bindDrag(row, drag) {
    row.addEventListener('dragstart', (e) => {
      this._drag = drag;
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
  _dropPlan(drag, target) {
    if (!drag) return null;
    if (drag.type === 'node') {
      if (target.type !== 'node' || !target.kind || target.id === drag.id || this._isInside(target.id, drag.id)) return null;
      if (canHoldNode(target.kind, drag.kind)) return { mode: 'into', parentId: target.id };
      const node = this._nodes.get(target.id);
      const parentKind = node.parentId ? this._nodes.get(node.parentId)?.kind : null;
      if (canHoldNode(parentKind ?? null, drag.kind)) {
        const index = this._nodesIn(node.parentId).filter((n) => n.id !== drag.id).findIndex((n) => n.id === node.id);
        return { mode: 'before', parentId: node.parentId, index };
      }
      return null;
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
    row.addEventListener('dragover', (e) => {
      const plan = this._dropPlan(this._drag, target);
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
      const plan = this._dropPlan(drag, target);
      this._drag = null;
      if (!plan) return;
      try {
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
