// ==================== EINSTELLUNGEN DER LEHRKRAFT ====================

/**
 * Persönliche Einstellungen der Oberfläche, am Konto gespeichert und damit auf
 * allen Geräten gleich (PATCH /api/auth/settings, auth.service.ts:
 * USER_SETTINGS). Der Stift-Editor liest sie über window.appSettings.
 */
export class UserSettingsDialog {
  constructor(app) {
    this.app = app;
    document.getElementById('btnUserSettings')?.addEventListener('click', () => this.open());
  }

  /** Aktuelle Einstellungen des angemeldeten Kontos. */
  get() {
    return this.app.state.currentUser?.settings || {};
  }

  /** Ändern und speichern; true, wenn der Server es übernommen hat. */
  async set(patch) {
    const res = await this.app.api.saveUserSettings(patch).catch(() => null);
    if (!res?.success) return false;
    if (this.app.state.currentUser) this.app.state.currentUser.settings = res.settings;
    return true;
  }

  open() {
    const s = this.get();
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<div class="import-modules-card" role="dialog" aria-modal="true">
        <h3>⚙️ Einstellungen</h3>
        <p class="hint">Gelten für dein Konto auf allen Geräten.</p>
        <label class="tag-filter-mode"><input type="checkbox" name="inkTemplateHead" ${s.inkTemplateHead ? 'checked' : ''} />
          <span>✏️ Stift-Editor: Kopfzeile der Vorlage zeigen (Logo, Titel – wie im Druck)</span></label>
        <p class="hint">Auch im Stift-Editor über den Knopf neben 🖨 umschaltbar.</p>
        <div class="confirm-actions"><button type="button" class="btn btn-primary" data-close>Fertig</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.querySelectorAll('input[type="checkbox"]').forEach((box) => box.addEventListener('change', async () => {
      if (!(await this.set({ [box.name]: box.checked }))) {
        box.checked = !box.checked;
        this.app.showToast('Die Einstellung ließ sich nicht speichern.', 'error');
      }
    }));
  }
}
