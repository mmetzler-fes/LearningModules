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

    this._bindSettings();
    this.checkBackupAlert(true);



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
          ${u.active === false ? '<span class="topic-status inactive" title="Kann sich nicht anmelden; Inhalte stehen kostenlos im Shop">⏸ deaktiviert</span>' : ''}
          ${u.isCreator ? '<span class="topic-shared-badge" title="Hat Module verfasst – wird beim Löschen nur deaktiviert">✍️ Creator</span>' : ''}
          <span class="topic-shared-badge" title="Punktekonto">🪙 ${u.points ?? 0}</span>
          ${u.pendingMergeFrom ? '<span class="hint">✉️ wartet auf Bestätigung eines E-Mail-Wechsels</span>' : ''}
          ${u.mustChangePassword && !u.pendingMergeFrom ? '<span class="hint">🔑 hat sein Passwort noch nicht geändert</span>' : ''}
        </div>
        <div class="admin-list-item-actions">
          <select class="user-role-select" title="Rolle ändern">
            <option value="teacher" ${u.role !== 'admin' ? 'selected' : ''}>Lehrer</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin + Lehrer</option>
          </select>
          <button class="btn btn-secondary btn-sm btn-reset-password"
            title="Neues Initialpasswort erzeugen und anzeigen">🔑 Neues Passwort</button>
          ${u.active === false
            ? '<button class="btn btn-primary btn-sm btn-reactivate-user" title="Konto wieder freischalten">▶ Reaktivieren</button>'
            : `<button class="btn btn-danger btn-sm btn-delete-user" title="${u.isCreator ? 'Deaktivieren (Creator werden nicht gelöscht)' : 'Benutzer löschen'}">🗑</button>`}
        </div>`;
      item.querySelector('.user-role-select').addEventListener('change', (e) => this._changeRole(u, e.target));
      item.querySelector('.btn-reset-password').addEventListener('click', () => this._resetPassword(u.id));
      item.querySelector('.btn-delete-user')?.addEventListener('click', () => this._deleteUser(u.id));
      item.querySelector('.btn-reactivate-user')?.addEventListener('click', () => this._reactivateUser(u));
      container.appendChild(item);
    }
  }

  /**
   * Entfernen. Creator werden nur deaktiviert, ihre Inhalte gehen für 0 Punkte
   * in den Shop; alle anderen werden gelöscht. Das gehört vor die
   * Entscheidung, nicht in eine Meldung danach.
   */
  async _deleteUser(userId) {
    const user = this._usersCache.find((u) => u.id === userId);
    if (!user) return;
    const name = user.displayName || user.email || user.username;
    const text = user.isCreator
      ? `"${name}" hat Module verfasst und wird deshalb nur deaktiviert.\n\n` +
        'Das Konto kann sich nicht mehr anmelden, seine Links sind gesperrt. Seine Inhalte stehen allen ' +
        'kostenlos zum Kopieren und Verwenden im Shop. Über „Reaktivieren" lässt sich das rückgängig machen.'
      : `"${name}" wirklich löschen?\n\n` +
        'Das Konto hat keine eigenen Module. Erworbene Kopien und Nutzungsrechte verfallen; ' +
        'Themen-Links, Ergebnisse, Tags und Dateien werden dir als Admin überschrieben.';
    if (!(await this.app.appConfirm(text))) return;
    const res = await this.app.api.deleteUser(userId);
    if (res && res.success !== false) {
      await this.refreshUsers();
      if (res.deactivated) {
        this.app.showToast(`"${name}" deaktiviert – ${res.offeredTopics || 0} Themen stehen kostenlos im Shop.`, 'success');
        return;
      }
      const m = res.moved || {};
      const parts = [
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
    } else this.app.showToast('Fehler: ' + (res?.message || res?.error || '?'), 'error');
  }

  async _reactivateUser(user) {
    const name = user.displayName || user.email;
    if (!(await this.app.appConfirm(`"${name}" wieder freischalten?\n\nSeine Shop-Angebote kehren zum Stand vor der Deaktivierung zurück. Wer in der Zwischenzeit kostenlos etwas erworben hat, behält es.`))) return;
    const res = await this.app.api.reactivateUser(user.id);
    if (res && res.success) {
      this.app.showToast(`"${name}" ist wieder aktiv.`, 'success');
      await this.refreshUsers();
    } else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
  }

  // ==================== SHOP & SICHERHEIT ====================

  async refreshSettings() {
    try {
      const [pts, key] = await Promise.all([this.app.api.getPointsSettings(), this.app.api.getMasterKeyStatus()]);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
      set('ptsStart', pts.startPoints);
      set('ptsDecay', pts.yearlyDecayPercent);
      set('ptsBonus', pts.yearlyBonus);
      set('ptsShareMax', pts.buyerShareMax);
      const status = document.getElementById('masterKeyStatus');
      if (status) {
        status.innerHTML = key.fingerprint
          ? `Aktueller Masterkey: Fingerabdruck <code>${escapeHtml(key.fingerprint)}</code>, gesetzt am
             ${new Date(key.setAt).toLocaleString('de-DE')}${key.previousKeys ? ` · ${key.previousKeys} frühere gespeichert` : ''}.
             ${key.appSecretFromEnv ? '' : '<br>⚠️ APP_SECRET ist nicht gesetzt – die Masterkeys sind mit einer Datei auf dem Server geschützt. Für den Betrieb besser APP_SECRET setzen.'}`
          : 'Noch kein Masterkey gesetzt.';
      }
      await this._refreshCloudBackup();
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
    }
  }

  // ---- Automatisches Backup ----

  /**
   * Ist das letzte automatische Backup fehlgeschlagen, steht ein rotes "!"
   * am Menüpunkt – und beim Anmelden zusätzlich eine Meldung. Ohne
   * Mailversand ist das der einzige Weg, auf dem es der Admin erfährt.
   */
  async checkBackupAlert(onLogin = false) {
    try {
      const data = await this.app.api.getCloudBackup();
      const failed = data?.config?.enabled && data?.state?.lastStatus === 'error';
      document.getElementById('navBackupAlert')?.classList.toggle('hidden', !failed);
      if (failed && onLogin) {
        this.app.showToast(
          `⚠️ Das automatische Backup ist fehlgeschlagen: ${data.state.lastError} – Details unter „Shop & Sicherheit“.`,
          'error',
        );
      }
      return data;
    } catch (_) {
      return null;
    }
  }

  async _refreshCloudBackup() {
    const data = await this.checkBackupAlert();
    if (!data || !data.config) return;
    const c = data.config;
    const hour = document.getElementById('cbHour');
    if (hour && !hour.options.length) {
      for (let h = 0; h < 24; h++) hour.add(new Option(`${String(h).padStart(2, '0')}:00 Uhr`, String(h)));
    }
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
    set('cbUrl', c.url);
    set('cbUser', c.username);
    set('cbPassword', '');
    set('cbInterval', c.interval);
    set('cbWeekday', String(c.weekday));
    set('cbHour', String(c.hour));
    set('cbKeep', c.keep);
    document.getElementById('cbEnabled').checked = !!c.enabled;
    document.getElementById('cbPassword').placeholder = c.hasPassword ? 'gespeichert – leer lassen = unverändert' : 'App-Passwort eingeben';
    document.getElementById('cbWeekday').disabled = c.interval === 'daily';

    const st = data.state || {};
    const when = (iso) => (iso ? new Date(iso).toLocaleString('de-DE') : '–');
    const parts = [];
    if (!c.enabled) parts.push('Ausgeschaltet.');
    else parts.push(`Nächstes Backup: <strong>${when(data.nextRunAt)}</strong>.`);
    if (st.lastStatus === 'ok') parts.push(`Letztes erfolgreich: ${when(st.lastSuccessAt)} (${escapeHtml(st.lastFile || '')}).`);
    if (st.lastStatus === 'error') {
      parts.push(`<span class="login-error" style="display:inline">❌ Letzter Versuch ${when(st.lastAttemptAt)} fehlgeschlagen:
        ${escapeHtml(st.lastError || '')}</span> Es wird stündlich erneut versucht.`);
      if (st.lastSuccessAt) parts.push(`Letztes erfolgreiches Backup: ${when(st.lastSuccessAt)}.`);
    }
    parts.push(`<span style="opacity:.7">Serverzeit: ${escapeHtml(data.serverTime || '')}</span>`);
    document.getElementById('cloudBackupStatus').innerHTML = parts.join(' ');
  }

  _cloudBackupForm() {
    const v = (id) => document.getElementById(id)?.value;
    return {
      url: v('cbUrl'),
      username: v('cbUser'),
      password: v('cbPassword') || undefined,
      interval: v('cbInterval'),
      weekday: Number(v('cbWeekday')),
      hour: Number(v('cbHour')),
      keep: Number(v('cbKeep')),
      enabled: document.getElementById('cbEnabled').checked,
    };
  }

  async _listCloudBackups() {
    const box = document.getElementById('cloudBackupList');
    box.innerHTML = '<p class="hint">Wird geladen…</p>';
    const res = await this.app.api.listCloudBackups();
    if (!Array.isArray(res)) {
      box.innerHTML = `<p class="login-error">${escapeHtml(res?.message || 'Ordner nicht lesbar')}</p>`;
      return;
    }
    if (res.length === 0) {
      box.innerHTML = '<p class="hint">Im Ordner liegt noch kein Backup.</p>';
      return;
    }
    box.innerHTML = res.map((f) => `
      <div class="cloud-backup-row">
        <span>${escapeHtml(f.name)} ${f.size ? `<span class="import-module-type">${Math.round(f.size / 1024)} KB</span>` : ''}</span>
        <button class="btn btn-danger btn-sm" data-name="${escapeHtml(f.name)}">⬆️ Einspielen</button>
      </div>`).join('');
    box.querySelectorAll('button[data-name]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await this.app.appConfirm(
          `Backup „${btn.dataset.name}“ aus der Cloud einspielen?\n\nAlle aktuellen Daten werden durch diesen Stand ersetzt. ` +
          'Der bisherige Stand bleibt auf dem Server als Datei *.before-restore liegen.',
        );
        if (!ok) return;
        btn.disabled = true;
        const r = await this.app.api.restoreCloudBackup(btn.dataset.name);
        if (r && r.success) {
          this.app.showToast('Backup eingespielt. Bitte neu anmelden.', 'success');
          setTimeout(() => this.app.loginView.showLoginScreen(), 1500);
        } else {
          this.app.showToast('Fehler: ' + (r?.message || '?'), 'error');
          btn.disabled = false;
        }
      });
    });
  }

  _bindCloudBackup() {
    document.getElementById('cbInterval')?.addEventListener('change', (e) => {
      document.getElementById('cbWeekday').disabled = e.target.value === 'daily';
    });
    const busy = async (btn, fn) => {
      btn.disabled = true;
      try { await fn(); } finally { btn.disabled = false; }
    };
    document.getElementById('btnCbSave')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const res = await this.app.api.saveCloudBackup(this._cloudBackupForm());
      if (res && res.config) {
        this.app.showToast(res.config.enabled ? 'Gespeichert – das erste Backup folgt in Kürze.' : 'Gespeichert', 'success');
        await this._refreshCloudBackup();
      } else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
    }));
    document.getElementById('btnCbTest')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      // Erst speichern, damit ein frisch eingetipptes Passwort mitgeprüft wird.
      const saved = await this.app.api.saveCloudBackup({ ...this._cloudBackupForm(), enabled: undefined });
      if (!saved || !saved.config) { this.app.showToast('Fehler: ' + (saved?.message || '?'), 'error'); return; }
      const res = await this.app.api.testCloudBackup();
      this.app.showToast(res && res.success ? res.message : 'Fehler: ' + (res?.message || '?'), res && res.success ? 'success' : 'error');
      await this._refreshCloudBackup();
    }));
    document.getElementById('btnCbRun')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      this.app.showToast('Backup wird erstellt und hochgeladen…', 'info');
      const res = await this.app.api.runCloudBackup();
      if (res && res.success) {
        this.app.showToast(`Gesichert: ${res.file}${res.removed?.length ? ` · ${res.removed.length} alte gelöscht` : ''}`, 'success');
      } else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
      await this._refreshCloudBackup();
    }));
    document.getElementById('btnCbList')?.addEventListener('click', () => this._listCloudBackups());
  }

  _bindSettings() {
    this._bindCloudBackup();
    document.getElementById('btnSavePoints')?.addEventListener('click', async () => {
      const num = (id) => Number(document.getElementById(id)?.value);
      const res = await this.app.api.savePointsSettings({
        startPoints: num('ptsStart'),
        yearlyDecayPercent: num('ptsDecay'),
        yearlyBonus: num('ptsBonus'),
        buyerShareMax: num('ptsShareMax'),
      });
      if (res && typeof res.startPoints === 'number') this.app.showToast('Punkteregeln gespeichert', 'success');
      else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
    });

    document.getElementById('btnSetMasterKey')?.addEventListener('click', async () => {
      const a = document.getElementById('masterKeyNew');
      const b = document.getElementById('masterKeyRepeat');
      if (!a.value || a.value !== b.value) {
        this.app.showToast('Die beiden Eingaben stimmen nicht überein.', 'error');
        return;
      }
      const ok = await this.app.appConfirm(
        'Neuen Masterkey setzen?\n\nAb jetzt wird damit verschlüsselt. Ältere Dateien bleiben lesbar. ' +
        'Die App zeigt den Schlüssel nie wieder an – bitte jetzt sicher notieren.',
      );
      if (!ok) return;
      const res = await this.app.api.setMasterKey(a.value);
      a.value = '';
      b.value = '';
      if (res && res.fingerprint) {
        this.app.showToast('Masterkey gesetzt', 'success');
        this.refreshSettings();
      } else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
    });

    document.getElementById('btnBackup')?.addEventListener('click', async () => {
      const res = await this.app.api.downloadBackup();
      if (res && res.success) this.app.showToast('Backup heruntergeladen (verschlüsselt)', 'success');
      else this.app.showToast('Fehler: ' + (res?.error || '?'), 'error');
    });

    document.getElementById('btnRestore')?.addEventListener('click', async () => {
      const ok = await this.app.appConfirm(
        'Backup einspielen?\n\nAlle aktuellen Daten – Konten, Themen, Links, Ergebnisse, Dokumente – werden durch ' +
        'den Stand des Backups ersetzt. Der bisherige Stand bleibt auf dem Server als Datei *.before-restore liegen.',
      );
      if (!ok) return;
      const res = await this.app.api.restoreBackup();
      if (!res) return;
      if (res.success) {
        this.app.showToast(`Backup vom ${new Date(res.createdAt).toLocaleString('de-DE')} eingespielt. Bitte neu anmelden.`, 'success');
        setTimeout(() => this.app.loginView.showLoginScreen(), 1500);
      } else this.app.showToast('Fehler: ' + (res.message || '?'), 'error');
    });
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
