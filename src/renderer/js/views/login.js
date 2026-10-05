import { escapeHtml, escapeAttr } from '../utils.js';

/** Schule und Schuladmin-Recht aus der Login-/Session-Antwort des Servers. */
function schoolFields(res) {
  return {
    schoolId: res.schoolId || null,
    schoolName: res.schoolName || null,
    isSchoolAdmin: !!res.isSchoolAdmin,
  };
}

/** Beschriftung der drei Abfragemodi – auch in der Link-Verwaltung genutzt. */
export const LINK_MODE_LABELS = {
  quiz:  { icon: '🧠', label: 'Quiz',                  hint: 'Mit Rückmeldung nach jeder Aufgabe.' },
  exam:  { icon: '📝', label: 'Klassenarbeit',         hint: 'Ohne Rückmeldung, kein Zurückblättern.' },
  learn: { icon: '💡', label: 'Lernen mit Lösungen',   hint: 'Antworten und sofort die Musterlösung sehen.' },
  companion: { icon: '🦉', label: 'Lernbegleitung',      hint: 'Die Lerneule kommentiert jeden Versuch – mit Lernpunkten, Joker und Denkpause.' },
  contest: { icon: '🏆', label: 'Quiz-Arena',            hint: 'Alle gleichzeitig: schnell und richtig antworten, Bestenliste und Siegertreppchen.' },
};

// ==================== LOGIN VIEW ====================

export class LoginView {
  constructor(app) {
    this.app = app;

    // DOM references
    this._loginScreen   = document.getElementById('loginScreen');
    this._appContainer  = document.getElementById('appContainer');
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
        if (!(await this.app.appConfirm(
          'Konto wirklich löschen?\n\n' +
          'Hast du selbst Module verfasst, wird das Konto nur deaktiviert: Deine Inhalte bleiben erhalten und ' +
          'stehen anderen kostenlos im Shop zur Verfügung, deine Links sind gesperrt. Der Admin kann dich wieder ' +
          'freischalten.\n\nOhne eigene Module wird das Konto gelöscht, erworbene Inhalte verfallen.',
        ))) return;
        let res = null;
        try { res = await this.app.api.deleteAccount(); } catch (_) {}
        if (res && res.success === false) {
          this.app.showToast('Fehler: ' + (res.message || '?'), 'error');
          return;
        }
        this.showLoginScreen();
        this.app.showToast(res && res.deactivated ? 'Konto deaktiviert – deine Inhalte bleiben im Shop.' : 'Konto wurde gelöscht.', 'info');
      });
    }

    // Logout
    if (this._btnLogout) {
      this._btnLogout.addEventListener('click', () => this.showLoginScreen());
    }
  }

  // ==================== QUICK-LINK-EINSTIEG ====================

  /**
   * Einstieg über ?q=<token>: Der Schüler gibt nur seinen Namen ein, danach
   * startet das Quiz sofort. Lehrer-E-Mail und Subscribe-Key entfallen, weil
   * der Token bereits den Zugang darstellt.
   */
  async startQuickEntry(token) {
    const section  = document.getElementById('quickEntrySection');
    const loading  = document.getElementById('quickEntryLoading');
    const ready    = document.getElementById('quickEntryReady');
    const errBox   = document.getElementById('quickEntryError');
    const studentSection = document.getElementById('studentLoginSection');
    if (!section) return false;

    // Normale Anmeldemasken ausblenden, Quick-Bereich zeigen
    section.classList.remove('hidden');
    studentSection?.classList.add('hidden');
    document.getElementById('teacherLoginForm')?.classList.add('hidden');

    const showError = (msg) => {
      loading.classList.add('hidden');
      ready.classList.add('hidden');
      errBox.classList.remove('hidden');
      document.getElementById('quickEntryErrorText').textContent = msg;
    };

    document.getElementById('btnQuickFallback')?.addEventListener('click', () => {
      section.classList.add('hidden');
      studentSection?.classList.remove('hidden');
      history.replaceState(null, '', window.location.pathname);
    });


    let data;
    try {
      data = await this.app.api.getQuickTopic(token);
    } catch (_) {
      showError('Der Server ist nicht erreichbar.');
      return true;
    }

    if (!data || !data.topic) {
      showError(data?.message || 'Dieser Link ist ungültig oder wurde zurückgezogen.');
      return true;
    }

    const modules = (data.topic.modules || []).filter((m) => m.moduleSelected !== false);
    if (modules.length === 0) {
      showError('Für dieses Lernthema sind derzeit keine Aufgaben freigegeben.');
      return true;
    }

    loading.classList.add('hidden');
    ready.classList.remove('hidden');
    document.getElementById('quickEntryTitle').textContent = data.topic.title;
    document.getElementById('quickEntryMeta').textContent =
      `${modules.length} Aufgabe${modules.length !== 1 ? 'n' : ''}`;

    const nameInput = document.getElementById('quickEntryName');
    nameInput?.focus();

    document.getElementById('quickEntryForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return;
      await this._enterQuickQuiz(name, data, token);
    });

    return true;
  }

  async _enterQuickQuiz(studentName, data, token) {
    const { app } = this;
    app.authStore.setToken(null);
    app.state.currentUser = { name: studentName, role: 'student', teacherEmail: data.teacherEmail };
    app.state.topics = [data.topic];
    app.state.linkSession = null;
    // Der Token wandert mit ins Ergebnis: Er sagt dem Server, welche Lehrkraft
    // den Link verteilt hat. Bei fremden Inhalten ist das nicht der
    // Eigentümer des Themas.
    app.state.quickSession = { token };

    await this.enterApp();
    // Direkt ins Quiz, ohne den Umweg über die Themenauswahl.
    await app.quizView.startQuickQuiz(data.topic);
  }

  // ==================== THEMEN-LINK-EINSTIEG ====================

  /**
   * Einstieg über ?l=<token>. Der Schüler gibt seinen Namen ein, bei Bedarf
   * ein Passwort, und wählt – falls die Lehrkraft mehrere Modi freigegeben
   * hat – zwischen Quiz, Klassenarbeit und Lernen mit Lösungen. Ist nur ein
   * Modus erlaubt, startet er ohne Rückfrage.
   */
  async startLinkEntry(token, presetMode = null) {
    // Quiz-Arena nach einem Neuladen: mit demselben Platz weiter, ohne neue Namenseingabe.
    if (await this.app.contestView.resumePlayer(token)) return true;

    const section = document.getElementById('linkEntrySection');
    const loading = document.getElementById('linkEntryLoading');
    const ready   = document.getElementById('linkEntryReady');
    const errBox  = document.getElementById('linkEntryError');
    if (!section) return false;

    section.classList.remove('hidden');
    document.getElementById('studentLoginSection')?.classList.add('hidden');
    document.getElementById('adminLoginSection')?.classList.add('hidden');

    const showError = (msg) => {
      loading.classList.add('hidden');
      ready.classList.add('hidden');
      errBox.classList.remove('hidden');
      document.getElementById('linkEntryErrorText').textContent = msg;
    };

    let info;
    try {
      info = await this.app.api.getLinkInfo(token);
    } catch (_) {
      showError('Der Server ist nicht erreichbar.');
      return true;
    }
    if (!info || !info.linkId) {
      showError(info?.message || 'Dieser Link ist ungültig, deaktiviert oder wurde zurückgezogen.');
      return true;
    }
    if (!info.moduleCount) {
      showError('Für diesen Link sind derzeit keine Aufgaben hinterlegt.');
      return true;
    }

    loading.classList.add('hidden');
    ready.classList.remove('hidden');

    document.getElementById('linkEntryTitle').textContent = info.className ? `${info.name} · ${info.className}` : info.name;
    const parts = [`${info.moduleCount} Aufgabe${info.moduleCount !== 1 ? 'n' : ''}`];
    if (info.topicTitles?.length) parts.push(info.topicTitles.join(' · '));
    document.getElementById('linkEntryMeta').textContent = parts.join(' — ');

    // Passwortfeld nur zeigen, wenn der Link eines verlangt.
    const pwGroup = document.getElementById('linkEntryPasswordGroup');
    pwGroup?.classList.toggle('hidden', !info.requiresPassword);
    const pwInput = document.getElementById('linkEntryPassword');
    if (pwInput) pwInput.required = !!info.requiresPassword;

    // Der QR-Code im Wartebereich führt direkt in die Quiz-Arena (…&m=contest).
    // Hat eine Freigabe nur die Quiz-Arena, führt auch ihr Übungslink dorthin.
    if (!presetMode && (info.modes || []).length === 0 && info.contestEnabled) presetMode = 'contest';
    if (presetMode === 'contest') {
      if (!info.contestEnabled) {
        showError('Für diese Freigabe ist die Quiz-Arena derzeit nicht eingeschaltet.');
        return true;
      }
      info.modes = ['contest'];
    } else if ((info.modes || []).length === 0) {
      showError('Über diesen Link ist derzeit nichts freigegeben. Bitte bei der Lehrkraft nachfragen.');
      return true;
    }
    if (info.modes.length === 1 && info.modes[0] === 'contest') {
      document.querySelector('#linkEntryReady .quick-entry-label').textContent = '🏆 Quiz-Arena:';
      document.getElementById('linkEntryMeta').textContent = 'Gib deinen Namen ein – dann geht es in den Wartebereich.';
    }

    const modeGroup = document.getElementById('linkEntryModeGroup');
    const modeChoices = document.getElementById('linkEntryModeChoices');
    const multi = (info.modes || []).length > 1;
    modeGroup?.classList.toggle('hidden', !multi);
    if (modeChoices) {
      modeChoices.innerHTML = '';
      if (multi) {
        info.modes.forEach((mode, i) => {
          const meta = LINK_MODE_LABELS[mode];
          if (!meta) return;
          const label = document.createElement('label');
          label.className = 'link-mode-choice';
          label.innerHTML = `
            <input type="radio" name="linkEntryMode" value="${escapeAttr(mode)}" ${i === 0 ? 'checked' : ''} />
            <span class="link-mode-choice-text">
              <strong>${meta.icon} ${escapeHtml(meta.label)}</strong>
              <small>${escapeHtml(meta.hint)}</small>
            </span>`;
          modeChoices.appendChild(label);
        });
      }
    }

    if (info.singleAttempt && (info.modes || []).includes('exam')) {
      const note = document.getElementById('linkEntryAttemptNote');
      note?.classList.remove('hidden');
    }

    const nameInput = document.getElementById('linkEntryName');
    nameInput?.focus();

    const form = document.getElementById('linkEntryForm');
    const errText = document.getElementById('linkEntryFormError');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errText?.classList.add('hidden');

      const studentName = nameInput.value.trim();
      if (!studentName) return;
      const password = pwInput ? pwInput.value : '';
      const mode = multi
        ? form.querySelector('input[name="linkEntryMode"]:checked')?.value
        : info.modes[0];

      if (mode === 'contest') {
        const err = await this.app.contestView.joinAsPlayer(token, { studentName, password });
        if (err && errText) { errText.textContent = err; errText.classList.remove('hidden'); }
        return;
      }

      let data;
      try {
        data = await this.app.api.startLinkRun(token, { studentName, password, mode });
      } catch (_) {
        if (errText) { errText.textContent = 'Der Server ist nicht erreichbar.'; errText.classList.remove('hidden'); }
        return;
      }
      if (!data || !data.topics) {
        if (errText) {
          errText.textContent = data?.message || 'Der Start ist fehlgeschlagen.';
          errText.classList.remove('hidden');
        }
        return;
      }
      await this._enterLinkRun(token, data);
    });

    return true;
  }

  /** Übergibt den geprüften Durchlauf an die Quiz-Ansicht. */
  async _enterLinkRun(token, data) {
    const { app } = this;
    app.authStore.setToken(null);
    app.state.currentUser = { name: data.studentName, role: 'student', teacherEmail: data.teacherEmail };
    app.state.topics = data.topics;
    app.state.linkSession = {
      token,
      linkId: data.linkId,
      linkName: data.linkName,
      mode: data.mode,
    };

    await this.enterApp();
    await app.quizView.startLinkRun(data);
  }

  async _onAdminLogin(e) {
    e.preventDefault();
    const email = this._adminUsername.value.trim();
    const pass  = this._adminPassword.value;
    if (!email || !pass) return;
    try {
      // Das Häkchen gilt auch für den zweiten Schritt (Code): Der Server hat
      // es im Zwischen-Token, der Browser merkt es sich für den Speicherort.
      this._remember = !!document.getElementById('loginRemember')?.checked;
      const res = await this.app.api.login(email, pass, this._remember);
      if (res && res.twoFactorRequired) {
        this._showTwoFactorStep(res.challenge);
        return;
      }
      await this._finishLogin(res, this._adminLoginErr);
    } catch (_) {
      this._adminLoginErr.textContent = 'Server nicht erreichbar';
      this._adminLoginErr.classList.remove('hidden');
    }
  }

  /** Sitzung aus der Login-Antwort übernehmen – nach Passwort bzw. nach dem 2FA-Code. */
  async _finishLogin(res, errEl) {
    if (!(res && res.token && (res.role === 'admin' || res.role === 'teacher'))) {
      errEl.textContent = res?.message || res?.error || 'Falsche Anmeldedaten';
      errEl.classList.remove('hidden');
      return false;
    }
    this.app.authStore.setToken(res.token, !!res.remember);
    this.app.state.currentUser = {
      name: res.displayName || res.username || res.email,
      role: res.role,
      id: res.id,
      username: res.email || res.username,
      email: res.email,
      mustChangePassword: !!res.mustChangePassword,
      ...schoolFields(res),
    };
    errEl.classList.add('hidden');
    this._hideTwoFactorStep();
    if (res.mustChangePassword) {
      // Erst das Passwort ändern – die übrigen Endpunkte sind bis dahin gesperrt.
      this.app.startForcedPasswordChange(() => this.enterApp());
      return true;
    }
    await this.enterApp();
    return true;
  }

  // ---- Zweiter Anmeldeschritt (2FA) ----

  _bindTwoFactorStep() {
    if (this._twoFactorBound) return;
    this._twoFactorBound = true;
    const form = document.getElementById('twoFactorLoginForm');
    const input = document.getElementById('twoFactorLoginCode');
    const err = document.getElementById('twoFactorLoginError');
    document.getElementById('btnTwoFactorBack')?.addEventListener('click', () => this._hideTwoFactorStep());
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) return;
      try {
        const res = await this.app.api.loginTwoFactor(this._challenge, code);
        if (res && res.token && res.usedRecoveryCode) {
          this.app.showToast(
            `Wiederherstellungscode verbraucht – noch ${res.recoveryLeft} übrig. Unter „🔐 Zwei-Faktor“ lassen sich neue erzeugen.`,
            res.recoveryLeft <= 2 ? 'error' : 'info',
          );
        }
        if (!(await this._finishLogin(res, err))) {
          input.select();
          // Abgelaufen: zurück zum Passwort, ein neuer Versuch braucht ein neues Zwischen-Token.
          if (res && res.statusCode === 401 && /abgelaufen/.test(res.message || '')) this._hideTwoFactorStep(res.message);
        }
      } catch (_) {
        err.textContent = 'Server nicht erreichbar';
        err.classList.remove('hidden');
      }
    });
  }

  _showTwoFactorStep(challenge) {
    this._bindTwoFactorStep();
    this._challenge = challenge;
    this._adminLoginErr.classList.add('hidden');
    this._adminLoginForm.classList.add('hidden');
    const form = document.getElementById('twoFactorLoginForm');
    form.classList.remove('hidden');
    document.getElementById('twoFactorLoginError').classList.add('hidden');
    const input = document.getElementById('twoFactorLoginCode');
    input.value = '';
    input.focus();
  }

  _hideTwoFactorStep(message) {
    this._challenge = null;
    document.getElementById('twoFactorLoginForm')?.classList.add('hidden');
    this._adminLoginForm?.classList.remove('hidden');
    if (message) {
      this._adminLoginErr.textContent = message;
      this._adminLoginErr.classList.remove('hidden');
    }
  }

  /**
   * Nach einem Reload mit dem gespeicherten Token weitermachen, statt erneut
   * nach dem Passwort zu fragen. Liefert true, wenn das geklappt hat; ein
   * abgelaufenes oder ungültiges Token führt still zum Login-Bildschirm.
   */
  async resumeSession() {
    const { app } = this;
    if (!app.authStore.getToken()) return false;
    let res;
    try {
      res = await app.api.me();
    } catch (_) {
      return false;
    }
    if (!res || !res.id || (res.role !== 'admin' && res.role !== 'teacher')) {
      app.authStore.setToken(null);
      return false;
    }
    app.state.currentUser = {
      name: res.displayName || res.email,
      role: res.role,
      id: res.id,
      username: res.email,
      email: res.email,
      mustChangePassword: !!res.mustChangePassword,
      ...schoolFields(res),
    };
    if (res.mustChangePassword) {
      app.startForcedPasswordChange(() => this.enterApp());
      return true;
    }
    await this.enterApp(app.lastView());
    return true;
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
        this.app.authStore.setToken(res.token, false);
        this.app.state.currentUser = {
          name: res.displayName || res.username || email, role: 'teacher', id: res.id, username: email, email, ...schoolFields(res),
        };
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
    this.app.forgetLastView();

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
    document.getElementById('schoolAdminNav')?.classList.add('hidden');
    this._loginScreen.classList.remove('hidden');

    // Reset teacher/admin fields
    this._adminUsername.value = '';
    this._adminPassword.value = '';
    this._adminSec.classList.add('hidden');
    this._adminLoginErr.classList.add('hidden');
    this._hideTwoFactorStep();
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
  }

  async enterApp(startView = null) {
    const { state, api } = this.app;
    const { currentUser } = state;

    this._loginScreen.classList.add('hidden');
    this._appContainer.classList.remove('hidden');

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

    // Schuladmin ist ein Zusatzrecht – das Menü kommt zu dem der Lehrkraft dazu.
    document.getElementById('schoolAdminNav')?.classList.toggle('hidden', !currentUser.isSchoolAdmin);
    if (currentUser.schoolName && currentUser.role !== 'student') {
      this._userInfo.insertAdjacentHTML('beforeend',
        `<div class="user-school" title="Deine Schule">🏫 ${escapeHtml(currentUser.schoolName)}</div>`);
    }

    this.app.setupNavigation();
    await this.app.loadTopics();
    if (currentUser.role === 'admin' || currentUser.role === 'teacher') this.app.loadPoints();

    if (currentUser.role === 'admin' || currentUser.role === 'teacher') {
      this.app.navigateToView(startView || 'teacher-dashboard');
      if (currentUser.role === 'admin') this.app.adminView.load();
    } else {
      this.app.navigateToView('student-quiz');
    }
  }
}
