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
      examModeEnabled: false,
      quizState: null,
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
  }

  showToast(message, type = 'info') {
    showToast(message, type);
  }

  appConfirm(message) {
    return appConfirm(message);
  }

  async loadTopics() {
    const { state, api } = this;
    if (state.currentUser && state.currentUser.role === 'student') {
      const data = await api.getTeacherTopics(state.currentUser.teacherEmail);
      if (data && Array.isArray(data.topics)) {
        state.topics = data.topics;
        // Exam mode is bundled with the topics response — always up-to-date
        state.examModeEnabled = !!(data.examMode);
      } else {
        // Fallback: old server returning plain array
        state.topics = Array.isArray(data) ? data : [];
      }
    } else {
      state.topics = await api.getTopics();
    }
  }

  async loadExamMode() {
    const { currentUser } = this.state;
    try {
      let result;
      if (currentUser && currentUser.role === 'student' && currentUser.teacherEmail) {
        result = await this.api.getTeacherExamMode(currentUser.teacherEmail);
      } else {
        result = await this.api.getExamMode();
      }
      this.state.examModeEnabled = !!(result && result.enabled);
    } catch (_) {
      this.state.examModeEnabled = false;
    }
    const chk = document.getElementById('chkExamMode');
    if (chk) chk.checked = this.state.examModeEnabled;
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
      case 'student-topics':    this.quizView.refreshStudentTopics(); break;
      case 'student-quiz':      this.quizView.refreshQuizSelect(); break;
      case 'admin-users':       this.adminView.refreshUsers(); break;
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
            this.showToast('Passwort erfolgreich geändert', 'success');
            changePasswordForm.reset();
            changePasswordOverlay.classList.add('hidden');
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
    }
  }
}

const app = new App();
window.appNavigate = (v) => app.navigateToView(v);
app.init();
