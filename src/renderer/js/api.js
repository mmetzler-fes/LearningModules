// ==================== AUTH STORE ====================

export class AuthStore {
  constructor() {
    this._token = null;
  }

  getToken() {
    return this._token || localStorage.getItem('lm_token');
  }

  setToken(t) {
    this._token = t;
    if (t) localStorage.setItem('lm_token', t);
    else localStorage.removeItem('lm_token');
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
  login(email, password) {
    return fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then((r) => r.json());
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
  getTeacherTopics(teacherEmail) {
    return fetch(`/api/public/teachers/${encodeURIComponent(teacherEmail)}/topics`).then((r) => r.json());
  }

  verifyTopicPassword(teacherEmail, topicId, password) {
    return fetch(
      `/api/public/teachers/${encodeURIComponent(teacherEmail)}/topics/${encodeURIComponent(topicId)}/verify-password`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      }
    ).then((r) => r.json());
  }

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
  createAdmin(data) { return this._fetch('/api/admin/admins', { method: 'POST', body: JSON.stringify(data) }); }
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
  getExamMode() { return Promise.resolve({ enabled: false }); }
  setExamMode() { return Promise.resolve({ success: true }); }
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
  setTopicSharing(topicId, sharedWith) {
    return this._fetch(`/api/topics/${encodeURIComponent(topicId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sharedWith }),
    });
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
  transferModules() {
    return Promise.resolve({ success: false, error: 'Im Browser-Modus nicht verfügbar' });
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
  exportTopic(topicId) {
    return this._fetch(`/api/topics/${encodeURIComponent(topicId)}`).then((topic) => {
      if (!topic || !topic.id) return { success: false };
      const blob = new Blob([JSON.stringify({ topic }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${topic.title || 'topic'}.json`;
      a.click();
      return { success: true };
    });
  }

  importTopic() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
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

  exportTopicAsH5p(topicId) {
    const token = this._auth.getToken();
    const url = `/api/interchange/topics/${topicId}/export-h5p${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const a = document.createElement('a');
    a.href = url;
    a.click();
    return Promise.resolve({ success: true });
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
