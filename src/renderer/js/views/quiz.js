import { escapeHtml } from '../utils.js';
import { collectAnswer, splitTrueFalse, GRADABLE_TYPES } from '../../lm-editor/src/modules/answer-eval.js';
import { CompanionRun, COMPANION_MAX } from './companion-run.js';
import { TaskTimer } from '../task-timer.js';
import { planRun } from '../../lm-editor/src/doc/doc-quiz.js';
import { classbookSession, backToClassbook } from './classbook-student.js';

/**
 * Stand je Aufgabe für die Live-Ansicht: 'd' bearbeitet, 's' mit „Weiter“
 * übersprungen (nichts verändert), 'p' teilweise (Dokument, von dessen Quizzen
 * nur ein Teil bearbeitet ist), '' noch nicht dran. Aufgaben ohne Bewertung
 * (Dokument ohne Quiz, Video …) gelten mit dem Ansehen als bearbeitet.
 */
function stepStates(qs) {
  return qs.modules.map((mod, i) => {
    const a = qs.answers?.[i];
    if (!a) return '';
    // Dokument mit Quizzen: was mit ihnen passiert ist ('p' = nur ein Teil bearbeitet).
    if (!GRADABLE_TYPES.has(mod.type)) return qs.embeddedStates?.[i] || 'd';
    // In dieser Sitzung aufgebaut: bearbeitet = Eingabe anders als am Anfang.
    if (qs.initialAnswers && i in qs.initialAnswers) return answerKey(a) !== qs.initialAnswers[i] ? 'd' : 's';
    // Sonst (fortgesetzter Durchlauf) nach der Antwort selbst.
    const given = String(a.userAnswer ?? '').replace(/[—–\-,;:|\s]/g, '');
    return a.isCorrect || given ? 'd' : 's';
  });
}

/** „Überprüfen“-Knopf einer Aufgabe (#mcCheck, #wordsCheck … bzw. .sort-check, .cw-check …). */
function isCheckButton(btn) {
  return /Check$/.test(btn.id || '') || /(^|\s)[a-z]+-check(\s|$)/.test(btn.className || '');
}

/** Vergleichbare Form einer Antwort (nur was der Schüler eingibt). */
function answerKey(a) {
  return JSON.stringify(a?.userAnswer ?? '');
}

// ==================== QUIZ VIEW ====================

/**
 * Schlüssel eines Schritts für den Zwischenstand der Klassenarbeit: das Modul,
 * bei zerlegtem Wahr/Falsch dazu die Frage (sie kann gemischt sein).
 */
function stepKey(m) {
  let content = m.type === 'trueFalse' ? m.content : null;
  if (typeof content === 'string') { try { content = JSON.parse(content); } catch (_) { content = null; } }
  const q = content?.questions?.length === 1 ? content.questions[0].question : null;
  return q == null ? String(m.id) : `${m.id}|${q}`;
}

/**
 * Schritte in die Reihenfolge des Zwischenstands bringen. Passt er nicht mehr
 * (Lehrkraft hat Aufgaben geändert), null – dann geht es von vorn los.
 */
function stepsInSavedOrder(steps, savedKeys) {
  if (!Array.isArray(savedKeys) || savedKeys.length !== steps.length) return null;
  const pool = new Map();
  for (const s of steps) {
    const k = stepKey(s);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(s);
  }
  const out = [];
  for (const k of savedKeys) {
    const s = pool.get(k)?.shift();
    if (!s) return null;
    out.push(s);
  }
  return out;
}

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
          qs.answers[qs.currentIndex] = this._currentAnswer(mod);
          this._revealSolution(qs.answers[qs.currentIndex]);
          for (const { answer, slot } of this._collectEmbedded()) this._revealSolution(answer, slot);
          qs.revealed = true;
          (qs.revealedAt || (qs.revealedAt = {}))[qs.currentIndex] = true;
          this._btnQuizNext.textContent =
            qs.currentIndex < qs.modules.length - 1 ? t('quiz.next') : t('quiz.finish');
          return;
        }

        this._taskTimer?.answered(qs.currentIndex);
        qs.answers[qs.currentIndex] = this._currentAnswer(mod);
        this._collectEmbedded();
        this._saveExamProgress(qs.currentIndex + 1);
        this._goNext();
      });
    }

    if (this._btnQuizPrev) {
      this._btnQuizPrev.addEventListener('click', () => {
        const { state } = this.app;
        if (!state.quizState || state.quizState.currentIndex <= 0) return;
        const mod = state.quizState.modules[state.quizState.currentIndex];
        state.quizState.answers[state.quizState.currentIndex] = this._currentAnswer(mod);
        this._collectEmbedded();
        state.quizState.currentIndex--;
        this._reportRun({ done: state.quizState.currentIndex, states: stepStates(state.quizState) });
        this._renderModule();
      });
    }

    if (this._btnQuizCancel) {
      this._btnQuizCancel.addEventListener('click', async () => {
        if (!(await this.app.appConfirm(t('quiz.cancel.confirm')))) return;
        this._endCompanion();
        this._taskTimer?.dispose();
        this._taskTimer = null;
        this.app.state.quizState = null;
        this._quizPlayerArea.classList.add('hidden');
        this._quizModuleContainer.innerHTML = '';
        // Aus dem Klassennotizbuch: dorthin zurück statt auf die leere Themenauswahl.
        if (this.app.state.currentUser?.role === 'student' && classbookSession()) { backToClassbook(); return; }
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
  async startLinkRun(data, { onlyModule = null } = {}) {
    const modules = [];
    for (const topic of data.topics || []) {
      for (const mod of topic.modules || []) {
        // _inkEdit: „✍️ Bearbeiten“ über Dokumenten (Freischaltung der Lehrkraft des Themas).
        modules.push({ ...mod, _topicId: topic.id, _topicTitle: topic.title, _inkEdit: !!topic.inkEdit });
      }
    }
    if (modules.length === 0) {
      this.app.showToast('Dieser Link enthält derzeit keine Aufgaben.', 'error');
      return;
    }
    if (onlyModule && !modules.some((m) => m.id === onlyModule)) {
      this.app.showToast('Dieses Quiz ist gerade nicht freigegeben – es geht mit dem ganzen Lernthema weiter.', 'info');
    }
    const plan = planRun(modules, { companion: data.mode === 'companion', onlyModule });

    let steps = splitTrueFalse(plan.steps);
    // Wiedereinstieg in eine Klassenarbeit: bis hierher beantwortet, in derselben Reihenfolge.
    const resume = data.mode === 'exam' && data.examResume ? data.examResume : null;
    const resumed = resume ? stepsInSavedOrder(steps, resume.steps) : null;
    if (resume && !resumed) this.app.showToast('Die Aufgaben haben sich geändert – die Klassenarbeit beginnt von vorn.', 'info');
    if (resumed) steps = resumed;

    this.app.state.quizState = {
      // Das Ergebnis hängt am ersten Thema des Links; welche Aufgaben
      // tatsächlich drankamen, steht ohnehin in den Details.
      topicId: (data.topics[0] || {}).id || null,
      // Themenname und Linkname getrennt halten – sonst stünde in der
      // Ergebnisliste zweimal dasselbe.
      topicTitle: (data.topics || []).map((t) => t.title).join(', '),
      modules: steps,
      embedded: plan.embedded,
      embeddedAnswers: resumed ? { ...(resume.embeddedAnswers || {}) } : {},
      currentIndex: resumed ? Math.min(Math.max(0, Number(resume.index) || 0), steps.length - 1) : 0,
      answers: resumed ? [...resume.answers] : [],
      startTime: Date.now(),
      mode: data.mode,
      linkToken: this.app.state.linkSession?.token || null,
      linkName: data.linkName,
      revealed: false,
    };

    this._endCompanion();
    if (data.mode === 'companion') this._companion = new CompanionRun(this, data.companion);
    this._enterPlayer(data.linkName);
    if (resumed) this.app.showToast(`Es geht bei Aufgabe ${this.app.state.quizState.currentIndex + 1} weiter – deine bisherigen Antworten sind gespeichert.`, 'success');
    this._reportRun({ steps: steps.map((m) => m.title || ''), done: this.app.state.quizState.currentIndex });
  }

  /**
   * Fortschritt für die Live-Ansicht der Lehrkraft (nur Klassenlinks mit
   * Schülerausweis): beim Start die Aufgaben, danach wie viele erledigt sind.
   */
  _reportRun(body) {
    const qs = this.app.state.quizState;
    const ticket = this.app.state.linkSession?.studentTicket;
    if (!qs?.linkToken || !ticket) return;
    fetch('/api/public/run/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkToken: qs.linkToken, studentTicket: ticket, mode: qs.mode, ...body }),
    }).catch(() => undefined);
  }

  /**
   * Klassenarbeit über einen Klassenlink: Zwischenstand nach jeder Aufgabe
   * an den Server – gibt die Lehrkraft einen Wiedereinstieg frei, geht es
   * dort weiter. Ein Fehlschlag hält den Durchlauf nicht auf.
   */
  _saveExamProgress(index) {
    const qs = this.app.state.quizState;
    const ticket = this.app.state.linkSession?.studentTicket;
    if (!qs || qs.mode !== 'exam' || !qs.linkToken || !ticket) return;
    const progress = { steps: qs.modules.map(stepKey), index, answers: qs.answers, embeddedAnswers: qs.embeddedAnswers || {} };
    fetch('/api/public/exam/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkToken: qs.linkToken, studentTicket: ticket, progress }),
    }).then(async (res) => {
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        this.app.showToast(data.message || 'Die Klassenarbeit wurde an einem anderen Gerät fortgesetzt.', 'error');
      }
    }).catch(() => undefined);
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
    // Über den Quick-Link: „✍️ Bearbeiten“, wenn die Lehrkraft des Themas den Stift-Editor hat.
    const inkEdit = !!(this.app.state.quickSession?.token && freshTopic.inkEdit);
    const modules = source.filter((m) => m.moduleSelected !== false).map((m) => (inkEdit ? { ...m, _inkEdit: true } : m));
    if (modules.length === 0) { this.app.showToast(t('quiz.no.modules'), 'error'); return; }
    const plan = planRun(modules);

    this.app.state.quizState = {
      topicId: freshTopic.id,
      topicTitle: freshTopic.title,
      modules: splitTrueFalse(plan.steps),
      embedded: plan.embedded,
      embeddedAnswers: {},
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
    this._finishing = false;
    // Zeit bis zur ersten Antwort je Aufgabe – Grundlage der Quiz-Arena-Zeiten.
    this._taskTimer?.dispose();
    this._taskTimer = new TaskTimer();
    // Schüler: kompakte Ansicht, damit die Aufgabe in die Bildschirmhöhe passt.
    document.body.classList.toggle('student-run', this.app.state.currentUser?.role === 'student');
    document.body.classList.toggle('companion-run', !!this._companion);
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
    if (qs.currentIndex < qs.modules.length) this._reportRun({ done: qs.currentIndex, states: stepStates(qs) });
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
    document.body.classList.remove('companion-run');
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
    this._taskTimer?.show(currentIndex);
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
      // Bereits aufgebaute Aufgabe: Eine Sperre von Weiter/Prüfen (z. B. noch
      // offene Wahr/Falsch-Fragen) steht am Element, nicht mehr am Knopf.
      const locked = !!view.querySelector('[data-next-locked="true"]');
      this._btnQuizNext.disabled = locked;
      this._btnQuizNext.title = locked ? 'Erst alle Fragen beantworten' : '';
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
        // Quizze im Dokument (planRun); in der Lernbegleitung kommen sie als eigene Aufgabe.
        embedModule: (id) => qs.embedded?.get(id) || null,
        embedMissingText: this._companion ? 'Dieses Quiz kommt gleich als eigene Aufgabe.' : undefined,
        inkEdit: mod._inkEdit ? 'student' : null,
        // Für Aufgaben, die etwas hochladen (Audio Recorder)
        upload: {
          linkToken: qs.linkToken || null,
          quickToken: qs.quickToken || null,
          password: this.app.state.linkSession?.password || '',
          studentTicket: this.app.state.linkSession?.studentTicket || null,
          studentName: this.app.state.currentUser?.name || '',
        },
      });
      qs.views[currentIndex] = view;
      this._watchFirstCheck(view, mod);
      // Anfangszustand der Eingabe merken: Verlässt der Schüler die Aufgabe
      // unverändert, gilt sie in der Live-Ansicht als übersprungen – auch wo
      // schon der Anfang Teilpunkte bringt (Reihenfolge, Zuordnen).
      if (GRADABLE_TYPES.has(mod.type)) {
        const index = currentIndex;
        requestAnimationFrame(() => {
          if (qs.views?.[index] !== view) return;
          try { (qs.initialAnswers ||= {})[index] = answerKey(collectAnswer(mod, view)); } catch (_) { /* ohne Vergleich */ }
        });
      } else if (qs.embedded?.size) {
        // Quizze im Dokument ebenso – daran entscheidet sich, ob das Dokument bearbeitet ist.
        requestAnimationFrame(() => {
          view.querySelectorAll('form.ds-quiz-slot').forEach((slot) => {
            const m = qs.embedded.get(slot.dataset.module);
            if (!m || !GRADABLE_TYPES.has(m.type) || slot._initialKey !== undefined) return;
            try { slot._initialKey = answerKey(collectAnswer(m, slot)); } catch (_) { /* ohne Vergleich */ }
          });
        });
      }
    }

    // Knöpfe eines Dokuments (✍️ Mit Stift bearbeiten, ⬇ Als PDF) in die feste
    // Titelleiste – dort scrollen sie nicht mit dem Blatt weg. Die Ansicht
    // merkt sich ihre Leiste, damit sie beim Zurückblättern wieder hinkommt.
    const actions = view._dsActions || (view._dsActions = view.querySelector('.ds-actions'));
    if (actions) {
      const slot = document.createElement('span');
      slot.className = 'quiz-info-actions';
      slot.appendChild(actions);
      this._quizInfo.appendChild(slot);
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
  _revealSolution(answer, target = null) {
    const panel = document.createElement('div');
    panel.className = 'quiz-solution-panel';
    panel.innerHTML = `
      <div class="quiz-solution-head">${answer.isCorrect ? '✅ Richtig' : '💡 Musterlösung'}</div>
      ${answer.userAnswer ? `<p><strong>Deine Antwort:</strong> ${escapeHtml(String(answer.userAnswer))}</p>` : ''}
      ${answer.correctAnswer ? `<p><strong>Richtig wäre:</strong> ${escapeHtml(String(answer.correctAnswer))}</p>` : ''}
      ${answer.score ? `<p><strong>Auswertung:</strong> ${escapeHtml(String(answer.score))}</p>` : ''}`;
    const qs = this.app.state.quizState;
    // In die Ansicht der Aufgabe, damit die Lösung beim Zurückblättern mitkommt.
    (target || (qs && qs.views && qs.views[qs.currentIndex]) || this._quizModuleContainer).appendChild(panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Antworten der Quizze im Dokument des aktuellen Schritts – je Schritt
   * gemerkt, beim Zurückblättern überschrieben. Liefert `{ answer, slot }`.
   */
  /**
   * Der erste Versuch zählt: Beim ersten Klick auf „Überprüfen“ einer Aufgabe
   * (auch eines Quiz im Dokument) wird ihr Stand festgehalten – vor der
   * Rückmeldung, die oft die Lösung zeigt (Mark the Words: fehlende Wörter
   * gelb). Nachbessern bleibt möglich, zählt aber nicht.
   */
  _watchFirstCheck(view, mod) {
    const qs = this.app.state.quizState;
    view.addEventListener('click', (e) => {
      const btn = e.target.closest?.('button');
      if (!btn || !view.contains(btn) || !isCheckButton(btn)) return;
      const slot = btn.closest('form.ds-quiz-slot');
      const root = slot && view.contains(slot) ? slot : view;
      const m = root === view ? mod : qs?.embedded?.get(slot.dataset.module);
      if (!m || root._firstCheck || !GRADABLE_TYPES.has(m.type)) return;
      try { root._firstCheck = { ...collectAnswer(m, root), firstTry: true }; } catch (_) { /* dann zählt der Stand beim Verlassen */ }
    }, true); // vor der Prüfung der Aufgabe selbst
  }

  /** Antwort der aktuellen Aufgabe: beim ersten „Überprüfen“ festgehalten, sonst der Stand jetzt. */
  _currentAnswer(mod) {
    const qs = this.app.state.quizState;
    return qs?.views?.[qs.currentIndex]?._firstCheck || collectAnswer(mod, this._quizModuleContainer);
  }

  _collectEmbedded() {
    const qs = this.app.state.quizState;
    const view = qs?.views?.[qs.currentIndex];
    if (!view || !qs.embedded?.size) return [];
    const found = [];
    view.querySelectorAll('form.ds-quiz-slot').forEach((slot) => {
      const mod = qs.embedded.get(slot.dataset.module);
      if (mod) found.push({ answer: slot._firstCheck || collectAnswer(mod, slot), slot });
    });
    if (found.length) (qs.embeddedAnswers || (qs.embeddedAnswers = {}))[qs.currentIndex] = found.map((f) => f.answer);
    // Für die Live-Ansicht: alle Quizze im Dokument bearbeitet, keins oder ein Teil?
    const graded = found.filter((f) => f.slot._initialKey !== undefined);
    if (graded.length) {
      const changed = graded.filter((f) => answerKey(f.answer) !== f.slot._initialKey).length;
      (qs.embeddedStates ||= {})[qs.currentIndex] = changed === graded.length ? 'd' : changed ? 'p' : 's';
    }
    return found;
  }

  async _finishQuiz() {
    const { state, api } = this.app;
    const { quizState, currentUser } = state;
    const isExam = quizState.mode === 'exam';
    const isLearn = quizState.mode === 'learn';
    // Ein zweiter Klick, während noch gespeichert wird, darf nicht noch
    // einmal abschließen (und kein zweites Ergebnis anlegen).
    if (this._finishing) return;
    this._finishing = true;
    this._btnQuizNext.disabled = true;
    const companion = this._companion;
    this._endCompanion();
    // Gemessene Zeiten an die Antworten hängen; der Server leitet daraus die
    // Vorgabezeiten der Quiz-Arena ab.
    const timer = this._taskTimer;
    this._taskTimer = null;
    timer?.dispose();
    // Je Schritt seine Antwort, dahinter die der Quizze in seinem Dokument.
    const ordered = [];
    for (let i = 0; i < quizState.modules.length; i++) {
      if (quizState.answers[i]) ordered.push({ a: quizState.answers[i], step: i });
      for (const e of quizState.embeddedAnswers?.[i] || []) ordered.push({ a: e, step: -1 });
    }
    const answers = ordered.map((o) => o.a);
    const details = ordered.map(({ a, step }) => (step >= 0 && timer?.msOf(step) !== undefined ? { ...a, ms: timer.msOf(step) } : a));
    // Informationsmodule bleiben in der Liste sichtbar, aber aus der
    // Rechnung heraus – sonst hinge die Prozentzahl daran, wie viele
    // Infoseiten ein Thema enthält. Dasselbe gilt in der Lernbegleitung für
    // Aufgaben, die kein Automat bewerten kann.
    const graded = answers.filter((a) => !a.informational && !a.ungraded);
    // Lernbegleitung: Lernpunkte statt Anteilen, 10 je Aufgabe.
    const rawScore = companion
      ? graded.reduce((sum, a) => sum + (a.lernpunkte || 0), 0)
      : graded.reduce((sum, a) => sum + (a.points ?? (a.isCorrect ? 1 : 0)), 0);
    const score = Math.round(rawScore * 100) / 100;
    const total = companion ? graded.length * COMPANION_MAX : graded.length;
    const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

    // Speichern darf das Ende nicht aufhalten: Ohne Netz (WLAN aus) warf der
    // Aufruf, und das Quiz blieb mit "Abschließen" stehen. Jetzt kommt die
    // Auswertung immer, und ein Fehlschlag lässt sich erneut senden.
    let send = null;
    if (isLearn) {
      // Lernen mit Lösungen ist zum Üben da – dabei entsteht kein Eintrag im
      // Ergebnis-Log der Lehrkraft.
    } else if (currentUser.role === 'student') {
      send = () => api.submitPublicResult({
        teacherEmail: currentUser.teacherEmail,
        linkToken: quizState.linkToken || undefined,
        quickToken: quizState.quickToken || undefined,
        mode: quizState.mode,
        studentName: currentUser.name,
        studentTicket: quizState.linkToken ? this.app.state.linkSession?.studentTicket || undefined : undefined,
        topicId: quizState.topicId,
        moduleId: null,
        score, maxScore: total,
        payload: {
          topicTitle: quizState.topicTitle,
          linkName: quizState.linkName || null,
          percentage,
          details,
          ...(companion ? { jokersUsed: companion.jokersUsed } : {}),
        },
      });
    } else {
      send = () => api.saveQuizResult({
        username: currentUser.name, topicId: quizState.topicId, topicTitle: quizState.topicTitle,
        score, totalQuestions: total, percentage, details: answers,
      });
    }
    const trySend = async () => {
      try {
        const res = await send();
        // Fehlerantworten des Servers kommen als JSON mit statusCode zurück.
        return !(res && (res.statusCode >= 400 || res.success === false));
      } catch (_) {
        return false;
      }
    };
    const saved = send ? await trySend() : true;
    this._reportRun({ done: quizState.modules.length, finished: true, states: stepStates(quizState) });

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
        ${saved ? '' : `<div class="quiz-save-failed login-error">
          <p>⚠️ Das Ergebnis konnte nicht gesendet werden – vermutlich gibt es gerade keine Internetverbindung.
            Bitte diese Seite offen lassen, die Verbindung prüfen und dann erneut senden.</p>
          <button class="btn btn-primary btn-sm" id="btnQuizResend">🔄 Erneut senden</button>
        </div>`}
        <div class="quiz-result-details">
          ${isExam
            ? '<p style="color:var(--text-secondary);">Klassenarbeit: Die Detail-Rückmeldung ist ausgeblendet.</p>'
            : answers.map((a, i) => `
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
          ${currentUser.role === 'student' && classbookSession() ? '<button class="btn btn-primary" id="btnQuizClassbook">📒 Zurück zum Klassenbuch</button>' : ''}
          <button class="btn ${currentUser.role === 'student' && classbookSession() ? 'btn-secondary' : 'btn-primary'}" id="btnQuizRestart">${t('quiz.restart')}</button>
        </div>
      </div>`;

    this._quizResultArea.querySelector('#btnQuizResend')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Wird gesendet…';
      const box = btn.closest('.quiz-save-failed');
      if (await trySend()) {
        box.className = 'quiz-save-ok';
        box.innerHTML = '<p>✓ Ergebnis gesendet.</p>';
      } else {
        btn.disabled = false;
        btn.textContent = '🔄 Erneut senden';
        this.app.showToast('Immer noch keine Verbindung – bitte gleich noch einmal versuchen.', 'error');
      }
    });

    this._quizResultArea.querySelector('#btnQuizClassbook')?.addEventListener('click', async () => {
      if (this._quizResultArea.querySelector('.quiz-save-failed')
        && !(await this.app.appConfirm('Das Ergebnis wurde noch nicht gesendet und geht verloren. Trotzdem zurück?'))) return;
      backToClassbook();
    });
    this._quizResultArea.querySelector('#btnQuizRestart').addEventListener('click', async () => {
      // Nicht gesendetes Ergebnis nicht stillschweigend verwerfen.
      if (this._quizResultArea.querySelector('.quiz-save-failed')
        && !(await this.app.appConfirm('Das Ergebnis wurde noch nicht gesendet und geht verloren. Trotzdem neu starten?'))) return;
      state.quizState = null;
      this._quizResultArea.classList.add('hidden');
      this._quizTopicSelect.classList.remove('hidden');
      this._quizSubtitle.textContent = t('quiz.subtitle');
      this.refreshQuizSelect();
    });

    state.quizState = null;
    this._finishing = false;
  }
}
