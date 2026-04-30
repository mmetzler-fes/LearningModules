import { escapeHtml } from '../utils.js';

// ==================== ADMIN VIEW ====================

export class AdminView {
  constructor(app) {
    this.app = app;
    this._usersCache = [];

    this._teacherWhitelist = document.getElementById('teacherWhitelistTextarea');
    this._teacherBlacklist = document.getElementById('teacherBlacklistTextarea');
    this._adminWhitelist   = document.getElementById('adminWhitelistTextarea');
    this._btnSaveWBL       = document.getElementById('btnSaveWhitelistBlacklist');
  }

  async load() {
    // Bind admin nav buttons
    document.querySelectorAll('#adminNav .nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#adminNav .nav-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const view = btn.getAttribute('data-view');
        this.app.navigateToView(view);
        if (view === 'admin-users') this.refreshUsers();
        if (view === 'admin-whitelist') this.refreshWhitelistBlacklist();
      });
    });

    // Create admin form
    const newAdminForm = document.getElementById('newAdminForm');
    if (newAdminForm) {
      newAdminForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email       = document.getElementById('newAdminEmail')?.value.trim();
        const password    = document.getElementById('newAdminPassword')?.value;
        const displayName = document.getElementById('newAdminDisplayName')?.value.trim();
        const errEl       = document.getElementById('newAdminError');
        if (!email || !password) return;
        try {
          const res = await this.app.api.createAdmin({ email, password, displayName });
          if (res && res.id) {
            this.app.showToast('Admin erstellt', 'success');
            newAdminForm.reset();
            if (errEl) errEl.classList.add('hidden');
            await this.refreshUsers();
          } else {
            if (errEl) { errEl.textContent = res?.error || 'Fehler'; errEl.classList.remove('hidden'); }
          }
        } catch (err) {
          if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
        }
      });
    }

    // Whitelist/blacklist save
    if (this._btnSaveWBL) {
      this._btnSaveWBL.addEventListener('click', async () => {
        const data = {
          teacherWhitelist: (this._teacherWhitelist?.value || '').split('\n').map((s) => s.trim()).filter(Boolean),
          teacherBlacklist: (this._teacherBlacklist?.value || '').split('\n').map((s) => s.trim()).filter(Boolean),
          adminWhitelist:   (this._adminWhitelist?.value   || '').split('\n').map((s) => s.trim()).filter(Boolean),
        };
        try {
          await this.app.api.saveAdminWhitelistBlacklist(data);
          this.app.showToast('Whitelist/Blacklist gespeichert', 'success');
        } catch (_) {
          this.app.showToast('Fehler beim Speichern', 'error');
        }
      });
    }
  }

  async refreshUsers() {
    try {
      this._usersCache = await this.app.api.getAllUsers();
      this._renderUsersList();
    } catch (e) {
      const el = document.getElementById('usersList');
      if (el) el.innerHTML = `<p class="hint">Fehler: ${escapeHtml(e.message)}</p>`;
    }
  }

  _renderUsersList() {
    const container = document.getElementById('usersList');
    if (!container) return;
    const roleLabels = { admin: 'Admin', teacher: 'Lehrer' };
    const roleBadge = (role) => `<span class="user-role-badge ${role}">${roleLabels[role] || role}</span>`;

    if (!this._usersCache.length) { container.innerHTML = '<p class="hint">Keine Benutzer gefunden.</p>'; return; }

    container.innerHTML = '';
    for (const u of this._usersCache) {
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      item.dataset.id = u.id;
      item.innerHTML = `
        <div class="admin-list-item-info">
          <strong>${escapeHtml(u.displayName || u.username || u.email)}</strong>
          <span style="color:var(--text-secondary);font-size:0.9em">${escapeHtml(u.email || u.username)}</span>
          ${roleBadge(u.role)}
        </div>
        <div class="admin-list-item-actions">
          <button class="btn btn-danger btn-sm btn-delete-user">🗑</button>
        </div>`;
      item.querySelector('.btn-delete-user').addEventListener('click', () => this._deleteUser(u.id));
      container.appendChild(item);
    }
  }

  async _deleteUser(userId) {
    const user = this._usersCache.find((u) => u.id === userId);
    if (!user) return;
    const confirmed = await this.app.appConfirm(`Benutzer "${user.displayName || user.email || user.username}" wirklich löschen?`);
    if (!confirmed) return;
    const res = await this.app.api.deleteUser(userId);
    if (res && res.success !== false) { await this.refreshUsers(); this.app.showToast('Benutzer gelöscht', 'success'); }
    else this.app.showToast('Fehler: ' + (res?.error || '?'), 'error');
  }

  async refreshWhitelistBlacklist() {
    try {
      const data = await this.app.api.getAdminWhitelistBlacklist();
      if (this._teacherWhitelist) this._teacherWhitelist.value = (data.teacherWhitelist || []).join('\n');
      if (this._teacherBlacklist) this._teacherBlacklist.value = (data.teacherBlacklist || []).join('\n');
      if (this._adminWhitelist)   this._adminWhitelist.value   = (data.adminWhitelist   || []).join('\n');
    } catch (_) {}
  }
}
