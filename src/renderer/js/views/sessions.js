import { escapeHtml } from '../utils.js';

// ==================== ANGEMELDETE GERÄTE ====================

const failed = (res) => !res || res.statusCode >= 400 || res.success === false;
const when = (d) => new Date(d).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Wo das eigene Konto angemeldet ist (auth/sessions.service.ts): je Gerät
 * seit wann, zuletzt aktiv, bis wann – einzeln abmelden, überall sonst oder
 * überall. Ein verlorenes iPad ist damit sofort draußen.
 */
export class SessionsDialog {
  constructor(app) {
    this.app = app;
    document.getElementById('btnSessions')?.addEventListener('click', () => this.open());
  }

  async open() {
    this._overlay?.remove();
    this._overlay = document.createElement('div');
    this._overlay.className = 'confirm-overlay';
    this._overlay.innerHTML = '<div class="import-modules-card sessions-card"><p class="hint">Wird geladen …</p></div>';
    document.body.appendChild(this._overlay);
    this._overlay.addEventListener('click', (e) => { if (e.target === this._overlay) this._close(); });
    await this._render();
  }

  _close() {
    this._overlay?.remove();
    this._overlay = null;
  }

  async _render() {
    const card = this._overlay?.querySelector('.sessions-card');
    if (!card) return;
    const list = await this.app.api.listSessions().catch(() => null);
    if (!Array.isArray(list)) {
      card.innerHTML = `<p class="login-error">${escapeHtml(list?.message || 'Die Liste ließ sich nicht laden.')}</p>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary" data-close>Schließen</button></div>`;
      card.querySelector('[data-close]').addEventListener('click', () => this._close());
      return;
    }
    const others = list.filter((s) => !s.current).length;
    card.innerHTML = `
      <h3>📱 Angemeldete Geräte</h3>
      <p class="hint">Mit „Angemeldet bleiben“ gilt eine Anmeldung bis 90 Tage nach der letzten Nutzung, sonst 12 Stunden.
        Ein Gerät abmelden wirkt sofort – etwa wenn ein iPad verloren gegangen ist. Wer das Passwort ändert, ist überall sonst abgemeldet.</p>
      <ul class="sessions-list">${list.map((s) => `
        <li class="${s.current ? 'sessions-current' : ''}">
          <div><strong>${escapeHtml(s.label || 'Gerät')}</strong>${s.current ? ' <span class="result-mode-badge">dieses Gerät</span>' : ''}
            <div class="hint">angemeldet ${escapeHtml(when(s.createdAt))} · zuletzt aktiv ${escapeHtml(when(s.lastSeenAt))} ·
              ${s.remember ? `bleibt angemeldet bis ${escapeHtml(when(s.expiresAt))}` : `bis ${escapeHtml(when(s.expiresAt))}`}</div></div>
          <button type="button" class="btn btn-secondary btn-sm" data-end="${escapeHtml(s.id)}">${s.current ? 'Hier abmelden' : 'Abmelden'}</button>
        </li>`).join('') || '<li class="hint">Keine Anmeldungen gefunden – vermutlich noch aus der Zeit vor der Geräteliste.</li>'}</ul>
      <div class="confirm-actions">
        <button type="button" class="btn btn-secondary" data-others ${others ? '' : 'disabled'}>Überall sonst abmelden (${others})</button>
        <button type="button" class="btn btn-danger" data-all>Überall abmelden</button>
        <button type="button" class="btn btn-secondary" data-close>Schließen</button>
      </div>`;
    card.querySelector('[data-close]').addEventListener('click', () => this._close());
    card.querySelectorAll('[data-end]').forEach((btn) => btn.addEventListener('click', async () => {
      const s = list.find((x) => x.id === btn.dataset.end);
      if (s?.current) { await this._endAll(false, 'Hier abmelden?'); return; }
      const res = await this.app.api.endSession(btn.dataset.end);
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      this.app.showToast(`„${s?.label || 'Gerät'}“ ist abgemeldet.`, 'success');
      await this._render();
    }));
    card.querySelector('[data-others]').addEventListener('click', async () => {
      if (!(await this.app.appConfirm(`Auf allen anderen Geräten abmelden (${others})? Dieses Gerät bleibt angemeldet.`))) return;
      const res = await this.app.api.endAllSessions(true);
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      this.app.showToast('Auf allen anderen Geräten abgemeldet.', 'success');
      await this._render();
    });
    card.querySelector('[data-all]').addEventListener('click', () => this._endAll(true, 'Überall abmelden – auch auf diesem Gerät?'));
  }

  /** Diese Anmeldung (oder alle) beenden und zur Anmeldung zurück. */
  async _endAll(all, question) {
    if (!(await this.app.appConfirm(question))) return;
    await (all ? this.app.api.endAllSessions(false) : this.app.api.logoutSession()).catch(() => null);
    this._close();
    this.app.loginView.showLoginScreen();
  }
}
