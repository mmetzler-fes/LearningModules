/**
 * LearningModules v2.0 - Main Application Logic
 * Features: Multi-user Auth (admin/teacher/student), Role-based RBAC,
 *           Class Management, Topic Permissions, H5P Browser Upload
 * Supports: Electron (full) + Browser/Server mode (all features via REST API)
 */

// --- Web-only mode ---

// --- Auth token storage (browser mode uses localStorage) ---
const authStore = {
  _token: null,
  getToken() { return this._token || localStorage.getItem('lm_token'); },
  setToken(t) { this._token = t; if (t) localStorage.setItem('lm_token', t); else localStorage.removeItem('lm_token'); },
  getHeaders() {
    const t = this.getToken();
    return t ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` } : { 'Content-Type': 'application/json' };
  },
  authFetch(url, opts = {}) {
    return fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...this.getHeaders() } }).then(r => {
      if (r.status === 401) { authStore.setToken(null); showLoginScreen(); }
      return r.json();
    });
  },
};

// --- REST API fallback for browser mode ---
const browserApi = {
  // Auth
  login: (username, password) => fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
  }).then(r => r.json()),
  getAuthSettings: () => fetch('/api/auth/settings').then(r => r.json()),
  verifyAdmin: async (username, password) => {
    const res = await browserApi.login(username, password);
    if (res.token && (res.role === 'admin' || res.role === 'teacher')) {
      authStore.setToken(res.token);
      return res;
    }
    return false;
  },
  getAdminCredentials: () => Promise.resolve({ username: 'admin' }),
  updateAdminPassword: (newPassword) => authStore.authFetch('/api/admin/users', {
    method: 'PUT', body: JSON.stringify({ password: newPassword })
  }),

  // User Management (admin/teacher)
  getAllUsers: () => authStore.authFetch('/api/admin/users'),
  saveUser: (userData) => {
    if (userData.id) {
      return authStore.authFetch(`/api/admin/users/${userData.id}`, { method: 'PUT', body: JSON.stringify(userData) });
    }
    return authStore.authFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(userData) });
  },
  deleteUser: (userId) => authStore.authFetch(`/api/admin/users/${userId}`, { method: 'DELETE' }),
  importUsers: async () => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.xlsx,.csv';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return resolve({ success: false });
        const formData = new FormData();
        formData.append('file', file);
        const token = authStore.getToken();
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        try {
          const res = await fetch('/api/admin/user-import', { method: 'POST', headers, body: formData });
          const data = await res.json();
          resolve(data);
        } catch (err) { resolve({ success: false, error: err.message }); }
      };
      input.click();
    });
  },

  // Class Management (admin/teacher)
  getAllClasses: () => authStore.authFetch('/api/admin/classes'),
  saveClass: (classData) => {
    if (classData.id) {
      return authStore.authFetch(`/api/admin/classes/${classData.id}`, { method: 'PUT', body: JSON.stringify(classData) });
    }
    return authStore.authFetch('/api/admin/classes', { method: 'POST', body: JSON.stringify(classData) });
  },
  deleteClass: (classId) => authStore.authFetch(`/api/admin/classes/${classId}`, { method: 'DELETE' }),

  // App Settings
  getAppSettings: () => authStore.authFetch('/api/admin/settings'),
  saveAppSettings: (settings) => authStore.authFetch('/api/admin/settings', { method: 'POST', body: JSON.stringify(settings) }),

  // Topics (teacher/admin full access)
  getTopics: () => authStore.authFetch('/api/topics'),
  getExamMode: () => Promise.resolve({ enabled: false }),
  setExamMode: (enabled) => Promise.resolve({ success: true }),
  saveTopic: (topicData) => authStore.authFetch('/api/topics', { method: 'POST', body: JSON.stringify(topicData) }),
  deleteTopic: (topicId) => authStore.authFetch(`/api/topics/${topicId}`, { method: 'DELETE' }),
  toggleTopicSelection: (topicId, selected) =>
    authStore.authFetch(`/api/topics/${encodeURIComponent(topicId)}`, {
      method: 'PATCH', body: JSON.stringify({ selected })
    }),
  setTopicSharing: (topicId, sharedWith) =>
    authStore.authFetch(`/api/topics/${encodeURIComponent(topicId)}`, {
      method: 'PATCH', body: JSON.stringify({ sharedWith })
    }),

  // Module CRUD (via topic save)
  getTopicModules: (topicId) => authStore.authFetch(`/api/topics/${encodeURIComponent(topicId)}/modules`),
  saveModule: (topicId, moduleData) =>
    authStore.authFetch(`/api/topics/${encodeURIComponent(topicId)}/modules`, {
      method: 'POST', body: JSON.stringify(moduleData)
    }),
  deleteModule: (topicId, moduleId) => authStore.authFetch(`/api/topics/${encodeURIComponent(topicId)}/modules/${encodeURIComponent(moduleId)}`, {
    method: 'DELETE'
  }),
  toggleModuleSelection: (topicId, moduleId, selected) => authStore.authFetch(`/api/topics/${encodeURIComponent(topicId)}/modules/${encodeURIComponent(moduleId)}/toggle`, {
    method: 'PATCH', body: JSON.stringify({ selected })
  }),
  bulkToggleModules: (topicId, moduleIds, selected) => authStore.authFetch(`/api/topics/${encodeURIComponent(topicId)}/modules/bulk-toggle`, {
    method: 'PATCH', body: JSON.stringify({ moduleIds, selected })
  }),
  reorderModules: (topicId, moduleIds) => authStore.authFetch(`/api/topics/${encodeURIComponent(topicId)}/modules/reorder`, {
    method: 'POST', body: JSON.stringify({ moduleIds })
  }),
  transferModules: () => Promise.resolve({ success: false, error: 'Im Browser-Modus nicht verfügbar' }),

  // Export/Import (topic JSON)
  exportTopic: (topicId) => authStore.authFetch(`/api/admin/topics`).then(topics => {
    const t = topics.find(t => t.id === topicId);
    if (!t) return { success: false };
    const blob = new Blob([JSON.stringify({ topic: t }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${t.title || 'topic'}.json`; a.click();
    return { success: true };
  }),
  importTopic: () => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return resolve({ success: false });
      const formData = new FormData();
      formData.append('file', file);
      const token = authStore.getToken();
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      try {
        const res = await fetch('/api/interchange/import-json', { method: 'POST', headers, body: formData });
        const data = await res.json();
        if (data.success) {
          resolve({ success: true, topicTitle: data.topicTitle, importedCount: data.importedCount });
        } else {
          resolve({ success: false, error: data.error || 'Unbekannter Fehler' });
        }
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    };
    input.click();
  }),
  importModulesToTopic: (topicId) => new Promise((resolve) => {
    // Datei-Dialog für JSON-Import
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return resolve({ success: false });
      const formData = new FormData();
      formData.append('file', file);
      formData.append('topicId', topicId);
      const token = authStore.getToken();
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      try {
        const res = await fetch('/api/interchange/import-json', { method: 'POST', headers, body: formData });
        const data = await res.json();
        if (data.success) {
          // Return modules and _fullModules for the preview modal in app.js
          resolve({
            success: true,
            importedCount: data.importedCount,
            modules: data.modules,
            _fullModules: data._fullModules
          });
        } else {
          resolve({ success: false, error: data.error || 'Unbekannter Fehler' });
        }
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    };
    input.click();
  }),
  confirmImportModules: (topicId, modules) => {
    // Speichere Module im lokalen Topic (Browser-Modus)
    let topics = [];
    try {
      topics = JSON.parse(localStorage.getItem('lm_topics') || '[]');
    } catch {}
    const topic = topics.find((t) => t.id === topicId);
    if (!topic) return Promise.resolve({ success: false, error: 'Thema nicht gefunden' });
    if (!topic.modules) topic.modules = [];
    topic.modules.push(...modules);
    localStorage.setItem('lm_topics', JSON.stringify(topics));
    return Promise.resolve({ success: true });
  },

  // H5P import via browser file picker
  importH5p: (options) => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.h5p';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return resolve({ success: false });
      const formData = new FormData(); formData.append('file', file);
      const token = authStore.getToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (options && options.importMode) headers['X-Import-Mode'] = options.importMode;
      try {
        const res = await fetch('/api/interchange/h5p/upload', { method: 'POST', headers, body: formData });
        const data = await res.json();
        resolve(data);
      } catch (e) { resolve({ success: false, error: e.message }); }
    };
    input.click();
  }),
  exportTopicAsH5p: async (topicId) => {
    const token = authStore.getToken();
    const url = `/api/interchange/topics/${topicId}/export-h5p${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const a = document.createElement('a');
    a.href = url;
    a.click();
    return { success: true };
  },
  exportSelectedModulesAsH5p: (topicId) => Promise.resolve({ success: false, error: 'Einzel-Export nur im Desktop-Modus' }),

  // Student selections
  getSelectedTopics: () => authStore.authFetch('/api/selected-topics'),
  getStudentSelections: (username) => authStore.authFetch(`/api/student-selections/${encodeURIComponent(username)}`),
  saveStudentSelections: (username, topicIds) => authStore.authFetch(`/api/student-selections/${encodeURIComponent(username)}`, {
    method: 'POST', body: JSON.stringify({ topicIds })
  }),
  saveQuizResult: (resultData) => authStore.authFetch('/api/results', { method: 'POST', body: JSON.stringify(resultData) }),

  // Quiz results (teacher/admin)
  getQuizResults: () => authStore.authFetch('/api/results'),
  deleteQuizResult: (resultId) => authStore.authFetch(`/api/results/${resultId}`, { method: 'DELETE' }),
  deleteAllQuizResults: () => authStore.authFetch('/api/results', { method: 'DELETE' }),

  // Topic permissions
  setTopicPermissions: (topicId, permissions) => authStore.authFetch('/api/topics/permissions', {
    method: 'POST', body: JSON.stringify({ topicId, ...permissions })
  }),

  getH5pContentPath: () => Promise.resolve(''),
  selectImage: () => Promise.resolve({ success: false }),
  selectAudio: () => Promise.resolve({ success: false }),
  onMenuImport: () => {},
  onMenuExport: () => {},
  focusWindow: () => {},
  getWebServerUrl: () => Promise.resolve(window.location.origin),
};

const appApi = browserApi;

// --- State ---
let currentUser = null; // { name, role: 'admin'|'teacher'|'student', id, username }
let topics = [];
let currentTopicId = null;
let currentTopicModules = [];
let currentTopicRawSummary = null;
let editingModuleId = null;
let editingTopicId = null;
let contentEditor = null;
let moduleDescEditorInitialized = false;
let examModeEnabled = false;

// User Import Elements
const btnImportUsers = document.getElementById('btnImportUsers');
const userImportOverlay = document.getElementById('userImportOverlay');
const userImportForm = document.getElementById('userImportForm');
const userImportFile = document.getElementById('userImportFile');
const btnCancelUserImport = document.getElementById('btnCancelUserImport');
const userImportResult = document.getElementById('userImportResult');
// === Nutzerimport: Dialog-Logik ===
if (btnImportUsers) {
  btnImportUsers.addEventListener('click', async () => {
    // Show overlay
    userImportOverlay.classList.remove('hidden');
    userImportResult.textContent = '';
    userImportFile.value = '';
  });
}
if (btnCancelUserImport) {
  btnCancelUserImport.addEventListener('click', () => {
    userImportOverlay.classList.add('hidden');
    userImportResult.textContent = '';
    userImportFile.value = '';
  });
}
if (userImportForm) {
  userImportForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = userImportFile.files[0];
    if (!file) return;
    userImportResult.innerHTML = '<span class="hint">Import läuft...</span>';
    const formData = new FormData();
    formData.append('file', file);
    const token = authStore.getToken();
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    try {
      const res = await fetch('/api/admin/user-import', { method: 'POST', headers, body: formData });
      const data = await res.json();
      if (data.success) {
        userImportResult.innerHTML = `<span style='color:green'>${data.created.length} Nutzer importiert.</span>` + (data.skipped.length ? `<br><span style='color:orange'>${data.skipped.length} übersprungen.</span>` : '');
        await refreshAdminUsers();
      } else {
        userImportResult.innerHTML = `<span style='color:red'>Fehler: ${data.error || 'Unbekannter Fehler'}</span>`;
      }
    } catch (err) {
      userImportResult.innerHTML = `<span style='color:red'>Fehler: ${err.message}</span>`;
    }
  });
}

// Quiz state
let quizState = null; // { topicId, modules, currentIndex, answers, startTime }

// --- DOM Elements ---

// Login
const loginScreen = document.getElementById('loginScreen');
const appContainer = document.getElementById('appContainer');
const loginForm = document.getElementById('loginForm');
const loginName = document.getElementById('loginName');
const studentLoginSection = document.getElementById('studentLoginSection');
const btnShowStudentLogin = document.getElementById('btnShowStudentLogin');
const btnShowAdminLogin = document.getElementById('btnShowAdminLogin');
const adminLoginSection = document.getElementById('adminLoginSection');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminUsername = document.getElementById('adminUsername');
const adminPassword = document.getElementById('adminPassword');
const adminLoginError = document.getElementById('adminLoginError');

// App shell
const sidebar = document.getElementById('sidebar');
const userInfo = document.getElementById('userInfo');
const teacherNav = document.getElementById('teacherNav');
const studentNav = document.getElementById('studentNav');
const btnLogout = document.getElementById('btnLogout');
const toastContainer = document.getElementById('toastContainer');
const views = document.querySelectorAll('.view');

// Teacher Dashboard
const statTopics = document.getElementById('statTopics');
const statModules = document.getElementById('statModules');
const statActive = document.getElementById('statActive');
const statResults = document.getElementById('statResults');
const typeGrid = document.getElementById('typeGrid');

// Teacher Topics
const topicsList = document.getElementById('topicsList');
const btnNewTopic = document.getElementById('btnNewTopic');
const btnImportTopic = document.getElementById('btnImportTopic');
const btnImportH5p = document.getElementById('btnImportH5p');
const btnExportH5p = document.getElementById('btnExportH5p');
const chkExamMode = document.getElementById('chkExamMode');
const exportH5pTopicOverlay = document.getElementById('exportH5pTopicOverlay');
const exportH5pTopicList = document.getElementById('exportH5pTopicList');
const exportH5pBtnCancel = document.getElementById('exportH5pBtnCancel');
const topicFormContainer = document.getElementById('topicFormContainer');
const topicForm = document.getElementById('topicForm');
const topicFormTitle = document.getElementById('topicFormTitle');
const topicTitleInput = document.getElementById('topicTitle');
const topicDescInput = document.getElementById('topicDescription');
const btnCancelTopic = document.getElementById('btnCancelTopic');

// Teacher Modules
const modulesBreadcrumb = document.getElementById('modulesBreadcrumb');
const backToTopics = document.getElementById('backToTopics');
const currentTopicName = document.getElementById('currentTopicName');
const modulesViewTitle = document.getElementById('modulesViewTitle');
const searchModules = document.getElementById('searchModules');
const filterType = document.getElementById('filterType');
const btnCreateModule = document.getElementById('btnCreateModule');
const btnImportModules = document.getElementById('btnImportModules');
const btnExportCurrentTopic = document.getElementById('btnExportCurrentTopic');
const btnExportModulesAsH5p = document.getElementById('btnExportModulesAsH5p');
const btnTransferModules = document.getElementById('btnTransferModules');
const modulesList = document.getElementById('modulesList');

// Import Modules Modal
const importModulesOverlay = document.getElementById('importModulesOverlay');
const importModulesList = document.getElementById('importModulesList');
const importModulesBtnOk = document.getElementById('importModulesBtnOk');
const importModulesBtnCancel = document.getElementById('importModulesBtnCancel');

// Create/Edit Module
const moduleForm = document.getElementById('moduleForm');
const moduleIdInput = document.getElementById('moduleId');
const moduleTitleInput = document.getElementById('moduleTitle');
const moduleTypeSelect = document.getElementById('moduleType');
const moduleDescInput = document.getElementById('moduleDescription');
const moduleDescToolbar = document.getElementById('moduleDescToolbar');
const moduleDescEditor = document.getElementById('moduleDescriptionEditor');
const moduleDescBlockFormat = document.getElementById('moduleDescBlockFormat');
const moduleDescSpacing = document.getElementById('moduleDescSpacing');
const moduleDescFontSize = document.getElementById('moduleDescFontSize');
const moduleDescInsertTable = document.getElementById('moduleDescInsertTable');
const moduleDescCreateLink = document.getElementById('moduleDescCreateLink');
const moduleDescClearFormat = document.getElementById('moduleDescClearFormat');
const contentEditorEl = document.getElementById('contentEditor');
const createViewTitle = document.getElementById('createViewTitle');
const btnCancelModule = document.getElementById('btnCancelModule');

// Teacher Results
const searchResults = document.getElementById('searchResults');
const btnDeleteAllResults = document.getElementById('btnDeleteAllResults');
const resultsStats = document.getElementById('resultsStats');
const resultsList = document.getElementById('resultsList');

// Student Topics
const studentTopicsList = document.getElementById('studentTopicsList');

// Student Quiz
const quizSubtitle = document.getElementById('quizSubtitle');
const quizTopicSelect = document.getElementById('quizTopicSelect');
const quizPlayerArea = document.getElementById('quizPlayerArea');
const quizProgressFill = document.getElementById('quizProgressFill');
const quizInfo = document.getElementById('quizInfo');
const quizModuleContainer = document.getElementById('quizModuleContainer');
const quizActions = document.getElementById('quizActions');
const btnQuizPrev = document.getElementById('btnQuizPrev');
const btnQuizNext = document.getElementById('btnQuizNext');
const btnQuizCancel = document.getElementById('btnQuizCancel');
const quizResultArea = document.getElementById('quizResultArea');

// Player
const btnBackFromPlayer = document.getElementById('btnBackFromPlayer');
const playerTitle = document.getElementById('playerTitle');
const h5pContainer = document.getElementById('h5pContainer');

// Custom confirm dialog
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmMessage = document.getElementById('confirmMessage');
const confirmBtnYes = document.getElementById('confirmBtnYes');
const confirmBtnNo = document.getElementById('confirmBtnNo');

// ==================== CUSTOM CONFIRM ====================

function appConfirm(message) {
  return new Promise((resolve) => {
    confirmMessage.textContent = message;
    confirmOverlay.classList.remove('hidden');
    confirmBtnYes.focus();

    function cleanup(result) {
      confirmBtnYes.removeEventListener('click', onYes);
      confirmBtnNo.removeEventListener('click', onNo);
      confirmOverlay.classList.add('hidden');
      resolve(result);
    }

    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }

    confirmBtnYes.addEventListener('click', onYes);
    confirmBtnNo.addEventListener('click', onNo);
  });
}

function escapeHtmlPreservingText(text) {
  return escapeHtml(String(text || '')).replace(/\n/g, '<br>');
}

function sanitizeModuleDescriptionHtml(html) {
  const allowedTags = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'SPAN', 'FONT']);
  const template = document.createElement('template');
  template.innerHTML = html || '';

  const sanitizeNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || '');
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return document.createDocumentFragment();
    }

    const tag = node.tagName.toUpperCase();
    const fragment = document.createDocumentFragment();

    if (!allowedTags.has(tag)) {
      Array.from(node.childNodes).forEach((child) => {
        fragment.appendChild(sanitizeNode(child));
      });
      return fragment;
    }

    const clean = document.createElement(tag.toLowerCase());

    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^(https?:|mailto:|#)/i.test(href)) {
        clean.setAttribute('href', href);
        clean.setAttribute('target', '_blank');
        clean.setAttribute('rel', 'noopener noreferrer');
      }
    }

    if (tag === 'TH' || tag === 'TD') {
      const colspan = node.getAttribute('colspan');
      const rowspan = node.getAttribute('rowspan');
      if (colspan && /^\d+$/.test(colspan)) clean.setAttribute('colspan', colspan);
      if (rowspan && /^\d+$/.test(rowspan)) clean.setAttribute('rowspan', rowspan);
    }

    if (tag === 'FONT') {
      const size = node.getAttribute('size');
      if (size && /^[1-7]$/.test(size)) clean.setAttribute('size', size);
    }

    const style = node.getAttribute('style') || '';
    const textAlignMatch = style.match(/text-align\s*:\s*(left|center|right|justify)/i);
    if (textAlignMatch && ['P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'TH', 'TD', 'SPAN'].includes(tag)) {
      clean.style.textAlign = textAlignMatch[1].toLowerCase();
    }
    const marginBottomMatch = style.match(/margin-bottom\s*:\s*(\d+px)/i);
    if (marginBottomMatch && ['P', 'H1', 'H2', 'H3', 'DIV', 'LI', 'UL', 'OL'].includes(tag)) {
      clean.style.marginBottom = marginBottomMatch[1].toLowerCase();
    }

    Array.from(node.childNodes).forEach((child) => {
      clean.appendChild(sanitizeNode(child));
    });

    return clean;
  };

  const out = document.createElement('div');
  Array.from(template.content.childNodes).forEach((child) => {
    out.appendChild(sanitizeNode(child));
  });

  return out.innerHTML;
}

function getModuleDescriptionHtml() {
  return sanitizeModuleDescriptionHtml(moduleDescEditor ? moduleDescEditor.innerHTML : moduleDescInput.value || '');
}

function setModuleDescriptionHtml(value) {
  const hasMarkup = /<\/?[a-z][\s\S]*>/i.test(value || '');
  const html = hasMarkup ? sanitizeModuleDescriptionHtml(value || '') : escapeHtmlPreservingText(value || '');
  if (moduleDescEditor) {
    moduleDescEditor.innerHTML = html;
  }
  if (moduleDescInput) {
    moduleDescInput.value = html;
  }
}

function syncModuleDescriptionInput() {
  if (moduleDescInput) {
    moduleDescInput.value = getModuleDescriptionHtml();
  }
}

function applyModuleDescriptionCommand(command, value = null) {
  if (!moduleDescEditor) return;
  moduleDescEditor.focus();
  document.execCommand(command, false, value);
  syncModuleDescriptionInput();
}

function initModuleDescriptionEditor() {
  if (!moduleDescEditor || !moduleDescToolbar) return;
  if (moduleDescEditorInitialized) return;
  moduleDescEditorInitialized = true;

  moduleDescToolbar.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => {
      applyModuleDescriptionCommand(button.dataset.command);
    });
  });

  moduleDescBlockFormat.addEventListener('change', () => {
    if (!moduleDescBlockFormat.value) return;
    applyModuleDescriptionCommand('formatBlock', moduleDescBlockFormat.value);
    moduleDescBlockFormat.value = 'p';
  });

  moduleDescFontSize.addEventListener('change', () => {
    applyModuleDescriptionCommand('fontSize', moduleDescFontSize.value);
    moduleDescFontSize.value = '3';
  });

  moduleDescSpacing.addEventListener('change', () => {
    const val = moduleDescSpacing.value;
    if (!val) return;
    moduleDescEditor.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      let node = sel.getRangeAt(0).commonAncestorContainer;
      if (node.nodeType === 3) node = node.parentNode;
      while (node && node !== moduleDescEditor && !/^(P|H[1-6]|DIV|LI)$/i.test(node.nodeName)) {
        node = node.parentNode;
      }
      if (node && node !== moduleDescEditor) {
        node.style.marginBottom = val;
      } else {
        document.execCommand('formatBlock', false, 'p');
        node = sel.getRangeAt(0).commonAncestorContainer;
        if (node.nodeType === 3) node = node.parentNode;
        while (node && node !== moduleDescEditor && !/^(P|H[1-6]|DIV|LI)$/i.test(node.nodeName)) {
          node = node.parentNode;
        }
        if (node && node !== moduleDescEditor) node.style.marginBottom = val;
      }
    }
    moduleDescSpacing.selectedIndex = 0;
    syncModuleDescriptionInput();
  });

  moduleDescInsertTable.addEventListener('click', () => {
    moduleDescEditor.focus();
    const tableHtml = '<table class="h5p-table" style="width:100%; border-collapse:collapse; margin-top:10px; margin-bottom:10px;" border="1"><tbody><tr><td style="padding:6px;">Inhalt</td><td style="padding:6px;">Inhalt</td></tr><tr><td style="padding:6px;">Inhalt</td><td style="padding:6px;">Inhalt</td></tr></tbody></table><p><br></p>';
    document.execCommand('insertHTML', false, tableHtml);
    syncModuleDescriptionInput();
  });

  moduleDescCreateLink.addEventListener('click', () => {
    const url = prompt('Link-URL eingeben:', 'https://');
    if (!url) return;
    applyModuleDescriptionCommand('createLink', url.trim());
  });

  moduleDescClearFormat.addEventListener('click', () => {
    if (!moduleDescEditor) return;
    moduleDescEditor.focus();
    // Remove inline formatting (bold, italic, underline, etc.)
    document.execCommand('removeFormat', false, null);
    // Also reset block-level formatting (headers, blockquotes) to plain paragraphs
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      document.execCommand('formatBlock', false, 'p');
    }
    syncModuleDescriptionInput();
  });

  moduleDescEditor.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.originalEvent || e).clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  
  moduleDescEditor.addEventListener('input', syncModuleDescriptionInput);
  moduleDescEditor.addEventListener('blur', () => {
    setModuleDescriptionHtml(getModuleDescriptionHtml());
  });

  setModuleDescriptionHtml('');
}

// ==================== LOGIN ====================

async function initLoginScreen() {
  // In browser mode: check if empty student passwords are allowed and if teacher login should be shown
  try {
    const settings = await fetch('/api/auth/settings').then(r => r.json());
    
    // Update student password field visibility
    const studentPasswordField = document.getElementById('loginPassword');
    if (studentPasswordField) {
      studentPasswordField.required = !settings.allowEmptyStudentPassword;
      document.getElementById('loginPasswordGroup').classList.toggle('hidden', settings.allowEmptyStudentPassword);
    }

    // Update teacher login button visibility based on server filters
    const adminToggle = document.getElementById('btnShowAdminLogin');
    if (adminToggle) {
      adminToggle.style.display = settings.showTeacherLogin ? '' : 'none';
    }
  } catch (_) {}
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = loginName.value.trim();
  const passwordInput = document.getElementById('loginPassword');
  const password = passwordInput ? passwordInput.value : '';
  if (!name) return;

  // Browser mode: authenticate via API
  const loginError = document.getElementById('studentLoginError');
  try {
    const res = await browserApi.login(name, password);
    if (res.token && res.role === 'student') {
      authStore.setToken(res.token);
      currentUser = { name: res.displayName || res.username, role: 'student', id: res.id, username: res.username };
      if (loginError) loginError.classList.add('hidden');
      enterApp();
    } else if (res.token && (res.role === 'admin' || res.role === 'teacher')) {
      // Teacher/admin tried the student form
      authStore.setToken(res.token);
      currentUser = { name: res.displayName || res.username, role: res.role, id: res.id, username: res.username };
      if (loginError) loginError.classList.add('hidden');
      enterApp();
    } else {
      if (loginError) { loginError.textContent = res.error || 'Anmeldung fehlgeschlagen'; loginError.classList.remove('hidden'); }
    }
  } catch (_) {
    if (loginError) { loginError.textContent = 'Server nicht erreichbar'; loginError.classList.remove('hidden'); }
  }
});

btnShowAdminLogin.addEventListener('click', () => {
  studentLoginSection.classList.add('hidden');
  adminLoginSection.classList.remove('hidden');
  adminLoginError.classList.add('hidden');
});

btnShowStudentLogin.addEventListener('click', () => {
  adminLoginSection.classList.add('hidden');
  studentLoginSection.classList.remove('hidden');
  adminLoginError.classList.add('hidden');
});

adminLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = adminUsername.value.trim();
  const pass = adminPassword.value;
  if (!user || !pass) return;

  // Browser mode: login via API, get role from response
  try {
    const res = await browserApi.login(user, pass);
    if (res.token && (res.role === 'admin' || res.role === 'teacher')) {
      authStore.setToken(res.token);
      currentUser = { name: res.displayName || res.username, role: res.role, id: res.id, username: res.username };
      adminLoginError.classList.add('hidden');
      enterApp();
    } else {
      adminLoginError.textContent = res.error || 'Falsche Anmeldedaten';
      adminLoginError.classList.remove('hidden');
    }
  } catch (_) {
    adminLoginError.textContent = 'Server nicht erreichbar';
    adminLoginError.classList.remove('hidden');
  }
});

function showLoginScreen() {
  currentUser = null;
  quizState = null;
  currentTopicId = null;
  authStore.setToken(null);
  views.forEach(v => v.classList.remove('active'));
  quizPlayerArea.classList.add('hidden');
  quizResultArea.classList.add('hidden');
  quizTopicSelect.classList.remove('hidden');
  quizModuleContainer.innerHTML = '';
  h5pContainer.innerHTML = '';
  quizSubtitle.textContent = t('quiz.subtitle');
  appContainer.classList.add('hidden');
  teacherNav.classList.add('hidden');
  studentNav.classList.add('hidden');
  const adminNavEl = document.getElementById('adminNav');
  if (adminNavEl) adminNavEl.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  loginName.value = '';
  adminUsername.value = 'admin';
  adminPassword.value = '';
  adminLoginSection.classList.add('hidden');
  adminLoginError.classList.add('hidden');
  studentLoginSection.classList.remove('hidden');
  loginName.focus();
}

btnLogout.addEventListener('click', showLoginScreen);

async function enterApp() {
  loginScreen.classList.add('hidden');
  appContainer.classList.remove('hidden');

  await loadExamMode();

  const adminNavEl = document.getElementById('adminNav');

  // Show role-specific nav
  if (currentUser.role === 'admin') {
    teacherNav.classList.remove('hidden');
    studentNav.classList.add('hidden');
    if (adminNavEl) adminNavEl.classList.remove('hidden');
    userInfo.innerHTML = `<span class="user-role-badge admin">Admin</span> ${escapeHtml(currentUser.name)}`;
  } else if (currentUser.role === 'teacher') {
    teacherNav.classList.remove('hidden');
    studentNav.classList.add('hidden');
    if (adminNavEl) adminNavEl.classList.add('hidden');
    userInfo.innerHTML = `<span class="user-role-badge teacher">${t('role.teacher')}</span> ${escapeHtml(currentUser.name)}`;
  } else {
    teacherNav.classList.add('hidden');
    studentNav.classList.remove('hidden');
    if (adminNavEl) adminNavEl.classList.add('hidden');
    userInfo.innerHTML = `<span class="user-role-badge student">${t('role.student')}</span> ${escapeHtml(currentUser.name)}`;
  }

  // Setup nav buttons for current role
  setupNavigation();
  await loadTopics();

  // Navigate to default view
  if (currentUser.role === 'admin' || currentUser.role === 'teacher') {
    navigateToView('teacher-dashboard');
    if (currentUser.role === 'admin') loadAdminView();
  } else {
    navigateToView('student-topics');
  }
}


if (chkExamMode) {
  chkExamMode.addEventListener('change', async (e) => {
    const enabled = !!e.target.checked;
    const result = await appApi.setExamMode(enabled);
    examModeEnabled = !!(result && result.enabled);
    chkExamMode.checked = examModeEnabled;
    showToast(examModeEnabled ? '📝 Prüfungsmodus aktiviert' : '🧠 Lernmodus aktiviert', 'info');
  });
}

// ==================== NAVIGATION ====================

function setupNavigation() {
  const isTeacherLike = currentUser.role === 'teacher' || currentUser.role === 'admin';
  const navContainer = isTeacherLike ? teacherNav : studentNav;
  navContainer.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigateToView(btn.dataset.view);
    });
  });
  // Wire adminNav buttons for admin role
  if (currentUser.role === 'admin') {
    const adminNavEl = document.getElementById('adminNav');
    if (adminNavEl) {
      adminNavEl.querySelectorAll('.nav-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          navigateToView(btn.dataset.view);
        });
      });
    }
  }
}

function navigateToView(viewName) {
  views.forEach((v) => v.classList.remove('active'));
  const isTeacherLike = currentUser.role === 'teacher' || currentUser.role === 'admin';
  const navContainer = isTeacherLike ? teacherNav : studentNav;
  navContainer.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  // Also clear adminNav active state
  const adminNavEl = document.getElementById('adminNav');
  if (adminNavEl) adminNavEl.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.add('active');

  // Set active nav button in the right nav
  const targetBtn = navContainer.querySelector(`.nav-btn[data-view="${viewName}"]`)
    || (adminNavEl && adminNavEl.querySelector(`.nav-btn[data-view="${viewName}"]`));
  if (targetBtn) targetBtn.classList.add('active');

  // Refresh data for views
  if (viewName === 'teacher-dashboard') refreshTeacherDashboard();
  if (viewName === 'teacher-topics') refreshTopicsList();
  if (viewName === 'teacher-modules') refreshModulesList();
  if (viewName === 'teacher-results') refreshResults();
  if (viewName === 'student-topics') refreshStudentTopics();
  if (viewName === 'student-quiz') refreshQuizTopicSelect();
  if (viewName === 'admin-users') refreshAdminUsers();
  if (viewName === 'admin-classes') refreshAdminClasses();
  if (viewName === 'admin-settings') refreshAdminSettings();
}


window.appNavigate = navigateToView;

// ==================== TOAST ====================

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(60px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==================== DATA LOADING ====================

async function loadTopics() {
  topics = await appApi.getTopics();
}

async function loadExamMode() {
  const result = await appApi.getExamMode();
  examModeEnabled = !!(result && result.enabled);
  if (chkExamMode) chkExamMode.checked = examModeEnabled;
}

// ==================== TEACHER: DASHBOARD ====================

async function refreshTeacherDashboard() {
  await loadTopics();
  statTopics.textContent = topics.length;
  const totalModules = topics.reduce((sum, t) => sum + (t.modules || []).length, 0);
  statModules.textContent = totalModules;
  statActive.textContent = topics.filter((t) => t.selected).length;
  const results = await appApi.getQuizResults();
  statResults.textContent = results.length;
  initModuleDescriptionEditor();
  renderTypeGrid();
}

function renderTypeGrid() {
  typeGrid.innerHTML = '';
  const types = getH5pTypesArray();
  for (const t of types) {
    const card = document.createElement('div');
    card.className = 'type-card';
    card.innerHTML = `
      <div class="type-card-icon">${t.icon}</div>
      <div class="type-card-name">${t.name}</div>
      <div class="type-card-desc">${t.description}</div>
    `;
    typeGrid.appendChild(card);
  }
}

// ==================== TEACHER: TOPICS ====================

async function refreshTopicsList() {

  await loadTopics();
  topicsList.innerHTML = '';
  topicFormContainer.classList.add('hidden');

  // Select/Deselect All Checkboxen einfügen
  if (topics.length > 0) {
    const selectAllRow = document.createElement('div');
    selectAllRow.style.display = 'flex';
    selectAllRow.style.justifyContent = 'flex-end';
    selectAllRow.style.gap = '12px';
    selectAllRow.style.marginBottom = '10px';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'btn btn-secondary btn-sm';
    selectAllBtn.textContent = 'Alle auswählen';
    selectAllBtn.title = 'Alle Lernthemen aktivieren';

    const deselectAllBtn = document.createElement('button');
    deselectAllBtn.className = 'btn btn-secondary btn-sm';
    deselectAllBtn.textContent = 'Alle abwählen';
    deselectAllBtn.title = 'Alle Lernthemen deaktivieren';

    selectAllBtn.addEventListener('click', async () => {
      for (const topic of topics) {
        if (!topic.selected) {
          await appApi.toggleTopicSelection(topic.id, true);
        }
      }
      showToast('Alle Lernthemen aktiviert', 'info');
      refreshTopicsList();
    });

    deselectAllBtn.addEventListener('click', async () => {
      for (const topic of topics) {
        if (topic.selected) {
          await appApi.toggleTopicSelection(topic.id, false);
        }
      }
      showToast('Alle Lernthemen deaktiviert', 'info');
      refreshTopicsList();
    });

    selectAllRow.appendChild(selectAllBtn);
    selectAllRow.appendChild(deselectAllBtn);
    topicsList.appendChild(selectAllRow);
  }

  if (topics.length === 0) {
    topicsList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📂</span>
        <p>Noch keine Lernthemen erstellt.</p>
      </div>`;
    if (btnExportH5p) btnExportH5p.disabled = true;
    return;
  }

  for (const topic of topics) {
    const isRawTopic = topic.h5pImportMode === 'raw';
    const moduleCount = isRawTopic
      ? (topic.h5pRawSummary && topic.h5pRawSummary.itemCount) || 0
      : (topic.modules || []).length;
    const card = document.createElement('div');
    card.className = `topic-card ${topic.selected ? 'topic-active' : 'topic-inactive'}`;
    card.innerHTML = `
      <div class="topic-card-header">
        <div class="topic-card-info">
          <h3 class="topic-card-title">${escapeHtml(topic.title)}</h3>
          <p class="topic-card-desc">${escapeHtml(topic.description || '')}</p>
          <div class="topic-card-meta">
            <span class="topic-module-count">${moduleCount} Module</span>
            ${isRawTopic ? '<span class="topic-status" style="background:#eef2ff; color:#3730a3;">RAW H5P</span>' : ''}
            <span class="topic-status ${topic.selected ? 'active' : 'inactive'}">${topic.selected ? '✅ Aktiv' : '❌ Inaktiv'}</span>
            ${topic.ownerId && topic.ownerId !== (currentUser && currentUser.id)
              ? '<span class="topic-shared-badge">🔗 Geteilt</span>'
              : (Array.isArray(topic.sharedWith) && topic.sharedWith.length > 0 ? '<span class="topic-shared-badge owner">👥 Freigegeben</span>' : '')}
          </div>
        </div>
        <div class="topic-card-actions">
          <label class="toggle-switch" title="Für Schüler freigeben">
            <input type="checkbox" class="topic-toggle" data-topic-id="${topic.id}" ${topic.selected ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
          <button class="btn btn-primary btn-sm btn-open-topic" data-topic-id="${topic.id}" title="Module verwalten">📦 Module</button>
          <button class="btn btn-secondary btn-sm btn-edit-topic" data-topic-id="${topic.id}" title="Bearbeiten">✏️</button>
          <button class="btn btn-secondary btn-sm btn-share-topic" data-topic-id="${topic.id}" title="Mit Lehrern teilen">👥</button>
          <button class="btn btn-secondary btn-sm btn-export-topic" data-topic-id="${topic.id}" title="Als JSON exportieren">📤</button>
          <button class="btn btn-secondary btn-sm btn-export-h5p-topic" data-topic-id="${topic.id}" title="Als H5P exportieren">📦 H5P</button>
          <button class="btn btn-danger btn-sm btn-delete-topic" data-topic-id="${topic.id}" title="Löschen">🗑</button>
        </div>
      </div>
    `;

    // Share topic
    card.querySelector('.btn-share-topic').addEventListener('click', () => {
      openShareDialog(topic);
    });

    // Toggle activation
    card.querySelector('.topic-toggle').addEventListener('change', async (e) => {
      await appApi.toggleTopicSelection(topic.id, e.target.checked);
      showToast(e.target.checked ? t('topics.activated') : t('topics.deactivated'), 'info');
      refreshTopicsList();
    });

    // Open modules
    card.querySelector('.btn-open-topic').addEventListener('click', () => {
      openTopicModules(topic.id);
    });

    // Edit topic
    card.querySelector('.btn-edit-topic').addEventListener('click', () => {
      openTopicEditor(topic);
    });

    // Export topic (JSON)
    card.querySelector('.btn-export-topic').addEventListener('click', async () => {
      const result = await appApi.exportTopic(topic.id);
      if (result.success) showToast(t('topics.exported'), 'success');
    });

    // Export topic as H5P
    card.querySelector('.btn-export-h5p-topic').addEventListener('click', async () => {
      const result = await appApi.exportTopicAsH5p(topic.id);
      if (result.success) {
        showToast(`📦 H5P exportiert!`, 'success');
      } else if (result.error) {
        showToast('❌ H5P-Export fehlgeschlagen: ' + result.error, 'error');
      }
    });

    // Delete topic
    card.querySelector('.btn-delete-topic').addEventListener('click', async () => {
      if (!(await appConfirm(t('topics.delete.confirm', { title: topic.title })))) return;
      await appApi.deleteTopic(topic.id);
      showToast(t('topics.deleted'), 'info');
      refreshTopicsList();
    });

    topicsList.appendChild(card);
  }

  // Enable toolbar export button only when at least one non-RAW topic has an active module
  if (btnExportH5p) {
    btnExportH5p.disabled = !topics.some(
      (t) => t.h5pImportMode !== 'raw' && (t.modules || []).some((m) => m.moduleSelected !== false)
    );
  }
}

btnExportH5p.addEventListener('click', () => {
  const exportable = topics.filter(
    (t) => t.h5pImportMode !== 'raw' && (t.modules || []).some((m) => m.moduleSelected !== false)
  );
  if (exportable.length === 0) return;

  // If only one exportable topic, export directly without the picker
  if (exportable.length === 1) {
    appApi.exportTopicAsH5p(exportable[0].id).then((result) => {
      if (result.success) showToast('📦 H5P exportiert!', 'success');
      else if (result.error) showToast('❌ H5P-Export fehlgeschlagen: ' + result.error, 'error');
    });
    return;
  }

  // Multiple exportable topics → show picker overlay
  exportH5pTopicList.innerHTML = '';
  for (const topic of exportable) {
    const activeCount = (topic.modules || []).filter((m) => m.moduleSelected !== false).length;
    const item = document.createElement('div');
    item.className = 'import-module-item';
    item.style.justifyContent = 'space-between';
    item.innerHTML = `
      <div>
        <span class="import-module-title">📚 ${escapeHtml(topic.title)}</span>
        <span class="import-module-type">${activeCount} aktive Modul${activeCount !== 1 ? 'e' : ''}</span>
      </div>
      <button class="btn btn-primary btn-sm">📦 Exportieren</button>
    `;
    item.querySelector('button').addEventListener('click', async () => {
      exportH5pTopicOverlay.classList.add('hidden');
      const result = await appApi.exportTopicAsH5p(topic.id);
      if (result.success) showToast('📦 H5P exportiert!', 'success');
      else if (result.error) showToast('❌ H5P-Export fehlgeschlagen: ' + result.error, 'error');
    });
    exportH5pTopicList.appendChild(item);
  }
  exportH5pTopicOverlay.classList.remove('hidden');
});

exportH5pBtnCancel.addEventListener('click', () => {
  exportH5pTopicOverlay.classList.add('hidden');
});

function updateModulesToolbarForTopicMode() {
  const isRaw = !!currentTopicRawSummary;
  if (btnCreateModule) {
    btnCreateModule.disabled = isRaw;
    btnCreateModule.title = isRaw ? 'Bei RAW-H5P Projekten ist die Modulbearbeitung deaktiviert.' : '';
  }
  if (btnImportModules) {
    btnImportModules.disabled = isRaw;
    btnImportModules.title = isRaw ? 'Bei RAW-H5P Projekten ist der Modulimport deaktiviert.' : '';
  }
  if (btnExportModulesAsH5p) {
    btnExportModulesAsH5p.disabled = isRaw;
    btnExportModulesAsH5p.title = isRaw ? 'Bei RAW-H5P Projekten ist der einzelne H5P-Export deaktiviert.' : 'Alle aktiven Module als einzelne H5P-Dateien exportieren';
  }
  if (btnTransferModules) {
    btnTransferModules.disabled = isRaw;
    btnTransferModules.title = isRaw ? 'Bei RAW-H5P Projekten ist das Verschieben/Kopieren deaktiviert.' : 'Ausgewählte Module verschieben/kopieren';
  }
}

btnNewTopic.addEventListener('click', () => {
  editingTopicId = null;
  topicFormTitle.textContent = t('topics.form.new');
  topicTitleInput.value = '';
  topicDescInput.value = '';
  topicFormContainer.classList.remove('hidden');
});

btnImportTopic.addEventListener('click', async () => {
  const result = await appApi.importTopic();
  if (result.success) {
    showToast(t('topics.import.success', { title: result.topicTitle || 'Thema', count: result.importedCount }), 'success');
    refreshTopicsList();
  } else if (result.error) {
    showToast(t('topics.import.error') + result.error, 'error');
  }
});

btnImportH5p.addEventListener('click', async () => {
  const result = await appApi.importH5p({ importMode: 'native' });
  if (result.success) {
    showToast(`🎉 H5P "${result.topicTitle}" importiert — ${result.importedCount} Modul(e) angelegt!`, 'success');
    refreshTopicsList();
  } else if (result.error) {
    showToast('❌ H5P-Import fehlgeschlagen: ' + result.error, 'error');
  }
});

btnCancelTopic.addEventListener('click', () => {
  topicFormContainer.classList.add('hidden');
  editingTopicId = null;
});

topicForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = topicTitleInput.value.trim();
  if (!title) return;

  const topicData = {
    id: editingTopicId || ('topic_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6)),
    title,
    description: topicDescInput.value.trim(),
    selected: editingTopicId ? (topics.find((t) => t.id === editingTopicId) || {}).selected || false : false,
    createdAt: editingTopicId ? (topics.find((t) => t.id === editingTopicId) || {}).createdAt || new Date().toISOString() : new Date().toISOString(),
  };

  await appApi.saveTopic(topicData);
  showToast(editingTopicId ? t('topics.updated') : t('topics.created'), 'success');
  topicFormContainer.classList.add('hidden');
  editingTopicId = null;
  refreshTopicsList();
});

function openTopicEditor(topic) {
  editingTopicId = topic.id;
  topicFormTitle.textContent = t('topics.form.edit');
  topicTitleInput.value = topic.title;
  topicDescInput.value = topic.description || '';
  topicFormContainer.classList.remove('hidden');
}

// ==================== TEACHER: MODULES ====================

function openTopicModules(topicId) {
  currentTopicId = topicId;
  const topic = topics.find((t) => t.id === topicId);
  if (!topic) return;
  currentTopicRawSummary = topic.h5pImportMode === 'raw' ? (topic.h5pRawSummary || null) : null;
  currentTopicName.textContent = topic.title;
  modulesViewTitle.textContent = t('modules.in', { title: topic.title });
  updateModulesToolbarForTopicMode();
  navigateToView('teacher-modules');
}

backToTopics.addEventListener('click', () => {
  currentTopicId = null;
  currentTopicRawSummary = null;
  updateModulesToolbarForTopicMode();
  navigateToView('teacher-topics');
});

async function refreshModulesList() {
  if (!currentTopicId) {
    modulesList.innerHTML = '<div class="empty-state"><span class="empty-icon">📂</span><p>Bitte wählen Sie zuerst ein Lernthema.</p></div>';
    return;
  }

  const topic = topics.find((t) => t.id === currentTopicId);
  const rawSummary = topic && topic.h5pImportMode === 'raw' ? (topic.h5pRawSummary || currentTopicRawSummary) : null;
  currentTopicRawSummary = rawSummary || null;
  updateModulesToolbarForTopicMode();

  if (rawSummary) {
    const search = searchModules.value.toLowerCase().trim();
    let items = Array.isArray(rawSummary.items) ? rawSummary.items : [];
    if (search) {
      items = items.filter((item) =>
        (item.title || '').toLowerCase().includes(search) ||
        (item.library || '').toLowerCase().includes(search)
      );
    }

    modulesList.innerHTML = '';
    const info = document.createElement('div');
    info.className = 'empty-state';
    info.style.marginBottom = '12px';
    info.innerHTML = `<span class="empty-icon">📦</span><p>RAW-H5P-Projekt: Inhalt wird read-only angezeigt. Für bearbeitbare Module bitte als „native Module“ importieren.</p>`;
    modulesList.appendChild(info);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = `<span class="empty-icon">🔍</span><p>Keine Inhalte gefunden.</p>`;
      modulesList.appendChild(empty);
      return;
    }

    items.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'module-card module-card-disabled';
      card.innerHTML = `
        <div class="module-card-icon">📄</div>
        <div class="module-card-info">
          <div class="module-card-title">${escapeHtml(item.title || `Inhalt ${idx + 1}`)}</div>
          <div class="module-card-meta">
            <span class="module-card-type">${escapeHtml((item.library || '').split(' ')[0] || rawSummary.mainLibrary || 'H5P')}</span>
          </div>
        </div>
        <div class="module-card-actions">
          <button class="btn btn-secondary btn-sm" disabled title="RAW-Inhalte sind in dieser Ansicht nicht einzeln editierbar">Nur Anzeige</button>
        </div>
      `;
      modulesList.appendChild(card);
    });
    return;
  }

  currentTopicModules = await appApi.getTopicModules(currentTopicId);

  const search = searchModules.value.toLowerCase().trim();
  const typeFilter = filterType.value;

  let filtered = currentTopicModules;
  if (search) {
    filtered = filtered.filter(
      (m) =>
        m.title.toLowerCase().includes(search) ||
        (m.description && m.description.toLowerCase().includes(search))
    );
  }
  if (typeFilter) {
    filtered = filtered.filter((m) => m.type === typeFilter);
  }

  modulesList.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = currentTopicModules.length === 0
      ? `<span class="empty-icon">📭</span><p>Noch keine Module in diesem Thema.</p>`
      : `<span class="empty-icon">🔍</span><p>Keine Module gefunden.</p>`;
    modulesList.appendChild(empty);
    return;
  }

  // Select/Deselect All Buttons einfügen
  if (filtered.length > 0) {
    const selectAllRow = document.createElement('div');
    selectAllRow.style.display = 'flex';
    selectAllRow.style.justifyContent = 'flex-end';
    selectAllRow.style.gap = '12px';
    selectAllRow.style.marginBottom = '10px';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'btn btn-secondary btn-sm';
    selectAllBtn.textContent = 'Alle auswählen';
    selectAllBtn.title = 'Alle Module aktivieren';

    const deselectAllBtn = document.createElement('button');
    deselectAllBtn.className = 'btn btn-secondary btn-sm';
    deselectAllBtn.textContent = 'Alle abwählen';
    deselectAllBtn.title = 'Alle Module deaktivieren';

    selectAllBtn.addEventListener('click', async () => {
      const moduleIds = filtered.map(m => m.id);
      await appApi.bulkToggleModules(currentTopicId, moduleIds, true);
      showToast('Alle Module aktiviert', 'info');
      refreshModulesList();
    });

    deselectAllBtn.addEventListener('click', async () => {
      const moduleIds = filtered.map(m => m.id);
      await appApi.bulkToggleModules(currentTopicId, moduleIds, false);
      showToast('Alle Module deaktiviert', 'info');
      refreshModulesList();
    });

    selectAllRow.appendChild(selectAllBtn);
    selectAllRow.appendChild(deselectAllBtn);
    modulesList.appendChild(selectAllRow);
  }

  // Enable drag reorder only when no search/filter is active
  const canReorder = !search && !typeFilter;
  let dragSrcCard = null;

  for (let fi = 0; fi < filtered.length; fi++) {
    const mod = filtered[fi];
    const typeDef = H5P_TYPES[mod.type] || {};
    const isSelected = mod.moduleSelected !== false;
    const card = document.createElement('div');
    card.className = `module-card ${isSelected ? '' : 'module-card-disabled'}`;
    card.dataset.moduleId = mod.id;
    card.innerHTML = `
      ${canReorder ? '<div class="module-drag-handle" title="Reihenfolge ändern">☰</div>' : ''}
      <span class="module-card-number">${fi + 1}.</span>
      <input type="checkbox" class="module-select-checkbox" title="Modul für Schüler aktivieren" ${isSelected ? 'checked' : ''} />
      <div class="module-card-icon">${typeDef.icon || '📦'}</div>
      <div class="module-card-info">
        <div class="module-card-title">${escapeHtml(mod.title)}</div>
        <div class="module-card-meta">
          <span class="module-card-type">${typeDef.name || mod.type}</span>
          ${mod.createdAt ? new Date(mod.createdAt).toLocaleDateString('de-DE') : ''}
        </div>
      </div>
      <div class="module-card-actions">
        <button class="btn btn-secondary btn-sm btn-preview" title="Vorschau">▶ Vorschau</button>
        <button class="btn btn-secondary btn-sm btn-edit" title="Bearbeiten">✏️ Bearbeiten</button>
        <button class="btn btn-danger btn-sm btn-delete" title="Löschen">🗑</button>
      </div>
    `;

    // --- Drag-and-Drop reordering ---
    if (canReorder) {
      const handle = card.querySelector('.module-drag-handle');
      handle.addEventListener('mousedown', () => { card.draggable = true; });
      card.addEventListener('dragstart', (e) => {
        dragSrcCard = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', mod.id);
      });
      card.addEventListener('dragend', () => {
        card.draggable = false;
        card.classList.remove('dragging');
        dragSrcCard = null;
        modulesList.querySelectorAll('.module-card').forEach((c) => c.classList.remove('drag-over'));
      });
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragSrcCard && dragSrcCard !== card) {
          modulesList.querySelectorAll('.module-card').forEach((c) => c.classList.remove('drag-over'));
          card.classList.add('drag-over');
        }
      });
      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });
      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        if (!dragSrcCard || dragSrcCard === card) return;
        // Move the dragged card before or after the drop target
        const cards = [...modulesList.querySelectorAll('.module-card')];
        const srcIdx = cards.indexOf(dragSrcCard);
        const dstIdx = cards.indexOf(card);
        if (srcIdx < dstIdx) {
          card.after(dragSrcCard);
        } else {
          card.before(dragSrcCard);
        }
        // Update numbering
        modulesList.querySelectorAll('.module-card .module-card-number').forEach((el, i) => { el.textContent = `${i + 1}.`; });
        // Persist new order
        const newOrder = [...modulesList.querySelectorAll('.module-card[data-module-id]')].map((c) => c.dataset.moduleId);
        await appApi.reorderModules(currentTopicId, newOrder);
      });
    }

    card.querySelector('.module-select-checkbox').addEventListener('change', async (e) => {
      await appApi.toggleModuleSelection(currentTopicId, mod.id, e.target.checked);
      mod.moduleSelected = e.target.checked;
      card.classList.toggle('module-card-disabled', !e.target.checked);
    });
    card.querySelector('.btn-preview').addEventListener('click', () => openPlayer(mod));
    card.querySelector('.btn-edit').addEventListener('click', () => openModuleEditor(mod));
    card.querySelector('.btn-delete').addEventListener('click', () => deleteModule(mod));
    modulesList.appendChild(card);
  }
}

searchModules.addEventListener('input', refreshModulesList);
filterType.addEventListener('change', refreshModulesList);

btnCreateModule.addEventListener('click', () => {
  resetModuleForm();
  navigateToView('create-module');
});

btnExportCurrentTopic.addEventListener('click', async () => {
  if (!currentTopicId) return;
  const result = await appApi.exportTopic(currentTopicId);
  if (result.success) showToast(t('topics.exported'), 'success');
});

btnExportModulesAsH5p.addEventListener('click', async () => {
  if (!currentTopicId) return;
  const result = await appApi.exportSelectedModulesAsH5p(currentTopicId);
  if (result.success) {
    const msg = result.exported === result.total
      ? `📦 ${result.exported} Modul(e) als H5P exportiert!`
      : `📦 ${result.exported} von ${result.total} Modul(en) exportiert.`;
    showToast(result.errors && result.errors.length > 0 ? msg + ` (${result.errors.length} Fehler)` : msg, 'success');
  } else if (result.error) {
    showToast('❌ H5P-Export fehlgeschlagen: ' + result.error, 'error');
  }
});

// --- Import Modules ---
let pendingImportModules = []; // full module objects from file

btnImportModules.addEventListener('click', async () => {
  if (!currentTopicId) return;
  const result = await appApi.importModulesToTopic(currentTopicId);
  if (!result || !result.success) return;

  showToast(`${result.importedCount} Modul(e) importiert.`, 'success');
  await loadTopicModules(currentTopicId);
});

importModulesBtnCancel.addEventListener('click', () => {
  importModulesOverlay.classList.add('hidden');
  pendingImportModules = [];
});

importModulesBtnOk.addEventListener('click', async () => {
  const checked = importModulesList.querySelectorAll('input[type=checkbox]:checked');
  const selectedIds = new Set([...checked].map((cb) => cb.dataset.modId));
  const selectedModules = pendingImportModules.filter((m) => selectedIds.has(m.id));

  if (selectedModules.length === 0) {
    showToast('Keine Module ausgewählt.', 'error');
    return;
  }

  const result = await appApi.confirmImportModules(currentTopicId, selectedModules);
  importModulesOverlay.classList.add('hidden');
  pendingImportModules = [];

  if (result && result.success) {
    showToast(`${selectedModules.length} Modul(e) importiert.`, 'success');
    await loadTopicModules(currentTopicId);
  } else {
    showToast('Import fehlgeschlagen.', 'error');
  }
});

// --- Transfer Modules ---
let transferSelectedModuleIds = [];
let transferTargetTopicId = null;

btnTransferModules.addEventListener('click', () => {
  if (!currentTopicId) return;

  transferSelectedModuleIds = currentTopicModules
    .filter((m) => m.moduleSelected !== false)
    .map((m) => m.id);

  if (transferSelectedModuleIds.length === 0) {
    showToast('Keine Module ausgewählt. Bitte aktiviere Module in der Übersicht, um sie zu übertragen.', 'error');
    return;
  }

  const availableTopics = topics.filter((t) => t.id !== currentTopicId);
  transferTopicList.innerHTML = '';
  transferTargetTopicId = null;
  transferModulesBtnMove.disabled = true;
  transferModulesBtnCopy.disabled = true;

  if (availableTopics.length === 0) {
    transferTopicList.innerHTML = '<div class="empty-state"><p>Keine anderen Lernthemen verfügbar.</p></div>';
  } else {
    for (const t of availableTopics) {
      const item = document.createElement('div');
      item.className = 'import-module-item';
      item.style.cursor = 'pointer';
      item.innerHTML = `
        <input type="radio" name="transferTarget" value="${t.id}" id="transfer_tgt_${t.id}" style="cursor:pointer;" />
        <label for="transfer_tgt_${t.id}" style="cursor:pointer; flex: 1; padding-left: 10px;">
          <span class="import-module-title">📚 ${escapeHtml(t.title)}</span>
        </label>
      `;
      item.addEventListener('click', () => {
        item.querySelector('input').checked = true;
        transferTargetTopicId = t.id;
        transferModulesBtnMove.disabled = false;
        transferModulesBtnCopy.disabled = false;
      });
      const radio = item.querySelector('input');
      radio.addEventListener('change', () => {
        if (radio.checked) {
          transferTargetTopicId = t.id;
          transferModulesBtnMove.disabled = false;
          transferModulesBtnCopy.disabled = false;
        }
      });
      transferTopicList.appendChild(item);
    }
  }
  
  transferModulesHint.textContent = `${transferSelectedModuleIds.length} Modul(e) ausgewählt. Wähle das Ziel-Thema aus:`;
  transferModulesOverlay.classList.remove('hidden');
});

transferModulesBtnCancel.addEventListener('click', () => {
  transferModulesOverlay.classList.add('hidden');
});

async function handleTransfer(mode) {
  if (!transferTargetTopicId || transferSelectedModuleIds.length === 0) return;
  
  const result = await appApi.transferModules(currentTopicId, transferTargetTopicId, transferSelectedModuleIds, mode);
  
  if (result && result.success) {
    showToast(`${result.count} Modul(e) erfolgreich ${mode === 'move' ? 'verschoben' : 'kopiert'}.`, 'success');
  } else {
    showToast('Ein Fehler ist aufgetreten: ' + (result?.error || 'Unbekannt'), 'error');
  }
  
  transferModulesOverlay.classList.add('hidden');
  
  // Refresh current topic and global topics list
  topics = await appApi.getTopics();
  refreshTopicsList();
  currentTopicModules = await appApi.getTopicModules(currentTopicId);
  refreshModulesList();
}

transferModulesBtnMove.addEventListener('click', () => handleTransfer('move'));
transferModulesBtnCopy.addEventListener('click', () => handleTransfer('copy'));

// ==================== MODULE FORM ====================

function populateTypeSelects() {
  const types = getH5pTypesArray();

  moduleTypeSelect.innerHTML = '<option value="">— Modultyp wählen —</option>';
  for (const t of types) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.icon} ${t.name}`;
    moduleTypeSelect.appendChild(opt);
  }

  filterType.innerHTML = '<option value="">Alle Typen</option>';
  for (const t of types) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.icon} ${t.name}`;
    filterType.appendChild(opt);
  }
}

moduleTypeSelect.addEventListener('change', () => {
  const typeId = moduleTypeSelect.value;
  if (typeId && H5P_TYPES[typeId]) {
    const existingData = editingModuleId
      ? (currentTopicModules.find((m) => m.id === editingModuleId) || {}).content || {}
      : {};
    contentEditor.render(typeId, existingData);
  } else {
    contentEditor.clear();
  }
});

moduleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentTopicId) {
    showToast(t('module.missing.topic'), 'error');
    return;
  }

  const title = moduleTitleInput.value.trim();
  const type = moduleTypeSelect.value;
  const description = getModuleDescriptionHtml().trim();

  if (!title || !type) {
    showToast(t('module.missing.fields'), 'error');
    return;
  }

  const content = contentEditor.collectData();

  const existingModule = editingModuleId
    ? currentTopicModules.find((m) => m.id === editingModuleId)
    : null;

  const moduleData = {
    id: editingModuleId || generateId(),
    title,
    type,
    description,
    content,
    moduleSelected: existingModule ? existingModule.moduleSelected : true,
    createdAt: existingModule
      ? existingModule.createdAt || new Date().toISOString()
      : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const result = await appApi.saveModule(currentTopicId, moduleData);
  if (result.success) {
    showToast(editingModuleId ? t('module.updated') : t('module.saved'), 'success');
    currentTopicModules = await appApi.getTopicModules(currentTopicId);
    resetModuleForm();
    navigateToView('teacher-modules');
  } else {
    showToast(t('module.save.error'), 'error');
  }
});

btnCancelModule.addEventListener('click', () => {
  resetModuleForm();
  navigateToView('teacher-modules');
});

function resetModuleForm() {
  editingModuleId = null;
  moduleIdInput.value = '';
  moduleTitleInput.value = '';
  moduleTypeSelect.value = '';
  setModuleDescriptionHtml('');
  contentEditor.clear();
  createViewTitle.textContent = t('module.create.title');
}

function openModuleEditor(mod) {
  editingModuleId = mod.id;
  createViewTitle.textContent = t('module.edit.title');
  moduleIdInput.value = mod.id;
  moduleTitleInput.value = mod.title;
  moduleTypeSelect.value = mod.type;
  setModuleDescriptionHtml(mod.description || '');
  navigateToView('create-module');
  contentEditor.render(mod.type, mod.content || {});
}

async function deleteModule(mod) {
  if (!(await appConfirm(t('modules.delete.confirm', { title: mod.title })))) return;
  const result = await appApi.deleteModule(currentTopicId, mod.id);
  if (result.success) {
    showToast(t('modules.deleted'), 'info');
    currentTopicModules = await appApi.getTopicModules(currentTopicId);
    refreshModulesList();
  }
}

// ==================== H5P PLAYER (Preview) ====================

function openPlayer(mod) {
  const typeDef = H5P_TYPES[mod.type] || {};
  playerTitle.textContent = mod.title;
  navigateToView('player');
  h5pContainer.innerHTML = '';
  renderH5pPreview(mod, typeDef, h5pContainer);
}

btnBackFromPlayer.addEventListener('click', () => {
  h5pContainer.innerHTML = '';
  if (currentUser.role === 'teacher') {
    navigateToView('teacher-modules');
  } else {
    navigateToView('student-quiz');
  }
});

// ==================== TEACHER: RESULTS ====================

async function refreshResults() {
  const results = await appApi.getQuizResults();
  const search = searchResults.value.toLowerCase().trim();

  let filtered = results;
  if (search) {
    filtered = filtered.filter((r) => r.username.toLowerCase().includes(search));
  }

  // Stats
  const uniqueStudents = new Set(results.map((r) => r.username)).size;
  const avgScore = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + (r.percentage || 0), 0) / results.length)
    : 0;

  resultsStats.innerHTML = `
    <div class="stats-grid" style="margin-bottom:20px;">
      <div class="stat-card">
        <div class="stat-number">${results.length}</div>
        <div class="stat-label">Quiz-Durchläufe</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${uniqueStudents}</div>
        <div class="stat-label">Verschiedene Schüler</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${avgScore}%</div>
        <div class="stat-label">Ø Erfolgsquote</div>
      </div>
    </div>
  `;

  resultsList.innerHTML = '';
  if (filtered.length === 0) {
    resultsList.innerHTML = '<div class="empty-state"><span class="empty-icon">📊</span><p>Noch keine Ergebnisse vorhanden.</p></div>';
    return;
  }

  for (const r of filtered) {
    const card = document.createElement('div');
    card.className = 'result-card';
    const pctClass = r.percentage >= 70 ? 'good' : r.percentage >= 40 ? 'medium' : 'poor';
    card.innerHTML = `
      <div class="result-card-header">
        <div class="result-card-info">
          <strong>${escapeHtml(r.username)}</strong>
          <span style="font-size: 0.85em; color: var(--text-secondary); margin-left: 5px;">
            ${r.systemUsername ? `[${escapeHtml(r.systemUsername)}]` : ''} ${r.ipAddress ? `(${escapeHtml(r.ipAddress)})` : ''}
          </span>
          <br>
          <span class="result-topic-name">${escapeHtml(r.topicTitle || '—')}</span>
          <span class="result-date">${new Date(r.timestamp).toLocaleString('de-DE')}</span>
        </div>
        <div class="result-score ${pctClass}">
          ${r.score}/${r.totalQuestions} (${r.percentage}%)
        </div>
        <button class="btn btn-danger btn-sm btn-delete-result" data-result-id="${r.id}">🗑</button>
      </div>
      ${r.details && r.details.length > 0 ? `
        <details class="result-details">
          <summary>Details anzeigen</summary>
          <div class="result-detail-list">
            ${r.details.map((d) => `
              <div class="result-detail-item ${d.isCorrect ? 'correct' : 'wrong'}">
                <span class="result-detail-icon">${d.isCorrect ? '✅' : '❌'}</span>
                <div>
                  <strong>${escapeHtml(d.moduleName || d.moduleTitle || '')}</strong>
                  ${d.userAnswer !== undefined ? `<br>Antwort: ${escapeHtml(String(d.userAnswer))}` : ''}
                  ${d.score ? `<br>Auswertung: ${escapeHtml(String(d.score))}` : ''}
                  ${d.correctAnswer !== undefined ? `<br>Korrekt: ${escapeHtml(String(d.correctAnswer))}` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </details>` : ''}
    `;

    card.querySelector('.btn-delete-result').addEventListener('click', async () => {
      await appApi.deleteQuizResult(r.id);
      showToast(t('results.deleted'), 'info');
      refreshResults();
    });

    resultsList.appendChild(card);
  }
}

searchResults.addEventListener('input', refreshResults);

btnDeleteAllResults.addEventListener('click', async () => {
  if (!(await appConfirm(t('results.delete.all.confirm')))) return;
  await appApi.deleteAllQuizResults();
  showToast(t('results.all.deleted'), 'info');
  refreshResults();
});

// ==================== STUDENT: TOPIC SELECTION ====================

async function refreshStudentTopics() {
  const availableTopics = await appApi.getSelectedTopics();
  const mySelections = await appApi.getStudentSelections(currentUser.name);

  studentTopicsList.innerHTML = '';

  if (availableTopics.length === 0) {
    studentTopicsList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📂</span>
        <p>Noch keine Lernthemen vom Lehrer freigegeben.</p>
      </div>`;
    return;
  }

  for (const topic of availableTopics) {
    const isSelected = mySelections.includes(topic.id);
    const moduleCount = (topic.modules || []).filter(m => m.moduleSelected !== false).length;
    const card = document.createElement('div');
    card.className = `topic-card student-topic-card ${isSelected ? 'topic-selected' : ''}`;
    card.innerHTML = `
      <div class="topic-card-header">
        <div class="topic-card-info">
          <h3 class="topic-card-title">${escapeHtml(topic.title)}</h3>
          <p class="topic-card-desc">${escapeHtml(topic.description || '')}</p>
          <div class="topic-card-meta">
            <span class="topic-module-count">${moduleCount} Module</span>
          </div>
        </div>
        <div class="topic-card-actions">
          <label class="toggle-switch" title="Thema auswählen">
            <input type="checkbox" class="student-topic-toggle" data-topic-id="${topic.id}" ${isSelected ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `;

    card.querySelector('.student-topic-toggle').addEventListener('change', async (e) => {
      let selections = await appApi.getStudentSelections(currentUser.name);
      if (e.target.checked) {
        if (!selections.includes(topic.id)) selections.push(topic.id);
      } else {
        selections = selections.filter((id) => id !== topic.id);
      }
      await appApi.saveStudentSelections(currentUser.name, selections);
      showToast(e.target.checked ? t('student.topics.selected') : t('student.topics.deselected'), 'info');
      refreshStudentTopics();
    });

    studentTopicsList.appendChild(card);
  }
}

// ==================== STUDENT: QUIZ MODE ====================

async function refreshQuizTopicSelect() {
  const mySelections = await appApi.getStudentSelections(currentUser.name);
  const availableTopics = await appApi.getSelectedTopics();
  const myTopics = availableTopics.filter((t) => mySelections.includes(t.id));

  quizTopicSelect.innerHTML = '';
  quizTopicSelect.classList.remove('hidden');
  quizPlayerArea.classList.add('hidden');
  quizResultArea.classList.add('hidden');

  if (myTopics.length === 0) {
    quizTopicSelect.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🧠</span>
        <p>Du hast noch keine Themen ausgewählt. Gehe zu "Lernthemen" und wähle Themen aus.</p>
      </div>`;
    return;
  }

  for (const topic of myTopics) {
    const moduleCount = (topic.modules || []).filter(m => m.moduleSelected !== false).length;
    if (moduleCount === 0) continue;

    const card = document.createElement('div');
    card.className = 'quiz-topic-card';
    card.innerHTML = `
      <div class="quiz-topic-card-info">
        <h3>${escapeHtml(topic.title)}</h3>
        <p>${moduleCount} Module</p>
      </div>
      <button class="btn btn-primary">🧠 Quiz starten</button>
    `;

    card.querySelector('.btn').addEventListener('click', () => {
      startQuiz(topic);
    });

    quizTopicSelect.appendChild(card);
  }
}

async function startQuiz(topic) {
  const modules = (topic.modules || []).filter(m => m.moduleSelected !== false);
  if (modules.length === 0) {
    showToast(t('quiz.no.modules'), 'error');
    return;
  }

  // Refresh exam mode so browser students get the latest teacher setting
  await loadExamMode();

  quizState = {
    topicId: topic.id,
    topicTitle: topic.title,
    modules: modules,
    currentIndex: 0,
    answers: [],
    startTime: Date.now(),
  };

  quizTopicSelect.classList.add('hidden');
  quizPlayerArea.classList.remove('hidden');
  quizResultArea.classList.add('hidden');
  quizSubtitle.textContent = `${t('quiz.title')}: ${topic.title}`;

  renderQuizModule();
}

function renderQuizModule() {
  if (!quizState) return;

  const { modules, currentIndex } = quizState;
  const mod = modules[currentIndex];
  const typeDef = H5P_TYPES[mod.type] || {};

  // Progress
  const progress = ((currentIndex) / modules.length) * 100;
  quizProgressFill.style.width = `${progress}%`;
  quizInfo.innerHTML = `<strong>${t('quiz.module.of', { current: currentIndex + 1, total: modules.length })}</strong> ${escapeHtml(mod.title)} <span class="quiz-type-badge">${typeDef.icon || ''} ${typeDef.name || mod.type}</span>`;

  // Render module in quiz container
  quizModuleContainer.innerHTML = '';
  renderH5pPreview(mod, typeDef, quizModuleContainer, {
    quizMode: true,
    examMode: examModeEnabled && currentUser && currentUser.role === 'student',
  });

  // Button text
  btnQuizNext.textContent = currentIndex < modules.length - 1 ? t('quiz.next') : t('quiz.finish');
  
  if (btnQuizPrev) {
    const isExam = examModeEnabled && currentUser && currentUser.role === 'student';
    btnQuizPrev.style.display = (!isExam && currentIndex > 0) ? 'inline-block' : 'none';
    btnQuizPrev.textContent = t('quiz.prev');
  }
}

if (btnQuizPrev) {
  btnQuizPrev.addEventListener('click', () => {
    if (!quizState || quizState.currentIndex <= 0) return;
    
    // Auto-save the current state before going back (optional, but good so they don't lose progress if they go back)
    const mod = quizState.modules[quizState.currentIndex];
    quizState.answers[quizState.currentIndex] = collectQuizAnswer(mod);
    
    quizState.currentIndex--;
    renderQuizModule();
  });
}

btnQuizNext.addEventListener('click', () => {
  if (!quizState) return;

  // Collect answer for current module
  const mod = quizState.modules[quizState.currentIndex];
  const answer = collectQuizAnswer(mod);
  quizState.answers[quizState.currentIndex] = answer;

  quizState.currentIndex++;

  if (quizState.currentIndex >= quizState.modules.length) {
    finishQuiz();
  } else {
    renderQuizModule();
  }
});

btnQuizCancel.addEventListener('click', async () => {
  if (!(await appConfirm(t('quiz.cancel.confirm')))) return;
  quizState = null;
  quizPlayerArea.classList.add('hidden');
  quizModuleContainer.innerHTML = '';
  quizTopicSelect.classList.remove('hidden');
  quizSubtitle.textContent = t('quiz.subtitle');
});

function collectQuizAnswer(mod) {
  const content = mod.content || {};
  const result = {
    moduleId: mod.id,
    moduleTitle: mod.title,
    moduleType: mod.type,
    isCorrect: false,
    userAnswer: '',
    correctAnswer: '',
  };

  switch (mod.type) {
    case 'multipleChoice': {
      const inputs = quizModuleContainer.querySelectorAll('input[name="mc-answer"]');
      const selected = [];
      const correctList = [];
      let correctDecisions = 0;
      let totalDecisions = 0;
      inputs.forEach((inp, i) => {
        if (inp.checked) selected.push(i);
        if (inp.dataset.correct === 'true') correctList.push(i);
        const isCorrect = inp.dataset.correct === 'true';
        if (inp.checked === isCorrect) correctDecisions++;
        totalDecisions++;
      });
      result.userAnswer = selected.map((i) => (content.answers || [])[i]?.text || i).join(', ');
      result.correctAnswer = correctList.map((i) => (content.answers || [])[i]?.text || i).join(', ');
      result.isCorrect = totalDecisions > 0 && correctDecisions === totalDecisions;
      if (totalDecisions > 0) {
        const correctPct = Math.round((correctDecisions / totalDecisions) * 100);
        const wrongPct = 100 - correctPct;
        result.score = `Richtig: ${correctPct}% | Falsch: ${wrongPct}%`;
      }
      break;
    }
    case 'trueFalse': {
      const tfQs = content.questions || [content];
      let tfCorrectCount = 0;
      const tfUserAnswers = [];
      const tfCorrectAnswers = [];
      tfQs.forEach((q) => {
        const isCorrect = q._userAnswer === q.correctAnswer;
        if (isCorrect) tfCorrectCount++;
        tfUserAnswers.push(q._userAnswer === 'true' ? 'Wahr' : (q._userAnswer === 'false' ? 'Falsch' : '—'));
        tfCorrectAnswers.push(q.correctAnswer === 'true' ? 'Wahr' : 'Falsch');
      });
      result.isCorrect = tfCorrectCount === tfQs.length;
      result.userAnswer = tfUserAnswers.join(', ');
      result.correctAnswer = tfCorrectAnswers.join(', ');
      if (tfQs.length > 0) {
        const correctPct = Math.round((tfCorrectCount / tfQs.length) * 100);
        const wrongPct = 100 - correctPct;
        result.score = `Richtig: ${correctPct}% | Falsch: ${wrongPct}%`;
      }
      break;
    }
    case 'fillInTheBlanks': {
      const inputs = quizModuleContainer.querySelectorAll('input[data-answer]');
      let correct = 0;
      const answers = [];
      inputs.forEach((inp) => {
        const expected = inp.dataset.answer;
        const given = inp.value.trim();
        const caseSensitive = content.caseSensitive;
        const alternatives = expected.split('/').map(a => a.trim()).filter(Boolean);
        const match = alternatives.some(alt => caseSensitive ? given === alt : given.toLowerCase() === alt.toLowerCase());
        if (match) correct++;
        answers.push(given);
      });
      result.userAnswer = answers.join(', ');
      result.correctAnswer = Array.from(inputs).map((i) => i.dataset.answer.split('/')[0].trim()).join(', ');
      result.isCorrect = correct === inputs.length && inputs.length > 0;
      break;
    }
    case 'essay': {
      const textarea = quizModuleContainer.querySelector('#essayAnswer');
      const text = textarea ? textarea.value.trim() : '';
      const minChars = Number(content.minChars) || 0;
      result.userAnswer = text || '—';
      result.correctAnswer = content.sampleSolution || 'Freitextantwort';
      result.isCorrect = minChars <= 0 ? text.length > 0 : text.length >= minChars;
      result.score = `${text.length} Zeichen`;
      break;
    }
    case 'arithmeticQuiz': {
      const resultEl = quizModuleContainer.querySelector('.quiz-area h3');
      if (resultEl) {
        const match = resultEl.textContent.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
          result.userAnswer = `${match[1]}/${match[2]}`;
          result.correctAnswer = `${match[2]}/${match[2]}`;
          result.isCorrect = match[1] === match[2];
        }
      }
      break;
    }
    case 'markTheWords': {
      const spans = quizModuleContainer.querySelectorAll('#wordsArea span');
      let correct = 0;
      let total = 0;
      const userSelected = [];
      const correctWords = [];
      spans.forEach((s) => {
        const isCorrectTarget = s.dataset.correct === 'true';
        const isSelected = s.classList.contains('selected');
        if (isCorrectTarget) {
            total++;
            correctWords.push(s.textContent);
        }
        if (isSelected) {
            userSelected.push(s.textContent);
            if (isCorrectTarget) correct++;
        }
      });
      result.userAnswer = userSelected.length ? userSelected.join(', ') : 'Keine markiert';
      result.correctAnswer = correctWords.join(', ');
      result.isCorrect = correct === total && total > 0;
      break;
    }
    case 'dragTheWords': {
      const zones = quizModuleContainer.querySelectorAll('.dtw-drop-zone');
      let correct = 0;
      const total = zones.length;
      const userAnswers = [];
      const correctAnswers = [];
      zones.forEach((z) => {
        const current = (z.dataset.currentWord || '').trim();
        const expected = z.dataset.correctWord;
        const isCorrect = current.toLowerCase() === expected.toLowerCase();
        if (isCorrect) correct++;
        userAnswers.push(`${current || '(leer)'}`);
        correctAnswers.push(`${expected}`);
      });
      const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
      result.userAnswer = userAnswers.join(', ');
      result.correctAnswer = correctAnswers.join(', ');
      result.percent = percent;
      result.isCorrect = correct === total && total > 0;
      break;
    }
    case 'dictation': {
      const inputs = quizModuleContainer.querySelectorAll('.dict-input');
      let correct = 0;
      inputs.forEach((inp) => {
        if (inp.value.trim().toLowerCase() === inp.dataset.answer.toLowerCase()) correct++;
      });
      result.userAnswer = `${correct}/${inputs.length}`;
      result.correctAnswer = `${inputs.length}/${inputs.length}`;
      result.isCorrect = correct === inputs.length && inputs.length > 0;
      break;
    }
    case 'dragAndDrop': {
      const draggablesDef = content.draggables || [];
      const zonesDef = content.dropZones || [];
      
      const expectedMappings = [];
      draggablesDef.forEach(d => { 
        if (d.correctZone && !expectedMappings.find(m => m.zone === d.correctZone && m.text === d.text)) {
          expectedMappings.push({ zone: d.correctZone, text: d.text });
        }
      });
      zonesDef.forEach(z => { 
        if (z.correctDraggable && !expectedMappings.find(m => m.zone === z.label && m.text === z.correctDraggable)) {
          expectedMappings.push({ zone: z.label, text: z.correctDraggable });
        }
      });

      const dragEls = quizModuleContainer.querySelectorAll('.dnd-player-drag');
      const expectedTotal = expectedMappings.length;
      let correct = 0;
      let incorrect = 0;
      const placements = [];
      const satisfiedDefs = new Set();

      dragEls.forEach((el) => {
        const currentZone = el.dataset.currentZone || '';
        const text = el.textContent;
        const isMultipleSource = el.dataset.multiple === 'true' && !currentZone;

        if (currentZone) {
          // Try to map this dropped element to a mapping requirement
          const matchIdx = expectedMappings.findIndex((m, idx) => m.text === text && m.zone === currentZone && !satisfiedDefs.has(idx));
          if (matchIdx !== -1) {
            satisfiedDefs.add(matchIdx);
            correct++;
          } else {
            incorrect++;
          }
          placements.push(`${text} → ${currentZone}`);
        } else if (!isMultipleSource) {
          // Unplaced normal item
          placements.push(`${text} → (nicht zugeordnet)`);
        }
      });

      result.userAnswer = placements.join(', ');
      result.correctAnswer = expectedMappings.map((m) => `${m.text} → ${m.zone}`).join(', ');
      result.isCorrect = expectedTotal > 0 && correct === expectedTotal && incorrect === 0;
      break;
    }
    case 'flashcards': {
      const cards = content.cards || [];
      let correct = 0;
      const answers = [];
      cards.forEach((card) => {
        const user = (card._userAnswer || '').trim();
        const expected = card.answer || '';
        const alternatives = expected.split('/').map(a => a.trim().toLowerCase()).filter(Boolean);
        const ok = alternatives.includes(user.toLowerCase());
        if (ok) correct++;
        answers.push(`${user || '—'} (${ok ? '✓' : '✗'})`);
      });
      result.userAnswer = `${correct}/${cards.length} richtig`;
      result.correctAnswer = `${cards.length}/${cards.length}`;
      result.isCorrect = correct === cards.length && cards.length > 0;
      break;
    }
    default: {
      // Non-gradeable types: consider them "viewed"
      result.isCorrect = true;
      result.userAnswer = 'Angesehen';
      result.correctAnswer = '—';
      break;
    }
  }

  return result;
}

async function finishQuiz() {
  const score = quizState.answers.filter((a) => a.isCorrect).length;
  const total = quizState.answers.length;
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

  const resultData = {
    username: currentUser.name,
    topicId: quizState.topicId,
    topicTitle: quizState.topicTitle,
    score,
    totalQuestions: total,
    percentage,
    details: quizState.answers,
  };

  await appApi.saveQuizResult(resultData);

  // Show result screen
  quizPlayerArea.classList.add('hidden');
  quizResultArea.classList.remove('hidden');

  const pctClass = percentage >= 70 ? 'good' : percentage >= 40 ? 'medium' : 'poor';
  quizResultArea.innerHTML = `
    <div class="quiz-final-result">
      <div class="quiz-result-icon">${percentage >= 80 ? '🏆' : percentage >= 50 ? '👍' : '📚'}</div>
      <h2>${t('quiz.complete')}</h2>
      <div class="quiz-result-score ${pctClass}">
        <span class="quiz-result-number">${score} / ${total}</span>
        <span class="quiz-result-pct">${percentage}%</span>
      </div>
      <p>${t('quiz.topic')}: <strong>${escapeHtml(quizState.topicTitle)}</strong></p>
      <div class="quiz-result-details">
        ${examModeEnabled
          ? '<p style="color:var(--text-secondary);">Prüfungsmodus aktiv: Detail-Rückmeldung ist ausgeblendet.</p>'
          : quizState.answers.map((a, i) => `
          <div class="result-detail-item ${a.isCorrect ? 'correct' : 'wrong'}">
            <span class="result-detail-icon">${a.isCorrect ? '✅' : '❌'}</span>
            <div>
              <strong>${i + 1}. ${escapeHtml(a.moduleTitle)}</strong>
              ${a.userAnswer ? `<br>${t('common.your.answer')}: ${escapeHtml(String(a.userAnswer))}` : ''}
              ${a.score ? `<br>Auswertung: ${escapeHtml(String(a.score))}` : ''}
              ${!a.isCorrect && a.correctAnswer ? `<br>${t('results.correct')}: ${escapeHtml(String(a.correctAnswer))}` : ''}
            </div>
          </div>
        `).join('')}
      </div>
      <div class="form-actions" style="justify-content:center; margin-top:24px;">
        <button class="btn btn-primary" id="btnQuizRestart">${t('quiz.restart')}</button>
      </div>
    </div>
  `;

  quizResultArea.querySelector('#btnQuizRestart').addEventListener('click', () => {
    quizState = null;
    quizResultArea.classList.add('hidden');
    quizTopicSelect.classList.remove('hidden');
    quizSubtitle.textContent = t('quiz.subtitle');
    refreshQuizTopicSelect();
  });

  quizState = null;
}

// ==================== H5P PREVIEW RENDER ====================

function renderH5pPreview(mod, typeDef, container, options = {}) {
  const content = mod.content || {};
  const wrapper = document.createElement('div');
  wrapper.style.maxWidth = '800px';
  wrapper.style.margin = '0 auto';

  const header = document.createElement('div');
  header.innerHTML = `
    <div style="text-align:center; margin-bottom: 24px;">
      <span style="font-size: 3rem;">${typeDef.icon || '📦'}</span>
      <h3 style="margin-top: 8px;">${escapeHtml(mod.title)}</h3>
      <p style="color: var(--text-secondary); font-size: 0.9rem;">${typeDef.name} — ${typeDef.category || ''}</p>
    </div>
  `;
  wrapper.appendChild(header);

  if (mod.description) {
    const desc = document.createElement('div');
    desc.className = 'module-description-content';
    desc.style.marginBottom = '20px';
    desc.style.color = 'var(--text-secondary)';
    desc.innerHTML = sanitizeModuleDescriptionHtml(mod.description);
    wrapper.appendChild(desc);
  }

  const previewEl = createTypePreview(mod.type, content, options);
  wrapper.appendChild(previewEl);

  container.appendChild(wrapper);
}

function renderModuleImage(content, options = {}) {
  if (!content || !content.imageUrl) return '';
  const marginBottom = options.marginBottom || '16px';

  return `
    <div style="margin-bottom:${marginBottom};">
      <img
        src="${content.imageUrl}"
        alt="Modulbild"
        style="display:block; max-width:100%; max-height:320px; object-fit:contain; border-radius:var(--radius-md); border:1px solid var(--border); background:var(--bg-primary);"
      />
    </div>
  `;
}

function createTypePreview(type, content, options = {}) {
  const suppressFeedback = !!(options.quizMode && options.examMode);
  const div = document.createElement('div');
  
  const globalNextBtn = document.getElementById('btnQuizNext');
  if (globalNextBtn) globalNextBtn.disabled = false;

  switch (type) {
    case 'accordion': {
      const panels = content.panels || [];
      for (const panel of panels) {
        const details = document.createElement('details');
        details.style.cssText = 'margin-bottom:8px; border:1px solid var(--border); border-radius:var(--radius-sm); overflow:hidden;';
        const summary = document.createElement('summary');
        summary.style.cssText = 'padding:12px 16px; cursor:pointer; font-weight:600; background:var(--bg-primary);';
        summary.textContent = panel.title || '';
        const body = document.createElement('div');
        body.style.cssText = 'padding:12px 16px;';
        body.textContent = panel.content || '';
        details.appendChild(summary);
        details.appendChild(body);
        div.appendChild(details);
      }
      break;
    }
    case 'arithmeticQuiz': {
      div.innerHTML = `
        <div style="text-align:center; padding: 30px; background: var(--accent-light); border-radius: var(--radius-md);">
          <p><strong>Rechenart:</strong> ${content.arithmeticType || 'Addition'}</p>
          <p><strong>Max. Zahl:</strong> ${content.maxNumber || 10}</p>
          <p><strong>Fragen:</strong> ${content.numQuestions || 10}</p>
          ${content.timeLimit ? `<p><strong>Zeitlimit:</strong> ${content.timeLimit}s</p>` : ''}
          <button class="btn btn-primary" style="margin-top:16px;" onclick="this.parentElement.querySelector('.quiz-area').style.display='block'; this.style.display='none';">Quiz starten</button>
          <div class="quiz-area" style="display:none; margin-top:20px;"></div>
        </div>
      `;
      startArithmeticQuiz(div.querySelector('.quiz-area'), content, suppressFeedback);
      break;
    }
    case 'multipleChoice': {
      const q = content.question || 'Keine Frage definiert';
      const answers = content.answers || [];
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        ${renderModuleImage(content)}
        <div style="font-weight:600; margin-bottom:16px;">${sanitizeModuleDescriptionHtml(q)}</div>
        <div class="mc-answers"></div>
        ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" style="margin-top:16px;" id="mcCheck">Überprüfen</button><div id="mcFeedback" style="margin-top:12px;"></div>'}
      </div>`;
      const answersEl = div.querySelector('.mc-answers');
      const isSingle = content.singleAnswer;
      answers.forEach((a, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom:8px; display:flex; align-items:center; gap:8px;';
        const input = document.createElement('input');
        input.type = isSingle ? 'radio' : 'checkbox';
        input.name = 'mc-answer';
        input.value = i;
        input.dataset.correct = a.correct ? 'true' : 'false';
        const label = document.createElement('label');
        label.innerHTML = sanitizeModuleDescriptionHtml(a.text);
        row.appendChild(input);
        row.appendChild(label);
        answersEl.appendChild(row);
      });
      const mcCheckBtn = div.querySelector('#mcCheck');
      if (mcCheckBtn) mcCheckBtn.addEventListener('click', () => {
        const inputs = answersEl.querySelectorAll('input');
        let allCorrect = true;
        inputs.forEach((inp) => {
          const isCorrect = inp.dataset.correct === 'true';
          if (inp.checked !== isCorrect) allCorrect = false;
          inp.parentElement.style.color = inp.checked
            ? (isCorrect ? 'green' : 'red')
            : (isCorrect ? 'orange' : '');
        });
        div.querySelector('#mcFeedback').innerHTML = allCorrect
          ? '<span style="color:green; font-weight:600;">✓ Richtig!</span>'
          : '<span style="color:red; font-weight:600;">✗ Nicht ganz richtig. Versuchen Sie es nochmal.</span>';
      });
      break;
    }
    case 'trueFalse': {
      // Support old flat format (single question) and new list format
      let tfQuestions = content.questions || [content];
      if (content.randomOrder) {
        // Shuffle questions (Fisher-Yates)
        tfQuestions = [...tfQuestions];
        for (let i = tfQuestions.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [tfQuestions[i], tfQuestions[j]] = [tfQuestions[j], tfQuestions[i]];
        }
      }
      if (tfQuestions.length === 0) { div.textContent = 'Keine Fragen definiert.'; break; }

      let tfIdx = 0;
      div.innerHTML = `
        <div class="tf-player">
          <div class="tf-progress"><span id="tfProgress">Frage 1 von ${tfQuestions.length}</span></div>
          <div class="tf-card">
            ${renderModuleImage(content, { marginBottom: '20px' })}
            <p id="tfQuestion" class="tf-question"></p>
            <div class="tf-buttons">
              <button class="btn btn-secondary tf-btn" id="tfTrue" data-val="true">Wahr</button>
              <button class="btn btn-secondary tf-btn" id="tfFalse" data-val="false">Falsch</button>
            </div>
            <div id="tfFeedback" class="tf-feedback"></div>
          </div>
          <div class="tf-nav">
            <button class="btn btn-secondary btn-sm" id="tfPrev">← Zurück</button>
            <span id="tfScore" class="tf-score"></span>
            <button class="btn btn-secondary btn-sm" id="tfNext">Weiter →</button>
          </div>
        </div>`;

      const tfQuestion = div.querySelector('#tfQuestion');
      const tfFeedback = div.querySelector('#tfFeedback');
      const tfProgress = div.querySelector('#tfProgress');
      const tfScore = div.querySelector('#tfScore');
      const tfTrue = div.querySelector('#tfTrue');
      const tfFalse = div.querySelector('#tfFalse');
      const tfResults = tfQuestions.map(() => null); // null = unanswered

      if (tfQuestions.length > 1) {
        const globalNextBtn = document.getElementById('btnQuizNext');
        if (globalNextBtn) globalNextBtn.disabled = true;
      }

      const showTfQuestion = () => {
        if (tfIdx === tfQuestions.length - 1) {
          const globalNextBtn = document.getElementById('btnQuizNext');
          if (globalNextBtn) globalNextBtn.disabled = false;
        }
        const q = tfQuestions[tfIdx];
        tfQuestion.textContent = q.question || '';
        tfProgress.textContent = `Frage ${tfIdx + 1} von ${tfQuestions.length}`;
        if (tfResults[tfIdx] !== null) {
          tfTrue.disabled = true;
          tfFalse.disabled = true;
          tfTrue.classList.remove('tf-selected');
          tfFalse.classList.remove('tf-selected');
          if (q._userAnswer === 'true') tfTrue.classList.add('tf-selected');
          if (q._userAnswer === 'false') tfFalse.classList.add('tf-selected');
          if (suppressFeedback) {
            tfFeedback.innerHTML = '';
            tfFeedback.className = 'tf-feedback';
          } else {
            const correct = tfResults[tfIdx];
            tfFeedback.innerHTML = correct
              ? `<span class="tf-correct">✓ ${escapeHtml(q.feedbackCorrect || 'Richtig!')}</span>`
              : `<span class="tf-wrong">✗ ${escapeHtml(q.feedbackWrong || 'Leider falsch.')}</span>`;
            tfFeedback.className = 'tf-feedback ' + (correct ? 'tf-feedback-correct' : 'tf-feedback-wrong');
          }
        } else {
          tfTrue.disabled = false;
          tfFalse.disabled = false;
          tfTrue.classList.remove('tf-selected');
          tfFalse.classList.remove('tf-selected');
          tfFeedback.innerHTML = '';
          tfFeedback.className = 'tf-feedback';
        }
        updateTfScore();
      };

      const updateTfScore = () => {
        if (suppressFeedback) {
          tfScore.textContent = '';
          return;
        }
        const answered = tfResults.filter(r => r !== null).length;
        const correct = tfResults.filter(r => r === true).length;
        tfScore.textContent = answered > 0 ? `${correct}/${answered} richtig` : '';
      };

      const handleTfAnswer = (val) => {
        if (tfResults[tfIdx] !== null) return;
        const q = tfQuestions[tfIdx];
        q._userAnswer = val;
        const correct = q.correctAnswer === val;
        tfResults[tfIdx] = correct;
        showTfQuestion();
      };

      tfTrue.addEventListener('click', () => handleTfAnswer('true'));
      tfFalse.addEventListener('click', () => handleTfAnswer('false'));
      div.querySelector('#tfPrev').addEventListener('click', () => { if (tfIdx > 0) { tfIdx--; showTfQuestion(); } });
      div.querySelector('#tfNext').addEventListener('click', () => { if (tfIdx < tfQuestions.length - 1) { tfIdx++; showTfQuestion(); } });

      showTfQuestion();
      break;
    }
    case 'dialogCards':
    case 'flashcards': {
      const cards = content.cards || [];
      if (cards.length === 0) { div.textContent = 'Keine Karten definiert.'; break; }
      const frontKey = type === 'dialogCards' ? 'front' : 'question';
      const backKey = type === 'dialogCards' ? 'back' : 'answer';
      const isFlashcards = type === 'flashcards';

      if (isFlashcards) {
        // H5P-style Flashcards: image + question, answer input, check, navigate
        let idx = 0;
        div.innerHTML = `
          <div class="fc-player">
            <div class="fc-card">
              <div id="fcImage" class="fc-image"></div>
              <div id="fcQuestion" class="fc-question"></div>
              <div class="fc-answer-row">
                <input type="text" id="fcInput" class="fc-input" placeholder="Antwort eingeben…" autocomplete="off" />
                <button class="btn btn-primary btn-sm" id="fcCheck">Prüfen</button>
              </div>
              <div id="fcFeedback" class="fc-feedback"></div>
            </div>
            <div class="fc-nav">
              <button class="btn btn-secondary btn-sm" id="fcPrev">← Zurück</button>
              <span id="fcCounter" class="fc-counter">1 / ${cards.length}</span>
              <span id="fcScore" class="fc-score"></span>
              <button class="btn btn-secondary btn-sm" id="fcNext">Weiter →</button>
            </div>
          </div>`;

        const fcImage = div.querySelector('#fcImage');
        const fcQuestion = div.querySelector('#fcQuestion');
        const fcInput = div.querySelector('#fcInput');
        const fcCheck = div.querySelector('#fcCheck');
        const fcFeedback = div.querySelector('#fcFeedback');
        const fcCounter = div.querySelector('#fcCounter');
        const fcScore = div.querySelector('#fcScore');
        const cardResults = cards.map(() => null); // null = not answered, true/false

        const showCard = () => {
          const card = cards[idx];
          // Image
          if (card.imageUrl) {
            fcImage.innerHTML = `<img src="${card.imageUrl}" />`;
            fcImage.style.display = '';
          } else {
            fcImage.innerHTML = '';
            fcImage.style.display = 'none';
          }
          fcQuestion.textContent = card[frontKey] || '';
          fcCounter.textContent = `${idx + 1} / ${cards.length}`;

          // Restore previous state or reset
          if (cardResults[idx] !== null) {
            fcInput.value = card._userAnswer || '';
            fcInput.disabled = true;
            fcCheck.disabled = true;
            showFeedback(cardResults[idx], card[backKey]);
          } else {
            fcInput.value = '';
            fcInput.disabled = false;
            fcCheck.disabled = false;
            fcFeedback.innerHTML = '';
            fcFeedback.className = 'fc-feedback';
          }
          updateScore();
        };

        const showFeedback = (correct, answer) => {
          if (suppressFeedback) {
            fcFeedback.innerHTML = '<span style="font-weight:600;">Antwort gespeichert.</span>';
            fcFeedback.className = 'fc-feedback';
            return;
          }
          if (correct) {
            fcFeedback.innerHTML = `<span class="fc-correct">✅ Richtig!</span>`;
            fcFeedback.className = 'fc-feedback fc-feedback-correct';
          } else {
            fcFeedback.innerHTML = `<span class="fc-wrong">❌ Falsch.</span> Richtige Antwort: <strong>${escapeHtml(answer)}</strong>`;
            fcFeedback.className = 'fc-feedback fc-feedback-wrong';
          }
        };

        const updateScore = () => {
          if (suppressFeedback) {
            fcScore.textContent = '';
            return;
          }
          const answered = cardResults.filter(r => r !== null).length;
          const correct = cardResults.filter(r => r === true).length;
          if (answered > 0) {
            fcScore.textContent = `${correct}/${answered} richtig`;
          } else {
            fcScore.textContent = '';
          }
        };

        fcCheck.addEventListener('click', () => {
          const userAnswer = fcInput.value.trim();
          if (!userAnswer) return;
          const correctAnswer = cards[idx][backKey] || '';
          const alternatives = correctAnswer.split('/').map(a => a.trim().toLowerCase()).filter(Boolean);
          const isCorrect = alternatives.includes(userAnswer.toLowerCase());
          cardResults[idx] = isCorrect;
          cards[idx]._userAnswer = userAnswer;
          fcInput.disabled = true;
          fcCheck.disabled = true;
          showFeedback(isCorrect, correctAnswer);
          updateScore();
        });

        fcInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !fcCheck.disabled) fcCheck.click();
        });

        div.querySelector('#fcPrev').addEventListener('click', () => { if (idx > 0) { idx--; showCard(); } });
        div.querySelector('#fcNext').addEventListener('click', () => { if (idx < cards.length - 1) { idx++; showCard(); } });

        showCard();
      } else {
        // dialogCards: click-to-flip with image + audio
        let idx = 0;
        let flipped = false;
        div.innerHTML = `
          <div class="dc-player">
            <div class="dc-card">
              <div id="dcImage" class="dc-image"></div>
              <div id="dcAudio" class="dc-audio"></div>
              <div id="cardDisplay" class="dc-display">
                ${escapeHtml(cards[0][frontKey] || '')}
              </div>
              <p class="dc-hint">Klicken zum Umdrehen</p>
              <div id="dcTip" class="dc-tip"></div>
            </div>
            <div class="dc-nav">
              <button class="btn btn-secondary btn-sm" id="cardPrev">← Zurück</button>
              <span id="cardCounter" class="dc-counter">1 / ${cards.length}</span>
              <button class="btn btn-secondary btn-sm" id="cardNext">Weiter →</button>
            </div>
          </div>
        `;
        const cardDisplay = div.querySelector('#cardDisplay');
        const cardCounter = div.querySelector('#cardCounter');
        const dcImage = div.querySelector('#dcImage');
        const dcAudio = div.querySelector('#dcAudio');
        const dcTip = div.querySelector('#dcTip');

        const showCardMedia = (card) => {
          // Image
          if (card.imageUrl) {
            dcImage.innerHTML = `<img src="${card.imageUrl}" />`;
            dcImage.style.display = '';
          } else {
            dcImage.innerHTML = '';
            dcImage.style.display = 'none';
          }
          // Audio — use Web Audio API fallback for codec issues (e.g. MP3 on Linux)
          if (card.audioUrl) {
            dcAudio.innerHTML = '';
            dcAudio.style.display = '';
            const audioEl = document.createElement('audio');
            audioEl.controls = true;
            audioEl.style.cssText = 'width:100%;max-width:320px;';
            audioEl.src = card.audioUrl;
            dcAudio.appendChild(audioEl);

            // Check if browser can play it; if not, use Web Audio API fallback
            audioEl.addEventListener('error', () => {
              dcAudio.innerHTML = '';
              let playing = false;
              let audioCtx = null;
              let sourceNode = null;

              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'btn btn-secondary btn-sm';
              btn.textContent = '▶️ Audio abspielen';

              btn.addEventListener('click', async () => {
                if (playing) {
                  if (audioCtx) { audioCtx.close(); audioCtx = null; }
                  playing = false;
                  btn.textContent = '▶️ Audio abspielen';
                  return;
                }
                try {
                  audioCtx = new AudioContext();
                  const resp = await fetch(card.audioUrl);
                  const arrayBuf = await resp.arrayBuffer();
                  const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
                  sourceNode = audioCtx.createBufferSource();
                  sourceNode.buffer = audioBuf;
                  sourceNode.connect(audioCtx.destination);
                  sourceNode.start(0);
                  playing = true;
                  btn.textContent = '⏹️ Stoppen';
                  sourceNode.onended = () => {
                    playing = false;
                    btn.textContent = '▶️ Audio abspielen';
                    if (audioCtx) { audioCtx.close(); audioCtx = null; }
                  };
                } catch (e) {
                  btn.textContent = '❌ Audio nicht abspielbar';
                  btn.disabled = true;
                }
              });
              dcAudio.appendChild(btn);
            }, { once: true });
          } else {
            dcAudio.innerHTML = '';
            dcAudio.style.display = 'none';
          }
          // Tip
          if (card.tip) {
            dcTip.innerHTML = `<span class="dc-tip-icon" title="${escapeAttr(card.tip)}">💡 Hinweis</span>`;
            dcTip.style.display = '';
          } else {
            dcTip.style.display = 'none';
          }
        };

        if (cards.length > 1) {
          const globalNextBtn = document.getElementById('btnQuizNext');
          if (globalNextBtn) globalNextBtn.disabled = true;
        }

        showCardMedia(cards[0]);
        const updateCard = () => {
          if (idx === cards.length - 1) {
            const globalNextBtn = document.getElementById('btnQuizNext');
            if (globalNextBtn) globalNextBtn.disabled = false;
          }
          flipped = false;
          cardDisplay.textContent = cards[idx][frontKey] || '';
          cardDisplay.style.background = 'var(--accent-light)';
          cardCounter.textContent = `${idx + 1} / ${cards.length}`;
          showCardMedia(cards[idx]);
        };
        cardDisplay.addEventListener('click', () => {
          flipped = !flipped;
          cardDisplay.textContent = flipped ? (cards[idx][backKey] || '') : (cards[idx][frontKey] || '');
          cardDisplay.style.background = flipped ? '#dcfce7' : 'var(--accent-light)';
        });
        div.querySelector('#cardPrev').addEventListener('click', () => { if (idx > 0) { idx--; updateCard(); } });
        div.querySelector('#cardNext').addEventListener('click', () => { if (idx < cards.length - 1) { idx++; updateCard(); } });
      }
      break;
    }
    case 'fillInTheBlanks': {
      const questions = content.questions || [];
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        ${content.taskDescription ? `<div style="margin-bottom:16px;">${sanitizeModuleDescriptionHtml(content.taskDescription)}</div>` : ''}
        ${renderModuleImage(content)}
        <div id="blanksArea"></div>
        <div style="display:flex; align-items:center; gap:12px; margin-top:16px;">
          ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" id="blanksCheck">Überprüfen</button>'}
          <button class="btn btn-secondary btn-sm" id="blanksNext">Weiter →</button>
        </div>
        ${suppressFeedback ? '' : '<div id="blanksFeedback" style="margin-top:12px;"></div>'}
      </div>`;
      const blanksArea = div.querySelector('#blanksArea');
      const answerMap = [];
      questions.forEach((q) => {
        const p = document.createElement('div');
        p.style.marginBottom = '12px';
        p.innerHTML = sanitizeModuleDescriptionHtml(q.text || '');
        
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) textNodes.push(node);

        textNodes.forEach((textNode) => {
          const nodeText = textNode.nodeValue;
          const parts = nodeText.split(/(\*[^*]+\*)/g);
          if (parts.length > 1) {
            const fragment = document.createDocumentFragment();
            parts.forEach((part) => {
              const match = part.match(/^\*(.+)\*$/);
              if (match) {
                const answer = match[1];
                const input = document.createElement('input');
                input.type = 'text';
                input.style.cssText = 'width:120px; padding:4px 8px; border:1px solid var(--border); border-radius:4px; margin:0 4px;';
                input.dataset.answer = answer;
                answerMap.push({ answer, inputEl: input });
                fragment.appendChild(input);
              } else if (part) {
                fragment.appendChild(document.createTextNode(part));
              }
            });
            textNode.parentNode.replaceChild(fragment, textNode);
          }
        });
        blanksArea.appendChild(p);
      });
      const blanksCheckBtn = div.querySelector('#blanksCheck');
      if (blanksCheckBtn) blanksCheckBtn.addEventListener('click', () => {
        let correct = 0;
        const caseSensitive = content.caseSensitive;
        answerMap.forEach(({ answer, inputEl }) => {
          const userVal = inputEl.value.trim();
          const alternatives = answer.split('/').map(a => a.trim()).filter(Boolean);
          const match = alternatives.some(alt => caseSensitive ? userVal === alt : userVal.toLowerCase() === alt.toLowerCase());
          inputEl.style.borderColor = match ? 'green' : 'red';
          if (match) correct++;
        });
        div.querySelector('#blanksFeedback').innerHTML = `<span style="font-weight:600;">${correct} von ${answerMap.length} richtig</span>`;
      });
      
      const blanksNextBtn = div.querySelector('#blanksNext');
      if (blanksNextBtn) {
        blanksNextBtn.addEventListener('click', () => {
          const globalNextBtn = document.getElementById('btnQuizNext');
          if (globalNextBtn) globalNextBtn.click();
        });
      }
      break;
    }
    case 'essay': {
      const minChars = Number(content.minChars) || 0;
      const rows = Number(content.inputFieldSize) || 10;
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        ${content.taskDescription ? `<p style="margin-bottom:16px;">${escapeHtml(content.taskDescription)}</p>` : ''}
        ${renderModuleImage(content)}
        <textarea id="essayAnswer" rows="${rows}" style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius-sm); resize:vertical;"></textarea>
        <div style="display:flex; align-items:center; gap:12px; margin-top:12px; flex-wrap:wrap;">
          ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" id="essayCheck">Überprüfen</button>'}
          ${minChars > 0 ? `<span style="font-size:0.85rem; color:var(--text-secondary);">Min. ${minChars} Zeichen</span>` : ''}
          <span id="essayCounter" style="font-size:0.85rem; color:var(--text-secondary);">0 Zeichen</span>
        </div>
        ${suppressFeedback ? '' : '<div id="essayFeedback" style="margin-top:12px;"></div>'}
        ${!suppressFeedback && content.sampleSolution ? `<details style="margin-top:12px;"><summary style="cursor:pointer;">Musterlösung anzeigen</summary><div style="margin-top:8px; padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm); white-space:pre-wrap;">${escapeHtml(content.sampleSolution)}</div></details>` : ''}
      </div>`;

      const essayInput = div.querySelector('#essayAnswer');
      const essayCounter = div.querySelector('#essayCounter');
      const essayFeedback = div.querySelector('#essayFeedback');
      const updateCounter = () => {
        const len = (essayInput.value || '').trim().length;
        essayCounter.textContent = `${len} Zeichen`;
      };
      essayInput.addEventListener('input', updateCounter);
      const essayCheckBtn = div.querySelector('#essayCheck');
      if (essayCheckBtn) essayCheckBtn.addEventListener('click', () => {
        const len = (essayInput.value || '').trim().length;
        const ok = minChars <= 0 ? len > 0 : len >= minChars;
        essayInput.style.borderColor = ok ? 'green' : 'red';
        essayFeedback.innerHTML = ok
          ? '<span style="color:green; font-weight:600;">✓ Antwort erfasst.</span>'
          : `<span style="color:red; font-weight:600;">✗ Bitte mindestens ${minChars} Zeichen eingeben.</span>`;
      });
      break;
    }
    case 'dragTheWords': {
      let autoScrollInterval = null;
      const startAutoScroll = (e) => {
        const main = document.getElementById('mainContent');
        if (!main) return;
        const rect = main.getBoundingClientRect();
        const y = e.clientY;
        const topDist = y - rect.top;
        const bottomDist = rect.bottom - y;
        const threshold = 60;
        let speed = 0;
        if (topDist < threshold && topDist > -threshold) speed = -15;
        else if (bottomDist < threshold && bottomDist > -threshold) speed = 15;
        
        if (speed !== 0 && !autoScrollInterval) {
          autoScrollInterval = setInterval(() => { main.scrollTop += speed; }, 20);
        } else if (speed === 0 && autoScrollInterval) {
          clearInterval(autoScrollInterval);
          autoScrollInterval = null;
        }
      };
      const stopAutoScroll = () => {
        if (autoScrollInterval) { clearInterval(autoScrollInterval); autoScrollInterval = null; }
        document.removeEventListener('dragover', startAutoScroll);
      };

      div.innerHTML = `<div class="dtw-container">
        ${content.taskDescription ? `<div class="dtw-description">${sanitizeModuleDescriptionHtml(content.taskDescription)}</div>` : ''}
        ${renderModuleImage(content)}
        <div class="dtw-text-area" id="dtwTextArea"></div>
        <div class="dtw-word-bank" id="dtwWordBank"></div>
        ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" style="margin-top:16px;" id="dtwCheck">Überprüfen</button><div id="dtwFeedback" style="margin-top:12px;"></div>'}
      </div>`;
      const text = content.textField || '';
      const textArea = div.querySelector('#dtwTextArea');
      const wordBank = div.querySelector('#dtwWordBank');
      const draggableWords = [];
      let dropIdx = 0;
      textArea.innerHTML = sanitizeModuleDescriptionHtml(text);
      
      const walker = document.createTreeWalker(textArea, NodeFilter.SHOW_TEXT, null, false);
      const textNodes = [];
      let node;
      while ((node = walker.nextNode())) textNodes.push(node);

      textNodes.forEach((textNode) => {
        const nodeText = textNode.nodeValue;
        const parts = nodeText.split(/(\*[^*]+\*)/g);
        
        if (parts.length > 1) {
          const fragment = document.createDocumentFragment();
          parts.forEach((part) => {
            const match = part.match(/^\*(.+)\*$/);
            if (match) {
              const correctWord = match[1];
              draggableWords.push(correctWord);
              const dropZone = document.createElement('span');
              dropZone.className = 'dtw-drop-zone';
              dropZone.dataset.correctWord = correctWord;
              dropZone.dataset.dropIdx = dropIdx++;
              dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dtw-drop-hover'); });
              dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('dtw-drop-hover'); });
              dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('dtw-drop-hover');
                const word = e.dataTransfer.getData('text/plain');
                const srcId = e.dataTransfer.getData('application/dtw-src');
                if (dropZone.dataset.currentWord) {
                  returnWordToBank(dropZone.dataset.currentWord, wordBank);
                }
                dropZone.textContent = word;
                dropZone.dataset.currentWord = word;
                dropZone.classList.add('dtw-drop-filled');
                const srcEl = wordBank.querySelector(`[data-dtw-id="${srcId}"]`);
                if (srcEl) srcEl.classList.add('dtw-chip-used');
                const fromZone = e.dataTransfer.getData('application/dtw-from-zone');
                if (fromZone) {
                  const prevZone = textArea.querySelector(`.dtw-drop-zone[data-drop-idx="${fromZone}"]`);
                  if (prevZone && prevZone !== dropZone) {
                    prevZone.textContent = '';
                    prevZone.dataset.currentWord = '';
                    prevZone.classList.remove('dtw-drop-filled');
                  }
                }
              });
              dropZone.setAttribute('draggable', 'false');
              dropZone.addEventListener('mousedown', (e) => {
                if (dropZone.dataset.currentWord) dropZone.setAttribute('draggable', 'true');
              });
              dropZone.addEventListener('dragstart', (e) => {
                if (!dropZone.dataset.currentWord) { e.preventDefault(); return; }
                e.dataTransfer.setData('text/plain', dropZone.dataset.currentWord);
                e.dataTransfer.setData('application/dtw-src', '');
                e.dataTransfer.setData('application/dtw-from-zone', dropZone.dataset.dropIdx);
                e.dataTransfer.effectAllowed = 'move';
                document.addEventListener('dragover', startAutoScroll);
              });
              dropZone.addEventListener('dragend', () => { 
                dropZone.setAttribute('draggable', 'false'); 
                stopAutoScroll();
              });
              fragment.appendChild(dropZone);
            } else if (part) {
              // Statischen Text als nicht auswählbar markieren
              const staticSpan = document.createElement('span');
              staticSpan.className = 'dtw-static-text';
              staticSpan.textContent = part;
              staticSpan.setAttribute('unselectable', 'on');
              staticSpan.style.userSelect = 'none';
              staticSpan.style.webkitUserSelect = 'none';
              fragment.appendChild(staticSpan);
            }
          // CSS für nicht auswählbaren statischen Text ergänzen
          const dtwStyle = document.createElement('style');
          dtwStyle.textContent = `.dtw-static-text { user-select: none; -webkit-user-select: none; }`;
          document.head.appendChild(dtwStyle);
          });
          textNode.parentNode.replaceChild(fragment, textNode);
        }
      });

      // Shuffle and create word bank chips
      const shuffled = [...draggableWords].sort(() => Math.random() - 0.5);
      shuffled.forEach((word, i) => {
        const chip = document.createElement('span');
        chip.className = 'dtw-chip';
        chip.textContent = word;
        chip.setAttribute('draggable', 'true');
        chip.dataset.dtwId = `chip_${i}`;
        chip.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', word);
          e.dataTransfer.setData('application/dtw-src', chip.dataset.dtwId);
          e.dataTransfer.effectAllowed = 'move';
          document.addEventListener('dragover', startAutoScroll);
        });
        chip.addEventListener('dragend', stopAutoScroll);
        wordBank.appendChild(chip);
      });

      function returnWordToBank(word, bank) {
        const chips = bank.querySelectorAll('.dtw-chip');
        for (const c of chips) {
          if (c.textContent === word && c.classList.contains('dtw-chip-used')) {
            c.classList.remove('dtw-chip-used');
            break;
          }
        }
      }

      // Allow dropping back to word bank to remove a word from a slot
      wordBank.addEventListener('dragover', (e) => e.preventDefault());
      wordBank.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromZone = e.dataTransfer.getData('application/dtw-from-zone');
        const word = e.dataTransfer.getData('text/plain');
        if (fromZone) {
          const prevZone = textArea.querySelector(`.dtw-drop-zone[data-drop-idx="${fromZone}"]`);
          if (prevZone) {
            prevZone.textContent = '';
            prevZone.dataset.currentWord = '';
            prevZone.classList.remove('dtw-drop-filled');
          }
          returnWordToBank(word, wordBank);
        }
      });

      const dtwCheckBtn = div.querySelector('#dtwCheck');
      if (dtwCheckBtn) dtwCheckBtn.addEventListener('click', () => {
        const zones = textArea.querySelectorAll('.dtw-drop-zone');
        let correct = 0;
        zones.forEach((z) => {
          z.classList.remove('dtw-correct', 'dtw-wrong', 'dtw-missing');
          const current = (z.dataset.currentWord || '').trim();
          const expected = z.dataset.correctWord;
          if (current.toLowerCase() === expected.toLowerCase()) {
            z.classList.add('dtw-correct');
            correct++;
          } else if (current) {
            z.classList.add('dtw-wrong');
          } else {
            z.classList.add('dtw-missing');
          }
        });
        div.querySelector('#dtwFeedback').innerHTML = `<span style="font-weight:600;">${correct} von ${zones.length} richtig</span>`;
      });
      break;
    }
    case 'markTheWords': {
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        ${content.taskDescription ? `<div style="margin-bottom:16px;">${sanitizeModuleDescriptionHtml(content.taskDescription)}</div>` : ''}
        ${renderModuleImage(content)}
        <div id="wordsArea" style="line-height:2.2;"></div>
        ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" style="margin-top:16px;" id="wordsCheck">Überprüfen</button><div id="wordsFeedback" style="margin-top:12px;"></div>'}
      </div>`;
      const text = content.textField || '';
      const wordsArea = div.querySelector('#wordsArea');
      const parts = text.split(/\*([^*]+)\*/g);
      const correctWords = [];
      const makeWordSpan = (word, isCorrect) => {
        const span = document.createElement('span');
        span.style.cssText = 'display:inline-block; padding:4px 8px; margin:2px; border-radius:4px; cursor:pointer; border: 1px solid transparent;';
        span.textContent = word;
        span.dataset.correct = isCorrect ? 'true' : 'false';
        if (isCorrect) correctWords.push(span);
        span.addEventListener('click', () => {
          span.classList.toggle('selected');
          span.style.background = span.classList.contains('selected') ? 'var(--accent-light)' : '';
          span.style.borderColor = span.classList.contains('selected') ? 'var(--accent)' : 'transparent';
        });
        return span;
      };
      parts.forEach((part, pi) => {
        if (pi % 2 === 0) {
          const lines = part.split(/\n/);
          lines.forEach((line, li) => {
            if (li > 0) wordsArea.appendChild(document.createElement('br'));
            const indent = line.match(/^[\t ]*/)[0].replace(/\t/g, '    ');
            if (indent.length > 0) {
              const spacer = document.createElement('span');
              spacer.style.cssText = `display:inline-block; width:${indent.length * 0.5}em;`;
              wordsArea.appendChild(spacer);
            }
            line.trim().split(/\s+/).filter(Boolean).forEach((word) => {
              wordsArea.appendChild(makeWordSpan(word, false));
            });
          });
        } else {
          wordsArea.appendChild(makeWordSpan(part, true));
        }
      });
      const wordsCheckBtn = div.querySelector('#wordsCheck');
      if (wordsCheckBtn) wordsCheckBtn.addEventListener('click', () => {
        const allSpans = wordsArea.querySelectorAll('span');
        let correct = 0;
        let total = correctWords.length;
        allSpans.forEach((s) => {
          const isCorrect = s.dataset.correct === 'true';
          const isSelected = s.classList.contains('selected');
          if (isSelected && isCorrect) { s.style.background = '#dcfce7'; correct++; }
          else if (isSelected && !isCorrect) { s.style.background = '#fef2f2'; }
          else if (!isSelected && isCorrect) { s.style.background = '#fef9c3'; }
          s.style.borderColor = 'transparent';
        });
        div.querySelector('#wordsFeedback').innerHTML = `<span style="font-weight:600;">${correct} von ${total} korrekte Wörter markiert</span>`;
      });
      break;
    }
    case 'coursePresentation': {
      const slides = content.slides || [];
      if (slides.length === 0) { div.textContent = 'Keine Folien definiert.'; break; }
      let sIdx = 0;
      div.innerHTML = `
        <div style="background: var(--bg-primary); border-radius: var(--radius-md); padding:24px; min-height:300px;">
          <div id="slideContent" style="min-height:200px;"></div>
          <div style="margin-top:20px; display:flex; justify-content:center; gap:12px; align-items:center;">
            <button class="btn btn-secondary btn-sm" id="slidePrev">← Zurück</button>
            <span id="slideCounter">1 / ${slides.length}</span>
            <button class="btn btn-secondary btn-sm" id="slideNext">Weiter →</button>
          </div>
        </div>
      `;
      const slideContent = div.querySelector('#slideContent');
      const slideCounter = div.querySelector('#slideCounter');

      if (slides.length > 1) {
        const globalNextBtn = document.getElementById('btnQuizNext');
        if (globalNextBtn) globalNextBtn.disabled = true;
      }

      const updateSlide = () => {
        if (sIdx === slides.length - 1) {
          const globalNextBtn = document.getElementById('btnQuizNext');
          if (globalNextBtn) globalNextBtn.disabled = false;
        }
        const slide = slides[sIdx];
        slideContent.innerHTML = `<h3 style="margin-bottom:12px;">${escapeHtml(slide.slideTitle || '')}</h3><div>${slide.slideContent || ''}</div>`;
        slideCounter.textContent = `${sIdx + 1} / ${slides.length}`;
      };
      updateSlide();
      div.querySelector('#slidePrev').addEventListener('click', () => { if (sIdx > 0) { sIdx--; updateSlide(); } });
      div.querySelector('#slideNext').addEventListener('click', () => { if (sIdx < slides.length - 1) { sIdx++; updateSlide(); } });
      break;
    }
    case 'dictation': {
      const sentences = content.sentences || [];
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        <p style="margin-bottom:16px; font-weight:600;">Diktat — Schreiben Sie die gehörten Sätze:</p>
        <div id="dictArea"></div>
        ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" style="margin-top:16px;" id="dictCheck">Überprüfen</button><div id="dictFeedback" style="margin-top:12px;"></div>'}
      </div>`;
      const dictArea = div.querySelector('#dictArea');
      sentences.forEach((s, i) => {
        const row = document.createElement('div');
        row.style.marginBottom = '12px';
        row.innerHTML = `
          <label style="font-size:0.85rem; color:var(--text-secondary);">Satz ${i + 1}:</label>
          <input type="text" class="dict-input" data-answer="${escapeAttr(s.text || '')}" style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:4px; margin-top:4px;">
        `;
        dictArea.appendChild(row);
      });
      const dictCheckBtn = div.querySelector('#dictCheck');
      if (dictCheckBtn) dictCheckBtn.addEventListener('click', () => {
        const inputs = dictArea.querySelectorAll('.dict-input');
        let correct = 0;
        inputs.forEach((inp) => {
          const match = inp.value.trim().toLowerCase() === inp.dataset.answer.toLowerCase();
          inp.style.borderColor = match ? 'green' : 'red';
          if (match) correct++;
        });
        div.querySelector('#dictFeedback').innerHTML = `<span style="font-weight:600;">${correct} von ${inputs.length} richtig</span>`;
      });
      break;
    }
    case 'dragAndDrop': {
      const hasImage = !!content.backgroundImage;
      const zones = content.dropZones || [];
      const drags = content.draggables || [];
      const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

      div.innerHTML = `<div class="dnd-player">
        ${content.taskDescription ? `<div class="dnd-player-desc" style="margin-bottom:16px;">${sanitizeModuleDescriptionHtml(content.taskDescription)}</div>` : ''}
        <div class="dnd-player-draggables" id="dndDraggables"></div>
        <div class="dnd-player-canvas-wrap">
          ${hasImage
            ? `<div class="dnd-player-canvas" id="dndCanvas">
                <img src="${content.backgroundImage}" class="dnd-player-img" draggable="false" />
              </div>`
            : `<div class="dnd-player-canvas dnd-player-no-img" id="dndCanvas">
                <div id="dndZonesLegacy"></div>
              </div>`
          }
        </div>
        <div style="display:flex; align-items:center; gap:12px; margin-top:16px;">
          ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" id="dndCheck">Überprüfen</button>'}
          <button class="btn btn-secondary btn-sm" id="dndNext">Weiter →</button>
        </div>
        ${suppressFeedback ? '' : '<div id="dndFeedback" style="margin-top:12px;"></div>'}
      </div>`;

      const canvasEl = div.querySelector('#dndCanvas');
      const dragsEl = div.querySelector('#dndDraggables');

      // Render drop zones on image
      zones.forEach((z, i) => {
        const zoneEl = document.createElement('div');
        zoneEl.className = 'dnd-player-zone';
        const color = colors[i % colors.length];
        if (hasImage && z.x !== undefined) {
          zoneEl.style.left = z.x + '%';
          zoneEl.style.top = z.y + '%';
          zoneEl.style.width = (z.width || 20) + '%';
          zoneEl.style.height = (z.height || 15) + '%';
        } else {
          zoneEl.style.position = 'relative';
          zoneEl.style.minHeight = '50px';
          zoneEl.style.marginBottom = '8px';
        }
        zoneEl.style.borderColor = color;
        zoneEl.style.background = hexToRgba(color, 0.92);
        zoneEl.dataset.zone = z.label;
        zoneEl.innerHTML = `<span class="dnd-player-zone-label" style="background:${color}">${escapeHtml(z.label)}</span>
          <div class="dnd-player-zone-items" data-zone="${escapeAttr(z.label)}"></div>`;

        // Drop handler
        zoneEl.addEventListener('dragover', (e) => { e.preventDefault(); zoneEl.classList.add('dnd-zone-hover'); });
        zoneEl.addEventListener('dragleave', () => { zoneEl.classList.remove('dnd-zone-hover'); });
        zoneEl.addEventListener('drop', (e) => {
          e.preventDefault();
          zoneEl.classList.remove('dnd-zone-hover');
          const dragId = e.dataTransfer.getData('text/plain');
          const dragBtn = div.querySelector(`[data-drag-id="${dragId}"]`);
          if (dragBtn) {
            let elToPlace = dragBtn;
            if (dragBtn.dataset.multiple === 'true' && dragBtn.parentElement === dragsEl && typeof dragBtn.cloneSelf === 'function') {
              elToPlace = dragBtn.cloneSelf();
            }
            elToPlace.dataset.currentZone = z.label;
            zoneEl.querySelector('.dnd-player-zone-items').appendChild(elToPlace);
            elToPlace.classList.add('placed');
          }
        });

        if (hasImage) {
          canvasEl.appendChild(zoneEl);
        } else {
          div.querySelector('#dndZonesLegacy').appendChild(zoneEl);
        }
      });

      // Render draggable elements
      drags.forEach((d, i) => {
        let cloneCounter = 0;
        function createDraggableNode(isClone = false) {
          const drag = document.createElement('div');
          drag.className = 'dnd-player-drag';
          drag.textContent = d.text;
          drag.draggable = true;
          drag.dataset.dragId = isClone ? `drag-${i}-${++cloneCounter}` : `drag-${i}`;
          drag.dataset.correctZone = d.correctZone || '';
          drag.dataset.currentZone = '';
          drag.dataset.multiple = d.multiple ? 'true' : 'false';

          drag.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', drag.dataset.dragId);
            drag.classList.add('dragging');
          });
          drag.addEventListener('dragend', () => {
            drag.classList.remove('dragging');
          });

          // support click-to-cycle
          drag.addEventListener('click', () => {
            const currentZone = drag.dataset.currentZone || '';
            const zoneNames = zones.map((z) => z.label);
            
            // If clicking original "multiple" draggable in bank, spawn a clone in first zone
            if (d.multiple && !isClone && drag.parentElement === dragsEl) {
               if (zones.length > 0) {
                 const clone = createDraggableNode(true);
                 clone.dataset.currentZone = zoneNames[0];
                 clone.classList.add('placed');
                 const zItems = (hasImage ? canvasEl : div.querySelector('#dndZonesLegacy')).querySelector(`.dnd-player-zone[data-zone="${escapeAttr(zoneNames[0])}"] .dnd-player-zone-items`);
                 if (zItems) zItems.appendChild(clone);
               }
               return;
            }

            const currentIdx = zoneNames.indexOf(currentZone);
            const nextIdx = (currentIdx + 1) % (zoneNames.length + 1);
            if (nextIdx >= zoneNames.length) {
              if (isClone) {
                drag.remove(); // destroy clone if cycled out
              } else {
                drag.dataset.currentZone = '';
                drag.classList.remove('placed');
                dragsEl.appendChild(drag);
              }
            } else {
              drag.dataset.currentZone = zoneNames[nextIdx];
              drag.classList.add('placed');
              const zoneItemsEl = (hasImage ? canvasEl : div.querySelector('#dndZonesLegacy')).querySelector(`.dnd-player-zone[data-zone="${escapeAttr(zoneNames[nextIdx])}"] .dnd-player-zone-items`);
              if (zoneItemsEl) zoneItemsEl.appendChild(drag);
            }
          });
          
          if (!isClone) drag.cloneSelf = () => createDraggableNode(true);
          return drag;
        }

        const originalDrag = createDraggableNode(false);
        dragsEl.appendChild(originalDrag);
      });

      if (!suppressFeedback) {
        const dndCheckBtn = div.querySelector('#dndCheck');
        if (dndCheckBtn) {
          dndCheckBtn.addEventListener('click', () => {
            const zoneEls = (hasImage ? canvasEl : div.querySelector('#dndZonesLegacy')).querySelectorAll('.dnd-player-zone');
            let correct = 0;
            let totalScored = 0;
            zoneEls.forEach((z, idx) => {
              const zoneData = zones.find(zz => zz.label === z.dataset.zone);
              const expected = zoneData?.correctDraggable || '';
              const items = z.querySelectorAll('.dnd-player-drag.placed');
              const defaultColor = colors[idx % colors.length];
              
              // We consider it correct if AT LEAST ONE element matches the expected text
              // OR if the items themselves have this zone as their 'correctZone'.
              let hasCorrect = false;
              let anyWrong = false;

              if (items.length === 0) {
                if (expected) anyWrong = true; // Expected something, got nothing
              } else {
                for (const item of items) {
                  const isMatchByText = expected && item.textContent === expected;
                  const isMatchByZone = item.dataset.correctZone === z.dataset.zone;
                  
                  if (isMatchByText || isMatchByZone) {
                    hasCorrect = true;
                  } else {
                    anyWrong = true;
                  }
                }
              }
              
              if (hasCorrect && !anyWrong) {
                z.style.borderColor = 'green';
                correct++;
              } else if (anyWrong) {
                z.style.borderColor = 'red';
              } else {
                // No items and none expected
                z.style.borderColor = defaultColor;
              }
            });
            const dndFeedback = div.querySelector('#dndFeedback');
            if (dndFeedback) {
              dndFeedback.innerHTML = `<span style="font-weight:600;">${correct} von ${totalScored || zones.length} richtig</span>`;
            }
          });
        }

        const dndNextBtn = div.querySelector('#dndNext');
        if (dndNextBtn) {
          dndNextBtn.addEventListener('click', () => {
            const globalNextBtn = document.getElementById('btnQuizNext');
            if (globalNextBtn) globalNextBtn.click();
          });
        }
      }
      break;
    }
    case 'iframeEmbedder': {
      const url = content.url || '';
      if (url) {
        div.innerHTML = `<p style="margin-bottom:8px; font-size:0.85rem; color:var(--text-secondary);">Eingebettete Seite: ${escapeHtml(url)}</p>
          <div style="border:1px solid var(--border); border-radius:var(--radius-sm); overflow:hidden; background:#fff; text-align:center; padding:40px;">
            <p>IFrame-Vorschau ist in der Desktop-App aus Sicherheitsgründen eingeschränkt.</p>
            <p style="margin-top:8px;"><strong>URL:</strong> ${escapeHtml(url)}</p>
            <p style="margin-top:4px;"><strong>Größe:</strong> ${content.width || 800}×${content.height || 600}px</p>
          </div>`;
      } else { div.textContent = 'Keine URL definiert.'; }
      break;
    }
    case 'imageHotspots': {
      const hotspots = content.hotspots || [];
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        <div style="position:relative; width:100%; height:300px; background:#e2e8f0; border-radius:var(--radius-sm); overflow:hidden;">
          ${hotspots.map((h) => `
            <div style="position:absolute; left:${h.posX || 50}%; top:${h.posY || 50}%; transform:translate(-50%,-50%); width:30px; height:30px; background:var(--accent); border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; font-size:0.8rem;" title="${escapeAttr(h.title || '')}">📌</div>
          `).join('')}
        </div>
        <div style="margin-top:16px;">
          ${hotspots.map((h) => `<div style="margin-bottom:8px; padding:8px 12px; background:var(--bg-secondary); border-radius:var(--radius-sm); border:1px solid var(--border);"><strong>${escapeHtml(h.title || '')}</strong><br/><span style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(h.content || '')}</span></div>`).join('')}
        </div>
      </div>`;
      break;
    }
    case 'collage': {
      const images = content.images || [];
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        <p style="margin-bottom:12px;"><strong>Layout:</strong> ${content.layout || 'Standard'}</p>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
          ${images.map((img) => `
            <div style="background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-sm); padding:16px; text-align:center;">
              <div style="font-size:2rem; margin-bottom:8px;">🖼️</div>
              <p style="font-size:0.85rem;">${escapeHtml(img.imageUrl || 'Kein Bild')}</p>
              <p style="font-size:0.8rem; color:var(--text-secondary);">${escapeHtml(img.alt || '')}</p>
            </div>
          `).join('')}
        </div>
      </div>`;
      break;
    }
    case 'audioRecorder': {
      div.innerHTML = `<div style="padding:30px; text-align:center; background:var(--bg-primary); border-radius:var(--radius-md);">
        ${content.instruction ? `<p style="margin-bottom:20px;">${escapeHtml(content.instruction)}</p>` : ''}
        <div style="font-size:4rem; margin-bottom:16px;">🎙️</div>
        <p style="color:var(--text-secondary);">Audio Recorder Vorschau</p>
        <p style="font-size:0.85rem; color:var(--text-secondary); margin-top:8px;">Max. Aufnahmedauer: ${content.maxDuration || 60}s</p>
      </div>`;
      break;
    }
    case 'branchingScenario': {
      const startScreen = content.startScreen || {};
      const steps = content.steps || [];
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        <div style="text-align:center; margin-bottom:24px;">
          <h3>${escapeHtml(startScreen.title || 'Branching Scenario')}</h3>
          ${startScreen.subtitle ? `<p style="color:var(--text-secondary);">${escapeHtml(startScreen.subtitle)}</p>` : ''}
        </div>
        <div>
          ${steps.map((s, i) => `
            <div style="padding:12px 16px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-sm); margin-bottom:8px;">
              <strong>Schritt ${i + 1}: ${escapeHtml(s.stepTitle || '')}</strong>
              ${s.stepContent ? `<p style="font-size:0.85rem; margin-top:4px;">${escapeHtml(s.stepContent)}</p>` : ''}
            </div>
          `).join('')}
        </div>
      </div>`;
      break;
    }
    case 'video': {
      div.innerHTML = `<div style="padding:30px; text-align:center; background:var(--bg-primary); border-radius:var(--radius-md);">
        <div style="font-size:4rem; margin-bottom:16px;">🎬</div>
        <h3>${escapeHtml(content.title || 'Video')}</h3>
        <p style="margin-top:8px; color:var(--text-secondary);">Quelle: ${escapeHtml(content.videoUrl || 'Nicht definiert')}</p>
      </div>`;
      break;
    }
    case 'h5p_native': {
      const H5P_LIB_NAMES = {
        'H5P.MultiChoice':         { name: 'Multiple Choice',     icon: '🔘' },
        'H5P.Blanks':              { name: 'Fill in the Blanks',   icon: '✏️' },
        'H5P.DragQuestion':        { name: 'Drag and Drop',        icon: '🎯' },
        'H5P.TrueFalse':           { name: 'Wahr / Falsch',        icon: '✅' },
        'H5P.Essay':               { name: 'Essay',                icon: '📝' },
        'H5P.MarkTheWords':        { name: 'Wörter markieren',     icon: '🔤' },
        'H5P.DragText':            { name: 'Text sortieren',       icon: '📘' },
        'H5P.Summary':             { name: 'Zusammenfassung',      icon: '📋' },
        'H5P.QuestionSet':         { name: 'Fragen-Set',           icon: '📚' },
        'H5P.CoursePresentation':  { name: 'Präsentation',         icon: '📊' },
        'H5P.InteractiveVideo':    { name: 'Interaktives Video',   icon: '🎬' },
        'H5P.Flashcards':          { name: 'Lernkarten',           icon: '🃏' },
        'H5P.Accordion':           { name: 'Accordion',            icon: '📂' },
        'H5P.ImageHotspots':       { name: 'Bild-Hotspots',        icon: '🗺️' },
        'H5P.AdvancedText':        { name: 'Text',                 icon: '📄' },
        'H5P.Image':               { name: 'Bild',                 icon: '🖼️' },
      };
      const machineName = content.machineName || (content.library || '').split(' ')[0];
      const libInfo = H5P_LIB_NAMES[machineName] || { name: machineName.replace('H5P.', '') || 'H5P-Inhalt', icon: '🌐' };
      const params = content.params || {};

      // Extract question text based on library type
      let questionHtml = '';
      let extraInfo = '';
      if (machineName === 'H5P.MultiChoice') {
        questionHtml = params.question || '';
        const answers = params.answers || [];
        const correctCount = answers.filter(a => a.correct).length;
        extraInfo = `${answers.length} Antwortmöglichkeit(en), ${correctCount} korrekt`;
      } else if (machineName === 'H5P.Blanks') {
        questionHtml = params.text || (Array.isArray(params.questions) ? params.questions[0] || '' : '');
        const blanksMatch = (questionHtml.match(/\*[^*]+\*/g) || []);
        extraInfo = `${blanksMatch.length} Lücke(n)`;
      } else if (machineName === 'H5P.TrueFalse') {
        questionHtml = params.question || '';
        extraInfo = `Richtige Antwort: ${params.correct === 'true' ? 'Wahr' : 'Falsch'}`;
      } else if (machineName === 'H5P.Essay') {
        questionHtml = params.question || params.taskDescription || '';
      } else if (machineName === 'H5P.DragQuestion') {
        questionHtml = params.question && params.question.settings && params.question.settings.questionTitle || params.taskDescription || '';
        const elements = (params.question && params.question.task && params.question.task.elements) || [];
        const zones = (params.question && params.question.task && params.question.task.dropZones) || [];
        extraInfo = `${elements.length} Element(e), ${zones.length} Zielzone(n)`;
      } else if (machineName === 'H5P.MarkTheWords') {
        questionHtml = params.taskDescription || '';
      } else if (machineName === 'H5P.DragText') {
        questionHtml = params.taskDescription || '';
      }

      const sanitizedQuestion = questionHtml
        ? `<div class="h5p-native-question">${questionHtml}</div>`
        : '';

      div.innerHTML = `
        <div class="h5p-native-preview">
          <div class="h5p-native-header">
            <span class="h5p-native-icon">${libInfo.icon}</span>
            <div class="h5p-native-meta">
              <span class="h5p-native-type-label">${escapeHtml(libInfo.name)}</span>
              <span class="h5p-native-lib-label">${escapeHtml(content.library || '')}</span>
            </div>
          </div>
          ${sanitizedQuestion}
          ${extraInfo ? `<p class="h5p-native-extra">${escapeHtml(extraInfo)}</p>` : ''}
          <p class="h5p-native-note">⚠️ Nativer H5P-Inhalt — Vorschau zeigt Rohdaten. Für vollständige Wiedergabe H5P exportieren und in einem H5P-fähigen System öffnen.</p>
        </div>`;
      break;
    }
    default: {
      div.innerHTML = `<div style="padding:30px; text-align:center; color:var(--text-secondary);">
        <p>Vorschau für diesen Modultyp wird noch entwickelt.</p>
        <pre style="text-align:left; margin-top:16px; padding:12px; background:var(--bg-primary); border-radius:var(--radius-sm); font-size:0.8rem; overflow:auto;">${escapeHtml(JSON.stringify(content, null, 2))}</pre>
      </div>`;
    }
  }

  return div;
}

function startArithmeticQuiz(container, content, suppressFeedback) {
  if (!container) return;
  const type = content.arithmeticType || 'addition';
  const max = content.maxNumber || 10;
  const num = content.numQuestions || 10;

  const questions = [];
  for (let i = 0; i < num; i++) {
    const a = Math.floor(Math.random() * max) + 1;
    const b = Math.floor(Math.random() * max) + 1;
    let op, answer;
    switch (type) {
      case 'subtraction': op = '−'; answer = a - b; break;
      case 'multiplication': op = '×'; answer = a * b; break;
      case 'division': op = '÷'; answer = Math.round((a * b) / b * 100) / 100; break;
      default: op = '+'; answer = a + b;
    }
    const displayA = type === 'division' ? a * b : a;
    questions.push({ display: `${displayA} ${op} ${b} = ?`, answer: type === 'division' ? a : answer });
  }

  let qIdx = 0;
  let score = 0;

  if (questions.length > 1) {
    const globalNextBtn = document.getElementById('btnQuizNext');
    if (globalNextBtn) globalNextBtn.disabled = true;
  }

  const render = () => {
    if (qIdx >= questions.length - 1) {
      const globalNextBtn = document.getElementById('btnQuizNext');
      if (globalNextBtn) globalNextBtn.disabled = false;
    }
    if (qIdx >= questions.length) {
      container.innerHTML = suppressFeedback
        ? `<h3>Alle Fragen beantwortet.</h3>`
        : `<h3>Ergebnis: ${score} / ${questions.length}</h3>`;
      return;
    }
    container.innerHTML = `
      <p style="font-size:1.3rem; font-weight:600; margin-bottom:12px;">${questions[qIdx].display}</p>
      <input type="number" id="quizAnswer" style="padding:8px 12px; border:1px solid var(--border); border-radius:4px; width:120px; text-align:center; font-size:1.1rem;" autofocus>
      <button class="btn btn-primary btn-sm" style="margin-left:8px;" id="quizSubmit">→</button>
      <p style="margin-top:8px; font-size:0.85rem; color:var(--text-secondary);">Frage ${qIdx + 1} von ${questions.length}${suppressFeedback ? '' : ` — Punkte: ${score}`}</p>
    `;
    container.querySelector('#quizSubmit').addEventListener('click', () => {
      const val = parseFloat(container.querySelector('#quizAnswer').value);
      if (val === questions[qIdx].answer) score++;
      qIdx++;
      render();
    });
    container.querySelector('#quizAnswer').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') container.querySelector('#quizSubmit').click();
    });
  };
  render();
}

// ==================== MENU HANDLERS ====================

appApi.onMenuImport(async () => {
  if (currentUser && currentUser.role === 'teacher') {
    const result = await appApi.importTopic();
    if (result.success) {
      showToast(t('topics.import.success', { title: result.topicTitle, count: result.importedCount || 0 }), 'success');
      await loadTopics();
      navigateToView('teacher-topics');
    }
  }
});

appApi.onMenuExport(async () => {
  if (currentUser && currentUser.role === 'teacher' && currentTopicId) {
    const result = await appApi.exportTopic(currentTopicId);
    if (result.success) showToast(t('topics.exported'), 'success');
  }
});

// ==================== UTILITIES ====================

function generateId() {
  return 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ==================== TOPIC SHARING ====================

async function openShareDialog(topic) {
  // Can only share if owner or admin
  const isOwner = topic.ownerId === (currentUser && currentUser.id);
  if (!isOwner && currentUser.role !== 'admin') {
    showToast('Nur der Eigentümer oder ein Admin kann dieses Thema teilen.', 'error');
    return;
  }

  // Load available teachers/admins to share with
  let users = [];
  try {
    const allUsers = await appApi.getAllUsers();
    // Show teachers and admins (not the owner themselves, not students)
    users = allUsers.filter(u =>
      (u.role === 'teacher' || u.role === 'admin') &&
      u.id !== (currentUser && currentUser.id)
    );
  } catch (_) {}

  const currentShared = Array.isArray(topic.sharedWith) ? topic.sharedWith : [];
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="import-modules-card" style="min-width:360px;max-width:480px">
      <h3>👥 Thema teilen: <em>${escapeHtml(topic.title)}</em></h3>
      <p style="color:var(--text-secondary);font-size:0.9em;margin-bottom:12px">
        Wähle Lehrer/Admins, die dieses Thema bearbeiten dürfen:
      </p>
      <div id="shareUserList" style="display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto;margin-bottom:16px">
        ${users.length === 0
          ? '<p style="color:var(--text-secondary)">Keine anderen Lehrer/Admins vorhanden.</p>'
          : users.map(u => `
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px;border-radius:var(--radius-sm);background:var(--bg-secondary)">
              <input type="checkbox" value="${escapeHtml(u.id)}" ${currentShared.includes(u.id) ? 'checked' : ''} />
              <span class="user-role-badge ${u.role}">${u.role === 'admin' ? 'Admin' : 'Lehrer'}</span>
              <span>${escapeHtml(u.displayName || u.username)}</span>
            </label>
          `).join('')}
      </div>
      <div class="confirm-actions">
        <button class="btn btn-primary" id="btnShareSave">Freigabe speichern</button>
        <button class="btn btn-secondary" id="btnShareCancel">Abbrechen</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btnShareCancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#btnShareSave').addEventListener('click', async () => {
    const checked = Array.from(overlay.querySelectorAll('#shareUserList input:checked')).map(cb => cb.value);
    try {
      // For Electron mode: use saveTopicSharing IPC; for browser: PATCH API
      if (appApi.setTopicSharing) {
        await appApi.setTopicSharing(topic.id, checked);
      } else if (appApi.saveTopic) {
        // Electron fallback: load full topic, update sharedWith, save
        const fullTopic = topics.find(tt => tt.id === topic.id);
        if (fullTopic) {
          fullTopic.sharedWith = checked;
          await appApi.saveTopic(fullTopic);
        }
      }
      overlay.remove();
      showToast('Freigabe gespeichert', 'success');
      await loadTopics();
      refreshTopicsList();
    } catch (e) {
      showToast('Fehler beim Speichern: ' + e.message, 'error');
    }
  });
  // Close on backdrop click
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ==================== ADMIN VIEWS ====================


let _adminUsersCache = [];
let _adminClassesCache = [];
let _adminUserFilter = 'all';

async function loadAdminView() {
  // Setup nav button handlers for admin views
  document.querySelectorAll('#adminNav .nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      document.querySelectorAll('#adminNav .nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      navigateToView(view);
      if (view === 'admin-users') refreshAdminUsers();
      if (view === 'admin-classes') refreshAdminClasses();
      if (view === 'admin-settings') refreshAdminSettings();
    });
  });

  // Admin tab filters
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _adminUserFilter = btn.getAttribute('data-filter');
      renderUsersList();
    });
  });

  // New User button
  const btnNewUser = document.getElementById('btnNewUser');
  if (btnNewUser) btnNewUser.addEventListener('click', () => openUserForm(null));

  // User form
  const userForm = document.getElementById('userForm');
  const userFormOverlay = document.getElementById('userFormOverlay');
  const btnCancelUser = document.getElementById('btnCancelUser');
  if (btnCancelUser) btnCancelUser.addEventListener('click', () => userFormOverlay.classList.add('hidden'));
  if (userForm) userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('userFormId').value;
    const username = document.getElementById('userFormUsername').value.trim();
    const displayName = document.getElementById('userFormDisplayName').value.trim();
    const role = document.getElementById('userFormRole').value;
    const password = document.getElementById('userFormPassword').value;
    const classCheckboxes = document.querySelectorAll('#userFormClassesList input[type=checkbox]:checked');
    const classIds = Array.from(classCheckboxes).map(cb => cb.value);
    const userData = { username, displayName, role, classIds };
    if (id) userData.id = id;
    if (password) userData.password = password;
    const api = appApi;
    const res = await api.saveUser(userData);
    if (res && res.success !== false) {
      userFormOverlay.classList.add('hidden');
      await refreshAdminUsers();
      showToast('Benutzer gespeichert', 'success');
    } else {
      showToast('Fehler: ' + (res && res.error || 'Unbekannter Fehler'), 'error');
    }
  });

  // New Class button
  const btnNewClass = document.getElementById('btnNewClass');
  if (btnNewClass) btnNewClass.addEventListener('click', () => openClassForm(null));

  // Class form
  const classForm = document.getElementById('classForm');
  const classFormOverlay = document.getElementById('classFormOverlay');
  const btnCancelClass = document.getElementById('btnCancelClass');
  if (btnCancelClass) btnCancelClass.addEventListener('click', () => classFormOverlay.classList.add('hidden'));
  if (classForm) classForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('classFormId').value;
    const name = document.getElementById('classFormName').value.trim();
    const classData = { name };
    if (id) classData.id = id;
    const res = await appApi.saveClass(classData);
    if (res && res.success !== false) {
      classFormOverlay.classList.add('hidden');
      await refreshAdminClasses();
      showToast('Klasse gespeichert', 'success');
    } else {
      showToast('Fehler: ' + (res && res.error || 'Unbekannter Fehler'), 'error');
    }
  });

  // Settings
  const btnSaveSettings = document.getElementById('btnSaveSettings');
  if (btnSaveSettings) btnSaveSettings.addEventListener('click', async () => {
    const setting = document.getElementById('settingAllowEmptyStudentPwd').checked;
    const res = await appApi.saveAppSettings({ allowEmptyStudentPassword: setting });
    if (res && res.success !== false) showToast('Einstellungen gespeichert', 'success');
    else showToast('Fehler beim Speichern', 'error');
  });
}

async function refreshAdminUsers() {
  try {
    _adminUsersCache = await appApi.getAllUsers();
    _adminClassesCache = await appApi.getAllClasses();
    renderUsersList();
  } catch (e) {
    document.getElementById('usersList').innerHTML = `<p class="hint">Fehler: ${escapeHtml(e.message)}</p>`;
  }
}

function renderUsersList() {
  const container = document.getElementById('usersList');
  if (!container) return;
  const filter = _adminUserFilter;
  const users = filter === 'all' ? _adminUsersCache : _adminUsersCache.filter(u => u.role === filter);
  const roleLabels = { admin: 'Admin', teacher: 'Lehrer', student: 'Schüler' };
  const roleBadge = (role) => `<span class="user-role-badge ${role}">${roleLabels[role] || role}</span>`;
  const getClassNames = (classIds) => (classIds || []).map(cid => { const cls = _adminClassesCache.find(c => c.id === cid); return cls ? cls.name : cid; }).join(', ');

  if (!users.length) { container.innerHTML = '<p class="hint">Keine Benutzer gefunden.</p>'; return; }
  container.innerHTML = users.map(u => `
    <div class="admin-list-item" data-id="${escapeHtml(u.id)}">
      <div class="admin-list-item-info">
        <strong>${escapeHtml(u.displayName || u.username)}</strong>
        <span style="color:var(--text-secondary);font-size:0.9em">@${escapeHtml(u.username)}</span>
        ${roleBadge(u.role)}
        ${u.classIds && u.classIds.length ? `<span class="hint">Klassen: ${escapeHtml(getClassNames(u.classIds))}</span>` : ''}
      </div>
      <div class="admin-list-item-actions">
        <button class="btn btn-secondary btn-sm" onclick="openUserForm('${escapeHtml(u.id)}')">✏️ Bearbeiten</button>
        <button class="btn btn-danger btn-sm" onclick="deleteUser('${escapeHtml(u.id)}')">🗑</button>
      </div>
    </div>
  `).join('');
}

function openUserForm(userId) {
  const overlay = document.getElementById('userFormOverlay');
  const title = document.getElementById('userFormTitle');
  const idInput = document.getElementById('userFormId');
  const usernameInput = document.getElementById('userFormUsername');
  const displayNameInput = document.getElementById('userFormDisplayName');
  const roleSelect = document.getElementById('userFormRole');
  const passwordInput = document.getElementById('userFormPassword');
  const classesList = document.getElementById('userFormClassesList');

  const user = userId ? _adminUsersCache.find(u => u.id === userId) : null;
  title.textContent = user ? 'Benutzer bearbeiten' : 'Neuer Benutzer';
  idInput.value = user ? user.id : '';
  usernameInput.value = user ? user.username : '';
  displayNameInput.value = user ? (user.displayName || '') : '';
  roleSelect.value = user ? user.role : 'student';
  passwordInput.value = '';

  // Render class checkboxes
  classesList.innerHTML = _adminClassesCache.map(cls => `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" value="${escapeHtml(cls.id)}" ${user && user.classIds && user.classIds.includes(cls.id) ? 'checked' : ''} />
      ${escapeHtml(cls.name)}
    </label>
  `).join('') || '<span style="color:var(--text-secondary)">Noch keine Klassen angelegt</span>';

  overlay.classList.remove('hidden');
  usernameInput.focus();
}

window.openUserForm = openUserForm;

async function deleteUser(userId) {
  const user = _adminUsersCache.find(u => u.id === userId);
  if (!user) return;
  const confirmed = await appConfirm(`Benutzer "${user.displayName || user.username}" wirklich löschen?`);
  if (!confirmed) return;
  const res = await appApi.deleteUser(userId);
  if (res && res.success !== false) { await refreshAdminUsers(); showToast('Benutzer gelöscht', 'success'); }
  else showToast('Fehler: ' + (res && res.error || '?'), 'error');
}
window.deleteUser = deleteUser;

async function refreshAdminClasses() {
  try {
    _adminClassesCache = await appApi.getAllClasses();
    _adminUsersCache = await appApi.getAllUsers();
    renderClassesList();
  } catch (e) {
    document.getElementById('classesList').innerHTML = `<p class="hint">Fehler: ${escapeHtml(e.message)}</p>`;
  }
}

function renderClassesList() {
  const container = document.getElementById('classesList');
  if (!container) return;
  const getStudentCount = (classId) => _adminUsersCache.filter(u => u.role === 'student' && u.classIds && u.classIds.includes(classId)).length;
  if (!_adminClassesCache.length) { container.innerHTML = '<p class="hint">Noch keine Klassen angelegt.</p>'; return; }
  container.innerHTML = _adminClassesCache.map(cls => `
    <div class="admin-list-item" data-id="${escapeHtml(cls.id)}">
      <div class="admin-list-item-info">
        <strong>${escapeHtml(cls.name)}</strong>
        <span style="color:var(--text-secondary);font-size:0.9em">${getStudentCount(cls.id)} Schüler</span>
      </div>
      <div class="admin-list-item-actions">
        <button class="btn btn-secondary btn-sm" onclick="openClassForm('${escapeHtml(cls.id)}')">✏️ Bearbeiten</button>
        <button class="btn btn-danger btn-sm" onclick="deleteClass('${escapeHtml(cls.id)}')">🗑</button>
      </div>
    </div>
  `).join('');
}

function openClassForm(classId) {
  const overlay = document.getElementById('classFormOverlay');
  const title = document.getElementById('classFormTitle');
  const idInput = document.getElementById('classFormId');
  const nameInput = document.getElementById('classFormName');
  const cls = classId ? _adminClassesCache.find(c => c.id === classId) : null;
  title.textContent = cls ? 'Klasse bearbeiten' : 'Neue Klasse';
  idInput.value = cls ? cls.id : '';
  nameInput.value = cls ? cls.name : '';
  overlay.classList.remove('hidden');
  nameInput.focus();
}
window.openClassForm = openClassForm;

async function deleteClass(classId) {
  const cls = _adminClassesCache.find(c => c.id === classId);
  if (!cls) return;
  const confirmed = await appConfirm(`Klasse "${cls.name}" wirklich löschen?`);
  if (!confirmed) return;
  const res = await appApi.deleteClass(classId);
  if (res && res.success !== false) { await refreshAdminClasses(); showToast('Klasse gelöscht', 'success'); }
  else showToast('Fehler: ' + (res && res.error || '?'), 'error');
}
window.deleteClass = deleteClass;

async function refreshAdminSettings() {
  try {
    const settings = await appApi.getAppSettings();
    const chk = document.getElementById('settingAllowEmptyStudentPwd');
    if (chk) chk.checked = !!settings.allowEmptyStudentPassword;
  } catch (_) {}
}

// ==================== INITIALIZATION ====================

const btnThemeToggle = document.getElementById('btnThemeToggle');
const langSelect = document.getElementById('langSelect');

function initTheme() {
  const saved = localStorage.getItem('app-theme') || 'light';
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    btnThemeToggle.textContent = '☀️';
  }
}

btnThemeToggle.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('app-theme', 'light');
    btnThemeToggle.textContent = '🌙';
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('app-theme', 'dark');
    btnThemeToggle.textContent = '☀️';
  }
});

langSelect.value = getLanguage();
langSelect.addEventListener('change', () => {
  setLanguage(langSelect.value);
});

async function init() {
  initTheme();
  applyTranslations();
  contentEditor = new ContentEditorManager(contentEditorEl);
  populateTypeSelects();

  // Show network QR code for WLAN access (Electron AND Browser)
  if (appApi.getWebServerUrl) {
    const showNetworkQr = async () => {
      return true;
    };
    // Let it run
    if (!(await showNetworkQr())) {
      let retries = 5;
      const timer = setInterval(async () => {
        if ((await showNetworkQr()) || --retries <= 0) clearInterval(timer);
      }, 1000);
    }
  }

  // In browser mode: handle other initialization tasks
  if (!isElectron) {
    // Hide teacher login initially to prevent flickering before settings are fetched
    const adminToggle = document.getElementById('btnShowAdminLogin');
    if (adminToggle) adminToggle.style.display = 'none';

    // Init login screen (password field visibility AND teacher login visibility from server)
    await initLoginScreen();
  }
}

init();
