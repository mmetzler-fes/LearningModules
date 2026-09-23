import { AuthStore, BrowserApi } from './api.js';
import { H5pRenderer } from './h5p-renderer.js';
import { appConfirm, showToast } from './utils.js';
import { LoginView } from './views/login.js';
import { TopicsView } from './views/topics.js';
import { ModulesView } from './views/modules.js';
import { QuizView } from './views/quiz.js';
import { ResultsView } from './views/results.js';
import { DashboardView } from './views/dashboard.js';
import { AdminView } from './views/admin.js';
import { LinksView } from './views/links.js';
import { TagsView } from './views/tags.js';

// ==================== APP COORDINATOR ====================

class App {
  constructor() {
    this.authStore = new AuthStore();
    this.api = new BrowserApi(this.authStore);
    this.renderer = new H5pRenderer();

    this.state = {
      currentUser: null,
      topics: [],
      currentTopicId: null,
      currentTopicModules: [],
      currentTopicRawSummary: null,
      editingModuleId: null,
      editingTopicId: null,
      contentEditor: null,
      quizState: null,
      /**
       * Läuft die Sitzung über einen Themen-Link, steht hier alles, was der
       * Durchlauf braucht: Token, Name des Links, gewählter Modus.
       */
      linkSession: null,
      quickSession: null,
      tags: [],
    };

    this._views = document.querySelectorAll('.view');
    this._toastContainer = document.getElementById('toastContainer');
    this._teacherNav = document.getElementById('teacherNav');
    this._studentNav = document.getElementById('studentNav');

    this.loginView    = new LoginView(this);
    this.topicsView   = new TopicsView(this);
    this.modulesView  = new ModulesView(this);
    this.quizView     = new QuizView(this);
    this.resultsView  = new ResultsView(this);
    this.dashboardView = new DashboardView(this);
    this.adminView    = new AdminView(this);
    this.linksView    = new LinksView(this);
    this.tagsView     = new TagsView(this);
  }

  showToast(message, type = 'info') {
    showToast(message, type);
  }

  appConfirm(message) {
    return appConfirm(message);
  }

  /**
   * Themen der angemeldeten Lehrkraft. Schüler laden nichts nach: Was sie
   * sehen, bringt der Themen-Link bzw. der Quick-Link mit.
   */
  async loadTopics() {
    const { state, api } = this;
    if (state.currentUser && state.currentUser.role === 'student') return;
    state.topics = await api.getTopics();
  }

  /** Tags der Lehrkraft – Grundlage für Filter und Auswahl. */
  async loadTags() {
    try {
      this.state.tags = await this.api.getTags();
    } catch (_) {
      this.state.tags = [];
    }
    return this.state.tags;
  }

  setupNavigation() {
    const { state } = this;
    const isTeacherLike = state.currentUser.role === 'teacher' || state.currentUser.role === 'admin';
    const navContainer = isTeacherLike ? this._teacherNav : this._studentNav;
    navContainer.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.navigateToView(btn.dataset.view));
    });
    if (state.currentUser.role === 'admin') {
      const adminNavEl = document.getElementById('adminNav');
      if (adminNavEl) {
        adminNavEl.querySelectorAll('.nav-btn').forEach((btn) => {
          btn.addEventListener('click', () => this.navigateToView(btn.dataset.view));
        });
      }
    }
  }

  navigateToView(viewName) {
    const { state } = this;
    this._views.forEach((v) => v.classList.remove('active'));

    const isTeacherLike = state.currentUser && (state.currentUser.role === 'teacher' || state.currentUser.role === 'admin');
    const navContainer = isTeacherLike ? this._teacherNav : this._studentNav;
    navContainer.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));

    const adminNavEl = document.getElementById('adminNav');
    if (adminNavEl) adminNavEl.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));

    const targetView = document.getElementById('view-' + viewName);
    if (targetView) targetView.classList.add('active');

    const targetBtn = navContainer.querySelector('.nav-btn[data-view="' + viewName + '"]')
      || (adminNavEl && adminNavEl.querySelector('.nav-btn[data-view="' + viewName + '"]'));
    if (targetBtn) targetBtn.classList.add('active');

    switch (viewName) {
      case 'teacher-dashboard': this.dashboardView.refresh(); break;
      case 'teacher-topics':    this.topicsView.refresh(); break;
      case 'teacher-modules':   this.modulesView.refresh(); break;
      case 'teacher-results':   this.resultsView.refresh(); break;
      case 'teacher-links':     this.linksView.refresh(); break;
      case 'teacher-tags':      this.tagsView.refresh(); break;
      case 'admin-users':       this.adminView.refreshUsers(); break;
      case 'admin-topics':      this.adminView.refreshAdminTopics(); break;
      case 'admin-whitelist':   this.adminView.refreshWhitelistBlacklist(); break;
    }
  }

  initTheme() {
    const saved = localStorage.getItem('app-theme') || 'light';
    const btnThemeToggle = document.getElementById('btnThemeToggle');
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (btnThemeToggle) btnThemeToggle.textContent = '☀️';
    }
    if (btnThemeToggle) {
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
    }

    const langSelect = document.getElementById('langSelect');
    if (langSelect) {
      langSelect.value = getLanguage();
      langSelect.addEventListener('change', () => setLanguage(langSelect.value));
    }
  }

  /**
   * Erzwingt den Passwortwechsel: der Dialog lässt sich nicht abbrechen,
   * solange das Initialpasswort gilt.
   */
  startForcedPasswordChange(onDone) {
    this._passwordChangeForced = true;
    this._onPasswordChanged = onDone;
    const overlay = document.getElementById('changePasswordOverlay');
    const hint    = document.getElementById('changePasswordForced');
    const cancel  = document.getElementById('btnCancelChangePassword');
    hint?.classList.remove('hidden');
    cancel?.classList.add('hidden');
    overlay?.classList.remove('hidden');
    document.getElementById('changePasswordOld')?.focus();
  }

  async _endForcedPasswordChange() {
    this._passwordChangeForced = false;
    if (this.state.currentUser) this.state.currentUser.mustChangePassword = false;
    document.getElementById('changePasswordForced')?.classList.add('hidden');
    document.getElementById('btnCancelChangePassword')?.classList.remove('hidden');
    const done = this._onPasswordChanged;
    this._onPasswordChanged = null;
    if (done) await done();
  }

  initGlobalEvents() {
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
          this.showToast('Die neuen Passwörter stimmen nicht überein.', 'error');
          return;
        }

        if (newPassword.length < 6) {
          this.showToast('Das neue Passwort muss mindestens 6 Zeichen lang sein.', 'error');
          return;
        }

        try {
          const res = await this.api.changePassword(oldPassword, newPassword);
          if (res && res.success !== false) {
            // Der Server liefert ein neues Token ohne die Initialpasswort-Sperre.
            if (res.token) this.authStore.setToken(res.token);
            this.showToast('Passwort erfolgreich geändert', 'success');
            changePasswordForm.reset();
            changePasswordOverlay.classList.add('hidden');
            if (this._passwordChangeForced) await this._endForcedPasswordChange();
          } else {
            this.showToast('Fehler: ' + (res?.message || res?.error || 'Ungültiges Passwort'), 'error');
          }
        } catch (err) {
          this.showToast('Fehler: ' + err.message, 'error');
        }
      });
    }
  }

  async init() {
    this.initTheme();
    this.initGlobalEvents();
    applyTranslations();

    const contentEditorEl = document.getElementById('contentEditor');
    if (contentEditorEl && typeof ContentEditorManager !== 'undefined') {
      this.state.contentEditor = new ContentEditorManager(contentEditorEl);
    }

    this.modulesView.populateTypeSelects();

    if (!window.isElectron) {
      const adminToggle = document.getElementById('btnShowAdminLogin');
      if (adminToggle) adminToggle.style.display = 'none';
      await this.loginView.initLoginScreen();

      const params = new URLSearchParams(window.location.search);
      // Themen-Link: ?l=<token> – Name, ggf. Passwort, ggf. Modusauswahl
      const linkToken = params.get('l');
      if (linkToken) {
        await this.loginView.startLinkEntry(linkToken);
        return;
      }
      // Quick-Link: ?q=<token> führt direkt zur Namenseingabe
      const quickToken = params.get('q');
      if (quickToken) await this.loginView.startQuickEntry(quickToken);
    }
  }
}

const app = new App();
window.appNavigate = (v) => app.navigateToView(v);
app.init();
