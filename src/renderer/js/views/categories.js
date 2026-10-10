import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== KATEGORIEN ====================
//
// Einheitliche Einordnung nach Fach (bis 3 Ebenen) und Bildungsstufe (bis 2),
// für alle Lehrkräfte gleich und über Server hinweg verständlich – anders als
// die persönlichen Tags. Ebene 1 stammt von OpenEduHub, darunter eine
// gemeinsame Ergänzung; Lehrkräfte können Begriffe vorschlagen.
// Siehe docs/kategorien.md.

export const FACETS = {
  subject: { icon: '📚', label: 'Fach', maxDepth: 3 },
  stage: { icon: '🎓', label: 'Bildungsstufe', maxDepth: 2 },
};

/** Kategorien laden (einmal je Sitzung, `force` lädt neu). */
export async function ensureCategories(app, force = false) {
  if (!force && Array.isArray(app.state.categories) && app.state.categories.length) return app.state.categories;
  try {
    const list = await app.api.getCategories();
    app.state.categories = Array.isArray(list) ? list : [];
  } catch (_) {
    app.state.categories = app.state.categories || [];
  }
  app.state.categoryById = new Map(app.state.categories.map((c) => [c.id, c]));
  return app.state.categories;
}

const byIdOf = (app) => app.state.categoryById || new Map((app.state.categories || []).map((c) => [c.id, c]));

/** „Elektrotechnik › Automatisierungstechnik › SPS-Programmierung“ */
export function catPath(app, id) {
  const byId = byIdOf(app);
  const parts = [];
  let c = byId.get(id);
  while (c && parts.length < 4) {
    parts.unshift(c.label);
    c = c.parentId ? byId.get(c.parentId) : null;
  }
  return parts.join(' › ');
}

/**
 * Chips für eine Auswahl. Angezeigt wird der Begriff selbst, der volle Pfad
 * steht im Tooltip. Liegen ein Begriff und sein Oberbegriff beide vor, genügt
 * der genauere.
 */
export function categoryChips(app, ids, { max = 5, removable = false } = {}) {
  const byId = byIdOf(app);
  const list = [...new Set(ids || [])].filter((id) => byId.has(id));
  const covered = new Set();
  for (const id of list) {
    let p = byId.get(id)?.parentId;
    while (p) { covered.add(p); p = byId.get(p)?.parentId; }
  }
  const shown = list.filter((id) => removable || !covered.has(id))
    .sort((a, b) => (byId.get(a).facet === byId.get(b).facet ? 0 : byId.get(a).facet === 'subject' ? -1 : 1));
  const chip = (id) => {
    const c = byId.get(id);
    const f = FACETS[c.facet] || FACETS.subject;
    const state = c.status === 'proposed' ? ' cat-proposed' : c.status === 'hidden' ? ' cat-hidden' : '';
    const note = c.status === 'proposed' ? ' (vorgeschlagen)' : c.status === 'hidden' ? ' (ausgeblendet)' : '';
    return `<span class="cat-chip cat-${c.facet}${state}" title="${escapeAttr(`${f.label}: ${catPath(app, id)}${note}`)}">${f.icon} ${escapeHtml(c.label)}${removable ? `<button type="button" class="cat-chip-x" data-id="${escapeAttr(id)}" aria-label="${escapeAttr(c.label)} entfernen">✕</button>` : ''}</span>`;
  };
  const head = shown.slice(0, removable ? shown.length : max).map(chip).join('');
  const more = !removable && shown.length > max ? `<span class="cat-chip cat-more" title="${escapeAttr(shown.slice(max).map((id) => catPath(app, id)).join('\n'))}">+${shown.length - max}</span>` : '';
  return head + more;
}

/** Optionen für eine Auswahlliste (Shop-Filter): eingerückt nach Ebene. */
export function categoryOptions(app, facet, { onlyUsed = null } = {}) {
  const all = (app.state.categories || []).filter((c) => c.facet === facet && c.status !== 'hidden');
  const kids = (pid) => all.filter((c) => (c.parentId || null) === pid);
  // Ein Begriff erscheint, wenn er selbst oder etwas darunter vorkommt.
  const walk = (pid, depth) => kids(pid).flatMap((c) => {
    const below = walk(c.id, depth + 1);
    if (onlyUsed && !onlyUsed.has(c.id) && !below.length) return [];
    return [`<option value="${escapeAttr(c.id)}">${'\u00a0\u00a0\u00a0'.repeat(depth)}${escapeHtml(c.label)}</option>`, ...below];
  });
  return walk(null, 0).join('');
}

/** Die Kategorien samt allem darunter (für die Suche). */
export function withDescendants(app, ids) {
  const out = new Set(ids);
  const all = app.state.categories || [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of all) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); grew = true; }
  }
  return out;
}

/** Die Kategorien samt allem darüber. */
export function withAncestors(app, ids) {
  const byId = byIdOf(app);
  const out = new Set();
  for (const id of ids || []) {
    let c = byId.get(id);
    while (c && !out.has(c.id)) { out.add(c.id); c = c.parentId ? byId.get(c.parentId) : null; }
  }
  return out;
}

/**
 * Auswahl nach Fach und Bildungsstufe: Baum zum Aufklappen, Suche, gewählte
 * Begriffe als Chips, und „Begriff vorschlagen“, wenn etwas fehlt.
 */
export class CategoryPicker {
  constructor(app, container, { fixed = [] } = {}) {
    this.app = app;
    this._root = container;
    this._selected = new Set();
    /** Kategorien, die von anderswo kommen (Tags, Lernthemen) – nur zur Ansicht. */
    this._fixed = new Set(fixed);
    this._facet = 'subject';
    this._open = new Set();
    this._query = '';
  }

  async render(selected) {
    await ensureCategories(this.app);
    if (selected !== undefined) this._selected = new Set(selected || []);
    if (!this._built) this._build();
    // Wo schon etwas gewählt ist, ist der Baum aufgeklappt.
    for (const id of withAncestors(this.app, [...this._selected])) if (!this._selected.has(id)) this._open.add(id);
    this._draw();
  }

  get selectedIds() {
    return [...this._selected];
  }

  _build() {
    this._root.innerHTML = `
      <div class="cat-picker">
        <div class="cat-selected"></div>
        <div class="cat-toolbar">
          <div class="cat-facets" role="tablist">
            ${Object.entries(FACETS).map(([k, f]) => `<button type="button" class="cat-facet-btn" data-facet="${k}" role="tab">${f.icon} ${f.label}</button>`).join('')}
          </div>
          <input type="search" class="cat-search" placeholder="Suchen, z. B. SPS" aria-label="Kategorie suchen" />
        </div>
        <div class="cat-tree" role="tree"></div>
        <details class="cat-propose">
          <summary>Fehlt ein Begriff? Vorschlagen …</summary>
          <div class="cat-propose-row">
            <select class="cat-propose-parent" aria-label="Oberbegriff"></select>
            <input type="text" class="cat-propose-label" maxlength="60" placeholder="Neuer Begriff" aria-label="Neuer Begriff" />
            <button type="button" class="btn btn-secondary btn-sm cat-propose-btn">Vorschlagen</button>
          </div>
          <p class="hint">Du kannst ihn sofort verwenden; für alle anderen erscheint er, sobald der Admin ihn bestätigt hat.</p>
        </details>
      </div>`;
    this._built = true;
    this._sel = this._root.querySelector('.cat-selected');
    this._tree = this._root.querySelector('.cat-tree');
    this._root.querySelectorAll('.cat-facet-btn').forEach((b) => b.addEventListener('click', () => { this._facet = b.dataset.facet; this._draw(); }));
    const search = this._root.querySelector('.cat-search');
    search.addEventListener('input', () => { this._query = search.value.trim().toLocaleLowerCase('de'); this._drawTree(); });
    // Enter in der Suche soll kein umgebendes Formular abschicken.
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    const label = this._root.querySelector('.cat-propose-label');
    label.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._propose(); } });
    this._root.querySelector('.cat-propose-btn').addEventListener('click', () => this._propose());
    this._sel.addEventListener('click', (e) => {
      const x = e.target.closest('.cat-chip-x');
      if (!x) return;
      this._selected.delete(x.dataset.id);
      this._draw();
    });
    this._tree.addEventListener('click', (e) => {
      const tog = e.target.closest('.cat-toggle');
      if (tog) {
        const id = tog.dataset.id;
        this._open.has(id) ? this._open.delete(id) : this._open.add(id);
        this._drawTree();
      }
    });
    this._tree.addEventListener('change', (e) => {
      const cb = e.target.closest('.cat-check');
      if (!cb) return;
      cb.checked ? this._selected.add(cb.value) : this._selected.delete(cb.value);
      this._drawSelected();
    });
  }

  _draw() {
    this._root.querySelectorAll('.cat-facet-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.facet === this._facet);
      b.setAttribute('aria-selected', String(b.dataset.facet === this._facet));
    });
    this._drawSelected();
    this._drawTree();
    this._drawParents();
  }

  _drawSelected() {
    const own = [...this._selected];
    const fixed = [...this._fixed].filter((id) => !this._selected.has(id));
    this._sel.innerHTML = (own.length ? categoryChips(this.app, own, { removable: true }) : '<span class="hint">Noch nicht eingeordnet.</span>')
      + (fixed.length ? `<span class="cat-fixed" title="Kommt aus den Tags bzw. den Lernthemen darin">+ ${categoryChips(this.app, fixed, { max: 6 })}</span>` : '');
  }

  _visible() {
    return (this.app.state.categories || []).filter((c) => c.facet === this._facet && (c.selectable || this._selected.has(c.id)));
  }

  _drawTree() {
    const all = this._visible();
    const kids = (pid) => all.filter((c) => (c.parentId || null) === pid);
    const q = this._query;
    let show = null;
    if (q) {
      const hits = all.filter((c) => c.label.toLocaleLowerCase('de').includes(q)).map((c) => c.id);
      show = withAncestors(this.app, hits);
    }
    const rows = [];
    const walk = (pid, depth) => {
      for (const c of kids(pid)) {
        if (show && !show.has(c.id)) continue;
        const children = kids(c.id).filter((k) => !show || show.has(k.id));
        const open = !!show || this._open.has(c.id);
        const hit = q && c.label.toLocaleLowerCase('de').includes(q);
        rows.push(`
          <div class="cat-row" role="treeitem" style="--depth:${depth}" ${children.length ? `aria-expanded="${open}"` : ''}>
            ${children.length ? `<button type="button" class="cat-toggle" data-id="${escapeAttr(c.id)}" aria-label="${open ? 'Zuklappen' : 'Aufklappen'}">${open ? '▾' : '▸'}</button>` : '<span class="cat-toggle-space"></span>'}
            <label class="cat-label${hit ? ' cat-hit' : ''}">
              <input type="checkbox" class="cat-check" value="${escapeAttr(c.id)}" ${this._selected.has(c.id) ? 'checked' : ''} ${c.selectable ? '' : 'disabled'} />
              <span>${escapeHtml(c.label)}${c.status === 'proposed' ? ' <span class="hint">(dein Vorschlag)</span>' : ''}${children.length && !open ? ` <span class="hint">${children.length}</span>` : ''}</span>
            </label>
          </div>`);
        if (open) walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    this._tree.innerHTML = rows.join('') || '<p class="hint">Nichts gefunden – unten lässt sich ein Begriff vorschlagen.</p>';
  }

  /** Mögliche Oberbegriffe für einen Vorschlag: alle Ebenen bis auf die unterste. */
  _drawParents() {
    const sel = this._root.querySelector('.cat-propose-parent');
    const facet = FACETS[this._facet];
    const all = this._visible().filter((c) => c.selectable);
    const depth = (c) => { let d = 1; let p = c.parentId; while (p) { d++; p = byIdOf(this.app).get(p)?.parentId; } return d; };
    const allowed = new Set(all.filter((c) => depth(c) < facet.maxDepth).map((c) => c.id));
    const kids = (pid) => all.filter((c) => (c.parentId || null) === pid && allowed.has(c.id));
    const out = [];
    const walk = (pid, d) => { for (const c of kids(pid)) { out.push(`<option value="${escapeAttr(c.id)}">${'   '.repeat(d)}${escapeHtml(c.label)}</option>`); walk(c.id, d + 1); } };
    walk(null, 0);
    const current = sel.value;
    // Vorbelegt mit dem zuletzt gewählten Begriff, unter dem noch Platz ist.
    const guess = [...this._selected].reverse().map((id) => byIdOf(this.app).get(id)).find((c) => c && c.facet === this._facet && allowed.has(c.id));
    sel.innerHTML = `<option value="">Oberbegriff (${facet.label}) wählen …</option>` + out.join('');
    sel.value = allowed.has(current) ? current : guess ? guess.id : '';
  }

  async _propose() {
    const parentId = this._root.querySelector('.cat-propose-parent').value;
    const input = this._root.querySelector('.cat-propose-label');
    const label = input.value.trim();
    if (!parentId) { this.app.showToast('Bitte einen Oberbegriff wählen.', 'error'); return; }
    if (!label) { this.app.showToast('Bitte einen Namen eingeben.', 'error'); return; }
    const res = await this.app.api.proposeCategory({ parentId, label });
    if (!res || !res.success) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    await ensureCategories(this.app, true);
    this._selected.add(res.category.id);
    this._open.add(parentId);
    input.value = '';
    this._draw();
    this.app.showToast(res.existing ? `„${res.category.label}“ gibt es schon – ausgewählt.`
      : this.app.state.currentUser?.role === 'admin' ? `„${label}“ angelegt und ausgewählt.`
        : `„${label}“ vorgeschlagen und ausgewählt.`, 'success');
  }
}

/**
 * Dialog nur zum Einordnen. `actions`: [{ id, label, primary? }] – liefert
 * { action, ids } oder null bei Abbruch.
 */
export async function openCategoryDialog(app, { title, intro = '', selected = [], fixed = [], actions = [{ id: 'save', label: 'Speichern', primary: true }] }) {
  await ensureCategories(app);
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card cat-dialog" style="min-width:min(520px,94vw); max-width:680px; max-height:90vh; overflow:auto">
        <h3>${title}</h3>
        ${intro ? `<p class="hint">${intro}</p>` : ''}
        <div class="cat-dialog-picker"></div>
        <div class="confirm-actions">
          ${actions.map((a) => `<button type="button" class="btn ${a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-secondary'}" data-action="${escapeAttr(a.id)}">${a.label}</button>`).join('')}
          <button type="button" class="btn btn-secondary" data-action="">Abbrechen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const picker = new CategoryPicker(app, overlay.querySelector('.cat-dialog-picker'), { fixed });
    picker.render(selected);
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => done(b.dataset.action ? { action: b.dataset.action, ids: picker.selectedIds } : null)));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
  });
}
