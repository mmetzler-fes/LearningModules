import { escapeHtml } from '../utils.js';

// ==================== QUIZ VIEW ====================

export class QuizView {
  constructor(app) {
    this.app = app;

    this._studentTopicsList     = document.getElementById('studentTopicsList');
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
        const mod = state.quizState.modules[state.quizState.currentIndex];
        state.quizState.answers[state.quizState.currentIndex] = this._collectAnswer(mod);
        state.quizState.currentIndex++;
        if (state.quizState.currentIndex >= state.quizState.modules.length) this._finishQuiz();
        else this._renderModule();
      });
    }

    if (this._btnQuizPrev) {
      this._btnQuizPrev.addEventListener('click', () => {
        const { state } = this.app;
        if (!state.quizState || state.quizState.currentIndex <= 0) return;
        const mod = state.quizState.modules[state.quizState.currentIndex];
        state.quizState.answers[state.quizState.currentIndex] = this._collectAnswer(mod);
        state.quizState.currentIndex--;
        this._renderModule();
      });
    }

    if (this._btnQuizCancel) {
      this._btnQuizCancel.addEventListener('click', async () => {
        if (!(await this.app.appConfirm(t('quiz.cancel.confirm')))) return;
        this.app.state.quizState = null;
        this._quizPlayerArea.classList.add('hidden');
        this._quizModuleContainer.innerHTML = '';
        this._quizTopicSelect.classList.remove('hidden');
        this._quizSubtitle.textContent = t('quiz.subtitle');
      });
    }
  }

  // Called when navigating to 'student-topics'
  async refreshStudentTopics() {
    await this.app.loadTopics();
    const { state } = this.app;
    const available = state.topics; // server returns only selected=true topics

    this._studentTopicsList.innerHTML = '';
    if (available.length === 0) {
      this._studentTopicsList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📂</span>
          <p>Noch keine Lernthemen vom Lehrer freigegeben.</p>
        </div>`;
      return;
    }

    for (const topic of available) {
      const moduleCount = (topic.modules || []).filter((m) => m.moduleSelected !== false).length;
      const keyIcon = topic.hasSubscribeKey ? '🔑' : '🌐';
      const card = document.createElement('div');
      card.className = 'topic-card student-topic-card';
      card.innerHTML = `
        <div class="topic-card-header">
          <div class="topic-card-info">
            <h3 class="topic-card-title">${keyIcon} ${escapeHtml(topic.title)}</h3>
            <p class="topic-card-desc">${escapeHtml(topic.description || '')}</p>
            <div class="topic-card-meta">
              <span class="topic-module-count">${moduleCount} Module</span>
              ${topic.hasSubscribeKey ? '<span class="hint" style="margin-left:8px;">🔑 Subscribe-Key erforderlich</span>' : ''}
            </div>
          </div>
        </div>`;
      this._studentTopicsList.appendChild(card);
    }
  }

  // Called when navigating to 'student-quiz'
  async refreshQuizSelect() {
    if (this.app.state.quizState) return;

    await this.app.loadTopics();
    await this.app.loadExamMode();
    const { state } = this.app;
    const myTopics = state.topics; // server already returns only selected=true

    this._quizTopicSelect.innerHTML = '';
    this._quizTopicSelect.classList.remove('hidden');
    this._quizPlayerArea.classList.add('hidden');
    this._quizResultArea.classList.add('hidden');

    if (myTopics.length === 0) {
      this._quizTopicSelect.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🧠</span>
          <p>Noch keine Lernthemen freigegeben.</p>
        </div>`;
      return;
    }

    const isExam = state.examModeEnabled;
    for (const topic of myTopics) {
      const moduleCount = (topic.modules || []).filter((m) => m.moduleSelected !== false).length;
      if (moduleCount === 0) continue;
      const card = document.createElement('div');
      card.className = 'quiz-topic-card';
      card.innerHTML = `
        <div class="quiz-topic-card-info">
          <h3>${escapeHtml(topic.title)}</h3>
          <p>${moduleCount} Module${topic.hasSubscribeKey ? ' 🔑' : ''}</p>
        </div>
        <button class="btn btn-primary">${isExam ? '📝 Prüfung starten' : '🧠 Quiz starten'}</button>`;
      card.querySelector('.btn').addEventListener('click', () => this._startStudentQuiz(topic));
      this._quizTopicSelect.appendChild(card);
    }
  }

  async _startStudentQuiz(topic) {
    if (topic.hasSubscribeKey) {
      const key = prompt(`🔑 Subscribe-Key für "${topic.title}" eingeben:`);
      if (key === null) return;
      try {
        const { state, api } = this.app;
        const verified = await api.verifySubscribeKey(state.currentUser.teacherEmail, topic.id, key);
        if (!verified || !verified.id) { this.app.showToast('Falscher Subscribe-Key.', 'error'); return; }
        await this._startQuiz(verified);
      } catch (_) {
        this.app.showToast('Falscher Subscribe-Key.', 'error');
      }
    } else {
      await this._startQuiz(topic);
    }
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

    const modules = (freshTopic.modules || []).filter((m) => m.moduleSelected !== false);
    if (modules.length === 0) { this.app.showToast(t('quiz.no.modules'), 'error'); return; }

    // loadTopics() already sets examModeEnabled; keep call for non-student fallback
    await this.app.loadExamMode();

    this.app.state.quizState = {
      topicId: freshTopic.id,
      topicTitle: freshTopic.title,
      modules,
      currentIndex: 0,
      answers: [],
      startTime: Date.now(),
    };

    this.app.navigateToView('student-quiz');

    this._quizTopicSelect.classList.add('hidden');
    this._quizPlayerArea.classList.remove('hidden');
    this._quizResultArea.classList.add('hidden');
    this._quizSubtitle.textContent = `${t('quiz.title')}: ${topic.title}`;
    this._renderModule();
  }

  _renderModule() {
    const { state } = this.app;
    if (!state.quizState) return;

    const { modules, currentIndex } = state.quizState;
    const mod = modules[currentIndex];
    const typeDef = H5P_TYPES[mod.type] || {};
    const progress = (currentIndex / modules.length) * 100;

    this._quizProgressFill.style.width = `${progress}%`;
    this._quizInfo.innerHTML = `
      <strong>${t('quiz.module.of', { current: currentIndex + 1, total: modules.length })}</strong>
      ${escapeHtml(mod.title)}
      <span class="quiz-type-badge">${typeDef.icon || ''} ${typeDef.name || mod.type}</span>`;

    this._quizModuleContainer.innerHTML = '';
    this.app.renderer.renderPreview(mod, typeDef, this._quizModuleContainer, {
      quizMode: true,
      examMode: state.examModeEnabled && state.currentUser && state.currentUser.role === 'student',
    });

    this._btnQuizNext.textContent = currentIndex < modules.length - 1 ? t('quiz.next') : t('quiz.finish');

    if (this._btnQuizPrev) {
      const isExam = state.examModeEnabled && state.currentUser && state.currentUser.role === 'student';
      this._btnQuizPrev.style.display = (!isExam && currentIndex > 0) ? 'inline-block' : 'none';
      this._btnQuizPrev.textContent = t('quiz.prev');
    }
  }

  _collectAnswer(mod) {
    const content = mod.content || {};
    const result = {
      moduleId: mod.id, moduleTitle: mod.title, moduleType: mod.type,
      isCorrect: false, userAnswer: '', correctAnswer: '',
    };

    switch (mod.type) {
      case 'multipleChoice': {
        const inputs = this._quizModuleContainer.querySelectorAll('input[name="mc-answer"]');
        const selected = []; const correctList = [];
        let correctDecisions = 0; let totalDecisions = 0;
        inputs.forEach((inp, i) => {
          if (inp.checked) selected.push(i);
          if (inp.dataset.correct === 'true') correctList.push(i);
          if (inp.checked === (inp.dataset.correct === 'true')) correctDecisions++;
          totalDecisions++;
        });
        result.userAnswer = selected.map((i) => (content.answers || [])[i]?.text || i).join(', ');
        result.correctAnswer = correctList.map((i) => (content.answers || [])[i]?.text || i).join(', ');
        result.isCorrect = totalDecisions > 0 && correctDecisions === totalDecisions;
        if (totalDecisions > 0) {
          const pct = Math.round((correctDecisions / totalDecisions) * 100);
          result.score = `Richtig: ${pct}% | Falsch: ${100 - pct}%`;
        }
        break;
      }
      case 'trueFalse': {
        const tfQs = content.questions || [content];
        let tfCorrect = 0; const ua = []; const ca = [];
        tfQs.forEach((q) => {
          if (q._userAnswer === q.correctAnswer) tfCorrect++;
          ua.push(q._userAnswer === 'true' ? 'Wahr' : q._userAnswer === 'false' ? 'Falsch' : '—');
          ca.push(q.correctAnswer === 'true' ? 'Wahr' : 'Falsch');
        });
        result.isCorrect = tfCorrect === tfQs.length;
        result.userAnswer = ua.join(', '); result.correctAnswer = ca.join(', ');
        if (tfQs.length > 0) {
          const pct = Math.round((tfCorrect / tfQs.length) * 100);
          result.score = `Richtig: ${pct}% | Falsch: ${100 - pct}%`;
        }
        break;
      }
      case 'fillInTheBlanks': {
        const inputs = this._quizModuleContainer.querySelectorAll('input[data-answer]');
        let correct = 0; const answers = [];
        inputs.forEach((inp) => {
          const expected = inp.dataset.answer; const given = inp.value.trim();
          const alts = expected.split('/').map((a) => a.trim()).filter(Boolean);
          const match = alts.some((alt) => content.caseSensitive ? given === alt : given.toLowerCase() === alt.toLowerCase());
          if (match) correct++;
          answers.push(given);
        });
        result.userAnswer = answers.join(', ');
        result.correctAnswer = Array.from(inputs).map((i) => i.dataset.answer.split('/')[0].trim()).join(', ');
        result.isCorrect = correct === inputs.length && inputs.length > 0;
        break;
      }
      case 'essay': {
        const textarea = this._quizModuleContainer.querySelector('#essayAnswer');
        const text = textarea ? textarea.value.trim() : '';
        const minChars = Number(content.minChars) || 0;
        result.userAnswer = text || '—'; result.correctAnswer = content.sampleSolution || 'Freitextantwort';
        result.isCorrect = minChars <= 0 ? text.length > 0 : text.length >= minChars;
        result.score = `${text.length} Zeichen`;
        break;
      }
      case 'arithmeticQuiz': {
        const resultEl = this._quizModuleContainer.querySelector('.quiz-area h3');
        if (resultEl) {
          const m = resultEl.textContent.match(/(\d+)\s*\/\s*(\d+)/);
          if (m) { result.userAnswer = `${m[1]}/${m[2]}`; result.correctAnswer = `${m[2]}/${m[2]}`; result.isCorrect = m[1] === m[2]; }
        }
        break;
      }
      case 'markTheWords': {
        const spans = this._quizModuleContainer.querySelectorAll('#wordsArea span');
        let correct = 0; let total = 0; const ua = []; const ca = [];
        spans.forEach((s) => {
          const isTarget = s.dataset.correct === 'true'; const isSel = s.classList.contains('selected');
          if (isTarget) { total++; ca.push(s.textContent); }
          if (isSel) { ua.push(s.textContent); if (isTarget) correct++; }
        });
        result.userAnswer = ua.length ? ua.join(', ') : 'Keine markiert';
        result.correctAnswer = ca.join(', ');
        result.isCorrect = correct === total && total > 0;
        break;
      }
      case 'dragTheWords': {
        const zones = this._quizModuleContainer.querySelectorAll('.dtw-drop-zone');
        let correct = 0; const ua = []; const ca = [];
        zones.forEach((z) => {
          const current = (z.dataset.currentWord || '').trim(); const expected = z.dataset.correctWord;
          if (current.toLowerCase() === expected.toLowerCase()) correct++;
          ua.push(current || '(leer)'); ca.push(expected);
        });
        result.userAnswer = ua.join(', '); result.correctAnswer = ca.join(', ');
        result.percent = zones.length > 0 ? Math.round((correct / zones.length) * 100) : 0;
        result.isCorrect = correct === zones.length && zones.length > 0;
        break;
      }
      case 'dictation': {
        const inputs = this._quizModuleContainer.querySelectorAll('.dict-input');
        let correct = 0;
        inputs.forEach((inp) => { if (inp.value.trim().toLowerCase() === inp.dataset.answer.toLowerCase()) correct++; });
        result.userAnswer = `${correct}/${inputs.length}`; result.correctAnswer = `${inputs.length}/${inputs.length}`;
        result.isCorrect = correct === inputs.length && inputs.length > 0;
        break;
      }
      case 'dragAndDrop': {
        const draggablesDef = content.draggables || []; const zonesDef = content.dropZones || [];
        const expectedMappings = [];
        draggablesDef.forEach((d) => { if (d.correctZone && !expectedMappings.find((m) => m.zone === d.correctZone && m.text === d.text)) expectedMappings.push({ zone: d.correctZone, text: d.text }); });
        zonesDef.forEach((z) => { if (z.correctDraggable && !expectedMappings.find((m) => m.zone === z.label && m.text === z.correctDraggable)) expectedMappings.push({ zone: z.label, text: z.correctDraggable }); });
        const dragEls = this._quizModuleContainer.querySelectorAll('.dnd-player-drag');
        let correct = 0; let incorrect = 0; const placements = [];
        const satisfiedDefs = new Set();
        dragEls.forEach((el) => {
          const currentZone = el.dataset.currentZone || ''; const text = el.textContent;
          const isMultipleSource = el.dataset.multiple === 'true' && !currentZone;
          if (currentZone) {
            const matchIdx = expectedMappings.findIndex((m, idx) => m.text === text && m.zone === currentZone && !satisfiedDefs.has(idx));
            if (matchIdx !== -1) { satisfiedDefs.add(matchIdx); correct++; } else { incorrect++; }
            placements.push(`${text} → ${currentZone}`);
          } else if (!isMultipleSource) { placements.push(`${text} → (nicht zugeordnet)`); }
        });
        result.userAnswer = placements.join(', ');
        result.correctAnswer = expectedMappings.map((m) => `${m.text} → ${m.zone}`).join(', ');
        result.isCorrect = expectedMappings.length > 0 && correct === expectedMappings.length && incorrect === 0;
        break;
      }
      case 'flashcards': {
        const cards = content.cards || []; let correct = 0; const answers = [];
        cards.forEach((card) => {
          const user = (card._userAnswer || '').trim(); const expected = card.answer || '';
          const alts = expected.split('/').map((a) => a.trim().toLowerCase()).filter(Boolean);
          const ok = alts.includes(user.toLowerCase());
          if (ok) correct++;
          answers.push(`${user || '—'} (${ok ? '✓' : '✗'})`);
        });
        result.userAnswer = `${correct}/${cards.length} richtig`; result.correctAnswer = `${cards.length}/${cards.length}`;
        result.isCorrect = correct === cards.length && cards.length > 0;
        break;
      }
      default: {
        result.isCorrect = true; result.userAnswer = 'Angesehen'; result.correctAnswer = '—';
        break;
      }
    }
    return result;
  }

  async _finishQuiz() {
    const { state, api } = this.app;
    const { quizState, currentUser, examModeEnabled } = state;
    const score = quizState.answers.filter((a) => a.isCorrect).length;
    const total = quizState.answers.length;
    const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

    if (currentUser.role === 'student') {
      await api.submitPublicResult({
        teacherEmail: currentUser.teacherEmail,
        studentName: currentUser.name,
        topicId: quizState.topicId,
        moduleId: null,
        score, maxScore: total,
        payload: { topicTitle: quizState.topicTitle, percentage, details: quizState.answers },
      });
    } else {
      await api.saveQuizResult({
        username: currentUser.name, topicId: quizState.topicId, topicTitle: quizState.topicTitle,
        score, totalQuestions: total, percentage, details: quizState.answers,
      });
    }

    this._quizPlayerArea.classList.add('hidden');
    this._quizResultArea.classList.remove('hidden');

    const pctClass = percentage >= 70 ? 'good' : percentage >= 40 ? 'medium' : 'poor';
    this._quizResultArea.innerHTML = `
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
