import { escapeHtml, escapeAttr } from '../utils.js';
import { buildSearchIndex, searchItems } from '../quick-search-index.js';

/**
 * 🔍 Schnellsuche (Strg+K oder Knopf oben): Books, Bereiche, Abschnitte, Lernthemen, Dokumente und
 * Quizze mit ihrem Pfad. Enter zeigt den Treffer im Notizbuch (mit Vorschau, wenn sie offen ist),
 * Strg+Enter öffnet ihn gleich im Editor. Nur für Lehrkräfte.
 */
export class QuickSearch {
  constructor(app) {
    this.app = app;
    this._items = null;
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
      if (!this._allowed()) return;
      e.preventDefault();
      this.open();
    });
    document.getElementById('btnQuickSearch')?.addEventListener('click', () => this.open());
  }

  _allowed() {
    const user = this.app.state.currentUser;
    return !!user && user.role !== 'student' && !document.querySelector('.qs-overlay');
  }

  async _load() {
    const typeIcon = (type) => (typeof H5P_TYPES !== 'undefined' && H5P_TYPES[type]?.icon) || '🧩';
    const cached = this.app.notebooksView?._data;
    if (cached) this._items = buildSearchIndex(cached, typeIcon);
    const fresh = await this.app.api.getNotebooks().catch(() => null);
    if (fresh && Array.isArray(fresh.nodes)) this._items = buildSearchIndex(fresh, typeIcon);
  }

  open() {
    if (!this._allowed()) return;
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay qs-overlay';
    overlay.innerHTML = `<div class="nb-dialog qs-card" role="dialog" aria-label="Suchen">
        <input type="search" class="search-input qs-input" placeholder="🔍 Lernthema, Dokument, Quiz, Bereich …" aria-label="Suchen" autocomplete="off" />
        <ul class="qs-list" role="listbox"></ul>
        <p class="hint qs-help">↑↓ wählen · Enter: im Notizbuch zeigen · Strg+Enter: bearbeiten · Esc: schließen</p>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.qs-input');
    const list = overlay.querySelector('.qs-list');
    let hits = [];
    let cur = 0;
    const close = () => overlay.remove();
    const draw = () => {
      const q = input.value.trim();
      hits = this._items ? searchItems(this._items, q) : [];
      cur = Math.min(cur, Math.max(0, hits.length - 1));
      list.innerHTML = !q ? '<li class="qs-empty hint">Tippe, um zu suchen.</li>'
        : !this._items ? '<li class="qs-empty hint">Wird geladen …</li>'
          : !hits.length ? '<li class="qs-empty hint">Nichts gefunden.</li>'
            : hits.map((h, i) => `<li class="qs-hit ${i === cur ? 'cur' : ''}" role="option" aria-selected="${i === cur}" data-i="${i}">
                <span class="qs-icon" aria-hidden="true">${h.icon}</span>
                <span class="qs-title">${escapeHtml(h.title || '(ohne Titel)')}</span>
                <span class="qs-path" title="${escapeAttr(h.path.join(' › '))}">${escapeHtml(h.path.join(' › '))}</span></li>`).join('');
      list.querySelector('.qs-hit.cur')?.scrollIntoView({ block: 'nearest' });
    };
    const choose = (i, edit) => {
      const hit = hits[i];
      if (!hit) return;
      close();
      void this._go(hit, edit);
    };
    input.addEventListener('input', () => { cur = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(cur + 1, hits.length - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(cur - 1, 0); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(cur, e.ctrlKey || e.metaKey); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    list.addEventListener('mousemove', (e) => {
      const li = e.target.closest('.qs-hit');
      if (li && Number(li.dataset.i) !== cur) { cur = Number(li.dataset.i); draw(); }
    });
    list.addEventListener('click', (e) => {
      const li = e.target.closest('.qs-hit');
      if (li) choose(Number(li.dataset.i), e.ctrlKey || e.metaKey);
    });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    input.focus();
    draw();
    this._load().then(draw);
  }

  /** Treffer zeigen: im Notizbuch markiert (mit Vorschau) oder – Strg+Enter – im Editor. */
  async _go(hit, edit) {
    const nb = this.app.notebooksView;
    if (edit && hit.own && hit.kind !== 'node') {
      const topic = (nb?._data?.topics || []).find((t) => t.id === hit.topicId);
      const mod = hit.kind === 'module' ? { id: hit.id } : (topic && nb._singleDocOf?.(topic));
      if (mod) { await this.app.modulesView.openFrom('teacher-notebooks', hit.topicId, { id: mod.id }, 'edit'); return; }
    }
    await nb?.reveal(hit);
  }
}
