import { escapeHtml } from '../utils.js';

// ==================== ADMIN VIEW ====================

export class AdminView {
  constructor(app) {
    this.app = app;
    this._usersCache = [];

    this._teacherWhitelist = document.getElementById('teacherWhitelist');
    this._teacherBlacklist = document.getElementById('teacherBlacklist');
    this._adminWhitelist   = document.getElementById('adminWhitelist');
    this._adminBlacklist   = document.getElementById('adminBlacklist');
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
        const displayName = document.getElementById('userFormDisplayName')?.value.trim();
        const role        = document.getElementById('userFormRole')?.value || 'teacher';
        if (!email) return;
        try {
          const res = await this.app.api.createUser({ email, role, displayName });
          if (res && res.id) {
            userForm.reset();
            userFormOverlay.classList.add('hidden');
            await this.refreshUsers(res.id);
            this._showCredentials(res, 'Benutzer angelegt');
          } else {
            // message trägt den Grund ("... nicht in der Whitelist"), error nur
            // das generische "Forbidden" – deshalb message zuerst.
            this.app.showToast('Fehler: ' + (res?.message || res?.error || 'Unbekannter Fehler'), 'error');
          }
        } catch (err) {
          this.app.showToast('Fehler: ' + err.message, 'error');
        }
      });
    }

    this._bindCredentialsDialog();



    // Whitelist/blacklist save
    if (this._btnSaveWBL) {
      this._btnSaveWBL.addEventListener('click', async () => {
        const data = {
          teacher_whitelist: (this._teacherWhitelist?.value || '').split('\n').map((s) => s.trim()).filter(Boolean),
          teacher_blacklist: (this._teacherBlacklist?.value || '').split('\n').map((s) => s.trim()).filter(Boolean),
          admin_whitelist:   (this._adminWhitelist?.value   || '').split('\n').map((s) => s.trim()).filter(Boolean),
          admin_blacklist:   (this._adminBlacklist?.value   || '').split('\n').map((s) => s.trim()).filter(Boolean),
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

  // ---- Anzeige der erzeugten Zugangsdaten ----

  _bindCredentialsDialog() {
    const overlay = document.getElementById('credentialsOverlay');
    if (!overlay || this._credentialsBound) return;
    this._credentialsBound = true;

    document.getElementById('btnCloseCredentials')?.addEventListener('click', async () => {
      overlay.classList.add('hidden');
      // Passwort nicht im DOM stehen lassen
      const pw = document.getElementById('credentialsPassword');
      if (pw) pw.textContent = '';
      this._lastCredentials = null;
      // Sicherheitshalber noch einmal laden: so ist die Liste auch dann aktuell,
      // wenn die erste Aktualisierung aus irgendeinem Grund nicht durchkam.
      await this.refreshUsers();
    });

    document.getElementById('btnCopyCredentials')?.addEventListener('click', async () => {
      const c = this._lastCredentials;
      if (!c) return;
      const text = c.initialPassword
        ? `Zugang LearningModules\nE-Mail: ${c.email}\nInitialpasswort: ${c.initialPassword}`
        : `Zugang LearningModules\nE-Mail: ${c.email}`;
      try {
        await navigator.clipboard.writeText(text);
        this.app.showToast('In die Zwischenablage kopiert', 'success');
      } catch (_) {
        this.app.showToast('Kopieren nicht möglich – bitte manuell notieren', 'error');
      }
    });

    document.getElementById('btnPrintCredentials')?.addEventListener('click', () => {
      document.body.classList.add('printing-credentials');
      const cleanup = () => {
        document.body.classList.remove('printing-credentials');
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
      // Fallback, falls afterprint nicht feuert
      setTimeout(cleanup, 2000);
    });
  }

  /**
   * Zeigt E-Mail und – falls keine Mail verschickt werden konnte – das
   * Initialpasswort genau einmal an.
   */
  _showCredentials(res, title) {
    this._bindCredentialsDialog();
    this._lastCredentials = res;

    const overlay = document.getElementById('credentialsOverlay');
    if (!overlay) {
      // Kein Dialog vorhanden: wenigstens als Toast ausgeben
      if (res.initialPassword) this.app.showToast(`Initialpasswort: ${res.initialPassword}`, 'info');
      return;
    }

    document.getElementById('credentialsTitle').textContent = `✅ ${title}`;
    document.getElementById('credentialsEmail').textContent = res.email || '';

    const pwGroup = document.getElementById('credentialsPasswordGroup');
    const pwField = document.getElementById('credentialsPassword');
    const mailInfo = document.getElementById('credentialsMailInfo');

    if (res.initialPassword) {
      pwGroup.classList.remove('hidden');
      pwField.textContent = res.initialPassword;
      mailInfo.textContent = res.mailInfo
        ? `Keine E-Mail verschickt: ${res.mailInfo}`
        : 'Es wurde keine E-Mail verschickt.';
    } else {
      pwGroup.classList.add('hidden');
      pwField.textContent = '';
      mailInfo.textContent = 'Das Passwort wurde per E-Mail an den Benutzer verschickt.';
    }

    overlay.classList.remove('hidden');
  }

  /** Rolle umstellen. Der Server lehnt ab, wenn der letzte Admin wegfiele. */
  async _changeRole(user, selectEl) {
    const newRole = selectEl.value;
    const previous = user.role;
    if (newRole === previous) return;

    const label = newRole === 'admin' ? 'Admin + Lehrer' : 'Lehrer';
    const confirmed = await this.app.appConfirm(
      `Rolle von "${user.displayName || user.email}" auf "${label}" ändern?`,
    );
    if (!confirmed) { selectEl.value = previous; return; }

    try {
      const res = await this.app.api.setUserRole(user.id, newRole);
      if (res && res.success) {
        this.app.showToast('Rolle geändert', 'success');
        await this.refreshUsers();
      } else {
        selectEl.value = previous;
        this.app.showToast('Fehler: ' + (res?.message || res?.error || 'Unbekannter Fehler'), 'error');
      }
    } catch (err) {
      selectEl.value = previous;
      this.app.showToast('Fehler: ' + err.message, 'error');
    }
  }

  async _resetPassword(userId) {
    const user = this._usersCache.find((u) => u.id === userId);
    if (!user) return;
    const confirmed = await this.app.appConfirm(
      `Neues Initialpasswort für "${user.displayName || user.email}" erzeugen?\n\n` +
      'Es wird anschließend einmalig angezeigt. Das bisherige Passwort wird ungültig.',
    );
    if (!confirmed) return;
    try {
      const res = await this.app.api.resetUserPassword(userId);
      if (res && res.id) {
        await this.refreshUsers();
        this._showCredentials(res, 'Passwort zurückgesetzt');
      } else {
        this.app.showToast('Fehler: ' + (res?.message || res?.error || '?'), 'error');
      }
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
    }
  }

  async refreshUsers(highlightId) {
    try {
      this._usersCache = await this.app.api.getAllUsers();
      this._renderUsersList();
      if (highlightId) {
        const row = document.querySelector(`.admin-list-item[data-id="${highlightId}"]`);
        row?.classList.add('admin-list-item-new');
        row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } catch (e) {
      const el = document.getElementById('usersList');
      if (el) el.innerHTML = `<p class="hint">Fehler: ${escapeHtml(e.message)}</p>`;
    }
  }

  _renderUsersList() {
    const container = document.getElementById('usersList');
    if (!container) return;
    // Ein Admin hat sämtliche Lehrerfunktionen zusätzlich – das wird auch so
    // angezeigt, damit die Auswahl nicht wie ein Entweder-oder wirkt.
    const roleBadge = (role) =>
      role === 'admin'
        ? '<span class="user-role-badge admin">Admin</span><span class="user-role-badge teacher">Lehrer</span>'
        : '<span class="user-role-badge teacher">Lehrer</span>';

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
          ${u.mustChangePassword ? '<span class="hint">🔑 hat sein Passwort noch nicht geändert</span>' : ''}
        </div>
        <div class="admin-list-item-actions">
          <select class="user-role-select" title="Rolle ändern">
            <option value="teacher" ${u.role !== 'admin' ? 'selected' : ''}>Lehrer</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin + Lehrer</option>
          </select>
          <button class="btn btn-secondary btn-sm btn-reset-password"
            title="Neues Initialpasswort erzeugen und anzeigen">🔑 Neues Passwort</button>
          <button class="btn btn-danger btn-sm btn-delete-user" title="Benutzer löschen">🗑</button>
        </div>`;
      item.querySelector('.user-role-select').addEventListener('change', (e) => this._changeRole(u, e.target));
      item.querySelector('.btn-reset-password').addEventListener('click', () => this._resetPassword(u.id));
      item.querySelector('.btn-delete-user').addEventListener('click', () => this._deleteUser(u.id));
      container.appendChild(item);
    }
  }

  async _deleteUser(userId) {
    const user = this._usersCache.find((u) => u.id === userId);
    if (!user) return;
    const name = user.displayName || user.email || user.username;
    // Die Übergabe ist der überraschende Teil – sie gehört vor die
    // Entscheidung, nicht in eine Meldung danach.
    const confirmed = await this.app.appConfirm(
      `Benutzer "${name}" wirklich löschen?\n\n` +
      'Themen, Links, Tags, Dateien und Ergebnisse gehen dabei nicht verloren: ' +
      'Sie werden dir als Admin überschrieben. Laufende Links von Kolleginnen, ' +
      'die Inhalte dieser Lehrkraft verwenden, bleiben damit gültig. ' +
      'Aufräumen kannst du danach in Ruhe.',
    );
    if (!confirmed) return;
    const res = await this.app.api.deleteUser(userId);
    if (res && res.success !== false) {
      await this.refreshUsers();
      const m = res.moved || {};
      const parts = [
        m.topics ? `${m.topics} Themen` : null,
        m.links ? `${m.links} Links` : null,
        m.quickLinks ? `${m.quickLinks} Quick-Links` : null,
        m.results ? `${m.results} Ergebnisse` : null,
        m.tags ? `${m.tags} Tags` : null,
        m.uploads ? `${m.uploads} Dateien` : null,
      ].filter(Boolean);
      this.app.showToast(
        parts.length
          ? `Benutzer gelöscht – ${parts.join(', ')} übernommen von ${res.handedOverTo}.`
          : 'Benutzer gelöscht – es gab nichts zu übernehmen.',
        'success',
      );
    } else this.app.showToast('Fehler: ' + (res?.error || '?'), 'error');
  }

  async refreshWhitelistBlacklist() {
    try {
      const data = await this.app.api.getAdminWhitelistBlacklist();
      if (this._teacherWhitelist) this._teacherWhitelist.value = (data.teacher_whitelist || []).join('\n');
      if (this._teacherBlacklist) this._teacherBlacklist.value = (data.teacher_blacklist || []).join('\n');
      if (this._adminWhitelist)   this._adminWhitelist.value   = (data.admin_whitelist   || []).join('\n');
      if (this._adminBlacklist)   this._adminBlacklist.value   = (data.admin_blacklist   || []).join('\n');
    } catch (_) {}
  }

  async refreshAdminTopics() {
    const container = document.getElementById('adminTopicsContainer');
    if (!container) return;
    try {
      const topics = await this.app.api.getAllAdminTopics();
      if (!topics || topics.length === 0) {
        container.innerHTML = '<p class="hint">Keine Lernthemen gefunden.</p>';
        return;
      }
      container.innerHTML = '';
      for (const topic of topics) {
        const moduleCount = (topic.modules || []).length;
        const item = document.createElement('div');
        item.className = `topic-card ${topic.selected ? 'topic-active' : 'topic-inactive'}`;
        item.innerHTML = `
          <div class="topic-card-header">
            <div class="topic-card-info">
              <h3 class="topic-card-title">${escapeHtml(topic.title)}</h3>
              <p class="topic-card-desc" style="color:var(--text-secondary);font-size:0.85em">${escapeHtml(topic.ownerEmail || topic.ownerId)}</p>
              <div class="topic-card-meta">
                <span class="topic-module-count">${moduleCount} Module</span>
                <span class="topic-status ${topic.selected ? 'active' : 'inactive'}" style="margin-left:8px">${topic.selected ? '✅ Aktiv' : '❌ Inaktiv'}</span>
                ${topic.subscribeKey ? `<span class="hint" style="margin-left:8px">🔑 Key: ${escapeHtml(topic.subscribeKey)}</span>` : ''}
              </div>
            </div>
          </div>`;
        container.appendChild(item);
      }
    } catch (e) {
      container.innerHTML = `<p class="hint">Fehler: ${escapeHtml(e.message)}</p>`;
    }
  }
}
