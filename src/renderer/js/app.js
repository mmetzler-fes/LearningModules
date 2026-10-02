import { AuthStore, BrowserApi } from './api.js';
import { H5pRenderer } from './h5p-renderer.js';
import { appConfirm, showToast, escapeHtml } from './utils.js';
import { LoginView } from './views/login.js';
import { TopicsView } from './views/topics.js';
import { ModulesView } from './views/modules.js';
import { QuizView } from './views/quiz.js';
import { ResultsView } from './views/results.js';
import { DashboardView } from './views/dashboard.js';
import { AdminView } from './views/admin.js';
import { LinksView } from './views/links.js';
import { TagsView } from './views/tags.js';
import { ShopView } from './views/shop.js';

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
    this.shopView     = new ShopView(this);
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

  /**
   * Zuletzt geöffnete Hauptansicht der Seitenleiste, damit ein Reload dort
   * weitermacht. Nur Ansichten aus der Seitenleiste – Unteransichten wie der
   * Modul-Editor brauchen Zustand, den es nach dem Reload nicht mehr gibt.
   */
  lastView() {
    try {
      const v = sessionStorage.getItem('lm_last_view');
      return v && document.querySelector(`.sidebar-nav .nav-btn[data-view="${v}"]`) ? v : null;
    } catch (_) {
      return null;
    }
  }

  forgetLastView() {
    try { sessionStorage.removeItem('lm_last_view'); } catch (_) {}
  }

  navigateToView(viewName) {
    const { state } = this;
    if (document.querySelector(`.sidebar-nav .nav-btn[data-view="${viewName}"]`)) {
      try { sessionStorage.setItem('lm_last_view', viewName); } catch (_) {}
    }
    this._views.forEach((v) => v.classList.remove('active'));

    const isTeacherLike = state.currentUser && (state.currentUser.role === 'teacher' || state.currentUser.role === 'admin');
    const navContainer = isTeacherLike ? this._teacherNav : this._studentNav;
    navContainer.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));

    const adminNavEl = document.getElementById('adminNav');
    if (adminNavEl) adminNavEl.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));

    const targetView = document.getElementById('view-' + viewName);
    if (targetView) targetView.classList.add('active');

    // Die Modulliste gehört zu einem Lernthema und hat keinen eigenen Menüpunkt.
    const navName = viewName === 'teacher-modules' ? 'teacher-topics' : viewName;
    const targetBtn = navContainer.querySelector('.nav-btn[data-view="' + navName + '"]')
      || (adminNavEl && adminNavEl.querySelector('.nav-btn[data-view="' + navName + '"]'));
    if (targetBtn) targetBtn.classList.add('active');

    switch (viewName) {
      case 'teacher-dashboard': this.dashboardView.refresh(); break;
      case 'teacher-topics':    this.topicsView.refresh(); break;
      case 'teacher-modules':   this.modulesView.refresh(); break;
      case 'teacher-results':   this.resultsView.refresh(); break;
      case 'teacher-links':     this.linksView.refresh(); break;
      case 'teacher-tags':      this.tagsView.refresh(); break;
      case 'teacher-shop':      this.shopView.refresh(); break;
      case 'admin-settings':    this.adminView.refreshSettings(); break;
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

  /** Kontostand neben dem Namen in der Seitenleiste. */
  updatePointsBadge(balance) {
    const info = document.getElementById('userInfo');
    if (!info || typeof balance !== 'number') return;
    let badge = info.querySelector('.points-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'points-badge';
      badge.title = 'Punkte für den Lernmodule-Shop';
      badge.addEventListener('click', () => this.navigateToView('teacher-shop'));
      info.appendChild(badge);
    }
    badge.textContent = `🪙 ${balance}`;
  }

  async loadPoints() {
    try {
      const data = await this.api.getMyPoints();
      if (data && typeof data.balance === 'number') this.updatePointsBadge(data.balance);
    } catch (_) {}
  }

  /**
   * E-Mail-Adresse ändern. Zwei Wege, die der Server unterscheidet: neue
   * Adresse (Initialpasswort dorthin, Übernahme nach dem ersten Login) oder
   * bestehende Adresse (Zusammenführen nach Eingabe ihres Passworts).
   */
  _initChangeEmail() {
    const overlay = document.getElementById('changeEmailOverlay');
    const form = document.getElementById('changeEmailForm');
    const targetGroup = document.getElementById('changeEmailTargetGroup');
    const result = document.getElementById('changeEmailResult');
    if (!overlay || !form) return;

    const reset = () => {
      form.reset();
      targetGroup.classList.add('hidden');
      result.classList.add('hidden');
      result.textContent = '';
    };
    document.getElementById('btnChangeOwnEmail')?.addEventListener('click', () => {
      reset();
      overlay.classList.remove('hidden');
      document.getElementById('changeEmailNew')?.focus();
    });
    document.getElementById('btnCancelChangeEmail')?.addEventListener('click', () => {
      overlay.classList.add('hidden');
      reset();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newEmail = document.getElementById('changeEmailNew').value.trim();
      const password = document.getElementById('changeEmailPassword').value;
      const target = targetGroup.classList.contains('hidden') ? undefined : document.getElementById('changeEmailTarget').value;
      if (!newEmail || !password) return;
      try {
        const res = await this.api.changeEmail(newEmail, password, target);
        if (res && res.needsTargetPassword) {
          targetGroup.classList.remove('hidden');
          result.textContent = res.message;
          result.classList.remove('hidden');
          document.getElementById('changeEmailTarget').focus();
          return;
        }
        if (res && res.merged && res.session) {
          // Weiter als das zusammengeführte Konto – das alte gibt es nicht mehr.
          overlay.classList.add('hidden');
          reset();
          this.authStore.setToken(res.session.token);
          Object.assign(this.state.currentUser, {
            id: res.session.id,
            email: res.session.email,
            username: res.session.email,
            name: res.session.displayName,
            role: res.session.role,
          });
          // Nicht neu "einsteigen" – das bände die Navigation ein zweites Mal.
          const nameEl = document.querySelector('#userInfo');
          const badge = nameEl?.querySelector('.user-role-badge');
          if (nameEl && badge) {
            nameEl.innerHTML = '';
            nameEl.appendChild(badge);
            nameEl.append(` ${res.session.displayName}`);
          }
          await this.loadTopics();
          await this.loadPoints();
          this.navigateToView('teacher-dashboard');
          this.showToast(
            `Konten zusammengeführt – du bist jetzt als ${res.session.email} angemeldet.` +
              (res.session.role === 'admin' && !document.getElementById('adminNav')?.offsetParent
                ? ' Für die Admin-Funktionen bitte neu anmelden.' : ''),
            'success',
          );
          return;
        }
        if (res && res.pending) {
          result.innerHTML = res.initialPassword
            ? `Für <strong>${escapeHtml(res.newEmail)}</strong> wurde ein Konto angelegt. Es konnte keine E-Mail
               verschickt werden – das Initialpasswort lautet <code>${escapeHtml(res.initialPassword)}</code>.
               Melde dich damit an und vergib ein eigenes Passwort; danach wird dieses Konto übernommen.`
            : `Das Initialpasswort wurde an <strong>${escapeHtml(res.newEmail)}</strong> geschickt. Melde dich damit
               an und vergib ein eigenes Passwort; danach wird dieses Konto übernommen.`;
          result.classList.remove('hidden');
          return;
        }
        this.showToast('Fehler: ' + (res?.message || 'E-Mail konnte nicht geändert werden'), 'error');
      } catch (err) {
        this.showToast('Fehler: ' + err.message, 'error');
      }
    });
  }

  initGlobalEvents() {
    this._initChangeEmail();
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
            this.showToast(res.mergedFrom ? res.message : 'Passwort erfolgreich geändert', 'success');
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
      if (quickToken) {
        await this.loginView.startQuickEntry(quickToken);
        return;
      }
      // Lehrkraft/Admin: nach einem Reload ohne erneutes Login weiter.
      await this.loginView.resumeSession();
    }
  }
}

const app = new App();
window.appNavigate = (v) => app.navigateToView(v);
// Für die klassischen Skripte (content-editors.js), die keine Module importieren.
window.appConfirm = (m) => app.appConfirm(m);
app.init();
