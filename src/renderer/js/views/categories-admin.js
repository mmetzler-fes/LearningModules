import { escapeHtml, escapeAttr } from '../utils.js';
import { FACETS, catPath, categoryOptions, ensureCategories } from './categories.js';

// ==================== ADMIN: KATEGORIEN ====================
//
// Vorschläge der Lehrkräfte bestätigen, umbenennen, zusammenführen oder
// ablehnen; Begriffe ergänzen und ausblenden. Ausgelieferte Kategorien
// (OpenEduHub, gemeinsame Liste) behalten Namen und Platz, damit sie auf allen
// Servern gleich sind – ausblenden geht. Siehe docs/kategorien.md.

const SOURCE = {
  oeh: { label: 'OpenEduHub', title: 'Ebene 1 aus den OpenEduHub-Vokabularen – auf allen Servern gleich' },
  shared: { label: 'gemeinsam', title: 'Mit der App ausgeliefert – auf allen Servern gleich' },
  local: { label: 'hier ergänzt', title: 'Nur auf diesem Server' },
};

export class CategoriesAdminView {
  constructor(app) {
    this.app = app;
    this._root = document.getElementById('adminCategoriesContent');
    this._facet = 'subject';
    this._query = '';
    this._open = new Set();
  }

  async refresh() {
    if (!this._root) return;
    this._root.innerHTML = '<p class="hint">Wird geladen…</p>';
    try {
      const [, usage, users] = await Promise.all([
        ensureCategories(this.app, true),
        this.app.api.getCategoryUsage(),
        this.app.api.getAllUsers(),
      ]);
      this._usage = usage && typeof usage === 'object' ? usage : {};
      this._names = new Map((Array.isArray(users) ? users : []).map((u) => [u.id, u.displayName || u.email]));
      this._render();
    } catch (err) {
      this._root.innerHTML = `<p class="login-error">Fehler: ${escapeHtml(err.message)}</p>`;
    }
  }

  get _all() {
    return this.app.state.categories || [];
  }

  _render() {
    const proposals = this._all.filter((c) => c.status === 'proposed');
    this._root.innerHTML = `
      <div class="settings-group">
        <h3>📝 Vorschläge${proposals.length ? ` (${proposals.length})` : ''}</h3>
        ${proposals.length ? `<div class="cat-admin-list">${proposals.map((c) => this._proposalRow(c)).join('')}</div>`
          : '<p class="hint">Keine offenen Vorschläge. Lehrkräfte können beim Einordnen fehlende Begriffe vorschlagen und sie sofort selbst nutzen.</p>'}
      </div>
      <div class="settings-group">
        <h3>🗂 Kategorien</h3>
        <div class="cat-toolbar">
          <div class="cat-facets">${Object.entries(FACETS).map(([k, f]) => `<button type="button" class="cat-facet-btn ${k === this._facet ? 'active' : ''}" data-facet="${k}">${f.icon} ${f.label}</button>`).join('')}</div>
          <input type="search" class="cat-search" placeholder="Suchen …" value="${escapeAttr(this._query)}" />
        </div>
        <div class="cat-admin-new">
          <select class="cat-new-parent" aria-label="Oberbegriff">${this._parentOptions()}</select>
          <input type="text" class="cat-new-label" maxlength="60" placeholder="Neuer Begriff" aria-label="Neuer Begriff" />
          <button type="button" class="btn btn-primary btn-sm cat-new-btn">➕ Anlegen</button>
        </div>
        <div class="cat-admin-tree">${this._treeHtml()}</div>
      </div>`;

    this._root.querySelectorAll('.cat-facet-btn').forEach((b) => b.addEventListener('click', () => { this._facet = b.dataset.facet; this._render(); }));
    const search = this._root.querySelector('.cat-search');
    search.addEventListener('input', () => {
      this._query = search.value.trim().toLocaleLowerCase('de');
      this._root.querySelector('.cat-admin-tree').innerHTML = this._treeHtml();
    });
    this._root.querySelector('.cat-new-btn').addEventListener('click', () => this._create());
    this._root.querySelector('.cat-new-label').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._create(); } });
    this._root.addEventListener('click', this._onClick ||= (e) => this._handle(e));
  }

  _proposalRow(c) {
    const f = FACETS[c.facet];
    return `
      <div class="cat-admin-row" data-id="${escapeAttr(c.id)}">
        <div class="cat-admin-info">
          <strong>${f.icon} ${escapeHtml(catPath(this.app, c.id))}</strong>
          <span class="hint">von ${escapeHtml(this._names.get(c.proposedBy) || 'Unbekannt')} · ${this._usage[c.id] || 0}× zugeordnet</span>
        </div>
        <div class="cat-admin-actions">
          <button type="button" class="btn btn-primary btn-sm" data-act="accept">✅ Übernehmen</button>
          <button type="button" class="btn btn-secondary btn-sm" data-act="rename">✏️ Umbenennen</button>
          <button type="button" class="btn btn-secondary btn-sm" data-act="merge" title="In einem vorhandenen Begriff aufgehen lassen – Zuordnungen wandern mit">⤵ Zusammenführen</button>
          <button type="button" class="btn btn-danger btn-sm" data-act="delete" title="Ablehnen – was damit eingeordnet war, gilt als eingeordnet unter dem Oberbegriff">🗑 Ablehnen</button>
        </div>
      </div>`;
  }

  _depth(c) {
    let d = 1;
    let p = c.parentId;
    const byId = this.app.state.categoryById;
    while (p) { d++; p = byId.get(p)?.parentId; }
    return d;
  }

  _parentOptions() {
    const f = FACETS[this._facet];
    const all = this._all.filter((c) => c.facet === this._facet && c.status === 'active' && this._depth(c) < f.maxDepth);
    const kids = (pid) => all.filter((c) => (c.parentId || null) === pid);
    const walk = (pid, d) => kids(pid).flatMap((c) => [`<option value="${escapeAttr(c.id)}">${'   '.repeat(d + 1)}${escapeHtml(c.label)}</option>`, ...walk(c.id, d + 1)]);
    return `<option value="">— ganz oben (neue${this._facet === 'subject' ? 's Fach' : ' Stufe'}) —</option>` + walk(null, 0).join('');
  }

  _treeHtml() {
    const all = this._all.filter((c) => c.facet === this._facet && c.status !== 'proposed');
    const kids = (pid) => all.filter((c) => (c.parentId || null) === pid);
    const q = this._query;
    let show = null;
    if (q) {
      show = new Set();
      const byId = this.app.state.categoryById;
      for (const c of all.filter((x) => x.label.toLocaleLowerCase('de').includes(q))) {
        let cur = c;
        while (cur && !show.has(cur.id)) { show.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : null; }
      }
    }
    const rows = [];
    const walk = (pid, depth) => {
      for (const c of kids(pid)) {
        if (show && !show.has(c.id)) continue;
        const children = kids(c.id);
        const open = !!show || this._open.has(c.id);
        const src = SOURCE[c.source] || SOURCE.local;
        rows.push(`
          <div class="cat-admin-row cat-tree-row ${c.status === 'hidden' ? 'cat-hidden' : ''}" data-id="${escapeAttr(c.id)}" style="--depth:${depth}">
            <div class="cat-admin-info">
              ${children.length ? `<button type="button" class="cat-toggle" data-act="toggle">${open ? '▾' : '▸'}</button>` : '<span class="cat-toggle-space"></span>'}
              <span>${escapeHtml(c.label)}</span>
              <span class="cat-src cat-src-${c.source}" title="${escapeAttr(src.title)}">${src.label}</span>
              ${this._usage[c.id] ? `<span class="hint" title="So oft direkt an Lernthemen, Tags oder Angeboten">${this._usage[c.id]}×</span>` : ''}
              ${c.status === 'hidden' ? '<span class="topic-status inactive">ausgeblendet</span>' : ''}
            </div>
            <div class="cat-admin-actions">
              ${c.status === 'hidden'
                ? '<button type="button" class="btn btn-secondary btn-sm" data-act="show">👁 Einblenden</button>'
                : '<button type="button" class="btn btn-secondary btn-sm" data-act="hide" title="Nicht mehr wählbar; bestehende Zuordnungen bleiben">🙈 Ausblenden</button>'}
              ${c.source === 'local' ? `
                <button type="button" class="btn btn-secondary btn-sm" data-act="rename">✏️</button>
                <button type="button" class="btn btn-secondary btn-sm" data-act="merge" title="Zusammenführen">⤵</button>
                <button type="button" class="btn btn-danger btn-sm" data-act="delete" title="Löschen – Zuordnungen gehen an den Oberbegriff">🗑</button>` : ''}
            </div>
          </div>`);
        if (open) walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return rows.join('') || '<p class="hint">Nichts gefunden.</p>';
  }

  async _handle(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || !this._root.contains(btn)) return;
    const id = btn.closest('[data-id]')?.dataset.id;
    const c = this.app.state.categoryById.get(id);
    if (!c) return;
    const { api } = this.app;
    const act = btn.dataset.act;
    let res;
    if (act === 'toggle') {
      this._open.has(id) ? this._open.delete(id) : this._open.add(id);
      this._root.querySelector('.cat-admin-tree').innerHTML = this._treeHtml();
      return;
    }
    if (act === 'accept') res = await api.updateCategory(id, { status: 'active' });
    else if (act === 'hide') res = await api.updateCategory(id, { status: 'hidden' });
    else if (act === 'show') res = await api.updateCategory(id, { status: 'active' });
    else if (act === 'rename') {
      const label = await this._ask(`Neuer Name für „${c.label}“`, c.label);
      if (!label) return;
      res = await api.updateCategory(id, { label });
    } else if (act === 'merge') {
      const into = await this._pickTarget(c);
      if (!into) return;
      res = await api.mergeCategory(id, into);
    } else if (act === 'delete') {
      const parent = c.parentId ? this.app.state.categoryById.get(c.parentId)?.label : null;
      if (!(await this.app.appConfirm(`„${c.label}“ ${c.status === 'proposed' ? 'ablehnen' : 'löschen'}?${this._usage[id] ? `\n\nEs ist ${this._usage[id]}× zugeordnet; dort steht danach ${parent ? `„${parent}“` : 'nichts mehr'}.` : ''}`))) return;
      res = await api.deleteCategory(id);
    }
    if (!res || !res.success) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this.app.showToast(res.moved ? `Erledigt – ${res.moved} Zuordnung${res.moved === 1 ? '' : 'en'} angepasst.` : 'Erledigt', 'success');
    await this.refresh();
  }

  async _create() {
    const parentId = this._root.querySelector('.cat-new-parent').value || null;
    const input = this._root.querySelector('.cat-new-label');
    const label = input.value.trim();
    if (!label) { this.app.showToast('Bitte einen Namen eingeben.', 'error'); return; }
    const res = await this.app.api.proposeCategory({ parentId, label, facet: this._facet });
    if (!res || !res.success) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    if (parentId) this._open.add(parentId);
    this.app.showToast(res.existing ? `„${res.category.label}“ gibt es schon.` : `„${label}“ angelegt.`, res.existing ? 'info' : 'success');
    await this.refresh();
  }

  /** Kleiner Eingabedialog; liefert den Text oder null. */
  _ask(title, value = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <form class="import-modules-card" style="min-width:min(380px,92vw)">
          <h3>${escapeHtml(title)}</h3>
          <input type="text" class="cat-ask" maxlength="60" value="${escapeAttr(value)}" style="width:100%" />
          <div class="confirm-actions"><button type="submit" class="btn btn-primary">OK</button><button type="button" class="btn btn-secondary cat-ask-cancel">Abbrechen</button></div>
        </form>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('.cat-ask');
      input.focus();
      input.select();
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(input.value.trim() || null); });
      overlay.querySelector('.cat-ask-cancel').addEventListener('click', () => done(null));
    });
  }

  /** Ziel für das Zusammenführen: ein Begriff derselben Facette. */
  _pickTarget(c) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <form class="import-modules-card" style="min-width:min(420px,92vw)">
          <h3>⤵ „${escapeHtml(c.label)}“ zusammenführen mit …</h3>
          <p class="hint">Alles, was mit „${escapeHtml(c.label)}“ eingeordnet ist, gilt danach als eingeordnet unter dem gewählten Begriff.</p>
          <select class="cat-target" style="width:100%">${categoryOptions(this.app, c.facet)}</select>
          <div class="confirm-actions"><button type="submit" class="btn btn-primary">Zusammenführen</button><button type="button" class="btn btn-secondary cat-ask-cancel">Abbrechen</button></div>
        </form>`;
      document.body.appendChild(overlay);
      const sel = overlay.querySelector('.cat-target');
      [...sel.options].find((o) => o.value === c.id)?.remove();
      if (c.parentId) sel.value = c.parentId;
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(sel.value || null); });
      overlay.querySelector('.cat-ask-cancel').addEventListener('click', () => done(null));
    });
  }
}
