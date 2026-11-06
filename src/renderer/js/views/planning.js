/**
 * 🗂 Planung (docs/planung.md): zwei Spalten wie im Double Commander. Links das
 * Lernnotizbuch (fachlich), rechts die Pläne je Bildungsgang und Beruf. Mit
 * Tastatur: Tab wechselt die Spalte, F5 legt Verweise an, F6 verschiebt, F7
 * legt an, F8 entfernt, F2 benennt um, F3 zeigt den Plan, wie die Klasse ihn
 * bekommt. Server: src/plans.
 */
import { escapeHtml, escapeAttr, appConfirm } from '../utils.js';
import { pickClass } from './classes.js';

const EXPAND_KEY = 'lm_plan_open';
const ICON = { book: '📕', area: '📂', section: '📑', folder: '📁', plan: '📋', include: '🧩', mirror: '🛒', unsorted: '📥' };

function bad(res) {
  return !res || res.success === false || (res.statusCode && res.statusCode >= 400);
}

/** Tasten der Fußleiste – zugleich die Kurzhilfe. */
const KEYS = [
  ['Tab', 'Spalte'], ['F2', 'Umbenennen'], ['F3', 'Plan ansehen'], ['F5', 'Verweis →'], ['F6', 'Verschieben'],
  ['F7', 'Neu'], ['⇧F7', 'Neuer Plan / Abschnitt'], ['F8', 'Entfernen'], ['Leertaste', 'Markieren'], ['Alt+↑↓', 'Reihenfolge'], ['Strg+F', 'Suchen'],
];

export class PlanningView {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('planningRoot');
    this.nb = null;
    this.plans = null;
    this.active = 'left';
    this.cursor = { left: 0, right: 0 };
    this.marked = { left: new Set(), right: new Set() };
    this.filter = { left: '', right: '' };
    try { this.open = new Set(JSON.parse(localStorage.getItem(EXPAND_KEY) || '[]')); } catch (_) { this.open = new Set(); }
    this.rows = { left: [], right: [] };
    document.addEventListener('keydown', (e) => this._onKey(e));
  }

  _visible() {
    return document.getElementById('view-teacher-planning')?.classList.contains('active');
  }

  async refresh() {
    if (!this.root) return;
    if (!this.root.dataset.ready) this._skeleton();
    const [nb, plans] = await Promise.all([this.app.api.getNotebooks(), this.app.api.getPlans()]);
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
        <button class="btn btn-secondary btn-sm" data-pl-act="classes" title="Klassen, deren Klassennotizbuch diesem Plan folgt">📒 Klassen zuweisen</button>
        <button class="btn btn-secondary btn-sm" data-pl-act="view" title="So bekommt ihn eine Klasse: Teilpläne eingesetzt, jedes Lernthema einmal (F3)">👁 Plan ansehen</button>
      </div>
      <div class="pl-panes">
        <section class="pl-pane" data-pane="left" aria-label="Lernnotizbuch">
          <div class="pl-head"><span>📓 Lernnotizbuch</span><input type="search" class="pl-filter" data-pane="left" placeholder="Suchen… (Strg+F)" /></div>
          <div class="pl-list" role="tree" tabindex="-1"></div>
        </section>
        <section class="pl-pane" data-pane="right" aria-label="Pläne">
          <div class="pl-head"><span>🗂 Pläne</span><input type="search" class="pl-filter" data-pane="right" placeholder="Suchen… (Strg+F)" /></div>
          <div class="pl-list" role="tree" tabindex="-1"></div>
        </section>
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

  /** Lernthemen im Plan der rechten Zeile (direkt und über Teilpläne) – links mit ✓. */
  _inCurrentPlan() {
    const row = this.rows.right[this.cursor.right];
    const nodes = this.plans?.nodes || [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let cur = row ? byId.get(row.kind === 'entry' ? row.nodeId : row.id) : null;
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
    const n = this.nb || {};
    const nodes = (n.nodes || []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const places = (n.placements || []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const mirrors = new Map((n.mirrors || []).map((m) => [`offer:${m.offerId}`, m]));
    const f = this.filter.left;
    const rows = [];
    const match = (t) => !f || String(t || '').toLowerCase().includes(f);
    // Bei einer Suche: alles aufgeklappt, was einen Treffer enthält.
    const hasHit = (nodeId) => places.some((p) => p.nodeId === nodeId && match(p.topicId.startsWith('offer:') ? mirrors.get(p.topicId)?.title : this._topicTitle(p.topicId)))
      || nodes.some((k) => k.parentId === nodeId && (match(k.title) || hasHit(k.id)));
    const topicRows = (nodeId, depth) => {
      for (const p of places.filter((x) => (x.nodeId ?? null) === nodeId)) {
        if (p.topicId.startsWith('offer:')) {
          const m = mirrors.get(p.topicId);
          if (m && match(m.title)) rows.push({ pane: 'left', kind: 'mirror', id: p.topicId, title: m.title, depth, key: `m:${p.topicId}` });
        } else if (match(this._topicTitle(p.topicId))) {
          rows.push({ pane: 'left', kind: 'topic', id: p.topicId, title: this._topicTitle(p.topicId), depth, key: `t:${p.topicId}` });
        }
      }
    };
    const walk = (parentId, depth) => {
      for (const node of nodes.filter((x) => (x.parentId ?? null) === parentId)) {
        if (f && !match(node.title) && !hasHit(node.id)) continue;
        const key = `n:${node.id}`;
        const isOpen = f ? true : this.open.has(key);
        rows.push({ pane: 'left', kind: node.kind, id: node.id, title: node.title, depth, key, folder: true, isOpen });
        if (isOpen) { walk(node.id, depth + 1); topicRows(node.id, depth + 1); }
      }
    };
    walk(null, 0);
    const unsorted = places.filter((p) => !p.nodeId);
    if (unsorted.length) {
      const isOpen = f ? true : this.open.has('u');
      if (!f || unsorted.some((p) => match(this._topicTitle(p.topicId)))) {
        rows.push({ pane: 'left', kind: 'unsorted', id: null, title: 'Unsortiert', depth: 0, key: 'u', folder: true, isOpen });
        if (isOpen) topicRows(null, 1);
      }
    }
    return rows;
  }

  _rightRows() {
    const p = this.plans || {};
    const nodes = (p.nodes || []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const entries = (p.entries || []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const f = this.filter.right;
    const match = (t) => !f || String(t || '').toLowerCase().includes(f);
    const hasHit = (id) => entries.some((e) => e.nodeId === id && match(this._topicTitle(e.topicId))) || nodes.some((k) => k.parentId === id && (match(k.title) || hasHit(k.id)));
    const rows = [];
    const walk = (parentId, depth) => {
      for (const node of nodes.filter((x) => (x.parentId ?? null) === parentId)) {
        if (f && !match(node.title) && !hasHit(node.id)) continue;
        const key = `p:${node.id}`;
        const folder = node.kind !== 'include';
        const isOpen = folder && (f ? true : this.open.has(key));
        rows.push({ pane: 'right', kind: node.kind, id: node.id, parentId: node.parentId, title: node.title, depth, key, folder, isOpen, refId: node.refId, grows: node.grows });
        if (isOpen) walk(node.id, depth + 1);
      }
      if (parentId) {
        for (const e of entries.filter((x) => x.nodeId === parentId)) {
          if (!match(this._topicTitle(e.topicId))) continue;
          rows.push({ pane: 'right', kind: 'entry', id: e.id, nodeId: e.nodeId, topicId: e.topicId, title: this._topicTitle(e.topicId), depth, key: `e:${e.id}` });
        }
      }
    };
    walk(null, 0);
    return rows;
  }

  _render() {
    this._titles = null;
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
    const icon = r.kind === 'topic' || r.kind === 'entry' ? '📘' : ICON[r.kind] || '•';
    const twisty = r.folder ? `<span class="pl-twisty">${r.isOpen ? '▾' : '▸'}</span>` : '<span class="pl-twisty"></span>';
    let extra = '';
    if (pane === 'left' && r.kind === 'topic' && plan.plan) {
      if (plan.direct.has(r.id)) extra = `<span class="pl-in" title="Steht im Plan „${escapeAttr(plan.plan.title)}“">✓</span>`;
      else if (plan.via.has(r.id)) extra = `<span class="pl-in via" title="Kommt über einen Teilplan in „${escapeAttr(plan.plan.title)}“">✓ Teilplan</span>`;
    }
    if (pane === 'right') {
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
    const cls = ['pl-row', `pl-${r.kind}`];
    if (i === this.cursor[pane]) cls.push('cur');
    if (this.marked[pane].has(r.key)) cls.push('mark');
    return `<div class="${cls.join(' ')}" role="treeitem" data-pane="${pane}" data-i="${i}" draggable="true" style="padding-left:${8 + r.depth * 18}px"${r.folder ? ` aria-expanded="${r.isOpen}"` : ''}>${twisty}<span class="pl-icon">${icon}</span><span class="pl-title">${escapeHtml(r.title)}</span>${extra}</div>`;
  }

  _paint() {
    if (!this.root?.dataset.ready) return;
    const plan = this._inCurrentPlan();
    for (const pane of ['left', 'right']) {
      const box = this.root.querySelector(`.pl-pane[data-pane="${pane}"]`);
      box.classList.toggle('active', this.active === pane);
      const list = box.querySelector('.pl-list');
      const rows = this.rows[pane];
      const empty = pane === 'right'
        ? '<p class="pl-empty">Noch keine Pläne. Lege mit <kbd>F7</kbd> einen Ordner an (z. B. „Berufsschule“), darin mit <kbd>⇧F7</kbd> einen Plan – dann links Lernthemen oder ganze Bereiche wählen und <kbd>F5</kbd> drücken.</p>'
        : '<p class="pl-empty">Nichts gefunden.</p>';
      list.innerHTML = rows.length ? rows.map((r, i) => this._rowHtml(r, i, pane, plan)).join('') : empty;
      const cur = list.querySelector('.pl-row.cur');
      if (cur && this.active === pane) cur.scrollIntoView({ block: 'nearest' });
    }
    const target = this._target();
    const head = this.root.querySelector('.pl-pane[data-pane="right"] .pl-head span');
    if (head) head.textContent = target ? `🗂 Pläne – Ziel: ${target.title}` : '🗂 Pläne';
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
    const row = this.rows.right[this.cursor.right];
    if (!row) return null;
    const nodes = this.plans?.nodes || [];
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
    const btn = e.target.closest('[data-pl-new]');
    if (btn) { void this._create(btn.dataset.plNew); return; }
    const act = e.target.closest('[data-pl-act]');
    if (act) {
      const a = act.dataset.plAct;
      void (a === 'include' ? this._includePicker() : a === 'classes' ? this._assignClasses() : this._viewPlan());
      return;
    }
    const row = e.target.closest('.pl-row');
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
    if (pane) { this.active = pane.dataset.pane; this._paint(); }
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
    const nodes = this.plans?.nodes || [];
    let plan = this._target();
    while (plan && plan.kind !== 'plan') plan = plan.parentId ? nodes.find((n) => n.id === plan.parentId) : null;
    if (!plan) { this.app.showToast('Rechts einen Plan wählen.', 'info'); return; }
    const before = (this.plans.classes?.[plan.id] || []).map((c) => c.id);
    const chosen = await pickClass(this.app, {
      title: `📒 Klassen für „${plan.title}“`,
      hint: 'Das Klassennotizbuch der Klasse folgt dem Plan: Alles kommt eingeschaltet hinein, später Dazugekommenes ausgeschaltet. Was die Klasse schon hat, bleibt. Eine Klasse hat höchstens einen Plan.',
      multiple: true, preselected: before, okLabel: '📒 Plan zuweisen', allowNone: true,
    });
    if (!chosen) return;
    const ids = new Set(chosen.map((c) => c.id));
    const notes = [];
    for (const c of chosen) {
      if (before.includes(c.id)) continue;
      const res = await this.app.api.setClassPlan(c.id, plan.id);
      if (bad(res)) { this.app.showToast(`${c.name}: ${res?.message || 'Das ging nicht.'}`, 'error'); continue; }
      notes.push(`${c.name}: ${res.added} neu${res.present?.length ? `, ${res.present.length} schon da` : ''}${res.notReleased?.length ? `, nicht freigegeben: ${res.notReleased.join(', ')}` : ''}`);
    }
    for (const id of before) {
      if (ids.has(id)) continue;
      const res = await this.app.api.setClassPlan(id, null);
      if (!bad(res)) notes.push(`${(this.plans.classes[plan.id] || []).find((c) => c.id === id)?.name || 'Klasse'}: folgt dem Plan nicht mehr (Inhalt bleibt)`);
    }
    if (notes.length) this.app.showToast(notes.join(' · '), 'success');
    await this.refresh();
  }

  _menu(x, y) {
    const pane = this.active;
    const items = pane === 'left'
      ? [['F5', '➡ Als Verweis in den Plan', () => this._copyRight()]]
      : [['F2', '✏️ Umbenennen', () => this._rename()], ['F3', '👁 Plan ansehen', () => this._viewPlan()],
        ['', '📒 Klassen zuweisen …', () => this._assignClasses()],
        ['F5', '🧩 Teilplan einbinden / Plan kopieren', () => this._includePicker()], ['F6', '↔️ Verschieben nach …', () => this._movePicker()],
        ['F7', '➕ Neu', () => this._create(this._newKind(false))], ['F8', '🗑 Entfernen', () => this._remove()]];
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
      const row = e.target.closest('.pl-pane[data-pane="right"] .pl-row');
      if (!from || !row) return;
      e.preventDefault();
      this.root.querySelectorAll('.pl-row.drop').forEach((r) => r.classList.remove('drop'));
      row.classList.add('drop');
    });
    this.root.addEventListener('dragend', () => { from = null; this.root.querySelectorAll('.pl-row.drop').forEach((r) => r.classList.remove('drop')); });
    this.root.addEventListener('drop', async (e) => {
      const row = e.target.closest('.pl-pane[data-pane="right"] .pl-row');
      if (!from || !row) return;
      e.preventDefault();
      const src = from;
      from = null;
      const i = Number(row.dataset.i);
      if (src === 'left') {
        this.cursor.right = i;
        await this._copyRight();
        return;
      }
      // Rechts → rechts: in den Knoten unter der Maus (bei Lernthema: dessen Elternteil).
      const dest = this.rows.right[i];
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
