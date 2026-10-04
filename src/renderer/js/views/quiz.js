import { escapeHtml } from '../utils.js';
import { collectAnswer } from '../answer-eval.js';
import { CompanionRun, COMPANION_MAX } from './companion-run.js';

// ==================== QUIZ VIEW ====================

export class QuizView {
  constructor(app) {
    this.app = app;

    this._quizTopicSelect       = document.getElementById('quizTopicSelect');
    this._quizPlayerArea        = document.getElementById('quizPlayerArea');
    this._quizResultArea        = document.getElementById('quizResultArea');
    this._quizSubtitle          = document.getElementById('quizSubtitle');
    this._quizProgressFill      = document.getElementById('quizProgressFill');
    this._quizInfo              = document.getElementById('quizInfo');
    this._quizModuleContainer   = document.getElementById('quizModuleContainer');
    this._btnQuizNext           = document.getElementById('btnQuizNext');
    this._btnQuizPrev           = document.getElementById('btnQuizPrev');
    this._btnQuizCancel         = document.getElementById('btnQuizCancel');

    this._bindEvents();
  }

  _bindEvents() {
    if (this._btnQuizNext) {
      this._btnQuizNext.addEventListener('click', () => {
        const { state } = this.app;
        if (!state.quizState) return;
        const qs = state.quizState;
        const mod = qs.modules[qs.currentIndex];

        // Lernbegleitung: Prüfen, Kommentar, ggf. Denkpause – die Eule entscheidet.
        if (this._companion) {
          this._companion.onPrimary();
          return;
        }

        // Im Lernmodus erst die Lösung zeigen; weiter geht es beim zweiten Klick.
        if (this._isLearnRun() && !qs.revealed) {
          qs.answers[qs.currentIndex] = collectAnswer(mod, this._quizModuleContainer);
          this._revealSolution(qs.answers[qs.currentIndex]);
          qs.revealed = true;
          (qs.revealedAt || (qs.revealedAt = {}))[qs.currentIndex] = true;
          this._btnQuizNext.textContent =
            qs.currentIndex < qs.modules.length - 1 ? t('quiz.next') : t('quiz.finish');
          return;
        }

        qs.answers[qs.currentIndex] = collectAnswer(mod, this._quizModuleContainer);
        this._goNext();
      });
    }

    if (this._btnQuizPrev) {
      this._btnQuizPrev.addEventListener('click', () => {
        const { state } = this.app;
        if (!state.quizState || state.quizState.currentIndex <= 0) return;
        const mod = state.quizState.modules[state.quizState.currentIndex];
        state.quizState.answers[state.quizState.currentIndex] = collectAnswer(mod, this._quizModuleContainer);
        state.quizState.currentIndex--;
        this._renderModule();
      });
    }

    if (this._btnQuizCancel) {
      this._btnQuizCancel.addEventListener('click', async () => {
        if (!(await this.app.appConfirm(t('quiz.cancel.confirm')))) return;
        this._endCompanion();
        this.app.state.quizState = null;
        this._quizPlayerArea.classList.add('hidden');
        this._quizModuleContainer.innerHTML = '';
        this._quizTopicSelect.classList.remove('hidden');
        this._quizSubtitle.textContent = t('quiz.subtitle');
      });
    }
  }

  /**
   * Themenauswahl beim Aufruf von 'student-quiz'. Für Schüler ist sie leer:
   * Der Themen-Link bestimmt, was bearbeitet wird. Lehrkräfte können ihre
   * eigenen Themen hier weiterhin zur Probe durchspielen.
   */
  async refreshQuizSelect() {
    if (this.app.state.quizState) return;

    const { state } = this.app;
    this._quizTopicSelect.innerHTML = '';
    this._quizTopicSelect.classList.remove('hidden');
    this._quizPlayerArea.classList.add('hidden');
    this._quizResultArea.classList.add('hidden');

    if (state.currentUser && state.currentUser.role === 'student') {
      this._quizTopicSelect.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🔗</span>
          <p>Dieser Durchlauf ist beendet. Öffne den Link erneut, um noch einmal zu starten.</p>
        </div>`;
      return;
    }

    await this.app.loadTopics();
    const myTopics = state.topics;

    if (myTopics.length === 0) {
      this._quizTopicSelect.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🧠</span>
          <p>Noch keine Lernthemen angelegt.</p>
        </div>`;
      return;
    }

    for (const topic of myTopics) {
      const moduleCount = (topic.modules || []).filter((m) => m.moduleSelected !== false).length;
      if (moduleCount === 0) continue;
      const card = document.createElement('div');
      card.className = 'quiz-topic-card';
      card.innerHTML = `
        <div class="quiz-topic-card-info">
          <h3>${escapeHtml(topic.title)}</h3>
          <p>${moduleCount} Module</p>
        </div>
        <button class="btn btn-primary">🧠 Quiz starten</button>`;
      card.querySelector('.btn').addEventListener('click', () => this._startQuiz(topic));
      this._quizTopicSelect.appendChild(card);
    }
  }

  /**
   * Start über den Quick-Link: Subscribe-Key und Themenauswahl werden
   * übersprungen, der Token hat den Zugang bereits nachgewiesen.
   */
  async startQuickQuiz(topic) {
    return this._startQuiz(topic);
  }

  /**
   * Start über einen Themen-Link: Die Module aller im Link gewählten Themen
   * werden zu einem Durchlauf zusammengezogen – in der Reihenfolge, in der
   * die Lehrkraft sie angeordnet hat.
   */
  async startLinkRun(data) {
    const modules = [];
    for (const topic of data.topics || []) {
      for (const mod of topic.modules || []) {
        modules.push({ ...mod, _topicId: topic.id, _topicTitle: topic.title });
      }
    }
    if (modules.length === 0) {
      this.app.showToast('Dieser Link enthält derzeit keine Aufgaben.', 'error');
      return;
    }

    this.app.state.quizState = {
      // Das Ergebnis hängt am ersten Thema des Links; welche Aufgaben
      // tatsächlich drankamen, steht ohnehin in den Details.
      topicId: (data.topics[0] || {}).id || null,
      // Themenname und Linkname getrennt halten – sonst stünde in der
      // Ergebnisliste zweimal dasselbe.
      topicTitle: (data.topics || []).map((t) => t.title).join(', '),
      modules,
      currentIndex: 0,
      answers: [],
      startTime: Date.now(),
      mode: data.mode,
      linkToken: this.app.state.linkSession?.token || null,
      linkName: data.linkName,
      revealed: false,
    };

    this._endCompanion();
    if (data.mode === 'companion') this._companion = new CompanionRun(this, data.companion);
    this._enterPlayer(data.linkName);
  }

  async _startQuiz(topic) {
    // Always fetch the latest data from the server so teacher changes are immediately visible
    await this.app.loadTopics();
    const freshTopic = this.app.state.topics.find((t) => t.id === topic.id);
    if (!freshTopic) {
      this.app.showToast('Dieses Thema ist nicht mehr verfügbar.', 'error');
      this.refreshQuizSelect();
      return;
    }

    // Beim Quick-Link bringt der Schülerzugang die Module samt Inhalt mit.
    // Die Themenliste der Lehrkraft trägt dagegen nur Zusammenfassungen –
    // zum Durchspielen werden die Inhalte nachgeladen.
    let source = freshTopic.modules || [];
    if (this.app.state.currentUser?.role !== 'student') {
      const full = await this.app.api.getTopicModules(freshTopic.id).catch(() => null);
      source = (Array.isArray(full) ? full : [])
        .filter((m) => !m.parentId)
        .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
    }
    const modules = source.filter((m) => m.moduleSelected !== false);
    if (modules.length === 0) { this.app.showToast(t('quiz.no.modules'), 'error'); return; }

    this.app.state.quizState = {
      topicId: freshTopic.id,
      topicTitle: freshTopic.title,
      modules,
      currentIndex: 0,
      answers: [],
      startTime: Date.now(),
      // Ohne Themen-Link gilt der normale Quiz-Modus mit Rückmeldung.
      mode: 'quiz',
      linkToken: null,
      // Beim Start über den Quick-Link entscheidet dieser Token, wem das
      // Ergebnis gutgeschrieben wird; die Lehrervorschau hat keinen.
      quickToken: this.app.state.quickSession?.token || null,
      linkName: null,
      revealed: false,
    };

    this._endCompanion();
    this._enterPlayer(topic.title);
  }

  /** Gemeinsames Umschalten in den Player, egal woher der Start kam. */
  _enterPlayer(title) {
    this.app.navigateToView('student-quiz');
    this._quizTopicSelect.classList.add('hidden');
    this._quizPlayerArea.classList.remove('hidden');
    this._quizResultArea.classList.add('hidden');
    this._quizSubtitle.textContent = `${t('quiz.title')}: ${title}`;
    if (this._companion) this._companion.mount(document.getElementById('quizActions'));
    this._renderModule();
  }

  /** Nächste Aufgabe oder Abschluss. */
  _goNext() {
    const qs = this.app.state.quizState;
    if (!qs) return;
    qs.currentIndex++;
    if (qs.currentIndex >= qs.modules.length) this._finishQuiz();
    else this._renderModule();
  }

  /** Aufgabe frisch aufbauen (Lernbegleitung: neuer Versuch bei Kopfrechnen & Co.). */
  _rebuildCurrentView() {
    const qs = this.app.state.quizState;
    if (!qs?.views) return;
    qs.views[qs.currentIndex]?.remove();
    qs.views[qs.currentIndex] = null;
    this._renderModule();
  }

  _endCompanion() {
    if (this._companion) this._companion.unmount();
    this._companion = null;
  }

  /** Klassenarbeit: keine Sofort-Rückmeldung, kein Zurückblättern. */
  _isExamRun() {
    return this.app.state.quizState?.mode === 'exam';
  }

  /** Lernen mit Lösungen: nach jeder Aufgabe erscheint die Musterlösung. */
  _isLearnRun() {
    return this.app.state.quizState?.mode === 'learn';
  }

  _renderModule() {
    const { state } = this.app;
    if (!state.quizState) return;

    const qs = state.quizState;
    const { modules, currentIndex } = qs;
    const mod = modules[currentIndex];
    const typeDef = H5P_TYPES[mod.type] || {};
    const progress = (currentIndex / modules.length) * 100;
    // Im Lernmodus bleibt eine schon gezeigte Lösung beim Zurückblättern stehen.
    qs.revealed = !!(qs.revealedAt && qs.revealedAt[currentIndex]);

    this._quizProgressFill.style.width = `${progress}%`;
    this._quizInfo.innerHTML = `
      <strong>${t('quiz.module.of', { current: currentIndex + 1, total: modules.length })}</strong>
      ${escapeHtml(mod.title)}
      <span class="quiz-type-badge">${typeDef.icon || ''} ${typeDef.name || mod.type}</span>
      ${mod._topicTitle ? `<span class="quiz-topic-badge">${escapeHtml(mod._topicTitle)}</span>` : ''}`;

    // Jede Aufgabe behält ihre Ansicht bis zum Abschluss. Beim Blättern wird
    // sie nur aus- und wieder eingehängt, nicht neu aufgebaut – so bleiben
    // Kreuze, Eingaben, gezogene Wörter und Markierungen genau so stehen,
    // wie der Schüler sie verlassen hat, gleich welcher Aufgabentyp.
    const container = this._quizModuleContainer;
    for (const el of [...container.children]) {
      el.querySelectorAll('video, audio').forEach((media) => { try { media.pause(); } catch (_) {} });
      // Vorlesen (Diktat ohne Aufnahme) ebenfalls beenden.
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      el.remove();
    }
    if (!qs.views) qs.views = [];
    let view = qs.views[currentIndex];
    if (view) {
      container.appendChild(view);
    } else {
      view = document.createElement('div');
      view.className = 'quiz-module-view';
      // Erst einhängen, dann aufbauen: Manche Aufgaben messen beim Aufbau ihre Größe.
      container.appendChild(view);
      this.app.renderer.renderPreview(mod, typeDef, view, {
        quizMode: true,
        // Die Lernbegleitung gibt die Rückmeldung selbst – die eingebauten
        // Prüfknöpfe der Aufgaben würden sie umgehen.
        examMode: this._isExamRun() || !!this._companion,
        // Für Aufgaben, die etwas hochladen (Audio Recorder)
        upload: {
          linkToken: qs.linkToken || null,
          quickToken: qs.quickToken || null,
          studentName: this.app.state.currentUser?.name || '',
        },
      });
      qs.views[currentIndex] = view;
    }

    this._btnQuizNext.textContent = this._isLearnRun() && !qs.revealed
      ? '💡 Lösung anzeigen'
      : currentIndex < modules.length - 1 ? t('quiz.next') : t('quiz.finish');

    if (this._btnQuizPrev) {
      const prevOk = !this._isExamRun() && !this._companion && currentIndex > 0;
      this._btnQuizPrev.style.display = prevOk ? 'inline-block' : 'none';
      this._btnQuizPrev.textContent = t('quiz.prev');
    }
    if (this._companion) this._companion.onTaskShown();
  }

  /**
   * Zeigt die Musterlösung zur aktuellen Aufgabe. Die richtige Antwort
   * stammt aus derselben Auswertung, die auch das Ergebnis erzeugt – so
   * kann die angezeigte Lösung gar nicht von der Bewertung abweichen.
   */
  _revealSolution(answer) {
    const panel = document.createElement('div');
    panel.className = 'quiz-solution-panel';
    panel.innerHTML = `
      <div class="quiz-solution-head">${answer.isCorrect ? '✅ Richtig' : '💡 Musterlösung'}</div>
      ${answer.userAnswer ? `<p><strong>Deine Antwort:</strong> ${escapeHtml(String(answer.userAnswer))}</p>` : ''}
      ${answer.correctAnswer ? `<p><strong>Richtig wäre:</strong> ${escapeHtml(String(answer.correctAnswer))}</p>` : ''}
      ${answer.score ? `<p><strong>Auswertung:</strong> ${escapeHtml(String(answer.score))}</p>` : ''}`;
    const qs = this.app.state.quizState;
    // In die Ansicht der Aufgabe, damit die Lösung beim Zurückblättern mitkommt.
    ((qs && qs.views && qs.views[qs.currentIndex]) || this._quizModuleContainer).appendChild(panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async _finishQuiz() {
    const { state, api } = this.app;
    const { quizState, currentUser } = state;
    const isExam = quizState.mode === 'exam';
    const isLearn = quizState.mode === 'learn';
    const companion = this._companion;
    this._endCompanion();
    // Informationsmodule bleiben in der Liste sichtbar, aber aus der
    // Rechnung heraus – sonst hinge die Prozentzahl daran, wie viele
    // Infoseiten ein Thema enthält. Dasselbe gilt in der Lernbegleitung für
    // Aufgaben, die kein Automat bewerten kann.
    const graded = quizState.answers.filter((a) => a && !a.informational && !a.ungraded);
    // Lernbegleitung: Lernpunkte statt Anteilen, 10 je Aufgabe.
    const rawScore = companion
      ? graded.reduce((sum, a) => sum + (a.lernpunkte || 0), 0)
      : graded.reduce((sum, a) => sum + (a.points ?? (a.isCorrect ? 1 : 0)), 0);
    const score = Math.round(rawScore * 100) / 100;
    const total = companion ? graded.length * COMPANION_MAX : graded.length;
    const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

    if (isLearn) {
      // Lernen mit Lösungen ist zum Üben da – dabei entsteht kein Eintrag im
      // Ergebnis-Log der Lehrkraft.
    } else if (currentUser.role === 'student') {
      await api.submitPublicResult({
        teacherEmail: currentUser.teacherEmail,
        linkToken: quizState.linkToken || undefined,
        quickToken: quizState.quickToken || undefined,
        mode: quizState.mode,
        studentName: currentUser.name,
        topicId: quizState.topicId,
        moduleId: null,
        score, maxScore: total,
        payload: {
          topicTitle: quizState.topicTitle,
          linkName: quizState.linkName || null,
          percentage,
          details: quizState.answers.filter(Boolean),
          ...(companion ? { jokersUsed: companion.jokersUsed } : {}),
        },
      });
    } else {
      await api.saveQuizResult({
        username: currentUser.name, topicId: quizState.topicId, topicTitle: quizState.topicTitle,
        score, totalQuestions: total, percentage, details: quizState.answers,
      });
    }

    this._quizPlayerArea.classList.add('hidden');
    this._quizResultArea.classList.remove('hidden');

    // Ein Thema kann auch nur aus Informationen bestehen. Dann gibt es
    // nichts zu bewerten, und "0 %" wäre eine Note, die niemand vergeben hat.
    const nothingGraded = total === 0;
    const pctClass = percentage >= 70 ? 'good' : percentage >= 40 ? 'medium' : 'poor';
    this._quizResultArea.innerHTML = `
      <div class="quiz-final-result">
        <div class="quiz-result-icon">${companion ? '🦉' : nothingGraded ? '📖' : percentage >= 80 ? '🏆' : percentage >= 50 ? '👍' : '📚'}</div>
        <h2>${t('quiz.complete')}</h2>
        ${companion && !nothingGraded ? `<p class="companion-summary">⭐ Du hast <strong>${score}</strong> von ${total} Lernpunkten gesammelt${companion.jokersUsed ? ` und ${companion.jokersUsed} Joker gespielt` : ''}.</p>` : ''}
        ${nothingGraded
          ? '<p style="margin:12px 0;">Durchgesehen – dieses Thema enthält nur Informationen, es gibt nichts zu bewerten.</p>'
          : `<div class="quiz-result-score ${pctClass}">
          <span class="quiz-result-number">${score.toLocaleString('de-DE')} / ${total}</span>
          <span class="quiz-result-pct">${percentage}%</span>
        </div>`}
        <p>${t('quiz.topic')}: <strong>${escapeHtml(quizState.topicTitle)}</strong></p>
        ${isLearn ? '<p class="hint">Übungsdurchlauf – dieses Ergebnis wird nicht gespeichert.</p>' : ''}
        <div class="quiz-result-details">
          ${isExam
            ? '<p style="color:var(--text-secondary);">Klassenarbeit: Die Detail-Rückmeldung ist ausgeblendet.</p>'
            : quizState.answers.filter(Boolean).map((a, i) => `
              <div class="result-detail-item ${a.informational ? '' : a.isCorrect ? 'correct' : 'wrong'}">
                <span class="result-detail-icon">${a.informational ? 'ℹ️' : a.isCorrect ? '✅' : '❌'}</span>
                <div>
                  <strong>${i + 1}. ${escapeHtml(a.moduleTitle)}</strong>
                  ${a.userAnswer ? `<br>${t('common.your.answer')}: ${escapeHtml(String(a.userAnswer))}` : ''}
                  ${a.score ? `<br>Auswertung: ${escapeHtml(String(a.score))}` : ''}
                  ${!a.isCorrect && a.correctAnswer ? `<br>${t('results.correct')}: ${escapeHtml(String(a.correctAnswer))}` : ''}
                </div>
              </div>`).join('')}
        </div>
        <div class="form-actions" style="justify-content:center; margin-top:24px;">
          <button class="btn btn-primary" id="btnQuizRestart">${t('quiz.restart')}</button>
        </div>
      </div>`;

    this._quizResultArea.querySelector('#btnQuizRestart').addEventListener('click', () => {
      state.quizState = null;
      this._quizResultArea.classList.add('hidden');
      this._quizTopicSelect.classList.remove('hidden');
      this._quizSubtitle.textContent = t('quiz.subtitle');
      this.refreshQuizSelect();
    });

    state.quizState = null;
  }
}
