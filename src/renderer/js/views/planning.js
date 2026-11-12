/**
 * 🗂 Planung (docs/planung.md): zwei Spalten wie im Double Commander. Links das
 * Lernnotizbuch (fachlich), rechts die Pläne je Bildungsgang und Beruf. Mit
 * Tastatur: Tab wechselt die Spalte, F5 legt Verweise an, F6 verschiebt, F7
 * legt an, F8 entfernt, F2 benennt um, F3 zeigt den Plan, wie die Klasse ihn
 * bekommt. Server: src/plans.
 */
import { escapeHtml, escapeAttr, appConfirm } from '../utils.js';
import { pickClass } from './classes.js';
import { isDocLike } from '../quiz-usage.js';

const EXPAND_KEY = 'lm_plan_open';
const RIGHT_KEY = 'lm_plan_right';
const VIEW_KEY = 'lm_pl_view';
const PREVIEW_KEY = 'lm_pl_preview';
/** Hineingewechselt je Spalte (und rechts je Ansicht): { left: id, 'right:plans': id, … }. */
const FOCUS_KEY = 'lm_pl_focus';
const VIEWS = ['docs', 'quizzes', 'all'];
const ICON = { book: '📕', area: '📂', section: '📑', folder: '📁', plan: '📋', include: '🧩', mirror: '🛒', unsorted: '📥' };

function bad(res) {
  return !res || res.success === false || (res.statusCode && res.statusCode >= 400);
}

/** Tasten der Fußleiste – zugleich die Kurzhilfe. */
const KEYS = [
  ['Tab', 'Spalte'], ['Strg+↓', 'Hinein'], ['Strg+↑ / ⌫', 'Heraus'], ['F2', 'Umbenennen'], ['F3', 'Plan ansehen'], ['F5', 'Verweis →'], ['F6', 'Verschieben'],
  ['F7', 'Neu'], ['⇧F7', 'Neuer Plan / Abschnitt'], ['F8', 'Entfernen'], ['Leertaste', 'Markieren'], ['Alt+↑↓', 'Reihenfolge'], ['Strg+F', 'Suchen'],
];

export class PlanningView {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('planningRoot');
    this.nb = null;
    this.plans = null;
    /** Rechte Spalte: 'plans' oder die ID einer Klasse (ihr Klassennotizbuch). */
    try { this.rightMode = localStorage.getItem(RIGHT_KEY) || 'plans'; } catch (_) { this.rightMode = 'plans'; }
    try {
      const v = localStorage.getItem(VIEW_KEY) || localStorage.getItem('lm_nb_view');
      this.view = VIEWS.includes(v) ? v : 'all';
    } catch (_) {
      this.view = 'all';
    }
    this.cb = null;
    this.classList = [];
    this.active = 'left';
    this.cursor = { left: 0, right: 0 };
    this.marked = { left: new Set(), right: new Set() };
    this.filter = { left: '', right: '' };
    try { this.focusMap = JSON.parse(localStorage.getItem(FOCUS_KEY) || '{}') || {}; } catch (_) { this.focusMap = {}; }
    try { this.open = new Set(JSON.parse(localStorage.getItem(EXPAND_KEY) || '[]')); } catch (_) { this.open = new Set(); }
    try { this.previewOpen = localStorage.getItem(PREVIEW_KEY) !== '0'; } catch (_) { this.previewOpen = true; }
    this._topicModCache = new Map();
    this._previewKey = null;
    this._previewModId = null;
    this.rows = { left: [], right: [] };
    document.addEventListener('keydown', (e) => this._onKey(e));
  }

  _visible() {
    return document.getElementById('view-teacher-planning')?.classList.contains('active');
  }

  async refresh() {
    if (!this.root) return;
    if (!this.root.dataset.ready) this._skeleton();
    this._topicModCache.clear();
    this._previewKey = null;
    const [nb, plans, year] = await Promise.all([this.app.api.getNotebooks(), this.app.api.getPlans(), this.app.api.getSchoolYear()]);
    const classes = year?.current ? await this.app.api.getClasses(year.current) : [];
    this.classList = Array.isArray(classes) ? classes : [];
    if (this.rightMode !== 'plans' && this.rightMode !== 'notebook' && !this.classList.some((c) => c.id === this.rightMode)) this.rightMode = 'plans';
    this.cb = null;
    if (this.rightMode !== 'plans' && this.rightMode !== 'notebook') {
      const cb = await this.app.api.getClassbook(this.rightMode);
      if (bad(cb)) this.rightMode = 'plans'; else this.cb = cb;
    }
    this._modeSelect();
    if (bad(nb) || bad(plans)) {
      this.root.querySelector('.pl-panes').innerHTML = `<p class="empty-state">Fehler beim Laden: ${escapeHtml((nb && nb.message) || (plans && plans.message) || '?')}</p>`;
      return;
    }
    this.nb = nb;
    this.plans = plans;
    this._render();
  }

  _skeleton() {
    this.root.dataset.ready = '1';
    this.root.innerHTML = `
      <div class="pl-toolbar">
        <button class="btn btn-primary btn-sm" data-pl-new="folder" title="Ordner für einen Bildungsgang oder Beruf (F7 in der rechten Spalte)">➕ Ordner</button>
        <button class="btn btn-primary btn-sm" data-pl-new="plan" title="Plan, z. B. „1. Ausbildungsjahr“ (⇧F7)">➕ Plan</button>
        <button class="btn btn-secondary btn-sm" data-pl-new="area" title="Bereich im Plan, z. B. ein Lernfeld (F7 im Plan)">➕ Bereich</button>
        <button class="btn btn-secondary btn-sm" data-pl-new="section" title="Abschnitt im Plan – enthält nur Lernthemen (⇧F7 im Plan)">➕ Abschnitt</button>
        <button class="btn btn-secondary btn-sm" data-pl-act="include" title="Einen anderen Plan als Teilplan hier einbinden – ändert er sich, ändert er sich überall">🧩 Teilplan einbinden</button>
        <button class="btn btn-secondary btn-sm pl-always" data-pl-act="structure" title="Books bzw. Pläne, Bereiche und Abschnitte aus einer Tabelle (.ods, .xlsx, .csv), einer Ordnerstruktur oder einer Gliederung anlegen – ins Notizbuch oder in die Planung">🧱 Struktur importieren</button>
        <button class="btn btn-secondary btn-sm pl-always" data-pl-act="ai-bridge" title="Zeitbeschränkten Zugriff und Anleitung für deine eigene KI erzeugen (Sortieren, Planen & Material-Import)">🤖 KI-Assistent</button>
        <span class="nb-view-tabs" role="group" aria-label="Ansicht">
          <button type="button" data-pl-view="docs" class="${this.view === 'docs' ? 'active' : ''}" aria-pressed="${this.view === 'docs'}" title="Nur Dokumente und Anhänge – die Quizze eines Dokuments stehen darunter">📄 Dokumente</button>
          <button type="button" data-pl-view="quizzes" class="${this.view === 'quizzes' ? 'active' : ''}" aria-pressed="${this.view === 'quizzes'}" title="Nur Quizze, Übungen und Apps – Lernthemen und Bereiche ohne Quiz sind ausgeblendet">🧩 Quizze</button>
          <button type="button" data-pl-view="all" class="${this.view === 'all' ? 'active' : ''}" aria-pressed="${this.view === 'all'}" title="Alle Module">Alles</button>
        </span>
        <button class="btn btn-secondary btn-sm" data-pl-act="classes" title="Klassen, deren Klassennotizbuch diesem Plan folgt">📒 Klassen zuweisen</button>
        <button class="btn btn-secondary btn-sm" data-pl-act="view" title="So bekommt ihn eine Klasse: Teilpläne eingesetzt, jedes Lernthema einmal (F3)">📋 Plan-Baum</button>
        <button type="button" class="btn btn-secondary btn-sm pl-always ${this.previewOpen ? 'active' : ''}" data-pl-act="preview" aria-pressed="${this.previewOpen}" title="Vorschau-Spalte rechts ein-/ausblenden: zeigt Module und Arbeitsblätter des gewählten Lernthemas sofort an">👁 Vorschau</button>
      </div>
      <div class="pl-panes ${this.previewOpen ? 'pl-with-preview' : ''}">
        <section class="pl-pane" data-pane="left" aria-label="Lernnotizbuch">
          <div class="pl-head"><span>📓 Lernnotizbuch</span><input type="search" class="pl-filter" data-pane="left" placeholder="Suchen… (Strg+F)" /></div>
          <nav class="pl-crumbs" data-pane="left" aria-label="Pfad"></nav>
          <div class="pl-list" role="tree" tabindex="-1"></div>
        </section>
        <section class="pl-pane" data-pane="right" aria-label="Pläne">
          <div class="pl-head"><select class="pl-right-mode" title="Rechte Spalte: deine Pläne oder das Klassennotizbuch einer Klasse"></select><span class="pl-target"></span><input type="search" class="pl-filter" data-pane="right" placeholder="Suchen… (Strg+F)" /></div>
          <nav class="pl-crumbs" data-pane="right" aria-label="Pfad"></nav>
          <div class="pl-list" role="tree" tabindex="-1"></div>
        </section>
        <aside class="pl-pane pl-preview-pane" data-pane="preview" aria-label="Vorschau"${this.previewOpen ? '' : ' hidden'}>
          <div class="pl-head">
            <span class="pl-preview-label">👁 Vorschau</span>
            <div class="pl-preview-actions"></div>
            <button type="button" class="btn btn-secondary btn-sm pl-preview-fold" data-pl-act="preview" title="Vorschau zuklappen">✕</button>
          </div>
          <div class="pl-preview-body"></div>
        </aside>
      </div>
      <div class="pl-keys">${KEYS.map(([k, t]) => `<span><kbd>${escapeHtml(k)}</kbd> ${escapeHtml(t)}</span>`).join('')}</div>`;
    this.root.addEventListener('click', (e) => this._onClick(e));
    this.root.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.pl-row');
      if (row) this._toggle(row.dataset.pane, Number(row.dataset.i));
    });
    this.root.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.pl-row');
      if (!row) return;
      e.preventDefault();
      this._setCursor(row.dataset.pane, Number(row.dataset.i));
      this._menu(e.clientX, e.clientY);
    });
    for (const input of this.root.querySelectorAll('.pl-filter')) {
      input.addEventListener('input', () => { this.filter[input.dataset.pane] = input.value.trim().toLowerCase(); this.cursor[input.dataset.pane] = 0; this._render(); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); input.blur(); this.active = input.dataset.pane; this._paint(); }
      });
    }
    this._dragSetup();
    this.root.querySelector('.pl-right-mode').addEventListener('change', (e) => {
      this.rightMode = e.target.value;
      try { localStorage.setItem(RIGHT_KEY, this.rightMode); } catch (_) { /* egal */ }
      this.cursor.right = 0;
      this.marked.right.clear();
      this.active = 'right';
      e.target.blur();
      void this.refresh();
    });
  }

  /** Rechts im Klassennotizbuch statt in den Plänen? */
  _classMode() {
    return this.rightMode !== 'plans' && this.rightMode !== 'notebook' && !!this.cb;
  }

  /** Rechts ebenfalls das Lernnotizbuch (zum Umsortieren der Fachebene)? */
  _nbMode() {
    return this.rightMode === 'notebook';
  }

  _modeSelect() {
    const sel = this.root?.querySelector('.pl-right-mode');
    if (!sel) return;
    sel.innerHTML = `<option value="plans">🗂 Pläne</option><option value="notebook">📓 Lernnotizbuch</option>${this.classList.length ? `<optgroup label="📒 Klassennotizbuch">${this.classList.map((c) => `<option value="${escapeAttr(c.id)}">📒 ${escapeHtml(c.name)}</option>`).join('')}</optgroup>` : ''}`;
    sel.value = this.rightMode;
    this.root.classList.toggle('pl-classmode', this.rightMode !== 'plans');
  }

  // ---- Hineinwechseln ----

  _scope(pane) {
    return pane === 'left' ? 'left' : `right:${this.rightMode}`;
  }

  /** Knoten des Baums in dieser Spalte. */
  _paneNodes(pane) {
    if (pane === 'left' || this._nbMode()) return this.nb?.nodes || [];
    if (this._classMode()) return this.cb?.nodes || [];
    return this.plans?.nodes || [];
  }

  /** Der Knoten, in den die Spalte hineingewechselt ist – null, wenn sie alles zeigt (oder es ihn nicht mehr gibt). */
  _focusOf(pane) {
    const id = this.focusMap[this._scope(pane)];
    if (!id) return null;
    const n = this._paneNodes(pane).find((x) => x.id === id);
    return n && n.kind !== 'include' ? id : null;
  }

  /** Pfad bis zum Knoten, von oben nach unten. */
  _chain(pane, id) {
    const byId = new Map(this._paneNodes(pane).map((n) => [n.id, n]));
    const out = [];
    const seen = new Set();
    for (let n = byId.get(id); n && !seen.has(n.id); n = n.parentId ? byId.get(n.parentId) : null) { seen.add(n.id); out.unshift(n); }
    return out;
  }

  /** Hinein-/herauswechseln; `cursorOn` = Knoten, auf dem der Cursor danach steht. */
  _setFocus(pane, id, cursorOn = null) {
    const scope = this._scope(pane);
    if (id) this.focusMap[scope] = id; else delete this.focusMap[scope];
    try { localStorage.setItem(FOCUS_KEY, JSON.stringify(this.focusMap)); } catch (_) { /* privat */ }
    this.active = pane;
    this.marked[pane].clear();
    this.cursor[pane] = 0;
    this._render();
    if (cursorOn) {
      const i = this.rows[pane].findIndex((r) => r.folder && r.id === cursorOn);
      if (i >= 0) this._setCursor(pane, i);
    }
  }

  _dive(pane, i) {
    const r = this.rows[pane][i];
    if (!r?.folder || !r.id || r.kind === 'unsorted') return;
    this._setFocus(pane, r.id);
  }

  _focusUp(pane) {
    const id = this._focusOf(pane);
    if (!id) return;
    const node = this._paneNodes(pane).find((n) => n.id === id);
    this._setFocus(pane, node?.parentId || null, id);
  }

  _crumbsHtml(pane) {
    const focus = this._focusOf(pane);
    const chain = focus ? this._chain(pane, focus) : [];
    const rootLabel = pane === 'left' || this._nbMode() ? '📓 Alle' : this._classMode() ? `📒 ${this.cb.className}` : '🗂 Alle Pläne';
    const crumb = (id, label, last) => `<button type="button" class="nb-crumb" data-pl-crumb="${escapeAttr(id || '')}" data-pane="${pane}"${last ? ' aria-current="location"' : ''} title="${escapeAttr(last ? label : `Zu „${label}“`)}">${escapeHtml(label)}</button>`;
    const parts = [
      `<button type="button" class="nb-crumb nb-crumb-up" data-pl-up data-pane="${pane}" ${chain.length ? '' : 'disabled'} title="Eine Ebene heraus (Strg+↑ oder ⌫)" aria-label="Eine Ebene heraus">⤴</button>`,
      crumb(null, rootLabel, !chain.length),
      ...chain.map((n, i) => `<span class="nb-crumb-sep">›</span>${crumb(n.id, `${ICON[n.kind] || '📁'} ${n.title}`, i === chain.length - 1)}`),
    ];
    if (chain.length && this.filter[pane]) parts.push('<span class="nb-crumb-hint">Suche nur hier</span>');
    return parts.join('');
  }

  // ---- Bäume als Zeilen ----

  _topicTitle(id) {
    if (!this._titles) {
      this._titles = new Map();
      const n = this.nb || {};
      for (const t of [...(n.topics || []), ...(n.granted || []), ...(n.mirrors || []).flatMap((m) => m.topics || [])]) this._titles.set(t.id, t.title);
      for (const t of (this.plans?.topics || [])) if (!this._titles.has(t.id)) this._titles.set(t.id, t.title);
    }
    return this._titles.get(id) || '(Lernthema)';
  }

  _topicMap() {
    if (!this._topicsById) {
      const map = new Map();
      const n = this.nb || {};
      for (const t of (n.topics || [])) map.set(t.id, t);
      for (const t of (n.granted || [])) if (!map.has(t.id)) map.set(t.id, t);
      for (const m of (n.mirrors || [])) {
        for (const t of (m.topics || [])) if (!map.has(t.id)) map.set(t.id, t);
      }
      this._topicsById = map;
    }
    return this._topicsById;
  }

  _topicInView(topicId) {
    if (this.view === 'all') return true;
    if (typeof topicId === 'string' && topicId.startsWith('offer:')) {
      const mirror = (this.nb?.mirrors || []).find((m) => `offer:${m.offerId}` === topicId);
      if (!mirror) return true;
      if (this.view === 'docs') return true;
      return (mirror.topics || []).some((t) => this._topicInView(t.id));
    }
    const topic = this._topicMap().get(topicId);
    if (!topic) return this.view === 'docs';
    const roots = (topic.modules || []).filter((m) => !m.parentId);
    if (this.view === 'docs') return !roots.length || roots.some(isDocLike);
    return roots.some((m) => !isDocLike(m));
  }

  /** Lernthemen im Plan der rechten Zeile (direkt und über Teilpläne) – links mit ✓. */
  _inCurrentPlan() {
    if (this._nbMode()) return { plan: null, direct: new Set(), via: new Set() };
    if (this._classMode()) {
      const direct = new Set(this._classLinks().flatMap((l) => (l.available || []).map((a) => a.topicId)));
      return { plan: { title: this.cb.className }, direct, via: new Set() };
    }
    const row = this.rows.right[this.cursor.right];
    const nodes = this.plans?.nodes || [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let cur = byId.get(row ? (row.kind === 'entry' ? row.nodeId : row.id) : this._focusOf('right'));
    while (cur && cur.kind !== 'plan') cur = cur.parentId ? byId.get(cur.parentId) : null;
    if (!cur) return { plan: null, direct: new Set(), via: new Set() };
    const below = (rootId) => {
      const ids = new Set([rootId]);
      let grew = true;
      while (grew) { grew = false; for (const n of nodes) if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) { ids.add(n.id); grew = true; } }
      return ids;
    };
    const topicsOf = (planId) => new Set((this.plans.entries || []).filter((e) => below(planId).has(e.nodeId)).map((e) => e.topicId));
    const direct = topicsOf(cur.id);
    const via = new Set();
    const seen = new Set([cur.id]);
    const stack = [cur.id];
    while (stack.length) {
      const p = stack.pop();
      for (const inc of nodes.filter((n) => n.kind === 'include' && below(p).has(n.id) && n.refId && !seen.has(n.refId))) {
        seen.add(inc.refId);
        stack.push(inc.refId);
        for (const t of topicsOf(inc.refId)) if (!direct.has(t)) via.add(t);
      }
    }
    return { plan: cur, direct, via };
  }

  _leftRows() {
    return this._nbRows('left');
  }

  /** Baum des Lernnotizbuchs als Zeilen – links immer, rechts im Modus „📓 Lernnotizbuch“. */
  _nbRows(pane) {
    const n = this.nb || {};
    const pre = pane === 'right' ? 'r' : '';
    const nodes = (n.nodes || []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const places = (n.placements || []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const mirrors = new Map((n.mirrors || []).map((m) => [`offer:${m.offerId}`, m]));
    const f = this.filter[pane];
    const rows = [];
    const match = (t) => !f || String(t || '').toLowerCase().includes(f);
    const topicInView = (topicId) => this._topicInView(topicId);
    const topicsBelow = (nodeId, seen = new Set()) => {
      if (seen.has(nodeId)) return [];
      seen.add(nodeId);
      const out = places.filter((x) => (x.nodeId ?? null) === nodeId).map((x) => x.topicId);
      for (const k of nodes.filter((x) => (x.parentId ?? null) === nodeId)) out.push(...topicsBelow(k.id, seen));
      return out;
    };
    const nodeInView = (node) => this.view !== 'quizzes' || topicsBelow(node.id).some(topicInView);
    // Bei einer Suche: alles aufgeklappt, was einen Treffer enthält.
    const hasHit = (nodeId, seen = new Set()) => {
      if (seen.has(nodeId)) return false;
      seen.add(nodeId);
      return places.some((p) => (p.nodeId ?? null) === nodeId && topicInView(p.topicId) && match(p.topicId.startsWith('offer:') ? mirrors.get(p.topicId)?.title : this._topicTitle(p.topicId)))
        || nodes.filter(nodeInView).some((k) => (k.parentId ?? null) === nodeId && (match(k.title) || hasHit(k.id, seen)));
    };
    const topicRows = (nodeId, depth) => {
      for (const p of places.filter((x) => (x.nodeId ?? null) === nodeId)) {
        if (!topicInView(p.topicId)) continue;
        if (p.topicId.startsWith('offer:')) {
          const m = mirrors.get(p.topicId);
          if (m && match(m.title)) rows.push({ pane, kind: 'mirror', id: p.topicId, nodeId, title: m.title, depth, key: `${pre}m:${p.topicId}` });
        } else if (match(this._topicTitle(p.topicId))) {
          rows.push({ pane, kind: 'topic', id: p.topicId, nodeId, title: this._topicTitle(p.topicId), depth, key: `${pre}t:${p.topicId}` });
        }
      }
    };
    const walk = (parentId, depth) => {
      for (const node of nodes.filter((x) => (x.parentId ?? null) === parentId)) {
        if (!nodeInView(node)) continue;
        if (f && !match(node.title) && !hasHit(node.id)) continue;
        const key = `${pre}n:${node.id}`;
        const isOpen = f ? true : this.open.has(key);
        rows.push({ pane, kind: node.kind, id: node.id, parentId: node.parentId ?? null, title: node.title, depth, key, folder: true, isOpen });
        if (isOpen) { walk(node.id, depth + 1); topicRows(node.id, depth + 1); }
      }
    };
    const focus = this._focusOf(pane);
    if (focus) {
      // Hineingewechselt: nur der Inhalt dieses Knotens, ohne „Unsortiert“.
      walk(focus, 0);
      topicRows(focus, 0);
      return rows;
    }
    walk(null, 0);
    const unsorted = places.filter((p) => !p.nodeId && topicInView(p.topicId));
    if (unsorted.length || (this._nbMode() && this.view !== 'quizzes')) {
      const key = `${pre}u`;
      const isOpen = f ? true : this.open.has(key);
      if (!f || unsorted.some((p) => match(this._topicTitle(p.topicId)))) {
        rows.push({ pane, kind: 'unsorted', id: null, title: 'Unsortiert', depth: 0, key, folder: true, isOpen });
        if (isOpen) topicRows(null, 1);
      }
    }
    return rows;
  }

  /** Zuweisungen im Baum der Klasse – wie die Inhaltsübersicht (class-results.js). */
  _classLinks() {
    return (this.cb?.links || []).filter((l) => (l.practice?.length || l.classTopicId) && l.inTree !== false);
  }

  _classRows() {
    const cb = this.cb;
    const nodes = (cb.nodes || []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const links = this._classLinks().slice().sort((a, b) => a.order - b.order);
    const f = this.filter.right;
    const match = (t) => !f || String(t || '').toLowerCase().includes(f);
    const linkInView = (l) => {
      if (this.view === 'all' || !l.available) return true;
      const mods = l.available.flatMap((t) => [...(t.modules || []), ...(t.foreign || [])]);
      if (this.view === 'docs') return !mods.length || mods.some(isDocLike);
      return mods.some((m) => !isDocLike(m));
    };
    const linksBelow = (nodeId, seen = new Set()) => {
      if (seen.has(nodeId)) return [];
      seen.add(nodeId);
      const out = links.filter((x) => (x.nodeId ?? null) === nodeId);
      for (const k of nodes.filter((x) => (x.parentId ?? null) === nodeId)) out.push(...linksBelow(k.id, seen));
      return out;
    };
    const nodeInView = (node) => this.view !== 'quizzes' || linksBelow(node.id).some(linkInView);
    const hasHit = (id, seen = new Set()) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return links.some((l) => (l.nodeId ?? null) === id && linkInView(l) && match(l.name))
        || nodes.filter(nodeInView).some((k) => (k.parentId ?? null) === id && (match(k.title) || hasHit(k.id, seen)));
    };
    const rows = [];
    const walk = (parentId, depth) => {
      for (const node of nodes.filter((x) => (x.parentId ?? null) === parentId)) {
        if (!nodeInView(node)) continue;
        if (f && !match(node.title) && !hasHit(node.id)) continue;
        const key = `c:${node.id}`;
        const isOpen = f ? true : this.open.has(key);
        rows.push({ pane: 'right', kind: node.kind, id: node.id, parentId: node.parentId ?? null, title: node.title, depth, key, folder: true, isOpen, fromPlan: (node.sourceNodeId || '').startsWith('plan:') });
        if (isOpen) walk(node.id, depth + 1);
      }
      for (const l of links.filter((x) => (x.nodeId ?? null) === parentId)) {
        if (!linkInView(l)) continue;
        if (!match(l.name)) continue;
        rows.push({ pane: 'right', kind: 'link', id: l.id, nodeId: l.nodeId ?? null, title: l.name, depth, key: `l:${l.id}`,
          on: (l.available || []).some((a) => a.enabled), own: !!l.classTopicId });
      }
    };
    walk(this._focusOf('right'), 0);
    return rows;
  }

  _rightRows() {
    if (this._nbMode()) return this._nbRows('right');
    if (this._classMode()) return this._classRows();
    const p = this.plans || {};
    const nodes = (p.nodes || []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const entries = (p.entries || []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const f = this.filter.right;
    const match = (t) => !f || String(t || '').toLowerCase().includes(f);
    const topicInView = (topicId) => this._topicInView(topicId);
    const topicsBelow = (nodeId, seen = new Set()) => {
      if (seen.has(nodeId)) return [];
      seen.add(nodeId);
      const node = nodes.find((n) => n.id === nodeId);
      const out = entries.filter((x) => x.nodeId === nodeId).map((x) => x.topicId);
      if (node?.kind === 'include' && node.refId) out.push(...topicsBelow(node.refId, seen));
      for (const k of nodes.filter((x) => (x.parentId ?? null) === nodeId)) out.push(...topicsBelow(k.id, seen));
      return out;
    };
    const nodeInView = (node) => this.view !== 'quizzes' || topicsBelow(node.id).some(topicInView);
    const hasHit = (id, seen = new Set()) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return entries.some((e) => e.nodeId === id && topicInView(e.topicId) && match(this._topicTitle(e.topicId)))
        || nodes.filter(nodeInView).some((k) => (k.parentId ?? null) === id && (match(k.title) || hasHit(k.id, seen)));
    };
    const rows = [];
    const walk = (parentId, depth) => {
      for (const node of nodes.filter((x) => (x.parentId ?? null) === parentId)) {
        if (!nodeInView(node)) continue;
        if (f && !match(node.title) && !hasHit(node.id)) continue;
        const key = `p:${node.id}`;
        const folder = node.kind !== 'include';
        const isOpen = folder && (f ? true : this.open.has(key));
        rows.push({ pane: 'right', kind: node.kind, id: node.id, parentId: node.parentId, title: node.title, depth, key, folder, isOpen, refId: node.refId, grows: node.grows });
        if (isOpen) walk(node.id, depth + 1);
      }
      if (parentId) {
        for (const e of entries.filter((x) => x.nodeId === parentId)) {
          if (!topicInView(e.topicId)) continue;
          if (!match(this._topicTitle(e.topicId))) continue;
          rows.push({ pane: 'right', kind: 'entry', id: e.id, nodeId: e.nodeId, topicId: e.topicId, title: this._topicTitle(e.topicId), depth, key: `e:${e.id}` });
        }
      }
    };
    walk(this._focusOf('right'), 0);
    return rows;
  }

  _render() {
    this._titles = null;
    this._topicsById = null;
    this.rows.left = this._leftRows();
    this.rows.right = this._rightRows();
    for (const pane of ['left', 'right']) {
      const max = this.rows[pane].length - 1;
      this.cursor[pane] = Math.max(0, Math.min(this.cursor[pane], max));
      const keys = new Set(this.rows[pane].map((r) => r.key));
      for (const k of [...this.marked[pane]]) if (!keys.has(k)) this.marked[pane].delete(k);
    }
    this._paint();
  }

  _rowHtml(r, i, pane, plan) {
    const icon = r.kind === 'topic' || r.kind === 'entry' || r.kind === 'link' ? '📘' : ICON[r.kind] || '•';
    const twisty = r.folder ? `<span class="pl-twisty">${r.isOpen ? '▾' : '▸'}</span>` : '<span class="pl-twisty"></span>';
    let extra = '';
    if (pane === 'left' && r.kind === 'topic' && plan.plan) {
      if (plan.direct.has(r.id)) extra = `<span class="pl-in" title="Steht im Plan „${escapeAttr(plan.plan.title)}“">✓</span>`;
      else if (plan.via.has(r.id)) extra = `<span class="pl-in via" title="Kommt über einen Teilplan in „${escapeAttr(plan.plan.title)}“">✓ Teilplan</span>`;
    }
    if (pane === 'right' && r.kind === 'link') {
      extra = `<span class="pl-note" title="${r.on ? 'Eingeschaltet – Schüler sehen es' : 'Ausgeschaltet – im Klassennotizbuch mit ● einschalten'}">${r.on ? '●' : '○'}${r.own ? ' nur diese Klasse' : ''}</span>`;
    } else if (pane === 'right' && r.fromPlan) {
      extra = '<span class="pl-note" title="Aus dem Plan der Klasse">🗂</span>';
    }
    if (pane === 'right' && !this._classMode()) {
      if (r.kind === 'include') {
        const ref = (this.plans.nodes || []).find((n) => n.id === r.refId);
        if (!ref || ref.title !== r.title) extra = `<span class="pl-note">→ ${escapeHtml(ref ? ref.title : '(gelöscht)')}</span>`;
      }
      if (r.kind === 'plan' && this.plans.usedIn?.[r.id]) {
        extra = `<span class="pl-note" title="Als Teilplan eingebunden in: ${escapeAttr(this.plans.usedIn[r.id].map((x) => x.title).join(', '))}">🧩 in ${this.plans.usedIn[r.id].length} Plan${this.plans.usedIn[r.id].length === 1 ? '' : 'en'}</span>`;
      }
      const cls = r.kind === 'plan' ? this.plans.classes?.[r.id] : null;
      if (cls?.length) extra += `<span class="pl-note pl-classes" title="Diese Klassennotizbücher folgen dem Plan">📒 ${escapeHtml(cls.map((c) => c.name).join(', '))}</span>`;
      if (r.grows) extra += '<span class="pl-note" title="Aus dem Notizbuch übernommen: Neues dort kommt hier dazu">🌱</span>';
    }
    if (r.folder && r.id && r.kind !== 'unsorted') extra += '<span class="pl-dive" title="Hineinwechseln (Strg+↓)">⤵</span>';
    const cls = ['pl-row', `pl-${r.kind}`];
    if (i === this.cursor[pane]) cls.push('cur');
    if (this.marked[pane].has(r.key)) cls.push('mark');
    return `<div class="${cls.join(' ')}" role="treeitem" data-pane="${pane}" data-i="${i}" draggable="true" style="padding-left:${8 + r.depth * 18}px"${r.folder ? ` aria-expanded="${r.isOpen}"` : ''}>${twisty}<span class="pl-icon">${icon}</span><span class="pl-title">${escapeHtml(r.title)}</span>${extra}</div>`;
  }

  _paint() {
    if (!this.root?.dataset.ready) return;
    this.root.querySelectorAll('[data-pl-view]').forEach((btn) => {
      const on = btn.dataset.plView === this.view;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    const plan = this._inCurrentPlan();
    for (const pane of ['left', 'right']) {
      const box = this.root.querySelector(`.pl-pane[data-pane="${pane}"]`);
      box.classList.toggle('active', this.active === pane);
      const list = box.querySelector('.pl-list');
      const rows = this.rows[pane];
      const hasFilter = !!this.filter[pane];
      const empty = hasFilter
        ? '<p class="pl-empty">Nichts gefunden.</p>'
        : pane === 'right' && this._classMode()
        ? (this.view === 'quizzes'
          ? '<p class="pl-empty">In den Zuweisungen dieser Klasse steckt noch kein Quiz.</p>'
          : '<p class="pl-empty">Das Klassennotizbuch ist noch leer. Links Lernthemen oder Bereiche wählen und <kbd>F5</kbd> drücken – sie kommen eingeschaltet ganz nach oben.</p>')
        : pane === 'right'
        ? (this.view === 'quizzes'
          ? '<p class="pl-empty">In deinen Plänen steckt noch kein Quiz.</p>'
          : '<p class="pl-empty">Noch keine Pläne. Lege mit <kbd>F7</kbd> einen Ordner an (z. B. „Berufsschule“), darin mit <kbd>⇧F7</kbd> einen Plan – dann links Lernthemen oder ganze Bereiche wählen und <kbd>F5</kbd> drücken.</p>')
        : this.view === 'quizzes'
        ? '<p class="pl-empty">Noch keine Quizze. Unter <strong>Alles</strong> stehen die Lernthemen mit Dokumenten.</p>'
        : '<p class="pl-empty">Nichts gefunden.</p>';
      list.innerHTML = rows.length ? rows.map((r, i) => this._rowHtml(r, i, pane, plan)).join('') : empty;
      const crumbs = box.querySelector('.pl-crumbs');
      if (crumbs) crumbs.innerHTML = this._crumbsHtml(pane);
      const cur = list.querySelector('.pl-row.cur');
      if (cur && this.active === pane) cur.scrollIntoView({ block: 'nearest' });
    }
    const target = this._target();
    const head = this.root.querySelector('.pl-pane[data-pane="right"] .pl-target');
    if (head) head.textContent = target ? `Ziel: ${target.title}` : '';
    this._updatePreview();
  }

  _togglePreview() {
    this.previewOpen = !this.previewOpen;
    try { localStorage.setItem(PREVIEW_KEY, this.previewOpen ? '1' : '0'); } catch (_) { /* privat */ }
    const panes = this.root?.querySelector('.pl-panes');
    const previewPane = this.root?.querySelector('.pl-preview-pane');
    const btn = this.root?.querySelector('.pl-toolbar [data-pl-act="preview"]');
    if (panes) panes.classList.toggle('pl-with-preview', this.previewOpen);
    if (previewPane) previewPane.hidden = !this.previewOpen;
    if (btn) {
      btn.classList.toggle('active', this.previewOpen);
      btn.setAttribute('aria-pressed', String(this.previewOpen));
    }
    if (this.previewOpen) {
      this._previewKey = null;
      this._updatePreview();
    }
  }

  _topicModules(topicId) {
    if (!this._topicModCache.has(topicId)) {
      const p = (async () => {
        const mods = await this.app.api.getTopicModules(topicId).catch(() => null);
        if (Array.isArray(mods)) return mods;
        const shared = await this.app.api.getSharedTopicView(topicId).catch(() => null);
        if (Array.isArray(shared?.modules)) return shared.modules;
        return [];
      })();
      this._topicModCache.set(topicId, p);
    }
    return this._topicModCache.get(topicId);
  }

  /** Welche Pläne enthalten dieses Lernthema bereits? */
  _plansUsingTopic(topicId) {
    const nodes = this.plans?.nodes || [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const entries = (this.plans?.entries || []).filter((e) => e.topicId === topicId);
    const out = [];
    const seen = new Set();
    for (const e of entries) {
      const path = [];
      for (let cur = byId.get(e.nodeId); cur; cur = cur.parentId ? byId.get(cur.parentId) : null) {
        if (cur.kind !== 'folder') path.unshift(cur.title);
      }
      const label = path.join(' › ');
      if (label && !seen.has(label)) {
        seen.add(label);
        out.push(label);
      }
    }
    return out;
  }

  _updatePreview() {
    if (!this.previewOpen) return;
    const paneEl = this.root?.querySelector('.pl-preview-pane');
    if (!paneEl) return;
    const labelEl = paneEl.querySelector('.pl-preview-label');
    const actionsEl = paneEl.querySelector('.pl-preview-actions');
    const bodyEl = paneEl.querySelector('.pl-preview-body');
    const row = this.rows[this.active]?.[this.cursor[this.active]];
    if (!row) {
      this._previewKey = null;
      if (labelEl) labelEl.textContent = '👁 Vorschau';
      if (actionsEl) actionsEl.innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = '<p class="pl-empty">Links oder rechts ein Lernthema oder einen Bereich auswählen, um den Inhalt hier sofort in der Vorschau zu sehen.</p>';
      return;
    }
    const rowKey = `${this.active}:${row.key}`;
    if (this._previewKey === rowKey) return;
    this._previewKey = rowKey;
    this._previewModId = null;
    if (actionsEl) actionsEl.innerHTML = '';

    // 1. Lernthema (links im Lernnotizbuch, rechts als Plan-Verweis oder im Klassennotizbuch)
    let topicId = null;
    if (row.kind === 'topic') topicId = row.id;
    else if (row.kind === 'entry') topicId = row.topicId;
    else if (row.kind === 'link') {
      const linkObj = (this.cb?.links || []).find((l) => l.id === row.id);
      topicId = linkObj?.available?.[0]?.topicId || linkObj?.classTopicId || null;
    }

    if (topicId) {
      const topic = this._topicMap().get(topicId) || { id: topicId, title: row.title, isOwn: true, modules: [] };
      if (labelEl) {
        labelEl.textContent = `📘 ${topic.title}`;
        labelEl.title = topic.title;
      }
      const usedInPlans = this._plansUsingTopic(topicId);
      const roots = (topic.modules || []).filter((m) => !m.parentId).sort((a, b) => a.orderIndex - b.orderIndex);
      const statusBadge = topic.isOwn !== false
        ? `<span class="pl-pv-badge ${topic.selected ? 'on' : 'off'}">${topic.selected ? '● Freigegeben' : '○ Gesperrt'}</span>`
        : `<span class="pl-pv-badge">🔗 ${escapeHtml(topic.ownerName || 'Geteilt')}</span>`;
      const plansHtml = usedInPlans.length
        ? `<div class="pl-pv-plans">🗂 <strong>In Planungsvorlagen:</strong> ${usedInPlans.map((p) => `<span class="pl-pv-plan-chip">${escapeHtml(p)}</span>`).join(' ')}</div>`
        : '<div class="pl-pv-plans hint">Noch in keiner Planungsvorlage verknüpft (mit <kbd>F5</kbd> in den Plan übernehmen).</div>';

      bodyEl.innerHTML = `
        <div class="pl-pv-meta">
          ${statusBadge}
          <span class="hint">${roots.length} Modul${roots.length === 1 ? '' : 'e'}</span>
        </div>
        ${plansHtml}
        <div class="pl-pv-tabs" role="tablist"></div>
        <div class="pl-pv-stage"><p class="hint">Vorschau wird geladen …</p></div>
      `;
      void this._loadAndRenderTopicPreview(rowKey, topic);
      return;
    }

    // 2. Ordner / Book / Bereich / Abschnitt / Plan
    const icon = ICON[row.kind] || '📂';
    if (labelEl) {
      labelEl.textContent = `${icon} ${row.title}`;
      labelEl.title = row.title;
    }
    const subRows = [];
    const list = this.rows[this.active] || [];
    for (let idx = this.cursor[this.active] + 1; idx < list.length; idx++) {
      if (list[idx].depth <= row.depth) break;
      if (list[idx].kind === 'topic' || list[idx].kind === 'entry' || list[idx].kind === 'link') {
        subRows.push(list[idx]);
      }
    }
    const planInfo = this._inCurrentPlan();
    const inPlanCount = subRows.filter((r) => planInfo.direct.has(r.topicId || r.id) || planInfo.via.has(r.topicId || r.id)).length;
    bodyEl.innerHTML = `
      <div class="pl-pv-meta">
        <span class="hint">${row.isOpen ? `${subRows.length} sichtbare Lernthemen darunter` : 'Zugeklappt (mit Pfeil rechts oder Doppelklick öffnen)'}</span>
        ${this.active === 'left' && planInfo.plan && subRows.length ? `<span class="pl-pv-badge on">✓ ${inPlanCount}/${subRows.length} in „${escapeHtml(planInfo.plan.title)}“</span>` : ''}
      </div>
      ${subRows.length ? `<ul class="pl-pv-topic-list">${subRows.slice(0, 25).map((r) => `
        <li>
          <button type="button" class="pl-pv-topic-btn" data-jump-key="${escapeAttr(r.key)}">
            📘 ${escapeHtml(r.title)}
          </button>
        </li>`).join('')}</ul>` : '<p class="hint" style="margin-top:8px">Wähle ein Lernthema aus, um Arbeitsblätter und Quizze direkt hier anzusehen.</p>'}
    `;
    bodyEl.querySelectorAll('[data-jump-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = this.rows[this.active].findIndex((r) => r.key === btn.dataset.jumpKey);
        if (idx >= 0) this._setCursor(this.active, idx);
      });
    });
  }

  async _loadAndRenderTopicPreview(rowKey, topic) {
    const modules = await this._topicModules(topic.id);
    if (this._previewKey !== rowKey) return;
    const paneEl = this.root?.querySelector('.pl-preview-pane');
    if (!paneEl) return;
    const tabsEl = paneEl.querySelector('.pl-pv-tabs');
    const stageEl = paneEl.querySelector('.pl-pv-stage');
    const actionsEl = paneEl.querySelector('.pl-preview-actions');
    if (!tabsEl || !stageEl) return;

    const roots = (modules.length ? modules : (topic.modules || []))
      .filter((m) => !m.parentId)
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

    if (!roots.length) {
      tabsEl.innerHTML = '';
      stageEl.innerHTML = '<p class="hint">Dieses Lernthema enthält noch keine Module.</p>';
      return;
    }

    const types = typeof H5P_TYPES !== 'undefined' ? H5P_TYPES : {};
    const renderSelectedMod = (mod) => {
      this._previewModId = mod.id;
      tabsEl.querySelectorAll('.pl-pv-tab').forEach((b) => {
        b.classList.toggle('active', b.dataset.modId === mod.id);
      });
      if (actionsEl) {
        actionsEl.innerHTML = '';
        if (topic.isOwn !== false) {
          const editBtn = document.createElement('button');
          editBtn.type = 'button';
          editBtn.className = 'btn btn-secondary btn-sm';
          editBtn.title = 'Im Modul-Editor bearbeiten';
          editBtn.textContent = '✏️ Bearbeiten';
          editBtn.addEventListener('click', () => this.app.modulesView.openFrom('teacher-planning', topic.id, mod, 'edit'));
          actionsEl.appendChild(editBtn);
        }
        const fullBtn = document.createElement('button');
        fullBtn.type = 'button';
        fullBtn.className = 'btn btn-secondary btn-sm';
        fullBtn.title = 'Vollbild-Vorschau öffnen';
        fullBtn.textContent = '⛶';
        fullBtn.addEventListener('click', () => this.app.modulesView.openFrom('teacher-planning', topic.id, mod, 'preview'));
        actionsEl.appendChild(fullBtn);
      }
      stageEl.innerHTML = '';
      const host = document.createElement('div');
      host.className = 'nb-preview-module pl-pv-module-host';
      stageEl.appendChild(host);
      try {
        this.app.renderer.renderPreview(mod, types[mod.type] || {}, host, {
          quizMode: true,
          embedModule: (id) => modules.find((m) => m.id === id) || null,
        });
      } catch (err) {
        host.innerHTML = `<p class="hint">Vorschau konnte nicht geladen werden: ${escapeHtml(err.message || String(err))}</p>`;
      }
    };

    tabsEl.innerHTML = roots.map((m) => {
      const t = types[m.type] || {};
      return `<button type="button" class="pl-pv-tab" data-mod-id="${escapeAttr(m.id)}" title="${escapeAttr(`${m.title} (${t.name || m.type})`)}">${t.icon || '📄'} ${escapeHtml(m.title)}</button>`;
    }).join('');
    tabsEl.querySelectorAll('.pl-pv-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mod = roots.find((m) => m.id === btn.dataset.modId);
        if (mod) renderSelectedMod(mod);
      });
    });

    // Bevorzugt das erste Dokument/Arbeitsblatt anzeigen, sonst das erste Modul
    const preferred = roots.find((m) => m.type === 'document') || roots[0];
    renderSelectedMod(preferred);
  }

  // ---- Auswahl ----

  _setCursor(pane, i) {
    this.active = pane;
    this.cursor[pane] = Math.max(0, Math.min(i, this.rows[pane].length - 1));
    this._paint();
  }

  /** Markierte Zeilen, sonst die Zeile am Cursor. */
  _selection(pane) {
    const rows = this.rows[pane];
    const marked = rows.filter((r) => this.marked[pane].has(r.key));
    if (marked.length) return marked;
    const cur = rows[this.cursor[pane]];
    return cur ? [cur] : [];
  }

  /** Wohin F5 rechts einträgt: die Zeile am Cursor, bei Lernthema/Teilplan ihr Elternteil. */
  _target() {
    if (this._nbMode()) return this._nbTarget('right');
    if (this._classMode()) {
      const root = { id: null, kind: 'root', title: `📒 ${this.cb.className} (oben)` };
      const row = this.rows.right[this.cursor.right];
      if (!row) {
        const n = (this.cb.nodes || []).find((x) => x.id === this._focusOf('right'));
        return n ? { id: n.id, kind: n.kind, title: n.title, parentId: n.parentId ?? null } : root;
      }
      const id = row.kind === 'link' ? row.nodeId : row.id;
      const n = (this.cb.nodes || []).find((x) => x.id === id);
      return n ? { id: n.id, kind: n.kind, title: n.title, parentId: n.parentId ?? null } : root;
    }
    const row = this.rows.right[this.cursor.right];
    const nodes = this.plans?.nodes || [];
    if (!row) return nodes.find((n) => n.id === this._focusOf('right')) || null;
    const id = row.kind === 'entry' ? row.nodeId : row.kind === 'include' ? row.parentId : row.id;
    return nodes.find((n) => n.id === id) || null;
  }

  _toggle(pane, i) {
    const r = this.rows[pane][i];
    if (!r?.folder) return;
    if (this.open.has(r.key)) this.open.delete(r.key); else this.open.add(r.key);
    this._saveOpen();
    this._setCursor(pane, i);
    this._render();
  }

  _saveOpen() {
    try { localStorage.setItem(EXPAND_KEY, JSON.stringify([...this.open].slice(-500))); } catch (_) { /* egal */ }
  }

  _onClick(e) {
    const vbtn = e.target.closest('[data-pl-view]');
    if (vbtn) {
      const v = vbtn.dataset.plView;
      if (VIEWS.includes(v)) {
        if (v !== this.view) {
          this.view = v;
          try { localStorage.setItem(VIEW_KEY, this.view); } catch (_) { /* privat */ }
          this.cursor.left = 0;
          this.cursor.right = 0;
          this._render();
        }
      }
      return;
    }
    const btn = e.target.closest('[data-pl-new]');
    if (btn) { void this._create(btn.dataset.plNew); return; }
    const act = e.target.closest('[data-pl-act]');
    if (act) {
      const a = act.dataset.plAct;
      if (a === 'structure') {
        void import('./structure-import.js').then((m) => m.openStructureImport(this.app, { where: this.rightMode === 'plans' ? 'plans' : 'notebook', onDone: () => this.refresh() }));
        return;
      }
      if (a === 'ai-bridge') {
        void import('./ai-bridge-dialog.js').then((m) => m.openAiBridgeDialog(this.app, { onDone: () => this.refresh() }));
        return;
      }
      if (a === 'preview') {
        this._togglePreview();
        return;
      }
      void (a === 'include' ? this._includePicker() : a === 'classes' ? this._assignClasses() : this._viewPlan());
      return;
    }
    const up = e.target.closest('[data-pl-up]');
    if (up) { this._focusUp(up.dataset.pane); return; }
    const crumb = e.target.closest('[data-pl-crumb]');
    if (crumb) {
      const pane = crumb.dataset.pane;
      const from = this._focusOf(pane);
      const to = crumb.dataset.plCrumb || null;
      if (to === from) { this.active = pane; this._paint(); return; }
      // Der Cursor landet auf dem Ordner, aus dem man kommt.
      const below = from ? this._chain(pane, from).find((n, k, arr) => (arr[k - 1]?.id ?? null) === to) : null;
      this._setFocus(pane, to, below?.id || null);
      return;
    }
    const row = e.target.closest('.pl-row');
    if (row && e.target.closest('.pl-dive')) { this._dive(row.dataset.pane, Number(row.dataset.i)); return; }
    if (row) {
      const pane = row.dataset.pane;
      const i = Number(row.dataset.i);
      if (e.ctrlKey || e.metaKey) {
        const key = this.rows[pane][i].key;
        if (this.marked[pane].has(key)) this.marked[pane].delete(key); else this.marked[pane].add(key);
      } else if (e.shiftKey) {
        const [a, b] = [Math.min(i, this.cursor[pane]), Math.max(i, this.cursor[pane])];
        for (let k = a; k <= b; k++) this.marked[pane].add(this.rows[pane][k].key);
      } else if (e.target.closest('.pl-twisty')) {
        this._toggle(pane, i);
        return;
      }
      this._setCursor(pane, i);
      return;
    }
    const pane = e.target.closest('.pl-pane');
    if (pane && (pane.dataset.pane === 'left' || pane.dataset.pane === 'right')) {
      this.active = pane.dataset.pane;
      this._paint();
    }
  }

  // ---- Tastatur ----

  _onKey(e) {
    if (!this._visible() || !this.rows) return;
    if (document.querySelector('.confirm-overlay:not(.hidden), .pl-dialog')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const pane = this.active;
    const rows = this.rows[pane];
    const i = this.cursor[pane];
    const key = e.key;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (key === 'Tab') { handled(); this.active = pane === 'left' ? 'right' : 'left'; this._paint(); return; }
    if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'f') { handled(); this.root.querySelector(`.pl-filter[data-pane="${pane}"]`)?.focus(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'ArrowDown') { handled(); this._dive(pane, i); return; }
    if (((e.ctrlKey || e.metaKey) && !e.altKey && key === 'ArrowUp') || (key === 'Backspace' && !e.ctrlKey && !e.altKey)) { handled(); this._focusUp(pane); return; }
    if (this._nbMode()) {
      // Beide Spalten zeigen das Lernnotizbuch: F5 kopiert, F6 verschiebt in die andere Spalte.
      if (e.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) { handled(); void this._nbNudge(key === 'ArrowUp' ? -1 : 1); return; }
      const nb = { F2: () => this._nbRename(), F3: () => this._nbOpen(), F5: () => this._nbTransfer(true), F6: () => this._nbTransfer(false),
        F7: () => this._nbCreate(e.shiftKey ? 'section' : 'area'), F8: () => this._nbRemove(), Delete: () => this._nbRemove() }[key];
      if (nb) { handled(); void nb(); return; }
    }
    if (e.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) { handled(); void this._nudge(key === 'ArrowUp' ? -1 : 1); return; }
    switch (key) {
      case 'ArrowDown': handled(); this._setCursor(pane, i + 1); return;
      case 'ArrowUp': handled(); this._setCursor(pane, i - 1); return;
      case 'PageDown': handled(); this._setCursor(pane, i + 15); return;
      case 'PageUp': handled(); this._setCursor(pane, i - 15); return;
      case 'Home': handled(); this._setCursor(pane, 0); return;
      case 'End': handled(); this._setCursor(pane, rows.length - 1); return;
      case 'ArrowRight': {
        handled();
        const r = rows[i];
        if (r?.folder && !r.isOpen) this._toggle(pane, i); else this._setCursor(pane, i + 1);
        return;
      }
      case 'ArrowLeft': {
        handled();
        const r = rows[i];
        if (r?.folder && r.isOpen) { this._toggle(pane, i); return; }
        for (let k = i - 1; k >= 0; k--) if (rows[k].depth < (r?.depth ?? 0)) { this._setCursor(pane, k); return; }
        return;
      }
      case 'Enter': handled(); this._toggle(pane, i); return;
      case ' ':
      case 'Insert': {
        handled();
        const r = rows[i];
        if (!r) return;
        if (this.marked[pane].has(r.key)) this.marked[pane].delete(r.key); else this.marked[pane].add(r.key);
        this._setCursor(pane, key === 'Insert' ? i + 1 : i);
        return;
      }
      case 'Escape': handled(); this.marked[pane].clear(); this._paint(); return;
      case 'F2': handled(); void this._rename(); return;
      case 'F3': handled(); void this._viewPlan(); return;
      case 'F5': handled(); void (pane === 'left' ? this._copyRight() : this._includePicker()); return;
      case 'F6': handled(); void this._movePicker(); return;
      case 'F7': handled(); void this._create(this._newKind(e.shiftKey)); return;
      case 'F8':
      case 'Delete': handled(); void this._remove(); return;
      default:
    }
  }

  /** F7/⇧F7: im Plan Bereich/Abschnitt, außerhalb Ordner/Plan. */
  _newKind(shift) {
    if (this._classMode()) return shift ? 'section' : 'area';
    const target = this.active === 'right' ? this._target() : null;
    const inPlan = target && target.kind !== 'folder';
    if (inPlan) return shift ? 'section' : 'area';
    return shift ? 'plan' : 'folder';
  }

  // ---- Aktionen ----

  async _after(res, okText) {
    if (bad(res)) { this.app.showToast(res?.message || 'Das ging nicht.', 'error'); return false; }
    if (okText) this.app.showToast(okText, 'success');
    await this.refresh();
    return true;
  }

  /** F5 von links: Verweise im Ziel rechts anlegen. */
  async _copyRight() {
    if (this._classMode()) return this._cbCopy();
    const target = this._target();
    if (!target) { this.app.showToast('Rechts zuerst einen Plan wählen – oder mit ⇧F7 einen anlegen.', 'error'); return; }
    if (target.kind === 'folder') { this.app.showToast('In einen Ordner kommen Pläne. Rechts einen Plan, Bereich oder Abschnitt wählen.', 'error'); return; }
    const items = [];
    for (const r of this._selection('left')) {
      if (r.kind === 'topic') items.push({ type: 'topic', id: r.id });
      else if (r.kind === 'mirror' || r.kind === 'book' || r.kind === 'area' || r.kind === 'section') items.push({ type: 'nbnode', id: r.id });
      else if (r.kind === 'unsorted') for (const p of (this.nb.placements || []).filter((x) => !x.nodeId && !x.topicId.startsWith('offer:'))) items.push({ type: 'topic', id: p.topicId });
    }
    if (!items.length) return;
    const res = await this.app.api.addToPlan({ parentId: target.id, items });
    if (bad(res)) { this.app.showToast(res?.message || 'Das ging nicht.', 'error'); return; }
    this.marked.left.clear();
    this.open.add(`p:${target.id}`);
    this._saveOpen();
    const present = res.present?.length ? ` Schon im Plan: ${res.present.slice(0, 5).join(', ')}${res.present.length > 5 ? ' …' : ''}.` : '';
    this.app.showToast(`${res.added} Verweis${res.added === 1 ? '' : 'e'} in „${target.title}“.${present}`, res.added ? 'success' : 'info');
    await this.refresh();
  }

  async _create(kind) {
    if (this._nbMode()) return this._nbCreate(kind === 'section' || kind === 'plan' ? 'section' : 'area');
    if (this._classMode()) return this._cbCreate(kind === 'section' || kind === 'plan' ? 'section' : 'area');
    const labels = { folder: 'Neuer Ordner', plan: 'Neuer Plan', area: 'Neuer Bereich', section: 'Neuer Abschnitt' };
    const hints = { folder: 'Name, z. B. „Berufsschule“ oder „Mechatroniker“', plan: 'Name, z. B. „1. Ausbildungsjahr“', area: 'Name, z. B. „LF 5 Elektrische Installationen“', section: 'Name' };
    const target = this._target();
    let parentId = null;
    if (kind === 'folder' || kind === 'plan') {
      // In den Ordner am Cursor, sonst in den Ordner, in dem der Cursor steht.
      const nodes = this.plans?.nodes || [];
      let cur = target;
      while (cur && cur.kind !== 'folder') cur = cur.parentId ? nodes.find((n) => n.id === cur.parentId) : null;
      parentId = cur ? cur.id : null;
    } else {
      if (!target || target.kind === 'folder') { this.app.showToast('Rechts zuerst einen Plan wählen.', 'error'); return; }
      parentId = target.kind === 'section' ? target.parentId : target.id;
    }
    const title = await this._ask(labels[kind], hints[kind]);
    if (!title) return;
    const res = await this.app.api.createPlanNode({ kind, title, parentId });
    if (bad(res)) { this.app.showToast(res?.message || 'Das ging nicht.', 'error'); return; }
    if (parentId) this.open.add(`p:${parentId}`);
    this.open.add(`p:${res.id}`);
    this._saveOpen();
    this.active = 'right';
    await this.refresh();
    const i = this.rows.right.findIndex((r) => r.id === res.id);
    if (i >= 0) this._setCursor('right', i);
  }

  async _rename() {
    const r = this.rows[this.active][this.cursor[this.active]];
    if (this._classMode() && this.active === 'right' && r) {
      const title = await this._ask('Umbenennen', 'Name', r.title);
      if (!title || title === r.title) return;
      await this._after(r.kind === 'link' ? await this.app.api.renameClassbookEntry(this.cb.classId, r.id, title) : await this.app.api.renameClassbookNode(this.cb.classId, r.id, title));
      return;
    }
    if (this.active !== 'right' || !r || r.kind === 'entry') {
      this.app.showToast('Umbenennen geht rechts bei Ordnern, Plänen, Bereichen und Teilplänen. Lernthemen benennst du im Notizbuch um.', 'info');
      return;
    }
    const title = await this._ask('Umbenennen', 'Name', r.title);
    if (!title || title === r.title) return;
    await this._after(await this.app.api.renamePlanNode(r.id, title));
  }

  async _remove() {
    if (this.active !== 'right') { this.app.showToast('Links ist dein Notizbuch – hier wird nichts gelöscht. Entfernen geht rechts im Plan.', 'info'); return; }
    const sel = this._selection('right');
    if (!sel.length) return;
    if (this._classMode()) return this._cbRemove(sel);
    const usedIn = sel.filter((r) => r.kind === 'plan' && this.plans.usedIn?.[r.id]).map((r) => `„${r.title}“ steckt als Teilplan in: ${this.plans.usedIn[r.id].map((x) => x.title).join(', ')}`);
    const plans = sel.filter((r) => r.kind === 'plan').length;
    const what = sel.length === 1 ? `„${sel[0].title}“` : `${sel.length} Einträge`;
    const msg = [`${what} aus der Planung entfernen?`,
      plans ? 'Ein Plan geht mit seinem Inhalt.' : 'Was in einem Ordner oder Bereich liegt, rückt eine Ebene höher.',
      ...usedIn.map((u) => `⚠️ ${u} – dort fällt er weg.`),
      ...sel.filter((r) => r.kind === 'plan' && this.plans.classes?.[r.id]?.length)
        .map((r) => `📒 Dem Plan „${r.title}“ folgen: ${this.plans.classes[r.id].map((c) => c.name).join(', ')}. Ihr Klassennotizbuch bleibt, wie es ist, wächst aber nicht mehr mit.`),
      'Im Notizbuch bleibt alles, wie es ist.'].join('\n');
    if (!(await appConfirm(msg))) return;
    for (const r of sel) {
      const res = r.kind === 'entry' ? await this.app.api.deletePlanEntry(r.id) : await this.app.api.deletePlanNode(r.id);
      if (bad(res) && !/nicht gefunden/.test(res?.message || '')) { this.app.showToast(res?.message || 'Das ging nicht.', 'error'); break; }
    }
    this.marked.right.clear();
    await this.refresh();
  }

  /** Alt+↑/↓: eine Stelle nach oben oder unten unter denselben Geschwistern. */
  async _nudge(dir) {
    if (this.active !== 'right') return;
    const r = this.rows.right[this.cursor.right];
    if (!r) return;
    if (this._classMode()) return this._cbNudge(r, dir);
    const isEntry = r.kind === 'entry';
    const parentId = isEntry ? r.nodeId : r.parentId ?? null;
    const siblings = isEntry
      ? (this.plans.entries || []).filter((e) => e.nodeId === parentId).sort((a, b) => a.orderIndex - b.orderIndex)
      : (this.plans.nodes || []).filter((n) => (n.parentId ?? null) === parentId).sort((a, b) => a.orderIndex - b.orderIndex);
    const pos = siblings.findIndex((s) => s.id === r.id);
    const index = pos + dir;
    if (pos < 0 || index < 0 || index >= siblings.length) return;
    const res = await this.app.api.movePlanItem({ type: isEntry ? 'entry' : 'node', id: r.id, parentId, index });
    if (await this._after(res)) {
      const i = this.rows.right.findIndex((x) => x.key === r.key);
      if (i >= 0) this._setCursor('right', i);
    }
  }

  /** Mögliche Ziele rechts, eingerückt: für Lernthemen, Bereiche, Pläne. */
  _targets(accept) {
    const nodes = this.plans?.nodes || [];
    const out = [];
    const walk = (parentId, depth) => {
      for (const n of nodes.filter((x) => (x.parentId ?? null) === parentId).sort((a, b) => a.orderIndex - b.orderIndex)) {
        if (n.kind === 'include') continue;
        if (accept(n)) out.push({ id: n.id, label: `${'   '.repeat(depth)}${ICON[n.kind]} ${n.title}`, node: n });
        walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  /** F6: markierte Einträge rechts woandershin. */
  async _movePicker() {
    if (this.active !== 'right') { this.app.showToast('Verschieben geht rechts in der Planung. Links ordnest du im Notizbuch.', 'info'); return; }
    const sel = this._selection('right');
    if (!sel.length) return;
    if (this._classMode()) return this._cbMovePicker(sel);
    const kinds = new Set(sel.map((r) => r.kind));
    const ids = new Set(sel.map((r) => r.id));
    const nodes = this.plans.nodes || [];
    const inside = (n) => { for (let c = n; c; c = c.parentId ? nodes.find((x) => x.id === c.parentId) : null) if (ids.has(c.id)) return true; return false; };
    const accept = (n) => {
      if (inside(n)) return false;
      if (kinds.has('folder') || kinds.has('plan')) return n.kind === 'folder';
      if (kinds.has('area') || kinds.has('section') || kinds.has('include')) return n.kind === 'plan' || n.kind === 'area';
      return n.kind === 'plan' || n.kind === 'area' || n.kind === 'section';
    };
    const options = this._targets(accept);
    if (kinds.has('folder') || kinds.has('plan')) options.unshift({ id: '', label: '⬆ ganz oben' });
    const to = await this._pick(`${sel.length === 1 ? `„${sel[0].title}“` : `${sel.length} Einträge`} verschieben nach …`, options);
    if (to === null) return;
    for (const r of sel) {
      const res = await this.app.api.movePlanItem({ type: r.kind === 'entry' ? 'entry' : 'node', id: r.id, parentId: to || null });
      if (bad(res)) { this.app.showToast(`„${r.title}“: ${res?.message || 'Das ging nicht.'}`, 'error'); }
    }
    this.marked.right.clear();
    if (to) this.open.add(`p:${to}`);
    this._saveOpen();
    await this.refresh();
  }

  /** F5 rechts / 🧩: einen Plan als Teilplan einbinden oder in einen Ordner kopieren. */
  async _includePicker() {
    if (this._classMode()) { this.app.showToast('Im Klassennotizbuch gibt es keine Teilpläne. Einen Plan weist du oben über die Auswahl „🗂 Pläne“ und „📒 Klassen zuweisen“ zu.', 'info'); return; }
    const sel = this.active === 'right' ? this._selection('right').filter((r) => r.kind === 'plan') : [];
    const target = this._target();
    if (sel.length) {
      // Markierte Pläne → wohin? Ordner = Kopie, Plan/Bereich = Teilplan.
      const options = this._targets((n) => n.kind === 'folder' || n.kind === 'plan' || n.kind === 'area')
        .filter((o) => !sel.some((s) => s.id === o.id))
        .map((o) => ({ ...o, label: `${o.label}${o.node.kind === 'folder' ? '  (Kopie hierher)' : '  (als Teilplan)'}` }));
      const to = await this._pick(`${sel.length === 1 ? `Plan „${sel[0].title}“` : `${sel.length} Pläne`}: Teilplan in … oder Kopie in einen Ordner`, options);
      if (!to) return;
      const res = await this.app.api.addToPlan({ parentId: to, items: sel.map((s) => ({ type: 'plan', id: s.id })) });
      this.marked.right.clear();
      this.open.add(`p:${to}`);
      this._saveOpen();
      await this._after(res, 'Erledigt.');
      return;
    }
    if (!target || target.kind === 'folder') { this.app.showToast('Rechts einen Plan oder Bereich wählen, in den der Teilplan kommt – oder einen Plan, um ihn woanders einzubinden.', 'info'); return; }
    const options = this._targets((n) => n.kind === 'plan').filter((o) => o.id !== target.id);
    if (!options.length) { this.app.showToast('Es gibt noch keinen anderen Plan. Lege einen an, z. B. „Lernfelder 1–4 Elektro“ in einem Ordner „Gemeinsam“.', 'info'); return; }
    const ref = await this._pick(`Teilplan in „${target.title}“ einbinden`, options);
    if (!ref) return;
    const res = await this.app.api.addToPlan({ parentId: target.id, items: [{ type: 'plan', id: ref }] });
    this.open.add(`p:${target.id}`);
    this._saveOpen();
    await this._after(res, 'Teilplan eingebunden.');
  }

  /** F3: Plan so, wie ihn eine Klasse bekommt. */
  async _viewPlan() {
    if (this._classMode()) {
      // F3: dieses Klassennotizbuch öffnen.
      const crv = this.app.classResultsView;
      crv._classId = this.cb.classId;
      crv._tab = 'content';
      try { localStorage.setItem('lm_cr_class', this.cb.classId); } catch (_) { /* egal */ }
      this.app.navigateToView('teacher-class-results');
      return;
    }
    const nodes = this.plans?.nodes || [];
    let cur = this._target();
    while (cur && cur.kind !== 'plan') cur = cur.parentId ? nodes.find((n) => n.id === cur.parentId) : null;
    if (!cur) { this.app.showToast('Rechts einen Plan wählen.', 'info'); return; }
    const res = await this.app.api.getPlanExpanded(cur.id);
    if (bad(res)) { this.app.showToast(res?.message || 'Das ging nicht.', 'error'); return; }
    const item = (x) => (x.type === 'topic'
      ? `<li>📘 ${escapeHtml(this._topicTitle(x.topicId))}</li>`
      : `<li>${x.include ? '🧩' : ICON[x.kind]} <strong>${escapeHtml(x.title)}</strong>${x.children.length ? `<ul>${x.children.map(item).join('')}</ul>` : ''}</li>`);
    const count = (xs) => xs.reduce((s, x) => s + (x.type === 'topic' ? 1 : count(x.children)), 0);
    const body = res.items.length ? `<ul class="pl-preview">${res.items.map(item).join('')}</ul>` : '<p>Der Plan ist noch leer.</p>';
    await this._dialog(`📋 ${cur.title} – so bekommt ihn eine Klasse (${count(res.items)} Lernthemen)`, body);
  }

  /** Plan am Cursor → Klassen, deren Klassennotizbuch ihm folgt. */
  async _assignClasses() {
    if (this._classMode()) { this.app.showToast('Rechts oben auf „🗂 Pläne“ umschalten, dort einen Plan wählen und 📒 Klassen zuweisen.', 'info'); return; }
    const nodes = this.plans?.nodes || [];
    let plan = this._target();
    while (plan && plan.kind !== 'plan') plan = plan.parentId ? nodes.find((n) => n.id === plan.parentId) : null;
    if (!plan) { this.app.showToast('Rechts einen Plan wählen.', 'info'); return; }
    const before = (this.plans.classes?.[plan.id] || []).map((c) => c.id);
    const chosen = await pickClass(this.app, {
      title: `📒 Klassen für „${plan.title}“`,
      hint: 'Das Klassennotizbuch der Klasse folgt dem Plan: Alles kommt hinein (danach fragt die App: ein- oder ausgeschaltet), später Dazugekommenes ausgeschaltet. Was die Klasse schon hat, bleibt. Eine Klasse hat höchstens einen Plan.',
      multiple: true, preselected: before, okLabel: '📒 Plan zuweisen', allowNone: true,
    });
    if (!chosen) return;
    const ids = new Set(chosen.map((c) => c.id));
    const added = chosen.filter((c) => !before.includes(c.id));
    const on = added.length ? await this.askPlanSwitch(added.map((c) => c.name).join(', ')) : true;
    if (on === null) return;
    const notes = [];
    for (const c of added) {
      const res = await this.app.api.setClassPlan(c.id, plan.id, on);
      if (bad(res)) { this.app.showToast(`${c.name}: ${res?.message || 'Das ging nicht.'}`, 'error'); continue; }
      notes.push(`${c.name}: ${res.added} neu${on || !res.added ? '' : ' (aus)'}${res.present?.length ? `, ${res.present.length} schon da` : ''}${res.notReleased?.length ? `, nicht freigegeben: ${res.notReleased.join(', ')}` : ''}`);
    }
    for (const id of before) {
      if (ids.has(id)) continue;
      const res = await this.app.api.setClassPlan(id, null);
      if (!bad(res)) notes.push(`${(this.plans.classes[plan.id] || []).find((c) => c.id === id)?.name || 'Klasse'}: folgt dem Plan nicht mehr (Inhalt bleibt)`);
    }
    if (notes.length) this.app.showToast(notes.join(' · '), 'success');
    await this.refresh();
  }

  // ---- Rechts: Klassennotizbuch einer Klasse ----

  /** F5 ins Klassennotizbuch: wie „➕ Aus dem Notizbuch“ – eingeschaltet, an die Stelle am Cursor. */
  async _cbCopy() {
    const target = this._target();
    const items = [];
    for (const r of this._selection('left')) {
      if (r.kind === 'topic') items.push(['topic', r.id, r.title]);
      else if (r.kind === 'mirror' || r.kind === 'book' || r.kind === 'area' || r.kind === 'section') items.push(['node', r.id, r.title]);
      else if (r.kind === 'unsorted') for (const p of (this.nb.placements || []).filter((x) => !x.nodeId && !x.topicId.startsWith('offer:'))) items.push(['topic', p.topicId, this._topicTitle(p.topicId)]);
    }
    if (!items.length) return;
    let added = 0;
    const present = [];
    const locked = [];
    for (const [type, id, title] of items) {
      const res = await this.app.api.assignToClassbook(this.cb.classId, type, id, target.id);
      if (bad(res)) { this.app.showToast(`${title}: ${res?.message || 'Das ging nicht.'}`, 'error'); continue; }
      if (res.existed) present.push(title);
      else added += type === 'node' ? (res.added || 0) : 1;
      present.push(...(res.present || []));
      locked.push(...(res.notReleased || []));
    }
    this.marked.left.clear();
    if (target.id) { this.open.add(`c:${target.id}`); this._saveOpen(); }
    const parts = [`${added} Lernthem${added === 1 ? 'a' : 'en'} in „${target.title}“`];
    if (present.length) parts.push(`schon da: ${[...new Set(present)].slice(0, 5).join(', ')}`);
    if (locked.length) parts.push(`nicht freigegeben: ${[...new Set(locked)].join(', ')}`);
    this.app.showToast(parts.join(' · '), added ? 'success' : 'info');
    await this.refresh();
  }

  async _cbCreate(kind) {
    const target = this._target();
    const parentId = target.kind === 'section' ? target.parentId : target.id;
    const title = await this._ask(kind === 'section' ? 'Neuer Abschnitt' : 'Neuer Bereich', 'Name');
    if (!title) return;
    const res = await this.app.api.createClassbookNode(this.cb.classId, kind, title, parentId);
    if (bad(res)) { this.app.showToast(res?.message || 'Das ging nicht.', 'error'); return; }
    if (parentId) this.open.add(`c:${parentId}`);
    this._saveOpen();
    await this.refresh();
    const i = this.rows.right.findIndex((r) => r.id === res.id);
    if (i >= 0) this._setCursor('right', i);
  }

  async _cbRemove(sel) {
    const what = sel.length === 1 ? `„${sel[0].title}“` : `${sel.length} Einträge`;
    const msg = [`${what} aus dem Klassennotizbuch von ${this.cb.className} entfernen?`,
      'Aus einem Bereich oder Abschnitt rückt der Inhalt eine Ebene höher. Eine Zuweisung verschwindet aus dem Baum; Ergebnisse und Blätter der Schüler bleiben, im Notizbuch bleibt alles.',
      ...(sel.some((r) => r.own) ? ['⚠️ Ein Lernthema „nur diese Klasse“ wird mit seinen Modulen gelöscht.'] : [])].join('\n');
    if (!(await appConfirm(msg))) return;
    for (const r of sel) {
      const res = r.kind === 'link' ? await this.app.api.deleteClassbookEntry(this.cb.classId, r.id) : await this.app.api.deleteClassbookNode(this.cb.classId, r.id);
      if (bad(res) && !/nicht gefunden/.test(res?.message || '')) { this.app.showToast(res?.message || 'Das ging nicht.', 'error'); break; }
    }
    this.marked.right.clear();
    await this.refresh();
  }

  async _cbNudge(r, dir) {
    const isLink = r.kind === 'link';
    const parentId = isLink ? r.nodeId : r.parentId;
    const siblings = isLink
      ? this._classLinks().filter((l) => (l.nodeId ?? null) === parentId).sort((a, b) => a.order - b.order)
      : (this.cb.nodes || []).filter((n) => (n.parentId ?? null) === parentId).sort((a, b) => a.orderIndex - b.orderIndex);
    const pos = siblings.findIndex((x) => x.id === r.id);
    const index = pos + dir;
    if (pos < 0 || index < 0 || index >= siblings.length) return;
    if (await this._after(await this.app.api.moveInClassbook(this.cb.classId, { type: isLink ? 'link' : 'node', id: r.id, parentId, index }))) {
      const i = this.rows.right.findIndex((x) => x.key === r.key);
      if (i >= 0) this._setCursor('right', i);
    }
  }

  async _cbMoveTo(sel, parentId) {
    for (const r of sel) {
      if (r.id === parentId) continue;
      const res = await this.app.api.moveInClassbook(this.cb.classId, { type: r.kind === 'link' ? 'link' : 'node', id: r.id, parentId: parentId || null, index: null });
      if (bad(res)) this.app.showToast(`„${r.title}“: ${res?.message || 'Das ging nicht.'}`, 'error');
    }
    this.marked.right.clear();
    if (parentId) { this.open.add(`c:${parentId}`); this._saveOpen(); }
    await this.refresh();
  }

  async _cbMovePicker(sel) {
    const ids = new Set(sel.map((r) => r.id));
    const onlyLinks = sel.every((r) => r.kind === 'link');
    const nodes = this.cb.nodes || [];
    const inside = (n) => { for (let c = n; c; c = c.parentId ? nodes.find((x) => x.id === c.parentId) : null) if (ids.has(c.id)) return true; return false; };
    const options = [{ id: '', label: `⬆ ganz oben (${this.cb.className})` }];
    const walk = (parentId, depth) => {
      for (const n of nodes.filter((x) => (x.parentId ?? null) === parentId).sort((a, b) => a.orderIndex - b.orderIndex)) {
        if (inside(n)) continue;
        if (onlyLinks || n.kind === 'area') options.push({ id: n.id, label: `${'\u00a0\u00a0\u00a0'.repeat(depth)}${ICON[n.kind]} ${n.title}` });
        walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    const to = await this._pick(`${sel.length === 1 ? `„${sel[0].title}“` : `${sel.length} Einträge`} verschieben nach …`, options);
    if (to === null) return;
    await this._cbMoveTo(sel, to || null);
  }

  // ---- Beide Spalten: Lernnotizbuch (Fachebene umsortieren) ----

  /** Wohin in dieser Zeile: ihr Book/Bereich/Abschnitt; Lernthema → sein Ordner; Unsortiert → oberste Ebene. */
  _nbTargetOf(row) {
    if (!row || row.kind === 'unsorted') return { id: null, kind: 'unsorted', title: 'Unsortiert' };
    if (row.kind === 'topic' || row.kind === 'mirror') {
      const n = (this.nb?.nodes || []).find((x) => x.id === row.nodeId);
      return n ? { id: n.id, kind: n.kind, title: n.title, parentId: n.parentId ?? null } : { id: null, kind: 'unsorted', title: 'Unsortiert' };
    }
    return { id: row.id, kind: row.kind, title: row.title, parentId: row.parentId ?? null };
  }

  _nbTarget(pane) {
    const row = this.rows[pane][this.cursor[pane]];
    if (!row) {
      const n = (this.nb?.nodes || []).find((x) => x.id === this._focusOf(pane));
      if (n) return { id: n.id, kind: n.kind, title: n.title, parentId: n.parentId ?? null };
    }
    return this._nbTargetOf(row);
  }

  /** Markiertes der aktiven Spalte als `{ type: 'topic'|'node', id, title, kind }`. */
  _nbItems(pane) {
    const out = [];
    for (const r of this._selection(pane)) {
      if (r.kind === 'topic' || r.kind === 'mirror') out.push({ type: 'topic', id: r.id, title: r.title, kind: r.kind });
      else if (r.kind === 'book' || r.kind === 'area' || r.kind === 'section') out.push({ type: 'node', id: r.id, title: r.title, kind: r.kind });
    }
    return out;
  }

  /**
   * F6 verschiebt, F5 kopiert – aus der aktiven Spalte an das Ziel der anderen
   * (oder `target`, beim Ziehen). Kopieren nur nach Rückfrage: Eine Kopie ist
   * eigenständig, Änderungen am Original gelten dort nicht.
   */
  async _nbTransfer(copy, fromPane = this.active, target = null) {
    const to = target || this._nbTarget(fromPane === 'left' ? 'right' : 'left');
    let items = this._nbItems(fromPane);
    if (!items.length) { this.app.showToast('Zuerst Lernthemen, Bereiche oder Abschnitte wählen (Leertaste markiert mehrere).', 'info'); return; }
    if (copy) {
      const bought = items.filter((x) => x.kind === 'mirror');
      items = items.filter((x) => x.kind !== 'mirror');
      if (bought.length) this.app.showToast(`Erworbene Bereiche lassen sich nicht kopieren: ${bought.map((x) => x.title).join(', ')}.`, 'info');
      if (!items.length) return;
      const what = items.length === 1 ? `„${items[0].title}“` : `${items.length} Einträge`;
      if (!(await appConfirm(`${what} als Kopie nach „${to.title}“?\n\nDie Kopie ist eigenständig – z. B. um ein zweites Blatt abzuwandeln. Änderungen am Original gelten dort nicht. Bei Bereichen werden die eigenen Lernthemen darin mitkopiert.`))) return;
    }
    let done = 0;
    for (const it of items) {
      let id = it.id;
      if (copy) {
        const c = it.type === 'topic' ? await this.app.api.copyTopicInNotebook(it.id) : await this.app.api.copyNotebookNode(it.id);
        if (bad(c)) { this.app.showToast(`„${it.title}“: ${c?.message || 'Kopieren fehlgeschlagen.'}`, 'error'); continue; }
        id = it.type === 'topic' ? c.topicId : c.id;
      }
      const res = await this.app.api.moveInNotebook(it.type, id, to.id, null);
      if (bad(res)) { this.app.showToast(`„${it.title}“: ${res?.message || 'Verschieben fehlgeschlagen.'}`, 'error'); continue; }
      done++;
    }
    this.marked[fromPane].clear();
    if (to.id) { this.open.add(`n:${to.id}`); this.open.add(`rn:${to.id}`); this._saveOpen(); }
    if (done) this.app.showToast(`${done} ${copy ? 'kopiert' : 'verschoben'} nach „${to.title}“.`, 'success');
    await this.refresh();
  }

  async _nbCreate(kind) {
    const target = this._nbTarget(this.active);
    let parentId = target.kind === 'section' ? target.parentId : target.id;
    if (!parentId) kind = 'book';
    const label = { book: 'Neues Book', area: 'Neuer Bereich', section: 'Neuer Abschnitt' }[kind];
    const title = await this._ask(label, 'Name');
    if (!title) return;
    const res = await this.app.api.createNotebookNode(kind, title, parentId || null);
    if (bad(res)) { this.app.showToast(res?.message || 'Das ging nicht.', 'error'); return; }
    const pre = this.active === 'right' ? 'r' : '';
    if (parentId) { this.open.add(`${pre}n:${parentId}`); this._saveOpen(); }
    await this.refresh();
    const i = this.rows[this.active].findIndex((r) => r.id === res.id);
    if (i >= 0) this._setCursor(this.active, i);
  }

  async _nbRename() {
    const r = this.rows[this.active][this.cursor[this.active]];
    if (!r || r.kind === 'unsorted' || r.kind === 'mirror') return;
    const own = r.kind !== 'topic' || (this.nb?.topics || []).some((t) => t.id === r.id);
    if (!own) { this.app.showToast('Erworbene Lernthemen lassen sich nicht umbenennen.', 'info'); return; }
    const title = await this._ask('Umbenennen', 'Name', r.title);
    if (!title || title === r.title) return;
    await this._after(r.kind === 'topic' ? await this.app.api.saveTopic({ id: r.id, title }, true) : await this.app.api.updateNotebookNode(r.id, { title }));
  }

  async _nbRemove() {
    const sel = this._selection(this.active).filter((r) => r.kind === 'book' || r.kind === 'area' || r.kind === 'section');
    if (!sel.length) { this.app.showToast('Lernthemen löschst du im Notizbuch (⋯ → Löschen). Hier lassen sich nur Books, Bereiche und Abschnitte entfernen.', 'info'); return; }
    const what = sel.length === 1 ? `„${sel[0].title}“` : `${sel.length} Ordner`;
    if (!(await appConfirm(`${what} löschen?\n\nEs wird kein Lernthema gelöscht: Was darin liegt, rückt eine Ebene höher (aus einem Book nach „Unsortiert“).`))) return;
    for (const r of sel) {
      const res = await this.app.api.deleteNotebookNode(r.id);
      if (bad(res) && !/nicht gefunden/.test(res?.message || '')) { this.app.showToast(res?.message || 'Das ging nicht.', 'error'); break; }
    }
    this.marked[this.active].clear();
    await this.refresh();
  }

  async _nbNudge(dir) {
    const pane = this.active;
    const r = this.rows[pane][this.cursor[pane]];
    if (!r || r.kind === 'unsorted') return;
    const isNode = r.kind === 'book' || r.kind === 'area' || r.kind === 'section';
    const parentId = isNode ? r.parentId ?? null : r.nodeId ?? null;
    const siblings = isNode
      ? (this.nb.nodes || []).filter((n) => (n.parentId ?? null) === parentId).sort((a, b) => a.orderIndex - b.orderIndex).map((n) => n.id)
      : (this.nb.placements || []).filter((p) => (p.nodeId ?? null) === parentId).sort((a, b) => a.orderIndex - b.orderIndex).map((p) => p.topicId);
    const pos = siblings.indexOf(r.id);
    const index = pos + dir;
    if (pos < 0 || index < 0 || index >= siblings.length) return;
    if (await this._after(await this.app.api.moveInNotebook(isNode ? 'node' : 'topic', r.id, parentId, index))) {
      const i = this.rows[pane].findIndex((x) => x.key === r.key);
      if (i >= 0) this._setCursor(pane, i);
    }
  }

  /** F3: Lernthema in der Vorschau des Notizbuchs öffnen. */
  async _nbOpen() {
    const r = this.rows[this.active][this.cursor[this.active]];
    if (r?.kind !== 'topic') return;
    this.app.navigateToView('teacher-notebooks');
  }

  _menu(x, y) {
    const pane = this.active;
    const items = this._nbMode()
      ? [['F5', '📋 Kopie in die andere Spalte …', () => this._nbTransfer(true)], ['F6', '➡ In die andere Spalte verschieben', () => this._nbTransfer(false)],
        ['F2', '✏️ Umbenennen', () => this._nbRename()], ['F3', '📓 Im Notizbuch zeigen', () => this._nbOpen()],
        ['F7', '➕ Neuer Bereich', () => this._nbCreate('area')], ['⇧F7', '➕ Neuer Abschnitt', () => this._nbCreate('section')], ['F8', '🗑 Bereich löschen', () => this._nbRemove()]]
      : pane === 'left'
      ? [['F5', this._classMode() ? '➡ Ins Klassennotizbuch zuweisen' : '➡ Als Verweis in den Plan', () => this._copyRight()]]
      : this._classMode()
      ? [['F2', '✏️ Umbenennen', () => this._rename()], ['F3', '📒 Klassennotizbuch öffnen', () => this._viewPlan()],
        ['F6', '↔️ Verschieben nach …', () => this._movePicker()], ['F7', '➕ Neuer Bereich', () => this._create('area')],
        ['⇧F7', '➕ Neuer Abschnitt', () => this._create('section')], ['F8', '🗑 Entfernen', () => this._remove()]]
      : [['F2', '✏️ Umbenennen', () => this._rename()], ['F3', '👁 Plan ansehen', () => this._viewPlan()],
        ['', '📒 Klassen zuweisen …', () => this._assignClasses()],
        ['F5', '🧩 Teilplan einbinden / Plan kopieren', () => this._includePicker()], ['F6', '↔️ Verschieben nach …', () => this._movePicker()],
        ['F7', '➕ Neu', () => this._create(this._newKind(false))], ['F8', '🗑 Entfernen', () => this._remove()]];
    const cur = this.rows[pane][this.cursor[pane]];
    if (cur?.folder && cur.id && cur.kind !== 'unsorted') items.unshift(['Strg+↓', '⤵ Hineinwechseln', () => this._dive(pane, this.cursor[pane])]);
    if (this._focusOf(pane)) items.unshift(['Strg+↑', '⤴ Eine Ebene heraus', () => this._focusUp(pane)]);
    document.querySelector('.pl-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'pl-menu';
    menu.innerHTML = items.map(([k, t], i) => `<button type="button" data-i="${i}">${escapeHtml(t)}${k ? `<kbd>${k}</kbd>` : ''}</button>`).join('');
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    const close = () => { menu.remove(); document.removeEventListener('pointerdown', outside, true); };
    const outside = (e) => { if (!menu.contains(e.target)) close(); };
    document.addEventListener('pointerdown', outside, true);
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      close();
      void items[Number(b.dataset.i)][2]();
    });
  }

  // ---- Ziehen mit der Maus ----

  _dragSetup() {
    let from = null;
    this.root.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.pl-row');
      if (!row) return;
      const pane = row.dataset.pane;
      const i = Number(row.dataset.i);
      if (!this.marked[pane].has(this.rows[pane][i].key)) { this.marked[pane].clear(); this.cursor[pane] = i; }
      this.active = pane;
      from = pane;
      e.dataTransfer.effectAllowed = pane === 'left' ? 'link' : 'move';
      e.dataTransfer.setData('text/plain', 'plan');
    });
    this.root.addEventListener('dragover', (e) => {
      const row = e.target.closest(this._nbMode() ? '.pl-row' : '.pl-pane[data-pane="right"] .pl-row');
      if (!from || !row) return;
      e.preventDefault();
      this.root.querySelectorAll('.pl-row.drop').forEach((r) => r.classList.remove('drop'));
      row.classList.add('drop');
    });
    this.root.addEventListener('dragend', () => { from = null; this.root.querySelectorAll('.pl-row.drop').forEach((r) => r.classList.remove('drop')); });
    this.root.addEventListener('drop', async (e) => {
      const row = e.target.closest(this._nbMode() ? '.pl-row' : '.pl-pane[data-pane="right"] .pl-row');
      if (!from || !row) return;
      e.preventDefault();
      const src = from;
      from = null;
      const i = Number(row.dataset.i);
      if (this._nbMode()) {
        // Ziehen verschiebt (wie F6), auch innerhalb einer Spalte.
        await this._nbTransfer(false, src, this._nbTargetOf(this.rows[row.dataset.pane][i]));
        return;
      }
      if (src === 'left') {
        this.cursor.right = i;
        await this._copyRight();
        return;
      }
      // Rechts → rechts: in den Knoten unter der Maus (bei Lernthema: dessen Elternteil).
      const dest = this.rows.right[i];
      if (this._classMode()) {
        const parentId = dest.kind === 'link' ? dest.nodeId : dest.id;
        await this._cbMoveTo(this._selection('right'), parentId);
        return;
      }
      const parentId = dest.kind === 'entry' ? dest.nodeId : dest.kind === 'include' ? dest.parentId : dest.id;
      for (const r of this._selection('right')) {
        if (r.id === parentId) continue;
        const res = await this.app.api.movePlanItem({ type: r.kind === 'entry' ? 'entry' : 'node', id: r.id, parentId });
        if (bad(res)) this.app.showToast(`„${r.title}“: ${res?.message || 'Das ging nicht.'}`, 'error');
      }
      this.marked.right.clear();
      await this.refresh();
    });
  }

  // ---- Kleine Dialoge (mit Tastatur bedienbar) ----

  _dialog(title, html) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay pl-dialog';
      overlay.innerHTML = `<div class="import-modules-card nb-dialog pl-dialog-card"><h3>${escapeHtml(title)}</h3><div class="pl-dialog-body">${html}</div>
        <div class="confirm-actions"><button type="button" class="btn btn-primary">Schließen</button></div></div>`;
      document.body.appendChild(overlay);
      const done = () => { overlay.remove(); resolve(); };
      const btn = overlay.querySelector('.btn');
      btn.focus();
      btn.addEventListener('click', done);
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'F3') { e.preventDefault(); done(); } });
    });
  }

  _ask(title, label, value = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay pl-dialog';
      overlay.innerHTML = `<form class="import-modules-card nb-dialog"><h3>${escapeHtml(title)}</h3>
        <label class="nb-field">${escapeHtml(label)}<input type="text" maxlength="200" required value="${escapeAttr(value)}" /></label>
        <div class="confirm-actions"><button type="submit" class="btn btn-primary">OK</button><button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button></div></form>`;
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

  /** Ziel wählen: Liste mit Pfeiltasten und Enter. Liefert die ID ('' = ganz oben) oder null. */
  /**
   * Beim Zuweisen eines Plans: Inhalte ausgeschaltet (Standard) oder
   * eingeschaltet übernehmen? true = ein, false = aus, null = abgebrochen.
   */
  askPlanSwitch(who) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay pl-dialog';
      overlay.innerHTML = `<div class="import-modules-card nb-dialog pl-switch-card" role="dialog" aria-label="Plan zuweisen"><h3>🗂 Plan zuweisen – ${escapeHtml(who)}</h3>
        <p>Wie sollen die Lernthemen des Plans ins Klassennotizbuch kommen?</p>
        <div class="pl-switch-choices">
          <button type="button" class="btn btn-primary" data-on="0">○ Ausgeschaltet<span class="hint">Die Schüler sehen noch nichts; du schaltest ein, was dran ist.</span></button>
          <button type="button" class="btn btn-secondary" data-on="1">● Eingeschaltet<span class="hint">Die Schüler sehen sofort den ganzen Plan.</span></button>
        </div>
        <p class="hint">Bereiche und Abschnitte kommen in beiden Fällen. Was die Klasse schon hat, bleibt, wie es ist; später im Plan Ergänztes kommt immer ausgeschaltet dazu.</p>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button></div></div>`;
      document.body.appendChild(overlay);
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelectorAll('[data-on]').forEach((b) => b.addEventListener('click', () => done(b.dataset.on === '1')));
      overlay.querySelector('.btn-cancel').addEventListener('click', () => done(null));
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } });
      overlay.querySelector('[data-on="0"]').focus();
    });
  }

  _pick(title, options) {
    if (!options.length) { this.app.showToast('Kein passendes Ziel vorhanden.', 'info'); return Promise.resolve(null); }
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay pl-dialog';
      overlay.innerHTML = `<form class="import-modules-card nb-dialog"><h3>${escapeHtml(title)}</h3>
        <input type="search" class="pl-pick-filter" placeholder="Filtern…" />
        <select class="pl-pick" size="${Math.min(14, Math.max(4, options.length))}">${options.map((o, i) => `<option value="${escapeAttr(o.id)}"${i === 0 ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>
        <div class="confirm-actions"><button type="submit" class="btn btn-primary">OK</button><button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button></div></form>`;
      document.body.appendChild(overlay);
      const select = overlay.querySelector('select');
      const filter = overlay.querySelector('.pl-pick-filter');
      select.focus();
      const done = (v) => { overlay.remove(); resolve(v); };
      filter.addEventListener('input', () => {
        const f = filter.value.trim().toLowerCase();
        for (const opt of select.options) opt.hidden = !!f && !opt.textContent.toLowerCase().includes(f);
        const first = [...select.options].find((o) => !o.hidden);
        if (first) first.selected = true;
      });
      filter.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); select.focus(); } });
      select.addEventListener('dblclick', () => done(select.value));
      select.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(select.selectedIndex >= 0 ? select.value : null); } });
      overlay.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(select.selectedIndex >= 0 ? select.value : null); });
      overlay.querySelector('.btn-cancel').addEventListener('click', () => done(null));
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } });
    });
  }
}
