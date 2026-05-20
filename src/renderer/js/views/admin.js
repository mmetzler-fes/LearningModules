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

    // Toggle New Admin Form
    const btnNewAdmin = document.getElementById('btnNewAdmin');
    const userFormOverlay = document.getElementById('userFormOverlay');
    const btnCancelUser = document.getElementById('btnCancelUser');
    const userForm = document.getElementById('userForm');

    if (btnNewAdmin && userFormOverlay) {
      btnNewAdmin.addEventListener('click', () => {
        userFormOverlay.classList.remove('hidden');
      });
    }
    if (btnCancelUser && userFormOverlay) {
      btnCancelUser.addEventListener('click', () => {
        userFormOverlay.classList.add('hidden');
        if (userForm) userForm.reset();
      });
    }
    if (userForm) {
      userForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email       = document.getElementById('userFormEmail')?.value.trim();
        const password    = document.getElementById('userFormPassword')?.value;
        const displayName = document.getElementById('userFormDisplayName')?.value.trim();
        if (!email || !password) return;
        try {
          const res = await this.app.api.createAdmin({ email, password, displayName });
          if (res && (res.id || !res.error)) {
            this.app.showToast('Admin erstellt', 'success');
            userForm.reset();
            userFormOverlay.classList.add('hidden');
            await this.refreshUsers();
          } else {
            this.app.showToast('Fehler: ' + (res?.error || res?.message || 'Unbekannter Fehler'), 'error');
          }
        } catch (err) {
          this.app.showToast('Fehler: ' + err.message, 'error');
        }
      });
    }

    // Toggle Change Own Password Form
    const btnChangeOwnPassword = document.getElementById('btnChangeOwnPassword');
    const changePasswordOverlay = document.getElementById('changePasswordOverlay');
    const btnCancelChangePassword = document.getElementById('btnCancelChangePassword');
    const changePasswordForm = document.getElementById('changePasswordForm');

    if (btnChangeOwnPassword && changePasswordOverlay) {
      btnChangeOwnPassword.addEventListener('click', () => {
        changePasswordOverlay.classList.remove('hidden');
      });
    }
    if (btnCancelChangePassword && changePasswordOverlay) {
      btnCancelChangePassword.addEventListener('click', () => {
        changePasswordOverlay.classList.add('hidden');
        if (changePasswordForm) changePasswordForm.reset();
      });
    }
    if (changePasswordForm) {
      changePasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldPassword = document.getElementById('changePasswordOld')?.value;
        const newPassword = document.getElementById('changePasswordNew')?.value;
        const confirmPassword = document.getElementById('changePasswordConfirm')?.value;

        if (!oldPassword || !newPassword || !confirmPassword) return;

        if (newPassword !== confirmPassword) {
          this.app.showToast('Die neuen Passwörter stimmen nicht überein.', 'error');
          return;
        }

        if (newPassword.length < 6) {
          this.app.showToast('Das neue Passwort muss mindestens 6 Zeichen lang sein.', 'error');
          return;
        }

        try {
          const res = await this.app.api.changePassword(oldPassword, newPassword);
          if (res && res.success !== false) {
            this.app.showToast('Passwort erfolgreich geändert', 'success');
            changePasswordForm.reset();
            changePasswordOverlay.classList.add('hidden');
          } else {
            this.app.showToast('Fehler: ' + (res?.message || res?.error || 'Ungültiges Passwort'), 'error');
          }
        } catch (err) {
          this.app.showToast('Fehler: ' + err.message, 'error');
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
