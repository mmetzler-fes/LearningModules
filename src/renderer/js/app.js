import { AuthStore, BrowserApi } from './api.js';
import { H5pRenderer } from './h5p-renderer.js';
import { appConfirm, showToast, escapeHtml } from './utils.js';
import { LoginView } from './views/login.js';
import { TopicsView } from './views/topics.js';
import { ModulesView } from './views/modules.js';
import { QuizView } from './views/quiz.js';
import { ResultsView } from './views/results.js';
import { AdminView } from './views/admin.js';
import { LinksView } from './views/links.js';
import { TagsView } from './views/tags.js';
import { ShopView } from './views/shop.js';
import { SchoolsAdminView, MySchoolView } from './views/schools.js';
import { TwoFactorDialog } from './views/two-factor.js';
import { ContestView } from './views/contest.js';
import { CompanionSettingsView } from './views/companion-settings.js';
import { ClassesView } from './views/classes.js';
import { ClassResultsView } from './views/class-results.js';
import { AiPromptView } from './views/ai-prompt-view.js';
import { HelpView, openHelpPopup } from './views/help-view.js';
import { NotebooksView } from './views/notebooks.js';
import { CategoriesAdminView } from './views/categories-admin.js';
import { FederationAdminView } from './views/federation-admin.js';

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
    this.adminView    = new AdminView(this);
    this.linksView    = new LinksView(this);
    this.tagsView     = new TagsView(this);
    this.shopView     = new ShopView(this);
    this.schoolsView  = new SchoolsAdminView(this);
    this.mySchoolView = new MySchoolView(this);
    this.twoFactorDialog = new TwoFactorDialog(this);
    this.contestView  = new ContestView(this);
    this.companionView = new CompanionSettingsView(this);
    this.classesView  = new ClassesView(this);
    this.classResultsView = new ClassResultsView(this);
    this.aiPromptView = new AiPromptView(this);
    this.helpView = new HelpView(this);
    this.notebooksView = new NotebooksView(this);
    this.categoriesAdminView = new CategoriesAdminView(this);
    this.federationAdminView = new FederationAdminView(this);
    // ❓ neben erklärungsbedürftigen Stellen (data-help="datei#anker"), auch in
    // Dialogen, die erst später entstehen – deshalb ein Lauscher fürs Dokument.
    document.addEventListener('click', (e) => {
      const hint = e.target.closest('[data-help]');
      if (!hint) return;
      e.preventDefault();
      e.stopPropagation();
      openHelpPopup(this, hint.dataset.help);
    }, true);
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
    if (state.currentUser.isSchoolAdmin) {
      document.querySelectorAll('#schoolAdminNav .nav-btn').forEach((btn) => {
        btn.addEventListener('click', () => this.navigateToView(btn.dataset.view));
      });
    }
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
    // Den Modul-Editor ohne Speichern verlassen: letzten Stand als Entwurf sichern.
    if (viewName !== 'create-module' && this.modulesView?._draft
      && document.getElementById('view-create-module')?.classList.contains('active')) {
      this.modulesView.leaveEditor();
    }
    // Das Dashboard ist in den LernModulen aufgegangen; ein gemerkter alter
    // Menüpunkt (sessionStorage) führt dorthin.
    if (viewName === 'teacher-dashboard') viewName = 'teacher-topics';
    if (document.querySelector(`.sidebar-nav .nav-btn[data-view="${viewName}"]`)) {
      try { sessionStorage.setItem('lm_last_view', viewName); } catch (_) {}
    }
    this._views.forEach((v) => v.classList.remove('active'));

    const isTeacherLike = state.currentUser && (state.currentUser.role === 'teacher' || state.currentUser.role === 'admin');
    const navContainer = isTeacherLike ? this._teacherNav : this._studentNav;
    navContainer.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));

    const adminNavEl = document.getElementById('adminNav');
    if (adminNavEl) adminNavEl.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    const schoolNavEl = document.getElementById('schoolAdminNav');
    schoolNavEl?.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));

    const targetView = document.getElementById('view-' + viewName);
    if (targetView) targetView.classList.add('active');

    // Die Modulliste gehört zu einem Lernthema und hat keinen eigenen Menüpunkt.
    const navName = viewName === 'teacher-modules' ? 'teacher-topics' : viewName;
    const targetBtn = navContainer.querySelector('.nav-btn[data-view="' + navName + '"]')
      || (adminNavEl && adminNavEl.querySelector('.nav-btn[data-view="' + navName + '"]'))
      || schoolNavEl?.querySelector('.nav-btn[data-view="' + navName + '"]');
    if (targetBtn) targetBtn.classList.add('active');

    switch (viewName) {
      case 'teacher-topics':    this.topicsView.refresh(); break;
      case 'teacher-notebooks': this.notebooksView.refresh(); break;
      case 'teacher-modules':   this.modulesView.refresh(); break;
      case 'teacher-results':   this.resultsView.refresh(); break;
      case 'teacher-links':     this.linksView.refresh(); break;
      case 'teacher-classes':   this.classesView.refresh(); break;
      case 'teacher-class-results': this.classResultsView.refresh(); break;
      case 'teacher-companion': this.companionView.refresh(); break;
      case 'teacher-ai-prompt': this.aiPromptView.refresh(); break;
      case 'teacher-help':      this.helpView.refresh(); break;
      case 'teacher-tags':      this.tagsView.refresh(); break;
      case 'teacher-shop':      this.shopView.refresh(); break;
      case 'admin-settings':    this.adminView.refreshSettings(); break;
      case 'admin-users':       this.adminView.refreshUsers(); break;
      case 'admin-topics':      this.adminView.refreshAdminTopics(); break;
      case 'admin-schools':     this.schoolsView.refresh(); break;
      case 'admin-groups':      this.adminView.refreshGroups(); break;
      case 'school-admin':      this.mySchoolView.refresh(); break;
      case 'admin-whitelist':   this.adminView.refreshWhitelistBlacklist(); break;
      case 'admin-categories':  this.categoriesAdminView.refresh(); break;
      case 'admin-federation':  this.federationAdminView.refresh(); break;
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

    this.initZoom();

    const langSelect = document.getElementById('langSelect');
    if (langSelect) {
      langSelect.value = getLanguage();
      langSelect.addEventListener('change', () => setLanguage(langSelect.value));
    }
  }

  /**
   * Zoom getrennt für Seitenleiste und Inhalt (CSS `zoom`), in festen Stufen
   * und je Gerät gemerkt – am Beamer anders als am eigenen Rechner. Dialoge
   * hängen am body und bleiben davon unberührt.
   */
  initZoom() {
    const STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
    const targets = { sidebar: document.getElementById('sidebar'), content: document.getElementById('mainContent') };
    const key = (which) => `lm_zoom_${which}`;
    const read = (which) => {
      let v = 1;
      try { v = parseFloat(localStorage.getItem(key(which))) || 1; } catch (_) {}
      return STEPS.includes(v) ? v : 1;
    };
    const apply = (which, v) => {
      const el = targets[which];
      if (el) el.style.zoom = v === 1 ? '' : String(v);
      const row = document.querySelector(`.zoom-row[data-zoom="${which}"]`);
      if (row) {
        row.querySelector('.zoom-value').textContent = `${Math.round(v * 100)} %`;
        row.querySelector('.zoom-minus').disabled = v <= STEPS[0];
        row.querySelector('.zoom-plus').disabled = v >= STEPS[STEPS.length - 1];
      }
      try { if (v === 1) localStorage.removeItem(key(which)); else localStorage.setItem(key(which), String(v)); } catch (_) {}
      // Ansichten, die sich an die verfügbare Fläche anpassen (Drag and Drop), neu rechnen lassen.
      window.dispatchEvent(new Event('lm-zoom'));
    };
    for (const which of Object.keys(targets)) {
      apply(which, read(which));
      const row = document.querySelector(`.zoom-row[data-zoom="${which}"]`);
      if (!row) continue;
      const step = (dir) => {
        const i = STEPS.indexOf(read(which));
        apply(which, STEPS[Math.min(STEPS.length - 1, Math.max(0, i + dir))]);
      };
      row.querySelector('.zoom-minus').addEventListener('click', () => step(-1));
      row.querySelector('.zoom-plus').addEventListener('click', () => step(1));
      row.querySelector('.zoom-value').addEventListener('click', () => apply(which, 1));
    }

    // Strg + Mausrad zoomt den Bereich unter dem Mauszeiger – Seitenleiste oder
    // Inhalt – statt der ganzen Seite. Zusammenziehen auf dem Touchpad kommt
    // im Browser ebenso an. Strg + Plus/Minus bleibt der Browser-Zoom.
    // Ein Rad-Klick (≈100) ist eine Stufe; kleine Touchpad-Schritte sammeln sich.
    for (const which of Object.keys(targets)) {
      const el = targets[which];
      if (!el) continue;
      let acc = 0;
      el.addEventListener('wheel', (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        acc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        if (Math.abs(acc) < 50) return;
        const dir = acc < 0 ? 1 : -1;
        acc = 0;
        const i = STEPS.indexOf(read(which));
        apply(which, STEPS[Math.min(STEPS.length - 1, Math.max(0, i + dir))]);
      }, { passive: false });
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
          this.navigateToView('teacher-topics');
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
      // Rechnername aus dem Start-Link (…&pc=%COMPUTERNAME%) für diese Sitzung
      // merken; er geht mit jedem Ergebnis mit. Der nicht ersetzte Platzhalter
      // zählt nicht.
      const pc = (params.get('pc') || '').trim();
      if (/^[A-Za-z0-9._-]{1,63}$/.test(pc)) {
        try { sessionStorage.setItem('lm_pc', pc); } catch (_) { /* ohne Rechnername */ }
      }
      // Quiz-Arena leiten: ?wh=<Leitungs-Token> – ohne Anmeldung, z. B. am Beamer.
      const hostToken = params.get('wh');
      if (hostToken) {
        await this.contestView.startHost(hostToken);
        return;
      }
      // Themen-Link: ?l=<token> – Name, ggf. Passwort, ggf. Modusauswahl;
      // &m=contest führt direkt in den Wartebereich der Quiz-Arena.
      const linkToken = params.get('l');
      if (linkToken) {
        await this.loginView.startLinkEntry(linkToken, params.get('m') === 'contest' ? 'contest' : null);
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
