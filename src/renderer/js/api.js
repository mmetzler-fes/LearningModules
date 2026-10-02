// ==================== AUTH STORE ====================

const TOKEN_KEY = 'lm_token';
function readStorage(store) {
  try { return store.getItem(TOKEN_KEY); } catch (_) { return null; }
}
function writeStorage(store, value) {
  try {
    if (value) store.setItem(TOKEN_KEY, value); else store.removeItem(TOKEN_KEY);
  } catch (_) { /* Speicher gesperrt: Token bleibt nur im Speicher der Seite */ }
}

/**
 * Anmelde-Token im Browser. Ohne "Angemeldet bleiben" im sessionStorage –
 * es übersteht einen Reload, aber nicht das Schließen des Browsers. Mit
 * Häkchen im localStorage, bis es abläuft oder man sich abmeldet.
 */
export class AuthStore {
  constructor() {
    this._token = null;
    this._persist = !!readStorage(localStorage);
  }

  getToken() {
    return this._token || readStorage(sessionStorage) || readStorage(localStorage);
  }

  /** persist: true = localStorage, false = sessionStorage; weggelassen = wie bisher. */
  setToken(t, persist = this._persist) {
    this._token = t;
    this._persist = !!persist;
    writeStorage(localStorage, t && persist ? t : null);
    writeStorage(sessionStorage, t && !persist ? t : null);
  }

  getHeaders() {
    const t = this.getToken();
    return t
      ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` }
      : { 'Content-Type': 'application/json' };
  }

  authFetch(url, opts = {}) {
    return fetch(url, {
      ...opts,
      // Ohne no-store beantwortet der Browser ein erneutes GET aus dem Cache –
      // frisch angelegte Benutzer oder Themen tauchen dann nicht auf.
      cache: 'no-store',
      headers: { ...(opts.headers || {}), ...this.getHeaders() },
    }).then((r) => {
      if (r.status === 401) this.setToken(null);
      return r.json();
    });
  }
}

// ==================== BROWSER API ====================

export class BrowserApi {
  constructor(authStore) {
    this._auth = authStore;
  }

  _fetch(url, opts) {
    return this._auth.authFetch(url, opts);
  }

  // ---------- Auth ----------
  login(email, password, remember = false) {
    return fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, remember }),
    }).then((r) => r.json());
  }

  /** Zweiter Anmeldeschritt bei aktiver 2FA – noch ohne Sitzung. */
  loginTwoFactor(challenge, code) {
    return fetch('/api/auth/login/2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge, code }),
    }).then((r) => r.json());
  }

  // ---------- 2FA des eigenen Kontos ----------
  getTwoFactor() { return this._fetch('/api/auth/2fa'); }
  setupTwoFactor() { return this._fetch('/api/auth/2fa/setup', { method: 'POST' }); }
  enableTwoFactor(code) {
    return this._fetch('/api/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) });
  }
  regenerateRecoveryCodes(code) {
    return this._fetch('/api/auth/2fa/recovery-codes', { method: 'POST', body: JSON.stringify({ code }) });
  }
  disableTwoFactor(password, code) {
    return this._fetch('/api/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password, code }) });
  }
  /** Hauptadmin: 2FA eines Kontos zurücksetzen. */
  adminResetTwoFactor(userId) {
    return this._fetch(`/api/admin/users/${encodeURIComponent(userId)}/reset-2fa`, { method: 'POST' });
  }

  /** Konto zum gespeicherten Token – für die Wiederaufnahme nach einem Reload. */
  me() {
    return this._fetch('/api/auth/me');
  }

  register(email, password, displayName) {
    return fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName }),
    }).then((r) => r.json());
  }

  forgotPassword(email) {
    return fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).then((r) => r.json());
  }

  changePassword(oldPassword, newPassword) {
    return this._fetch('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  }

  deleteAccount() {
    return this._fetch('/api/auth/account', { method: 'DELETE' });
  }

  // ---------- Public (student) API ----------

  getAllAdminTopics() { return this._fetch('/api/admin/topics'); }

  // ---------- Quick-Link ----------
  createQuickLink(topicId, regenerate = false) {
    return this._fetch(`/api/topics/${topicId}/quick-link`, {
      method: 'POST',
      body: JSON.stringify({ regenerate }),
    });
  }
  revokeQuickLink(topicId) {
    return this._fetch(`/api/topics/${topicId}/quick-link`, { method: 'DELETE' });
  }
  /** Öffentlicher Einstieg über den Quick-Link – ohne Anmeldung. */
  getQuickTopic(token) {
    return fetch(`/api/public/quick/${encodeURIComponent(token)}`).then((r) => r.json());
  }

  /** Vorschau eines Themen-Links (Name, Modi, Passwortpflicht). */
  getLinkInfo(token) {
    return fetch(`/api/public/link/${encodeURIComponent(token)}`, { cache: 'no-store' }).then((r) => r.json());
  }

  /** Durchlauf starten: prüft Name, Passwort und Modus und liefert die Module. */
  startLinkRun(token, { studentName, password, mode }) {
    return fetch(`/api/public/link/${encodeURIComponent(token)}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentName, password, mode }),
    }).then((r) => r.json());
  }

  // ---------- Tags ----------
  getTags() { return this._fetch('/api/tags'); }
  createTag(data) { return this._fetch('/api/tags', { method: 'POST', body: JSON.stringify(data) }); }
  updateTag(id, data) {
    return this._fetch(`/api/tags/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) });
  }
  deleteTag(id) { return this._fetch(`/api/tags/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  /** Persönlich ausgeblendete Themengebiete (ersetzt die bisherige Auswahl). */
  setHiddenAreas(areaIds) {
    return this._fetch('/api/tags/hidden-areas', { method: 'PUT', body: JSON.stringify({ areaIds }) });
  }
  // Tag-Struktur der Schule (Schuladmin)
  getSchoolTags() { return this._fetch('/api/tags/school'); }
  createSchoolTag(data) { return this._fetch('/api/tags/school', { method: 'POST', body: JSON.stringify(data) }); }
  updateSchoolTag(id, data) {
    return this._fetch(`/api/tags/school/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) });
  }
  deleteSchoolTag(id) { return this._fetch(`/api/tags/school/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // ---------- Themen-Links ----------
  getLinks() { return this._fetch('/api/links'); }
  getLink(id) { return this._fetch(`/api/links/${encodeURIComponent(id)}`); }
  createLink(data) { return this._fetch('/api/links', { method: 'POST', body: JSON.stringify(data) }); }
  updateLink(id, data) {
    return this._fetch(`/api/links/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) });
  }
  deleteLink(id) { return this._fetch(`/api/links/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  shareLink(id, regenerate = false) {
    return this._fetch(`/api/links/${encodeURIComponent(id)}/share`, {
      method: 'POST',
      body: JSON.stringify({ regenerate }),
    });
  }
  revokeLink(id) { return this._fetch(`/api/links/${encodeURIComponent(id)}/share`, { method: 'DELETE' }); }

  submitPublicResult(data) {
    return fetch('/api/public/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => r.json());
  }

  // ---------- Admin ----------
  getAllUsers() { return this._fetch('/api/admin/users'); }
  deleteUser(userId) { return this._fetch(`/api/admin/users/${userId}`, { method: 'DELETE' }); }
  createUser(data) { return this._fetch('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }); }
  setUserRole(userId, role) {
    return this._fetch(`/api/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  }
  resetUserPassword(userId) {
    return this._fetch(`/api/admin/users/${userId}/reset-password`, { method: 'POST' });
  }
  getAdminWhitelistBlacklist() { return this._fetch('/api/admin/whitelist-blacklist'); }
  saveAdminWhitelistBlacklist(data) {
    return this._fetch('/api/admin/whitelist-blacklist', { method: 'POST', body: JSON.stringify(data) });
  }

  // ---------- App settings stubs ----------
  getAppSettings() { return Promise.resolve({}); }
  saveAppSettings() { return Promise.resolve({ success: true }); }
  getAllClasses() { return Promise.resolve([]); }
  saveClass() { return Promise.resolve({ success: false }); }
  deleteClass() { return Promise.resolve({ success: false }); }

  // ---------- Topics ----------
  getTopics() { return this._fetch('/api/topics'); }
  saveTopic(topicData, isUpdate = false) {
    if (isUpdate && topicData.id) {
      return this._fetch(`/api/topics/${encodeURIComponent(topicData.id)}`, { method: 'PATCH', body: JSON.stringify(topicData) });
    }
    return this._fetch('/api/topics', { method: 'POST', body: JSON.stringify(topicData) });
  }
  deleteTopic(topicId) {
    return this._fetch(`/api/topics/${topicId}`, { method: 'DELETE' });
  }
  toggleTopicSelection(topicId, selected) {
    return this._fetch(`/api/topics/${encodeURIComponent(topicId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ selected }),
    });
  }
  /** Themen, die ich in eigenen Links verwenden darf (eigene + mit Nutzungsrecht). */
  getUsableTopics() { return this._fetch('/api/topics/usable'); }
  /** Kollegen für die Zielgruppe eines Shop-Angebots. */
  getColleagues() { return this._fetch('/api/topics/colleagues'); }
  /** Themen, auf die ich ein Nutzungsrecht aus dem Shop habe. */
  getGrantedTopics() { return this._fetch('/api/topics/granted'); }
  /** Ein Thema mit Nutzungsrecht samt sichtbaren Modulen nur zum Ansehen holen. */
  getSharedTopicView(topicId) {
    return this._fetch(`/api/topics/${encodeURIComponent(topicId)}/shared-view`);
  }

  // ---------- Lernmodule-Shop ----------
  getShopOffers() { return this._fetch('/api/shop/offers'); }
  getMyOffers() { return this._fetch('/api/shop/my-offers'); }
  getMyPoints() { return this._fetch('/api/shop/points'); }
  getTopicOfferState(topicId) {
    return this._fetch(`/api/shop/topics/${encodeURIComponent(topicId)}`);
  }
  saveCreatorOffer(topicId, body) {
    return this._fetch(`/api/shop/topics/${encodeURIComponent(topicId)}/creator-offer`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  saveBuyerShare(topicId, audience) {
    return this._fetch(`/api/shop/topics/${encodeURIComponent(topicId)}/buyer-share`, {
      method: 'POST',
      body: JSON.stringify({ audience }),
    });
  }
  withdrawOffer(offerId) {
    return this._fetch(`/api/shop/offers/${encodeURIComponent(offerId)}`, { method: 'DELETE' });
  }
  /** mode: 'copy' | 'use' */
  acquireOffer(offerId, mode) {
    return this._fetch(`/api/shop/offers/${encodeURIComponent(offerId)}/acquire`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
  }
  /** Nutzungsrecht zurückgeben (eigenes) bzw. kostenloses entziehen (als Anbieter). */
  revokeGrant(grantId) {
    return this._fetch(`/api/shop/grants/${encodeURIComponent(grantId)}`, { method: 'DELETE' });
  }

  // ---------- Konto ----------
  /** E-Mail-Adresse ändern; bei bestehender Adresse mit `targetPassword` zusammenführen. */
  changeEmail(newEmail, password, targetPassword) {
    return this._fetch('/api/auth/change-email', {
      method: 'POST',
      body: JSON.stringify({ newEmail, password, targetPassword }),
    });
  }

  // ---------- Admin: Shop & Sicherheit ----------
  reactivateUser(userId) {
    return this._fetch(`/api/admin/users/${encodeURIComponent(userId)}/reactivate`, { method: 'POST' });
  }
  getPointsSettings() { return this._fetch('/api/admin/points-settings'); }
  savePointsSettings(body) {
    return this._fetch('/api/admin/points-settings', { method: 'POST', body: JSON.stringify(body) });
  }
  getMasterKeyStatus() { return this._fetch('/api/admin/master-key'); }
  /** creds: { password, code } – erneute Bestätigung für heikle Aktionen. */
  setMasterKey(masterKey, creds) {
    return this._fetch('/api/admin/master-key', { method: 'POST', body: JSON.stringify({ masterKey, ...creds }) });
  }
  downloadBackup(creds) {
    return this._download('/api/admin/backup', `lernmodule-backup-${new Date().toISOString().slice(0, 10)}.lmbak`,
      { method: 'POST', body: JSON.stringify(creds || {}) });
  }
  getCloudBackup() { return this._fetch('/api/admin/cloud-backup'); }
  saveCloudBackup(body) {
    return this._fetch('/api/admin/cloud-backup', { method: 'POST', body: JSON.stringify(body) });
  }
  testCloudBackup() { return this._fetch('/api/admin/cloud-backup/test', { method: 'POST' }); }
  runCloudBackup() { return this._fetch('/api/admin/cloud-backup/run', { method: 'POST' }); }
  listCloudBackups() { return this._fetch('/api/admin/cloud-backup/files'); }
  restoreCloudBackup(name, creds) {
    return this._fetch('/api/admin/cloud-backup/restore', { method: 'POST', body: JSON.stringify({ name, ...creds }) });
  }

  /** Fragt nach einer Backup-Datei und spielt sie ein. Liefert null bei Abbruch. */
  restoreBackup(creds) {
    return this._pickAndUpload('.lmbak', '/api/admin/restore', { password: creds?.password || '', code: creds?.code || '' });
  }

  /**
   * Lädt eine Datei mit Anmeldung herunter. Der Dateiname kommt vom Server;
   * `fallbackName` gilt nur, wenn er fehlt.
   */
  async _download(url, fallbackName, opts = {}) {
    const token = this._auth.getToken();
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) };
    const res = await fetch(url, { ...opts, headers, cache: 'no-store' });
    if (!res.ok) {
      let message = 'Download fehlgeschlagen.';
      try { message = (await res.json()).message || message; } catch (_) {}
      return { success: false, error: message };
    }
    const disposition = res.headers.get('Content-Disposition') || '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    const plain = /filename="([^"]+)"/i.exec(disposition);
    const name = star ? decodeURIComponent(star[1]) : plain ? plain[1] : fallbackName;
    downloadBlob(await res.blob(), name);
    return { success: true };
  }

  _pickAndUpload(accept, url, extra = {}) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return resolve(null);
        const formData = new FormData();
        formData.append('file', file);
        for (const [k, v] of Object.entries(extra)) formData.append(k, v);
        const token = this._auth.getToken();
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          });
          resolve(await res.json());
        } catch (err) {
          resolve({ success: false, message: err.message });
        }
      };
      input.click();
    });
  }

  // ---------- Benutzerliste als Tabelle (.ods) ----------

  /** Lädt die Benutzertabelle herunter. Enthält keine Passwörter. */
  async exportUsersOds() {
    const token = this._auth.getToken();
    const res = await fetch('/api/admin/users/export.ods', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Export fehlgeschlagen.');
    const blob = await res.blob();
    downloadBlob(blob, `benutzer-${new Date().toISOString().slice(0, 10)}.ods`);
    return { success: true };
  }

  /** Lädt eine .ods hoch und liefert den Bericht samt Zugangsdaten-Datei. */
  importUsersOds() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.ods';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return resolve(null);
        const formData = new FormData();
        formData.append('file', file);
        const token = this._auth.getToken();
        try {
          const res = await fetch('/api/admin/users/import', {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          });
          resolve(await res.json());
        } catch (err) {
          resolve({ message: err.message });
        }
      };
      input.click();
    });
  }

  // ---------- Lehrergruppen (Fachschaften) ----------
  /** Lesen darf jede Lehrkraft – der Freigabe-Dialog braucht die Namen. */
  getGroups() { return this._fetch('/api/groups'); }
  createGroup(body) {
    return this._fetch('/api/groups', { method: 'POST', body: JSON.stringify(body) });
  }
  updateGroup(id, body) {
    return this._fetch(`/api/groups/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  }
  deleteGroup(id) {
    return this._fetch(`/api/groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // ---------- Schulen (Hauptadmin) ----------
  getSchools() { return this._fetch('/api/admin/schools'); }
  createSchool(body) {
    return this._fetch('/api/admin/schools', { method: 'POST', body: JSON.stringify(body) });
  }
  updateSchool(id, body) {
    return this._fetch(`/api/admin/schools/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  }
  deleteSchool(id) {
    return this._fetch(`/api/admin/schools/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  previewSchoolWhitelist(id) {
    return this._fetch(`/api/admin/schools/${encodeURIComponent(id)}/whitelist-preview`);
  }
  applySchoolWhitelist(id) {
    return this._fetch(`/api/admin/schools/${encodeURIComponent(id)}/apply-whitelist`, { method: 'POST' });
  }
  /** `{ schoolId: id | null, isSchoolAdmin? }` */
  assignSchool(userId, body) {
    return this._fetch(`/api/admin/schools/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  // ---------- Meine Schule (Schuladmin) ----------
  getMySchool() { return this._fetch('/api/my-school'); }
  saveMySchoolWhitelist(whitelist) {
    return this._fetch('/api/my-school/whitelist', { method: 'PUT', body: JSON.stringify({ whitelist }) });
  }
  previewMySchoolWhitelist() { return this._fetch('/api/my-school/whitelist-preview'); }
  applyMySchoolWhitelist() { return this._fetch('/api/my-school/apply-whitelist', { method: 'POST' }); }
  /** action: 'remove' | 'deactivate' | 'reactivate' | 'reset-2fa' */
  mySchoolTeacherAction(userId, action) {
    return this._fetch(`/api/my-school/teachers/${encodeURIComponent(userId)}/${action}`, { method: 'POST' });
  }

  setTopicPermissions(topicId, permissions) {
    return this._fetch('/api/topics/permissions', {
      method: 'POST',
      body: JSON.stringify({ topicId, ...permissions }),
    });
  }

  // ---------- Modules ----------
  getTopicModules(topicId) {
    return this._fetch(`/api/topics/${encodeURIComponent(topicId)}/modules`);
  }
  saveModule(topicId, moduleData) {
    return this._fetch(`/api/topics/${encodeURIComponent(topicId)}/modules`, {
      method: 'POST',
      body: JSON.stringify(moduleData),
    }).then((res) => {
      if (res && res.id) {
        return { success: true, ...res };
      }
      return res;
    });
  }
  deleteModule(topicId, moduleId) {
    return this._fetch(
      `/api/topics/${encodeURIComponent(topicId)}/modules/${encodeURIComponent(moduleId)}`,
      { method: 'DELETE' }
    );
  }
  toggleModuleSelection(topicId, moduleId, selected) {
    return this._fetch(
      `/api/topics/${encodeURIComponent(topicId)}/modules/${encodeURIComponent(moduleId)}/toggle`,
      { method: 'PATCH', body: JSON.stringify({ selected }) }
    );
  }
  bulkToggleModules(topicId, moduleIds, selected) {
    return this._fetch(`/api/topics/${encodeURIComponent(topicId)}/modules/bulk-toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ moduleIds, selected }),
    });
  }
  reorderModules(topicId, moduleIds) {
    return this._fetch(`/api/topics/${encodeURIComponent(topicId)}/modules/reorder`, {
      method: 'POST',
      body: JSON.stringify({ moduleIds }),
    });
  }
  /**
   * Module in ein anderes Thema verschieben oder kopieren. Gleiches Quell-
   * und Zielthema mit mode='copy' dupliziert sie an Ort und Stelle.
   */
  transferModules(topicId, targetTopicId, moduleIds, mode) {
    return this._fetch(`/api/topics/${encodeURIComponent(topicId)}/modules/transfer`, {
      method: 'POST',
      body: JSON.stringify({ targetTopicId, moduleIds, mode }),
    });
  }
  confirmImportModules(topicId, modules) {
    let topics = [];
    try { topics = JSON.parse(localStorage.getItem('lm_topics') || '[]'); } catch (_) {}
    const topic = topics.find((t) => t.id === topicId);
    if (!topic) return Promise.resolve({ success: false, error: 'Thema nicht gefunden' });
    if (!topic.modules) topic.modules = [];
    topic.modules.push(...modules);
    localStorage.setItem('lm_topics', JSON.stringify(topics));
    return Promise.resolve({ success: true });
  }

  // ---------- Export / Import ----------
  /** Wie viele Module eigene und fremde sind – vor dem Export abfragen. */
  getExportInfo(topicId) {
    return this._fetch(`/api/interchange/topics/${encodeURIComponent(topicId)}/export-info`);
  }
  /** Unverschlüsselt als JSON – nur die selbst verfassten Module. */
  exportTopic(topicId) {
    return this._download(`/api/interchange/topics/${encodeURIComponent(topicId)}/export-json`, 'thema.json');
  }
  /** Das ganze Thema, verschlüsselt mit dem Masterkey. */
  exportTopicEncrypted(topicId) {
    return this._download(`/api/interchange/topics/${encodeURIComponent(topicId)}/export-encrypted`, 'thema.lmenc');
  }

  importTopic() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      // .lmenc = verschlüsselter Export dieser App; der Server erkennt ihn selbst.
      input.accept = '.json,.lmenc';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return resolve({ success: false });
        const formData = new FormData();
        formData.append('file', file);
        const token = this._auth.getToken();
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        try {
          const res = await fetch('/api/interchange/import-json', { method: 'POST', headers, body: formData });
          const data = await res.json();
          if (data.success) {
            resolve({ success: true, topicTitle: data.topicTitle, importedCount: data.importedCount });
          } else {
            resolve({ success: false, error: data.message || data.error || 'Unbekannter Fehler' });
          }
        } catch (err) {
          resolve({ success: false, error: err.message });
        }
      };
      input.click();
    });
  }

  importH5p(options) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.h5p';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return resolve({ success: false });
        const formData = new FormData();
        formData.append('file', file);
        const token = this._auth.getToken();
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (options && options.importMode) headers['X-Import-Mode'] = options.importMode;
        try {
          const res = await fetch('/api/interchange/h5p/upload', { method: 'POST', headers, body: formData });
          const data = await res.json();
          resolve(data);
        } catch (err) {
          resolve({ success: false, error: err.message });
        }
      };
      input.click();
    });
  }

  /** Unverschlüsselt als H5P – nur die selbst verfassten Module. */
  exportTopicAsH5p(topicId) {
    return this._download(`/api/interchange/topics/${encodeURIComponent(topicId)}/export-h5p`, 'thema.h5p');
  }

  exportSelectedModulesAsH5p() {
    return Promise.resolve({ success: false, error: 'Einzel-Export nur im Desktop-Modus' });
  }

  // ---------- Results ----------
  getQuizResults() { return this._fetch('/api/results'); }
  saveQuizResult(resultData) {
    return this._fetch('/api/results', { method: 'POST', body: JSON.stringify(resultData) });
  }
  deleteQuizResult(resultId) {
    return this._fetch(`/api/results/${resultId}`, { method: 'DELETE' });
  }
  deleteAllQuizResults() {
    return this._fetch('/api/results', { method: 'DELETE' });
  }

  // ---------- Misc stubs ----------
  getH5pContentPath() { return Promise.resolve(''); }
  selectImage() { return Promise.resolve({ success: false }); }
  selectAudio() { return Promise.resolve({ success: false }); }
  onMenuImport() {}
  onMenuExport() {}
  focusWindow() {}
  getWebServerUrl() { return Promise.resolve(window.location.origin); }
}


/**
 * Speichert einen Blob als Datei. Der Umweg über ein <a download> ist nötig,
 * weil der Download eine Authorization-Kopfzeile braucht – ein einfacher
 * Link zum Endpunkt käme ohne Token an.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Erst freigeben, wenn der Browser den Download begonnen hat.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
