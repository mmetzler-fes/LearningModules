import { escapeHtml } from '../utils.js';
import { downloadBlob } from '../api.js';
import { helpHint } from './help-view.js';

// ==================== ZWEI-FAKTOR-ANMELDUNG ====================

const failed = (res) => !res || res.statusCode >= 400 || res.success === false;

/** "JBSWY3DPEHPK3PXP…" in Vierergruppen – leichter abzutippen. */
const groupSecret = (secret) => String(secret || '').match(/.{1,4}/g)?.join(' ') || '';

/**
 * Dialog für die eigene 2FA: einrichten (QR-Code, ersten Code bestätigen,
 * Wiederherstellungscodes sichern), neue Wiederherstellungscodes erzeugen,
 * ausschalten. Ein Zustand je Ansicht; der Server ist die Quelle.
 */
export class TwoFactorDialog {
  constructor(app) {
    this.app = app;
    document.getElementById('btnTwoFactor')?.addEventListener('click', () => this.open());
  }

  async open() {
    this._close();
    this._overlay = document.createElement('div');
    this._overlay.className = 'confirm-overlay';
    this._overlay.innerHTML = '<div class="import-modules-card two-factor-card"></div>';
    this._card = this._overlay.querySelector('.two-factor-card');
    document.body.appendChild(this._overlay);
    await this._showStatus();
  }

  _close() {
    this._overlay?.remove();
    this._overlay = null;
  }

  _render(html, bind) {
    this._card.innerHTML = html;
    this._card.querySelector('.btn-2fa-close')?.addEventListener('click', () => this._close());
    bind?.(this._card);
    this._card.querySelector('input:not([type=checkbox])')?.focus();
  }

  async _showStatus() {
    const status = await this.app.api.getTwoFactor();
    if (failed(status)) { this.app.showToast('Fehler: ' + (status?.message || '?'), 'error'); this._close(); return; }

    if (!status.enabled) {
      this._render(`
        <h3>🔐 Zwei-Faktor-Anmeldung ${helpHint('zwei-faktor', 'Hilfe: Zwei-Faktor-Anmeldung')}</h3>
        <p>Zusätzlich zum Passwort fragt die Anmeldung nach einem 6-stelligen Code aus einer
          Authenticator-App auf deinem Handy (z. B. Microsoft oder Google Authenticator, FreeOTP, Aegis, 2FAS).
          Ein erbeutetes Passwort allein reicht dann nicht mehr.</p>
        <p class="hint">Status: <strong>aus</strong></p>
        <div class="confirm-actions">
          <button class="btn btn-primary btn-2fa-setup">Einrichten</button>
          <button class="btn btn-secondary btn-2fa-close">Schließen</button>
        </div>`, (c) => c.querySelector('.btn-2fa-setup').addEventListener('click', () => this._showSetup()));
      return;
    }

    const since = status.enabledAt ? new Date(status.enabledAt).toLocaleDateString('de-DE') : '';
    this._render(`
      <h3>🔐 Zwei-Faktor-Anmeldung ${helpHint('zwei-faktor', 'Hilfe: Zwei-Faktor-Anmeldung')}</h3>
      <p class="hint">Status: <strong>aktiv</strong>${since ? ` seit ${since}` : ''} ·
        noch <strong>${status.recoveryLeft}</strong> Wiederherstellungscode${status.recoveryLeft === 1 ? '' : 's'}</p>
      ${status.recoveryLeft <= 2 ? '<p class="login-error">Nur noch wenige Wiederherstellungscodes – erzeuge neue.</p>' : ''}

      <div class="two-factor-block">
        <h4>Neue Wiederherstellungscodes</h4>
        <p class="hint">Die bisherigen verfallen. Bestätige mit einem aktuellen Code aus der App.</p>
        <div class="school-row">
          <input type="text" class="otp-input code-recovery" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" />
          <button class="btn btn-secondary btn-2fa-recovery">Neue Codes erzeugen</button>
        </div>
      </div>

      <div class="two-factor-block">
        <h4>Ausschalten</h4>
        <p class="hint">Zum Beispiel vor einem Handywechsel – danach neu einrichten.</p>
        <div class="form-group"><input type="password" class="pw-disable" placeholder="Dein Passwort" autocomplete="current-password" /></div>
        <div class="school-row">
          <input type="text" class="otp-input code-disable" maxlength="12" placeholder="Code oder Wiederherstellungscode" />
          <button class="btn btn-danger btn-2fa-disable">2FA ausschalten</button>
        </div>
      </div>

      <div class="confirm-actions"><button class="btn btn-secondary btn-2fa-close">Schließen</button></div>`, (c) => {
      c.querySelector('.btn-2fa-recovery').addEventListener('click', async () => {
        const res = await this.app.api.regenerateRecoveryCodes(c.querySelector('.code-recovery').value.trim());
        if (failed(res)) { this.app.showToast(res?.message || 'Fehler', 'error'); return; }
        this._showRecoveryCodes(res.recoveryCodes, false);
      });
      c.querySelector('.btn-2fa-disable').addEventListener('click', async () => {
        const res = await this.app.api.disableTwoFactor(c.querySelector('.pw-disable').value, c.querySelector('.code-disable').value.trim());
        if (failed(res)) { this.app.showToast(res?.message || 'Fehler', 'error'); return; }
        this.app.showToast('Zwei-Faktor-Anmeldung ausgeschaltet.', 'info');
        await this._showStatus();
      });
    });
  }

  async _showSetup() {
    const res = await this.app.api.setupTwoFactor();
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this._render(`
      <h3>🔐 Zwei-Faktor einrichten</h3>
      <ol class="two-factor-steps">
        <li>Authenticator-App öffnen und diesen QR-Code scannen.</li>
        <li>Den angezeigten 6-stelligen Code unten eingeben.</li>
      </ol>
      <div class="two-factor-qr">${res.qrSvg || ''}</div>
      <p class="hint">Scannen klappt nicht? Schlüssel von Hand eingeben:</p>
      <p><code class="two-factor-secret">${escapeHtml(groupSecret(res.secret))}</code></p>
      <div class="school-row">
        <input type="text" class="otp-input code-enable" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" />
        <button class="btn btn-primary btn-2fa-enable">Aktivieren</button>
        <button class="btn btn-secondary btn-2fa-close">Abbrechen</button>
      </div>`, (c) => {
      const submit = async () => {
        const out = await this.app.api.enableTwoFactor(c.querySelector('.code-enable').value.trim());
        if (failed(out)) { this.app.showToast(out?.message || 'Fehler', 'error'); return; }
        this._showRecoveryCodes(out.recoveryCodes, true);
      };
      c.querySelector('.btn-2fa-enable').addEventListener('click', submit);
      c.querySelector('.code-enable').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    });
  }

  /** Die Codes gibt es nur jetzt im Klartext – deshalb Kopieren und Speichern anbieten. */
  _showRecoveryCodes(codes, justEnabled) {
    const text = 'LernModule – Wiederherstellungscodes (jeder gilt einmal)\n' +
      `${this.app.state.currentUser?.email || ''}\n${new Date().toLocaleString('de-DE')}\n\n${codes.join('\n')}\n`;
    this._render(`
      <h3>${justEnabled ? '✅ Zwei-Faktor ist aktiv' : '🔑 Neue Wiederherstellungscodes'}</h3>
      <p>Bewahre diese Codes sicher auf (ausdrucken oder im Passwortmanager). Mit jedem kommst du
        <strong>einmal</strong> ohne Handy hinein. Sie werden <strong>nur jetzt</strong> angezeigt.</p>
      <div class="two-factor-codes">${codes.map((c) => `<code>${escapeHtml(c)}</code>`).join('')}</div>
      <div class="confirm-actions">
        <button class="btn btn-secondary btn-2fa-copy">📋 Kopieren</button>
        <button class="btn btn-secondary btn-2fa-download">⬇️ Als Datei</button>
        <button class="btn btn-primary btn-2fa-close">Fertig</button>
      </div>`, (c) => {
      c.querySelector('.btn-2fa-copy').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(text);
          this.app.showToast('Codes kopiert', 'success');
        } catch (_) {
          this.app.showToast('Kopieren klappt hier nicht – bitte als Datei speichern.', 'error');
        }
      });
      c.querySelector('.btn-2fa-download').addEventListener('click', () =>
        downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'lernmodule-wiederherstellungscodes.txt'));
    });
  }
}
