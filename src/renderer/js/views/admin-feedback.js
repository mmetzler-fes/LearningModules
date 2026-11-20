import { escapeHtml, escapeAttr } from '../utils.js';

// ============ 💬 FEEDBACK – Admin ============
// Meldungen aller Nutzer: nach Wichtigkeit ordnen, erledigen, löschen (src/feedback).

const PRIO = [
  { v: 3, label: '🔴 hoch' },
  { v: 2, label: '🟠 mittel' },
  { v: 1, label: '🟢 niedrig' },
  { v: 0, label: '⚪ ohne' },
];

export class AdminFeedbackView {
  constructor(app) {
    this.app = app;
    this.filter = 'open';
  }

  get _el() { return document.getElementById('adminFeedbackContent'); }

  _headers() { return this.app.authStore.getHeaders(); }

  async refresh() {
    const el = this._el;
    if (!el) return;
    el.innerHTML = '<p class="hint">Wird geladen …</p>';
    const res = await fetch('/api/admin/feedback', { headers: this._headers() }).catch(() => null);
    const rows = res?.ok ? await res.json() : null;
    if (!Array.isArray(rows)) { el.innerHTML = '<p class="login-error">Meldungen lassen sich nicht laden.</p>'; return; }
    this.rows = rows;
    this._render();
  }

  _render() {
    const el = this._el;
    const open = this.rows.filter((r) => r.status !== 'done');
    const shown = this.filter === 'open' ? open : this.rows;
    const when = (d) => new Date(d).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
    el.innerHTML = `
      <div class="fb-bar">
        <label class="login-remember"><input type="radio" name="fbFilter" value="open" ${this.filter === 'open' ? 'checked' : ''}> offen (${open.length})</label>
        <label class="login-remember"><input type="radio" name="fbFilter" value="all" ${this.filter === 'all' ? 'checked' : ''}> alle (${this.rows.length})</label>
        <button type="button" class="btn btn-secondary btn-sm" data-fb-reload>↻ Neu laden</button>
      </div>
      ${shown.length ? '' : '<p class="hint">Keine Meldungen.</p>'}
      <div class="fb-list">${shown.map((r) => `
        <article class="fb-item${r.status === 'done' ? ' fb-done' : ''}" data-id="${escapeAttr(r.id)}">
          <div class="fb-head">
            <select data-fb-prio title="Wichtigkeit">${PRIO.map((p) => `<option value="${p.v}" ${p.v === r.priority ? 'selected' : ''}>${p.label}</option>`).join('')}</select>
            <span class="fb-meta">${escapeHtml(when(r.createdAt))} · ${escapeHtml(r.reporter || 'Gast')}${r.context?.view ? ` · ${escapeHtml(r.context.view)}` : ''}${r.context?.tab ? ` · ${escapeHtml(r.context.tab)}` : ''}</span>
            <span class="fb-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-fb-done>${r.status === 'done' ? '↺ wieder offen' : '✓ erledigt'}</button>
              <button type="button" class="btn btn-secondary btn-sm" data-fb-del title="Löschen">🗑</button>
            </span>
          </div>
          <p class="fb-text">${escapeHtml(r.text || '').replace(/\n/g, '<br>') || '<span class="hint">ohne Text</span>'}</p>
          ${r.hasImage ? `<button type="button" class="fb-thumb" data-fb-img title="Bild groß"><img alt="Bild zur Meldung" data-src="/api/admin/feedback/${escapeAttr(r.id)}/image"></button>` : ''}
          <details class="fb-context"><summary>Gerät und Ort</summary><pre>${escapeHtml(JSON.stringify(r.context || {}, null, 2))}</pre></details>
        </article>`).join('')}</div>`;
    el.querySelectorAll('input[name=fbFilter]').forEach((x) => x.addEventListener('change', () => { this.filter = x.value; this._render(); }));
    el.querySelector('[data-fb-reload]').addEventListener('click', () => this.refresh());
    // Bilder mit Anmeldung laden (img src kann keinen Header schicken).
    el.querySelectorAll('img[data-src]').forEach(async (img) => {
      const res = await fetch(img.dataset.src, { headers: this._headers() }).catch(() => null);
      if (res?.ok) img.src = URL.createObjectURL(await res.blob());
    });
    el.querySelectorAll('.fb-item').forEach((item) => {
      const id = item.dataset.id;
      const row = this.rows.find((r) => r.id === id);
      item.querySelector('[data-fb-prio]').addEventListener('change', async (e) => {
        await this._patch(id, { priority: Number(e.target.value) });
        row.priority = Number(e.target.value);
        this.rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1) || b.priority - a.priority);
        this._render();
      });
      item.querySelector('[data-fb-done]').addEventListener('click', async () => {
        const status = row.status === 'done' ? 'open' : 'done';
        await this._patch(id, { status });
        row.status = status;
        this._render();
      });
      item.querySelector('[data-fb-del]').addEventListener('click', async () => {
        if (!confirm('Diese Meldung löschen?')) return;
        await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: 'DELETE', headers: this._headers() });
        this.rows = this.rows.filter((r) => r.id !== id);
        this._render();
      });
      item.querySelector('[data-fb-img]')?.addEventListener('click', (e) => {
        const src = e.currentTarget.querySelector('img').src;
        if (src) window.open(src, '_blank', 'noopener');
      });
    });
  }

  async _patch(id, body) {
    const res = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: 'PATCH', headers: this._headers(), body: JSON.stringify(body) });
    if (!res.ok) this.app.showToast('Speichern ging nicht.', 'error');
  }
}
