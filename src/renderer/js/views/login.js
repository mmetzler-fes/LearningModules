import { escapeHtml } from '../utils.js';

// ==================== LOGIN VIEW ====================

export class LoginView {
  constructor(app) {
    this.app = app;

    // DOM references
    this._loginScreen   = document.getElementById('loginScreen');
    this._appContainer  = document.getElementById('appContainer');
    this._loginForm     = document.getElementById('loginForm');
    this._loginName     = document.getElementById('loginName');
    this._teacherEmail  = document.getElementById('teacherEmailInput');
    this._studentSec    = document.getElementById('studentLoginSection');
    this._adminSec      = document.getElementById('adminLoginSection');
    this._btnShowAdmin  = document.getElementById('btnShowAdminLogin');
    this._btnShowStudent = document.getElementById('btnShowStudentLogin');
    this._adminLoginForm = document.getElementById('adminLoginForm');
    this._adminUsername = document.getElementById('adminUsername');
    this._adminPassword = document.getElementById('adminPassword');
    this._adminLoginErr = document.getElementById('adminLoginError');
    this._teacherLoginForm = document.getElementById('teacherLoginForm');
    this._forgotPasswordForm = document.getElementById('forgotPasswordForm');
    this._forgotForm    = document.getElementById('forgotForm');
    this._forgotEmail   = document.getElementById('forgotEmail');
    this._forgotMsg     = document.getElementById('forgotMessage');
    this._btnForgot     = document.getElementById('btnForgotPassword');
    this._btnBackLogin  = document.getElementById('btnBackToLogin');
    this._registerForm  = document.getElementById('teacherRegisterForm');
    this._registerInner = document.getElementById('registerForm');
    this._regEmail      = document.getElementById('registerEmail');
    this._regDisplayName = document.getElementById('registerDisplayName');
    this._regPassword   = document.getElementById('registerPassword');
    this._regError      = document.getElementById('registerError');
    this._btnShowReg    = document.getElementById('btnShowRegister');
    this._btnBackReg    = document.getElementById('btnBackToLoginFromRegister');
    this._btnDeleteAcc  = document.getElementById('btnDeleteAccount');
    this._btnLogout     = document.getElementById('btnLogout');
    this._userInfo      = document.getElementById('userInfo');

    this._bindEvents();
  }

  _bindEvents() {
    // Student login
    if (this._loginForm) {
      this._loginForm.addEventListener('submit', (e) => this._onStudentLogin(e));
    }

    // Show admin / show student toggles
    if (this._btnShowAdmin) {
      this._btnShowAdmin.addEventListener('click', () => {
        this._studentSec.classList.add('hidden');
        this._adminSec.classList.remove('hidden');
        this._adminLoginErr.classList.add('hidden');
      });
    }
    if (this._btnShowStudent) {
      this._btnShowStudent.addEventListener('click', () => {
        this._adminSec.classList.add('hidden');
        this._studentSec.classList.remove('hidden');
        this._adminLoginErr.classList.add('hidden');
      });
    }

    // Admin / teacher login
    if (this._adminLoginForm) {
      this._adminLoginForm.addEventListener('submit', (e) => this._onAdminLogin(e));
    }

    // Forgot password
    if (this._btnForgot) {
      this._btnForgot.addEventListener('click', () => {
        if (this._teacherLoginForm) this._teacherLoginForm.classList.add('hidden');
        if (this._forgotPasswordForm) this._forgotPasswordForm.classList.remove('hidden');
        if (this._forgotMsg) this._forgotMsg.textContent = '';
        if (this._forgotEmail && this._adminUsername) this._forgotEmail.value = this._adminUsername.value;
      });
    }
    if (this._btnBackLogin) {
      this._btnBackLogin.addEventListener('click', () => {
        if (this._forgotPasswordForm) this._forgotPasswordForm.classList.add('hidden');
        if (this._teacherLoginForm) this._teacherLoginForm.classList.remove('hidden');
      });
    }
    if (this._forgotForm) {
      this._forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = this._forgotEmail ? this._forgotEmail.value.trim() : '';
        if (!email) return;
        try { await this.app.api.forgotPassword(email); } catch (_) {}
        if (this._forgotMsg) {
          this._forgotMsg.textContent = 'Falls ein Konto mit dieser E-Mail existiert, wurde ein neues Passwort gesendet.';
          this._forgotMsg.classList.remove('hidden');
        }
      });
    }

    // Register
    if (this._btnShowReg) {
      this._btnShowReg.addEventListener('click', () => {
        if (this._teacherLoginForm) this._teacherLoginForm.classList.add('hidden');
        if (this._registerForm) this._registerForm.classList.remove('hidden');
        if (this._regError) this._regError.classList.add('hidden');
      });
    }
    if (this._btnBackReg) {
      this._btnBackReg.addEventListener('click', () => {
        if (this._registerForm) this._registerForm.classList.add('hidden');
        if (this._teacherLoginForm) this._teacherLoginForm.classList.remove('hidden');
      });
    }
    if (this._registerInner) {
      this._registerInner.addEventListener('submit', (e) => this._onRegister(e));
    }

    // Delete account
    if (this._btnDeleteAcc) {
      this._btnDeleteAcc.addEventListener('click', async () => {
        if (!(await this.app.appConfirm('Konto wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.'))) return;
        try { await this.app.api.deleteAccount(); } catch (_) {}
        this.showLoginScreen();
        this.app.showToast('Konto wurde gelöscht.', 'info');
      });
    }

    // Logout
    if (this._btnLogout) {
      this._btnLogout.addEventListener('click', () => this.showLoginScreen());
    }
  }

  async _onStudentLogin(e) {
    e.preventDefault();
    const teacherEmail = this._teacherEmail ? this._teacherEmail.value.trim() : '';
    const studentName  = this._loginName.value.trim();
    const loginError   = document.getElementById('studentLoginError');
    if (!teacherEmail || !studentName) return;
    try {
      const data = await this.app.api.getTeacherTopics(teacherEmail);
      // New format: { topics: [...], examMode: bool }  — fallback: plain array
      const topics = data && Array.isArray(data.topics) ? data.topics : (Array.isArray(data) ? data : null);
      if (!topics) throw new Error('Lehrer nicht gefunden');
      this.app.authStore.setToken(null);
      this.app.state.currentUser = { name: studentName, role: 'student', teacherEmail };
      this.app.state.topics = topics;
      this.app.state.examModeEnabled = !!(data && data.examMode);
      if (loginError) loginError.classList.add('hidden');
      await this.enterApp();
    } catch (_) {
      if (loginError) { loginError.textContent = 'Lehrer-E-Mail nicht gefunden.'; loginError.classList.remove('hidden'); }
    }
  }

  async _onAdminLogin(e) {
    e.preventDefault();
    const email = this._adminUsername.value.trim();
    const pass  = this._adminPassword.value;
    if (!email || !pass) return;
    try {
      const res = await this.app.api.login(email, pass);
      if (res.token && (res.role === 'admin' || res.role === 'teacher')) {
        this.app.authStore.setToken(res.token);
        this.app.state.currentUser = {
          name: res.displayName || res.username || res.email,
          role: res.role,
          id: res.id,
          username: res.email || res.username,
          email: res.email,
        };
        this._adminLoginErr.classList.add('hidden');
        await this.enterApp();
      } else {
        this._adminLoginErr.textContent = res.error || 'Falsche Anmeldedaten';
        this._adminLoginErr.classList.remove('hidden');
      }
    } catch (_) {
      this._adminLoginErr.textContent = 'Server nicht erreichbar';
      this._adminLoginErr.classList.remove('hidden');
    }
  }

  async _onRegister(e) {
    e.preventDefault();
    const email       = this._regEmail ? this._regEmail.value.trim() : '';
    const password    = this._regPassword ? this._regPassword.value : '';
    const displayName = this._regDisplayName ? this._regDisplayName.value.trim() : '';
    if (!email || !password) return;
    try {
      const res = await this.app.api.register(email, password, displayName);
      if (res.token) {
        this.app.authStore.setToken(res.token);
        this.app.state.currentUser = { name: res.displayName || res.username || email, role: 'teacher', id: res.id, username: email, email };
        if (this._registerForm) this._registerForm.classList.add('hidden');
        if (this._teacherLoginForm) this._teacherLoginForm.classList.remove('hidden');
        await this.enterApp();
      } else {
        if (this._regError) { this._regError.textContent = res.error || 'Registrierung fehlgeschlagen'; this._regError.classList.remove('hidden'); }
      }
    } catch (_) {
      if (this._regError) { this._regError.textContent = 'Server nicht erreichbar'; this._regError.classList.remove('hidden'); }
    }
  }

  async initLoginScreen() {
    const adminToggle = document.getElementById('btnShowAdminLogin');
    if (adminToggle) adminToggle.style.display = '';
  }

  showLoginScreen() {
    const { state } = this.app;
    state.currentUser   = null;
    state.quizState     = null;
    state.currentTopicId = null;
    this.app.authStore.setToken(null);

    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));

    const quizPlayerArea   = document.getElementById('quizPlayerArea');
    const quizResultArea   = document.getElementById('quizResultArea');
    const quizTopicSelect  = document.getElementById('quizTopicSelect');
    const quizModuleContainer = document.getElementById('quizModuleContainer');
    const h5pContainer     = document.getElementById('h5pContainer');
    const quizSubtitle     = document.getElementById('quizSubtitle');
    const teacherNav       = document.getElementById('teacherNav');
    const studentNav       = document.getElementById('studentNav');
    const adminNavEl       = document.getElementById('adminNav');

    if (quizPlayerArea)   quizPlayerArea.classList.add('hidden');
    if (quizResultArea)   quizResultArea.classList.add('hidden');
    if (quizTopicSelect)  quizTopicSelect.classList.remove('hidden');
    if (quizModuleContainer) quizModuleContainer.innerHTML = '';
    if (h5pContainer)     h5pContainer.innerHTML = '';
    if (quizSubtitle)     quizSubtitle.textContent = t('quiz.subtitle');

    this._appContainer.classList.add('hidden');
    if (teacherNav)  teacherNav.classList.add('hidden');
    if (studentNav)  studentNav.classList.add('hidden');
    if (adminNavEl)  adminNavEl.classList.add('hidden');
    this._loginScreen.classList.remove('hidden');

    // Reset student fields
    if (this._teacherEmail) this._teacherEmail.value = '';
    this._loginName.value = '';
    // Reset teacher/admin fields
    this._adminUsername.value = '';
    this._adminPassword.value = '';
    this._adminSec.classList.add('hidden');
    this._adminLoginErr.classList.add('hidden');
    this._studentSec.classList.remove('hidden');
    if (this._teacherLoginForm)  this._teacherLoginForm.classList.remove('hidden');
    if (this._forgotPasswordForm) this._forgotPasswordForm.classList.add('hidden');
    if (this._registerForm)      this._registerForm.classList.add('hidden');
    if (this._forgotEmail)       this._forgotEmail.value = '';
    if (this._forgotMsg)         { this._forgotMsg.textContent = ''; this._forgotMsg.classList.add('hidden'); }
    if (this._regEmail)          this._regEmail.value = '';
    if (this._regDisplayName)    this._regDisplayName.value = '';
    if (this._regPassword)       this._regPassword.value = '';
    if (this._regError)          this._regError.classList.add('hidden');
    this._loginName.focus();
  }

  async enterApp() {
    const { state, api } = this.app;
    const { currentUser } = state;

    this._loginScreen.classList.add('hidden');
    this._appContainer.classList.remove('hidden');

    await this.app.loadExamMode();

    const teacherNav = document.getElementById('teacherNav');
    const studentNav = document.getElementById('studentNav');
    const adminNavEl = document.getElementById('adminNav');

    if (currentUser.role === 'admin') {
      teacherNav.classList.remove('hidden');
      studentNav.classList.add('hidden');
      if (adminNavEl) adminNavEl.classList.remove('hidden');
      this._userInfo.innerHTML = `<span class="user-role-badge admin">Admin</span> ${escapeHtml(currentUser.name)}`;
      if (this._btnDeleteAcc) this._btnDeleteAcc.classList.add('hidden');
    } else if (currentUser.role === 'teacher') {
      teacherNav.classList.remove('hidden');
      studentNav.classList.add('hidden');
      if (adminNavEl) adminNavEl.classList.add('hidden');
      this._userInfo.innerHTML = `<span class="user-role-badge teacher">${t('role.teacher')}</span> ${escapeHtml(currentUser.name)}`;
      if (this._btnDeleteAcc) this._btnDeleteAcc.classList.remove('hidden');
    } else {
      teacherNav.classList.add('hidden');
      studentNav.classList.remove('hidden');
      if (adminNavEl) adminNavEl.classList.add('hidden');
      if (this._btnDeleteAcc) this._btnDeleteAcc.classList.add('hidden');
      this._userInfo.innerHTML = `<span class="user-role-badge student">${t('role.student')}</span> ${escapeHtml(currentUser.name)}`;
    }

    this.app.setupNavigation();
    await this.app.loadTopics();

    if (currentUser.role === 'admin' || currentUser.role === 'teacher') {
      this.app.navigateToView('teacher-dashboard');
      if (currentUser.role === 'admin') this.app.adminView.load();
    } else {
      this.app.navigateToView('student-topics');
    }
  }
}
