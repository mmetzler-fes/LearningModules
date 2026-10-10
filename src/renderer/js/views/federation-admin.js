import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== ADMIN: VERNETZUNG ====================
//
// Eigene Identität (Name, öffentliche Adresse, Fingerabdruck), Anfrage an
// einen anderen Server, Liste der Verbindungen mit Annehmen, Trennen und
// Abgleich. Siehe docs/vernetzung.md.

const STATUS = {
  active: { label: '✅ verbunden', cls: 'active' },
  outgoing: { label: '⏳ angefragt – wartet auf den anderen Admin', cls: 'pending' },
  incoming: { label: '📨 möchte sich verbinden', cls: 'pending' },
  ended: { label: '⏸ getrennt', cls: 'inactive' },
};

const when = (d) => (d ? new Date(d).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');

export class FederationAdminView {
  constructor(app) {
    this.app = app;
    this._root = document.getElementById('adminFederationContent');
  }

  async refresh() {
    if (!this._root) return;
    this._root.innerHTML = '<p class="hint">Wird geladen…</p>';
    try {
      this._data = await this.app.api.getFederation();
      if (!this._data || !this._data.serverId) throw new Error(this._data?.message || 'Keine Antwort');
      this._render();
    } catch (err) {
      this._root.innerHTML = `<p class="login-error">Fehler: ${escapeHtml(err.message)}</p>`;
    }
  }

  _render() {
    const d = this._data;
    const incoming = d.peers.filter((p) => p.status === 'incoming');
    const others = d.peers.filter((p) => p.status !== 'incoming');
    this._root.innerHTML = `
      <div class="settings-group">
        <h3>🏫 Dieser Server</h3>
        <div class="form-group">
          <label for="fedName">Name, wie ihn andere sehen</label>
          <input type="text" id="fedName" maxlength="80" value="${escapeAttr(d.name)}" placeholder="z. B. FES Esslingen" />
        </div>
        <div class="form-group">
          <label for="fedUrl">Öffentliche Adresse</label>
          <input type="text" id="fedUrl" value="${escapeAttr(d.url)}" placeholder="https://lm.schule.de" />
          <span class="hint">Unter dieser Adresse müssen andere Server diesen erreichen${d.allowHttp ? ' (http ist zum Testen erlaubt)' : ' – nur https'}.</span>
        </div>
        <p class="hint">Fingerabdruck: <code class="fed-fp">${escapeHtml(d.fingerprint)}</code> – vergleicht ihn mit dem anderen Admin,
          z. B. am Telefon. Er erscheint dort neben eurem Namen.</p>
        <div class="form-actions"><button class="btn btn-primary" id="fedSave">💾 Speichern</button></div>
      </div>

      ${incoming.length ? `
      <div class="settings-group fed-incoming">
        <h3>📨 Anfragen</h3>
        ${incoming.map((p) => this._peerRow(p)).join('')}
      </div>` : ''}

      <div class="settings-group">
        <h3>🌐 Verbundene Server</h3>
        <div class="fed-request">
          <input type="text" id="fedPeerUrl" placeholder="Adresse eines anderen Servers, z. B. https://lm.andere-schule.de" />
          <button class="btn btn-primary" id="fedRequest">Verbindung anfragen</button>
        </div>
        ${others.length ? others.map((p) => this._peerRow(p)).join('') : '<p class="hint">Noch keine Verbindungen.</p>'}
      </div>`;

    this._root.querySelector('#fedSave').addEventListener('click', () => this._save());
    this._root.querySelector('#fedRequest').addEventListener('click', () => this._request());
    this._root.querySelector('#fedPeerUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._request(); });
    this._root.querySelectorAll('[data-peer-act]').forEach((b) => b.addEventListener('click', () => this._act(b.dataset.peer, b.dataset.peerAct, b)));
  }

  _peerRow(p) {
    const s = STATUS[p.status] || STATUS.ended;
    const actions = {
      incoming: `<button class="btn btn-primary btn-sm" data-peer="${escapeAttr(p.id)}" data-peer-act="accept">✅ Annehmen</button>
                 <button class="btn btn-danger btn-sm" data-peer="${escapeAttr(p.id)}" data-peer-act="end">Ablehnen</button>`,
      outgoing: `<button class="btn btn-secondary btn-sm" data-peer="${escapeAttr(p.id)}" data-peer-act="end">Anfrage zurückziehen</button>`,
      active: `<button class="btn btn-secondary btn-sm" data-peer="${escapeAttr(p.id)}" data-peer-act="sync">🔄 Jetzt abgleichen</button>
               <button class="btn btn-danger btn-sm" data-peer="${escapeAttr(p.id)}" data-peer-act="end">Trennen</button>`,
      ended: '',
    }[p.status] || '';
    return `
      <div class="fed-peer fed-${s.cls}">
        <div class="fed-peer-info">
          <strong>${escapeHtml(p.name)}</strong> <span class="hint">${escapeHtml(p.url)}</span>
          <div class="fed-peer-meta">
            <span class="topic-status ${s.cls === 'active' ? 'active' : s.cls === 'inactive' ? 'inactive' : ''}">${s.label}</span>
            <span class="hint">Fingerabdruck <code>${escapeHtml(p.fingerprint)}</code></span>
            ${p.status === 'active' ? `<span class="hint">${p.offerCount} Angebot${p.offerCount === 1 ? '' : 'e'} · abgeglichen ${when(p.lastSyncAt)}</span>` : ''}
          </div>
          ${p.lastError ? `<p class="login-error">${escapeHtml(p.lastError)}</p>` : ''}
          ${p.status === 'incoming' ? '<p class="hint">Bitte vor dem Annehmen den Fingerabdruck mit dem anderen Admin vergleichen.</p>' : ''}
        </div>
        <div class="fed-peer-actions">${actions}</div>
      </div>`;
  }

  async _save() {
    const res = await this.app.api.saveFederationSettings({
      name: this._root.querySelector('#fedName').value,
      url: this._root.querySelector('#fedUrl').value,
    });
    if (!res || !res.serverId) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this._data = res;
    this._render();
    this.app.showToast('Gespeichert', 'success');
  }

  async _request() {
    const input = this._root.querySelector('#fedPeerUrl');
    const url = input.value.trim();
    if (!url) return;
    const btn = this._root.querySelector('#fedRequest');
    btn.disabled = true;
    const res = await this.app.api.requestPeer(url);
    btn.disabled = false;
    if (!res || !res.success) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this.app.showToast(res.status === 'active'
      ? `Mit ${res.peer} verbunden.`
      : `Anfrage an ${res.peer} gesendet – sobald der Admin dort annimmt, seid ihr verbunden.`, 'success');
    await this.refresh();
  }

  async _act(id, act, btn) {
    const peer = this._data.peers.find((p) => p.id === id);
    if (act === 'end') {
      const text = peer.status === 'incoming' ? `Anfrage von ${peer.name} ablehnen?`
        : peer.status === 'outgoing' ? `Anfrage an ${peer.name} zurückziehen?`
          : `Verbindung zu ${peer.name} trennen?\n\nIhre Angebote verschwinden aus dem Shop. Was schon kopiert wurde, bleibt – auf beiden Seiten.`;
      if (!(await this.app.appConfirm(text))) return;
    }
    btn.disabled = true;
    const res = await this.app.api.peerAction(id, act);
    if (!res || !res.success) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); btn.disabled = false; return; }
    this.app.showToast({ accept: `Mit ${peer.name} verbunden.`, end: 'Erledigt', sync: `${res.offerCount} Angebote abgeglichen${res.lastError ? ' – ' + res.lastError : ''}` }[act] || 'Erledigt', res.lastError ? 'error' : 'success');
    await this.refresh();
  }
}
