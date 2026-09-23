import { escapeHtml } from '../utils.js';
import { downloadBlob } from '../api.js';

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
        if (view === 'admin-groups') this.refreshGroups();
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

    document.getElementById('btnNewGroup')?.addEventListener('click', () => this._openGroupEditor(null));

    document.getElementById('btnExportUsers')?.addEventListener('click', async () => {
      try {
        await this.app.api.exportUsersOds();
        this.app.showToast('Tabelle heruntergeladen – sie enthält keine Passwörter.', 'success');
      } catch (err) {
        this.app.showToast('Fehler: ' + err.message, 'error');
      }
    });

    document.getElementById('btnImportUsers')?.addEventListener('click', () => this._importUsers());



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

  // ==================== TABELLE EIN- UND AUSLESEN ====================

  async _importUsers() {
    const res = await this.app.api.importUsersOds();
    if (!res) return; // abgebrochen
    if (!res.created && !res.skipped) {
      this.app.showToast('Fehler: ' + (res.message || 'Import fehlgeschlagen'), 'error');
      return;
    }
    await this.refreshUsers();
    this._showImportReport(res);
  }

  /**
   * Der Bericht ist wichtiger als ein Toast: Beim Stapel-Import will man
   * sehen, was angelegt wurde, was übersprungen wurde und warum – und die
   * Zugangsdaten gibt es nur dieses eine Mal.
   */
  _showImportReport(res) {
    const created = res.created || [];
    const updated = res.groupsUpdated || [];
    const skipped = res.skipped || [];

    const section = (title, items, render) =>
      items.length
        ? `<div class="settings-group" style="margin-top:14px">
             <h3>${title} (${items.length})</h3>
             <div class="share-user-list">${items.map(render).join('')}</div>
           </div>`
        : '';

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card" style="min-width:480px; max-width:720px; max-height:82vh; overflow:auto">
        <h3>📊 Tabelle eingelesen</h3>
        <p class="hint">
          ${created.length} Konto${created.length === 1 ? '' : 'en'} angelegt ·
          ${updated.length} Gruppenzuordnung${updated.length === 1 ? '' : 'en'} geändert ·
          ${skipped.length} Zeile${skipped.length === 1 ? '' : 'n'} übersprungen
        </p>
        ${res.groupColumns?.length
          ? `<p class="hint">Berücksichtigte Gruppenspalten: ${res.groupColumns.map(escapeHtml).join(', ')}.
             Gruppen ohne Spalte in der Datei blieben unverändert.</p>`
          : '<p class="hint">Die Datei enthielt keine bekannten Gruppenspalten – es wurden keine Mitgliedschaften geändert.</p>'}
        ${res.unknownColumns?.length
          ? `<p class="login-error">Unbekannte Spalten übergangen: ${res.unknownColumns.map(escapeHtml).join(', ')}.
             Heißt die Gruppe wirklich so?</p>`
          : ''}

        ${res.credentialsFile
          ? `<div class="settings-group" style="margin-top:14px">
               <h3>🔑 Zugangsdaten</h3>
               <p class="hint">Für ${res.credentialsCount} neues Konto${res.credentialsCount === 1 ? '' : 'en'} wurde ein
                 Initialpasswort erzeugt. <strong>Diese Datei gibt es nur jetzt</strong> – danach steht im Server nur
                 noch der Hash. Herunterladen, verteilen, löschen.</p>
               <button class="btn btn-primary" id="btnDownloadCreds">⬇️ Zugangsdaten (.ods)</button>
             </div>`
          : ''}

        ${section('Angelegt', created, (c) =>
          `<div class="share-user-row"><span class="share-user-name">${escapeHtml(c.displayName)} · ${escapeHtml(c.email)} · ${escapeHtml(c.role === 'admin' ? 'Admin' : 'Lehrer')}</span></div>`)}
        ${section('Gruppen geändert', updated, (u) =>
          `<div class="share-user-row"><span class="share-user-name">${escapeHtml(u.email)}
             ${u.added.length ? '<span class="topic-shared-badge use">+ ' + u.added.map(escapeHtml).join(', ') + '</span>' : ''}
             ${u.removed.length ? '<span class="topic-status inactive">− ' + u.removed.map(escapeHtml).join(', ') + '</span>' : ''}
           </span></div>`)}
        ${section('Übersprungen', skipped, (s) =>
          `<div class="share-user-row"><span class="share-user-name">Zeile ${s.row}: ${escapeHtml(s.email || '(ohne E-Mail)')} – ${escapeHtml(s.reason)}</span></div>`)}

        <div class="confirm-actions">
          <button class="btn btn-secondary" id="btnCloseImportReport">Schließen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#btnDownloadCreds')?.addEventListener('click', () => {
      // Aus base64 zurück in eine Datei – der Server hat sie einmalig
      // mitgeschickt, gespeichert wird sie nirgends.
      const raw = atob(res.credentialsFile);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      downloadBlob(
        new Blob([bytes], { type: 'application/vnd.oasis.opendocument.spreadsheet' }),
        `zugangsdaten-${new Date().toISOString().slice(0, 10)}.ods`,
      );
      this.app.showToast('Zugangsdaten heruntergeladen – bitte nach dem Verteilen löschen.', 'info');
    });

    const close = () => overlay.remove();
    overlay.querySelector('#btnCloseImportReport').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  // ==================== GRUPPEN (FACHSCHAFTEN) ====================

  async refreshGroups() {
    const box = document.getElementById('adminGroupsContainer');
    if (!box) return;

    let groups = [];
    let users = [];
    try {
      [groups, users] = await Promise.all([this.app.api.getGroups(), this.app.api.getAllUsers()]);
    } catch (_) { groups = []; users = []; }
    this._groupUsers = Array.isArray(users) ? users.filter((u) => u.role === 'teacher' || u.role === 'admin') : [];

    box.innerHTML = '';
    if (!Array.isArray(groups) || groups.length === 0) {
      box.innerHTML = '<div class="empty-state"><span class="empty-icon">🏫</span>' +
        '<p>Noch keine Gruppen. Eine Fachschaft anzulegen lohnt sich ab etwa drei Personen, ' +
        'die regelmäßig dieselben Themen brauchen.</p></div>';
      return;
    }

    for (const g of groups) {
      const members = (g.memberIds || [])
        .map((id) => this._groupUsers.find((u) => u.id === id))
        .filter(Boolean);

      const card = document.createElement('div');
      card.className = 'topic-card';
      card.innerHTML = `
        <div class="topic-card-header">
          <div class="topic-card-info">
            <h3 class="topic-card-title">🏫 ${escapeHtml(g.name)}</h3>
            <p class="topic-card-desc">${escapeHtml(g.description || '')}</p>
            <div class="topic-card-meta">
              <span class="topic-module-count">${members.length} Mitglied${members.length === 1 ? '' : 'er'}</span>
            </div>
            <div class="topic-card-tags">${members
              .map((m) => `<span class="tag-chip">${escapeHtml(m.displayName || m.email)}</span>`)
              .join('')}</div>
          </div>
          <div class="topic-card-actions">
            <button class="btn btn-secondary btn-sm btn-edit-group" title="Bearbeiten">✏️</button>
            <button class="btn btn-danger btn-sm btn-delete-group" title="Löschen">🗑</button>
          </div>
        </div>`;

      card.querySelector('.btn-edit-group').addEventListener('click', () => this._openGroupEditor(g));
      card.querySelector('.btn-delete-group').addEventListener('click', () => this._deleteGroup(g));
      box.appendChild(card);
    }
  }

  async _deleteGroup(group) {
    const ok = await this.app.appConfirm(
      `Gruppe "${group.name}" löschen?\n\n` +
      'Die Freigaben, die auf diese Gruppe zeigen, werden dabei mit entfernt. ' +
      'Themen und Konten bleiben unberührt – nur der Verteiler verschwindet.',
    );
    if (!ok) return;
    try {
      const res = await this.app.api.deleteGroup(group.id);
      if (res && res.success) {
        this.app.showToast(
          res.sharingEntriesRemoved
            ? `Gruppe gelöscht – ${res.sharingEntriesRemoved} Freigabe${res.sharingEntriesRemoved === 1 ? '' : 'n'} bereinigt.`
            : 'Gruppe gelöscht.',
          'info',
        );
        this.refreshGroups();
      } else this.app.showToast('Fehler: ' + (res?.message || 'Löschen fehlgeschlagen'), 'error');
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
    }
  }

  /** Anlegen und Bearbeiten teilen sich den Dialog; `group` null heißt neu. */
  _openGroupEditor(group) {
    const users = this._groupUsers || [];
    const chosen = new Set(group ? group.memberIds || [] : []);

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card" style="min-width:420px; max-width:560px; max-height:82vh; overflow:auto">
        <h3>${group ? '✏️ Gruppe bearbeiten' : '➕ Neue Gruppe'}</h3>
        <div class="form-group">
          <label>Name</label>
          <input type="text" id="groupName" placeholder="z. B. Fachschaft Informatik"
            value="${group ? escapeHtml(group.name) : ''}" />
        </div>
        <div class="form-group">
          <label>Beschreibung (optional)</label>
          <input type="text" id="groupDesc" value="${group ? escapeHtml(group.description || '') : ''}" />
        </div>
        <div class="form-group">
          <label>Mitglieder</label>
          <div class="share-user-list" id="groupMembers">
            ${users.length === 0
              ? '<p class="hint">Keine Lehrkräfte vorhanden.</p>'
              : users.map((u) => `
                <div class="share-user-row">
                  <span class="share-user-name">${escapeHtml(u.displayName || u.email)}</span>
                  <label class="share-flag">
                    <input type="checkbox" data-user="${escapeHtml(u.id)}" ${chosen.has(u.id) ? 'checked' : ''} />
                    <span>Mitglied</span>
                  </label>
                </div>`).join('')}
          </div>
        </div>
        <div class="confirm-actions">
          <button class="btn btn-primary" id="btnSaveGroup">Speichern</button>
          <button class="btn btn-secondary" id="btnCancelGroup">Abbrechen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#btnCancelGroup').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#btnSaveGroup').addEventListener('click', async () => {
      const name = overlay.querySelector('#groupName').value.trim();
      if (!name) { this.app.showToast('Die Gruppe braucht einen Namen.', 'error'); return; }
      const memberIds = [...overlay.querySelectorAll('#groupMembers input:checked')].map((cb) => cb.dataset.user);
      const body = { name, description: overlay.querySelector('#groupDesc').value.trim(), memberIds };

      try {
        const res = group
          ? await this.app.api.updateGroup(group.id, body)
          : await this.app.api.createGroup(body);
        if (res && res.id) {
          close();
          this.app.showToast(group ? 'Gruppe gespeichert' : 'Gruppe angelegt', 'success');
          this.refreshGroups();
        } else {
          this.app.showToast('Fehler: ' + (res?.message || 'Speichern fehlgeschlagen'), 'error');
        }
      } catch (err) {
        this.app.showToast('Fehler: ' + err.message, 'error');
      }
    });
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
