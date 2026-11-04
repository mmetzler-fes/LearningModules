import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== ADMIN: HTML-APPS ====================
//
// Liste aller hochgeladenen Apps mit Quelltext und Sperre im Shop je Fassung (docs/html-apps.md).
// Alles aus den Dateien ist fremder Text: Der Quelltext steht nur in einer Textbox und läuft hier nie.

const kb = (bytes) => `${Math.round((bytes || 0) / 1024)} KB`;
const CELL = 'padding:10px 12px;';
const MAX_USED = 3;
const when = (d) => (d ? new Date(d).toLocaleDateString('de-DE') : '');

export class HtmlAppsAdminView {
  constructor(app) {
    this.app = app;
    this._root = document.getElementById('adminHtmlAppsContent');
    this._rows = [];
    this._root?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-source]');
      if (btn) this._showSource(btn.dataset.source);
    });
    this._root?.addEventListener('change', (e) => {
      if (e.target.matches('[data-shop]')) this._setShop(e.target);
    });
  }

  async refresh() {
    if (!this._root) return;
    this._root.textContent = 'Wird geladen …';
    let rows = null;
    try { rows = await this.app.api.getAdminHtmlApps(); } catch (_) { /* unten wie eine Ablehnung */ }
    if (!Array.isArray(rows)) {
      this._root.textContent = `❌ ${rows?.message || 'Die Liste konnte nicht geladen werden.'}`;
      return;
    }
    this._rows = rows;
    this._render();
  }

  _render() {
    if (!this._rows.length) {
      this._root.innerHTML = '<p class="hint">Es wurde noch keine HTML-App hochgeladen.</p>';
      return;
    }
    const th = (text) => `<th style="${CELL}">${text}</th>`;
    this._root.style.maxWidth = 'none';
    this._root.innerHTML = `<div style="overflow-x:auto"><table style="width:100%; border-collapse:collapse;">
      <thead><tr style="text-align:left;">${['App', 'Hochgeladen', 'Umfang', 'Verwendet in', 'Prüfen und sperren'].map(th).join('')}</tr></thead>
      <tbody>${this._rows.map((r) => this._row(r)).join('')}</tbody>
    </table></div>`;
  }

  _used(usedIn) {
    if (!usedIn.length) return '<span class="hint">nicht verwendet</span>';
    const names = [...new Set(usedIn.map((u) => `${u.topic} › ${u.title}`))];
    const more = names.length - MAX_USED;
    return names.slice(0, MAX_USED).map(escapeHtml).join('<br>') + (more > 0 ? `<br><span class="hint">und ${more} weitere</span>` : '');
  }

  _row(r) {
    const shop = r.current
      ? `<label style="display:block; margin-top:6px;"><input type="checkbox" data-shop="${escapeAttr(r.id)}" ${r.shopBlocked ? 'checked' : ''}> Im Shop gesperrt</label>
         ${r.shopBlocked ? `<small class="hint">${escapeHtml(r.blockedBy)}, ${escapeHtml(when(r.blockedAt))}</small>` : ''}`
      : '<div class="hint" style="margin-top:6px;">alte Schnittstelle, nicht im Shop</div>';
    return `<tr style="border-top:1px solid var(--border); vertical-align:top;">
      <td style="${CELL}"><strong>${escapeHtml(r.title || 'Ohne Titel')}</strong>${r.version ? `<br><small class="hint">Fassung ${escapeHtml(r.version)}</small>` : ''}
        <br><small class="hint" title="SHA-256: ${escapeAttr(r.sha)}">Hash ${escapeHtml(r.sha.slice(0, 12))}</small></td>
      <td style="${CELL}">${escapeHtml(r.owner)}${r.ownerAllowed ? '' : '<br><small class="hint">⏸ Konto darf keine HTML-Apps, App nicht im Shop</small>'}<br><small class="hint">${escapeHtml(when(r.createdAt))}</small></td>
      <td style="${CELL}">${r.units} Abschnitte, ${r.steps} Schritte<br><small class="hint">${kb(r.size)}</small></td>
      <td style="${CELL}">${this._used(r.usedIn)}</td>
      <td style="${CELL} white-space:nowrap;"><button type="button" class="btn btn-secondary btn-sm" data-source="${escapeAttr(r.id)}">Code ansehen</button>${shop}</td>
    </tr>`;
  }

  async _setShop(box) {
    const id = box.dataset.shop;
    const blocked = box.checked;
    box.disabled = true;
    let res = null;
    try { res = await this.app.api.setHtmlAppBlocked(id, blocked); } catch (_) { /* unten wie eine Ablehnung */ }
    if (!res?.success) {
      box.checked = !blocked;
      box.disabled = false;
      this.app.showToast(res?.message || 'Das hat nicht geklappt.', 'error');
      return;
    }
    this.app.showToast(blocked ? 'Diese Fassung ist aus dem Shop genommen.' : 'Diese Fassung darf wieder in den Shop.', 'success');
    await this.refresh();
  }

  async _showSource(id) {
    const row = this._rows.find((r) => r.id === id);
    let data = null;
    try { data = await this.app.api.getAdminHtmlAppSource(id); } catch (_) { /* unten wie eine Ablehnung */ }
    if (typeof data?.html !== 'string') {
      this.app.showToast(data?.message || 'Der Quelltext konnte nicht geladen werden.', 'error');
      return;
    }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; z-index:10000; display:flex; flex-direction:column; gap:8px; padding:16px; background:var(--bg-primary,#fff);';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:12px;';
    const title = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = `${row?.title || 'HTML-App'} ${row?.version ? `(Fassung ${row.version})` : ''}`;
    const hash = document.createElement('div');
    hash.className = 'hint';
    hash.textContent = `SHA-256: ${data.sha}${data.intact ? '' : ' – ⚠️ passt nicht mehr zum Inhalt'}`;
    title.append(name, hash);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-secondary';
    close.textContent = '✕ Schließen';
    head.append(title, close);
    // Nur als Text: value setzt keinen HTML-Code in die Seite.
    const code = document.createElement('textarea');
    code.readOnly = true;
    code.wrap = 'off';
    code.spellcheck = false;
    code.style.cssText = 'flex:1; width:100%; font-family:monospace; font-size:13px; white-space:pre; overflow:auto;';
    code.value = data.html;
    overlay.append(head, code);
    const onKey = (e) => { if (e.key === 'Escape') done(); };
    const done = () => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    };
    close.addEventListener('click', done);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    code.focus();
  }
}
