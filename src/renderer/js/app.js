import { AuthStore, BrowserApi } from './api.js';
import { H5pRenderer } from '../lm-editor/src/modules/h5p-renderer.js';
import { lmHost } from './lm-host.js';
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
import { SessionsDialog } from './views/sessions.js';
import { UserSettingsDialog } from './views/user-settings.js';
import { ContestView } from './views/contest.js';
import { CompanionSettingsView } from './views/companion-settings.js';
import { ClassesView } from './views/classes.js';
import { ClassResultsView } from './views/class-results.js';
import { ClassbookStudent } from './views/classbook-student.js';
import { AiPromptView } from './views/ai-prompt-view.js';
import { HelpView, openHelpPopup } from './views/help-view.js';
import { NotebooksView } from './views/notebooks.js';
import { CategoriesAdminView } from './views/categories-admin.js';
import { FederationAdminView } from './views/federation-admin.js';
import { openDrawingForImage } from './views/drawings-dialog.js';
import { nextcloudState, uploadImageToNextcloud, uploadAttachmentToNextcloud, pickNextcloudImage } from './views/nextcloud.js';
import { storeImage } from './views/image-store.js';
import { initFolding } from './fold.js';
import { contentFromPairs, pairsFromContent } from './dnd-pairs.js';
// Editor des Modultyps „Dokument“ – hängt sich an window.DocSpecEditor.
import { useModuleSource, useTopicModules, useTopicSource, useDocumentId } from './docspec-editor.js';

// ==================== APP COORDINATOR ====================

class App {
  constructor() {
    this.authStore = new AuthStore();
    this.api = new BrowserApi(this.authStore);
    this.renderer = new H5pRenderer({ host: lmHost });
    // Der Dokument-Editor holt sich Nummer und Kopfzeile des bearbeiteten Moduls.
    useModuleSource(() => this.state.editingModuleId);
    useTopicSource(() => this.state.currentTopicId);
    useDocumentId(() => this.state.editingModuleId || this.modulesView?._newModuleId || null);
    useTopicModules(() => this.state.currentTopicModules || []);

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
    this.sessionsDialog = new SessionsDialog(this);
    this.userSettings = new UserSettingsDialog(this);
    // Offen gelassene App (Desktop-Symbol, iPad) erneuert ihre Anmeldung auch unterwegs.
    // Kurze Anmeldungen alle 10 Minuten prüfen – sie verlängern sich so beim Arbeiten.
    setInterval(() => { void this.keepSessionFresh(); }, 10 * 60 * 1000);
    this._lastActivity = Date.now();
    for (const ev of ['keydown', 'pointerdown', 'input']) {
      window.addEventListener(ev, () => { this._lastActivity = Date.now(); }, { capture: true, passive: true });
    }
    this._offerInstall();
    this._answerAuthAsk();
    this._acceptFiles();
    this.contestView  = new ContestView(this);
    this.companionView = new CompanionSettingsView(this);
    this.classesView  = new ClassesView(this);
    this.classResultsView = new ClassResultsView(this);
    this.classbookStudent = new ClassbookStudent(this);
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
    // Einstellungsseiten: nur Überschriften, ein Klick klappt auf.
    initFolding();
  }

  /**
   * Frisches Token holen: „Angemeldet bleiben“ höchstens einmal am Tag (die
   * Anmeldung endet erst nach 90 Tagen ohne Nutzung), sonst höchstens jede
   * Stunde, solange die App offen ist und benutzt wird (endet 12 Stunden nach
   * der letzten Nutzung – nicht mitten in der Arbeit).
   */
  async keepSessionFresh() {
    if (!this.authStore.getToken() || this.state.currentUser?.role === 'student') return;
    const persistent = this.authStore.persistent;
    const store = persistent ? localStorage : sessionStorage;
    let last = 0;
    try { last = Number(store.getItem('lm_token_fresh') || 0); } catch (_) { /* ohne Speicher */ }
    if (!persistent && Date.now() - (this._lastActivity || 0) > 3600 * 1000) return; // niemand arbeitet
    if (Date.now() - last < (persistent ? 24 : 1) * 3600 * 1000) return;
    const res = await this.api.refreshSession().catch(() => null);
    if (!res?.token) return;
    this.authStore.setToken(res.token, persistent);
    try { store.setItem('lm_token_fresh', String(Date.now())); } catch (_) { /* ohne Speicher */ }
  }

  /**
   * Rechte Maustaste → „Öffnen mit“ bzw. Doppelklick (installierte App,
   * Chrome/Edge am PC): .zlm zum Ansehen, Writer/Word/PDF/.xopp umgewandelt
   * mit „Im Notizbuch ablegen“ (views/file-open.js) – diese nach der Anmeldung.
   */
  _acceptFiles() {
    if (!('launchQueue' in window)) return;
    window.launchQueue.setConsumer(async (params) => {
      const { noteHandle } = await import('./xopp-folder.js');
      const files = (await Promise.all((params.files || []).map(async (h) => {
        const f = await h.getFile().catch(() => null);
        noteHandle(f, h); // für das PDF zur .xopp im selben Ordner
        return f;
      }))).filter(Boolean);
      if (!files.length) return;
      const { handleOpenedFiles } = await import('./views/file-open.js');
      await handleOpenedFiles(this, files);
    });
  }

  /**
   * Ein Schülerlink in einem anderen Tab fragt, ob hier eine Lehrkraft
   * angemeldet ist („Als ‹Name› teilnehmen“, views/teacher-as-student.js).
   */
  _answerAuthAsk() {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('lm-auth');
    ch.onmessage = (e) => {
      const role = this.state.currentUser?.role;
      const token = this.authStore.getToken();
      if (e.data?.type === 'who' && token && (role === 'teacher' || role === 'admin')) ch.postMessage({ type: 'token', token });
    };
  }

  /** Nach der Anmeldung: Dateien, die vorher per „Öffnen mit“ kamen. */
  async openPendingFiles() {
    const { takePendingFiles, handleOpenedFiles } = await import('./views/file-open.js');
    const files = takePendingFiles();
    if (files.length) await handleOpenedFiles(this, files);
  }

  /**
   * Seitenleiste einklappen (« / ») – bei wenig Platz bleiben nur die
   * Symbole, die Namen stehen als Tooltip daran. Je Gerät gemerkt.
   */
  initSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('btnSidebarToggle');
    if (!sidebar || !btn) return;
    const KEY = 'lm_sidebar_collapsed';
    // Tooltip mit dem Namen an jedem Menüpunkt (eingeklappt sieht man nur das Symbol).
    sidebar.querySelectorAll('.nav-btn').forEach((b) => {
      if (!b.title) b.title = b.textContent.replace(/\s+/g, ' ').replace(b.querySelector('.nav-icon')?.textContent || '', '').trim();
    });
    const apply = (collapsed) => {
      sidebar.classList.toggle('collapsed', collapsed);
      btn.textContent = collapsed ? '»' : '«';
      btn.title = collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen – mehr Platz für den Inhalt';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-expanded', String(!collapsed));
    };
    let collapsed = false;
    try { collapsed = localStorage.getItem(KEY) === '1'; } catch (_) { /* ohne Speicher */ }
    apply(collapsed);
    btn.addEventListener('click', () => {
      collapsed = !sidebar.classList.contains('collapsed');
      apply(collapsed);
      try { if (collapsed) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (_) { /* gilt bis zum Neuladen */ }
      // Ansichten, die ihre Breite messen (Drag and Drop, Editor), neu einpassen.
      window.dispatchEvent(new Event('resize'));
    });
  }

  /**
   * „Als App installieren“ (Chrome, Edge): Der Knopf erscheint nur, wenn der
   * Browser es anbietet und die App nicht schon installiert läuft. Auf dem
   * iPad geht es über Teilen → Zum Home-Bildschirm (manifest.webmanifest).
   */
  _offerInstall() {
    const btn = document.getElementById('btnInstallApp');
    if (!btn) return;
    let prompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      prompt = e;
      // Auch für Schüler (Klassennotizbuch: 📲 Als App, Startseite: 💻 Schüler-App).
      this.installPrompt = e;
      window.appInstallPrompt = e;
      btn.classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => btn.classList.add('hidden'));
    btn.addEventListener('click', async () => {
      if (!prompt) return;
      prompt.prompt();
      await prompt.userChoice.catch(() => null);
      prompt = null;
      btn.classList.add('hidden');
    });
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

  /**
   * Für Admins: welcher Server das ist – unter „Administration“ und im Tab.
   * Wer mehrere Server betreut, soll nicht aus Versehen den falschen
   * einstellen. `info` kommt nach dem Speichern direkt aus der Vernetzung.
   */
  async showServerName(info) {
    const el = document.getElementById('adminServerName');
    if (!el) return;
    try {
      if (!info) info = await (await fetch('/api/federation/info', { cache: 'no-store' })).json();
    } catch (_) {
      info = null;
    }
    const host = location.host;
    const name = info?.name && info.name !== 'LearningModules' ? info.name : '';
    el.innerHTML = `🖥 ${name ? `<strong>${escapeHtml(name)}</strong><br>` : ''}<span>${escapeHtml(host)}</span>`;
    document.title = `${name || host} – LearningModules`;
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
    // Reiter „📓 Notizbuch | 📒 Klassennotizbuch“ über beiden Ansichten.
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-nb-switch]');
      if (tab && !tab.classList.contains('active')) this.navigateToView(tab.dataset.nbSwitch);
    });
    this.initTheme();
    this.initSidebarToggle();
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
      // Quiz-Arena leiten: ?wh=<Leitungs-Token> – ohne Anmeldung, z. B. am Beamer.
      const hostToken = params.get('wh');
      if (hostToken) {
        await this.contestView.startHost(hostToken);
        return;
      }
      // Themen-Link: ?l=<token> – Name, ggf. Passwort, ggf. Modusauswahl;
      // &m=contest führt direkt in den Wartebereich der Quiz-Arena,
      // &mod=<modul> nur in dieses eine Modul (QR-Code eines Quiz im Dokument).
      // Klassennotizbuch: ?k=<token> – Name und PIN, dann Aufgaben, Ergebnisse, Blätter.
      const classbookToken = params.get('k');
      // Installierte Schüler-App: Liste der Klassennotizbücher (das des Links kommt dazu).
      if (params.get('app') === 'classbook') {
        await this.classbookStudent.startApp(classbookToken);
        return;
      }
      if (classbookToken) {
        await this.classbookStudent.start(classbookToken);
        return;
      }
      const linkToken = params.get('l');
      if (linkToken) {
        await this.loginView.startLinkEntry(linkToken, params.get('m') === 'contest' ? 'contest' : null, params.get('mod'));
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
// Persönliche Einstellungen (views/user-settings.js) – z. B. für den Stift-Editor.
window.appSettings = { get: () => app.userSettings.get(), set: (patch) => app.userSettings.set(patch) };
// Für die klassischen Skripte (content-editors.js), die keine Module importieren.
window.appConfirm = (m) => app.appConfirm(m);
window.appToast = (m, type) => app.showToast(m, type);
// Drag and Drop als Paare (dnd-pairs.js) für den Editor in content-editors.js
window.dndPairs = { contentFromPairs, pairsFromContent };
// Nextcloud für Bilder (views/nextcloud.js): ready, upload(file) → URL | null | false, pick() → URL | null,
// uploadAttachment(file) → { url, name, size, type } | null | false
window.appNextcloud = {
  get ready() { return nextcloudState.ready; },
  upload: (file) => uploadImageToNextcloud(app, file),
  uploadAttachment: (file) => uploadAttachmentToNextcloud(app, file),
  pick: () => pickNextcloudImage(app),
};
// Zeichnungen mit Quelle (views/drawings-dialog.js) für die Bildleiste im Editor (worksheet-image-tools.js).
window.appDrawings = {
  open: (odgUrl, onSrc) => {
    const id = app.state.currentTopicId;
    const topic = (app.state.topics || []).find((t) => t.id === id) || (id ? { id, title: '' } : null);
    return openDrawingForImage(app, topic, odgUrl, onSrc);
  },
};
// Jedes Bild für ein Modul (views/image-store.js): Nextcloud oder – verkleinert,
// mit Grenze – in die App. store(File|Blob|data:-URL, name) → Link | data:-URL | false
window.appImages = {
  store: (input, name) => storeImage(app, input, name),
};
app.init();
