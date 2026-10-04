import { escapeHtml } from '../utils.js';
import { collectAnswer, GRADABLE_TYPES, ONE_SHOT_TYPES } from '../answer-eval.js';

// ==================== LERNBEGLEITUNG ====================

/** Lernpunkte nach Versuch: 1. Versuch 10, 2. Versuch 6, 3. Versuch 3, danach 1. */
export const COMPANION_POINTS = [10, 6, 3, 1];
export const COMPANION_MAX = COMPANION_POINTS[0];

/** Ab dem zweiten Fehlversuch kann der Joker auftauchen – mit jedem Fehler wahrscheinlicher. */
function jokerChance(wrong) {
  return wrong < 2 ? 0 : Math.min(0.8, 0.3 * (wrong - 1));
}

/** Zeitstrafe nach dem n-ten Fehlversuch: ab dem dritten, jedes Mal länger bis zur Obergrenze. */
export function penaltySeconds(wrong, settings) {
  if (wrong < 3) return 0;
  const start = Math.max(0, Number(settings.penaltyStart) || 0);
  const max = Math.max(start, Number(settings.penaltyMax) || 0);
  return Math.min(max, start * (wrong - 2));
}

/**
 * Ein Durchlauf mit dem Lernbegleiter (der Eule).
 *
 * Jede Aufgabe wird geprüft, so oft der Schüler will. Die Eule kommentiert
 * jeden Versuch; der Ton hängt davon ab, wie oft es schon daneben ging.
 * Lernpunkte gibt es nur für eine richtig gelöste Aufgabe – je weniger
 * Versuche, desto mehr. Ab dem dritten Fehlversuch folgt eine Denkpause,
 * damit Raten sich nicht lohnt; mit etwas Glück taucht ein Joker auf, der
 * die Lösung zeigt (dann ohne Punkte).
 */
export class CompanionRun {
  constructor(quizView, config) {
    this.view = quizView;
    this.config = config || {};
    this.settings = this.config.settings || { jokerMax: 2, penaltyStart: 30, penaltyMax: 120 };
    this.comments = this.config.comments || {};
    this.tasks = [];
    this.jokersUsed = 0;
    this.points = 0;
    this._lastComment = {};
    this._timer = null;
  }

  get jokersLeft() {
    return Math.max(0, (Number(this.settings.jokerMax) || 0) - this.jokersUsed);
  }

  // ---------- Anzeige ----------

  /**
   * Breite Bildschirme: Die Eule sitzt in der Seitenleiste, die Aufgabe hat
   * die volle Höhe. Schmale Bildschirme (Seitenleiste nur Symbole): über den
   * Knöpfen unter der Aufgabe.
   */
  _place() {
    if (!this.panel) return;
    const slot = document.getElementById('sidebarCompanion');
    const narrow = window.matchMedia('(max-width: 800px)').matches;
    if (slot && !narrow) {
      if (this.panel.parentNode !== slot) slot.appendChild(this.panel);
    } else if (this._beforeEl && this.panel.nextSibling !== this._beforeEl) {
      this._beforeEl.parentNode.insertBefore(this.panel, this._beforeEl);
    }
    this.panel.classList.toggle('companion-in-sidebar', !!slot && !narrow);
  }

  mount(beforeEl) {
    this.unmount();
    this._beforeEl = beforeEl;
    const panel = document.createElement('div');
    panel.id = 'companionPanel';
    panel.className = 'companion-panel';
    panel.innerHTML = `
      <div class="companion-owl" aria-hidden="true">🦉</div>
      <div class="companion-body">
        <div class="companion-bubble" role="status" aria-live="polite"></div>
        <div class="companion-status">
          <span class="companion-points" title="Lernpunkte">⭐ <strong>0</strong> Lernpunkte</span>
          <span class="companion-jokers" title="Joker, die noch auftauchen können"></span>
          <span class="companion-penalty hidden"></span>
        </div>
        <div class="companion-actions">
          <button type="button" class="btn btn-sm companion-joker hidden">🃏 Joker spielen</button>
        </div>
      </div>`;
    this.panel = panel;
    this._place();
    this._onResize = () => this._place();
    window.addEventListener('resize', this._onResize);
    panel.querySelector('.companion-joker').addEventListener('click', () => this._playJoker());
    this._say('Hallo! Ich bin deine Lerneule. Löse die Aufgabe und klick auf „Prüfen“ – ich sag dir, wie es aussieht.', 'happy');
    this._updateStatus();
  }

  unmount() {
    this._stopTimer();
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this._onResize = null;
    document.getElementById('companionPanel')?.remove();
    this.panel = null;
  }

  _say(text, mood = 'think') {
    if (!this.panel) return;
    const bubble = this.panel.querySelector('.companion-bubble');
    bubble.innerHTML = text;
    const owl = this.panel.querySelector('.companion-owl');
    owl.dataset.mood = mood;
    // Stimmung färbt die Sprechblase (grün = gut, blau = nachdenken, orange = streng).
    this.panel.dataset.mood = mood;
    // Kleiner Hüpfer, damit der neue Kommentar auffällt.
    owl.classList.remove('companion-hop');
    void owl.offsetWidth;
    owl.classList.add('companion-hop');
  }

  /** Zufälliger Kommentar einer Lage, möglichst nicht zweimal hintereinander derselbe. */
  _pick(category) {
    const list = (this.comments[category] || []).filter(Boolean);
    if (list.length === 0) return '';
    let choice = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1 && choice === this._lastComment[category]) {
      choice = list[(list.indexOf(choice) + 1) % list.length];
    }
    this._lastComment[category] = choice;
    return escapeHtml(choice);
  }

  _updateStatus() {
    if (!this.panel) return;
    this.panel.querySelector('.companion-points strong').textContent = String(this.points);
    const jokerMax = Number(this.settings.jokerMax) || 0;
    this.panel.querySelector('.companion-jokers').textContent = jokerMax > 0
      ? `🃏 ${this.jokersLeft} von ${jokerMax} Joker im Spiel`
      : '';
    const task = this._task();
    const jokerBtn = this.panel.querySelector('.companion-joker');
    jokerBtn.classList.toggle('hidden', !(task && task.jokerOffered && !task.done));
  }

  // ---------- Aufgabenzustand ----------

  _qs() {
    return this.view.app.state.quizState;
  }

  _task(index = this._qs()?.currentIndex) {
    if (index === undefined || index === null) return null;
    if (!this.tasks[index]) {
      this.tasks[index] = { attempts: 0, wrong: 0, done: false, points: 0, jokerOffered: false, joker: false, lockedUntil: 0 };
    }
    return this.tasks[index];
  }

  _module() {
    const qs = this._qs();
    return qs.modules[qs.currentIndex];
  }

  _isGraded(mod) {
    return GRADABLE_TYPES.has(mod.type);
  }

  _isInformational(mod) {
    return !!(H5P_TYPES[mod.type] || {}).informational;
  }

  /** Nach dem Aufbau einer Aufgabe: Knopf beschriften, gesperrten Zustand wiederherstellen. */
  onTaskShown() {
    const mod = this._module();
    const task = this._task();
    const btn = this.view._btnQuizNext;
    const view = this._currentView();
    view?.classList.toggle('companion-locked', task.done);

    if (task.done) {
      btn.textContent = this._isLast() ? '🏁 Abschließen' : 'Weiter →';
    } else if (this._isInformational(mod)) {
      btn.textContent = this._isLast() ? '🏁 Abschließen' : 'Gelesen – weiter →';
    } else if (!this._isGraded(mod)) {
      btn.textContent = '👍 Abgeben';
    } else {
      btn.textContent = '🦉 Prüfen';
    }
    if (task.lockedUntil > Date.now()) this._startPenalty(task);
    else this._endPenaltyUi();
    this._updateStatus();
    if (!task.done && task.attempts === 0 && this._qs().currentIndex > 0) {
      this._say(this._isGraded(mod) ? 'Neue Aufgabe – los geht’s!' : 'Schau dir das in Ruhe an.', 'happy');
    }
  }

  _isLast() {
    const qs = this._qs();
    return qs.currentIndex >= qs.modules.length - 1;
  }

  _currentView() {
    const qs = this._qs();
    return qs?.views?.[qs.currentIndex] || null;
  }

  // ---------- Hauptknopf ----------

  async onPrimary() {
    const qs = this._qs();
    const mod = this._module();
    const task = this._task();
    const root = this.view._quizModuleContainer;

    if (task.done) {
      this._advance();
      return;
    }

    if (this._isInformational(mod)) {
      qs.answers[qs.currentIndex] = collectAnswer(mod, root);
      task.done = true;
      this._advance();
      return;
    }

    if (!this._isGraded(mod)) {
      // Freitext, Aufnahme & Co.: abgegeben, Daumen hoch, keine Punkte.
      const answer = collectAnswer(mod, root);
      qs.answers[qs.currentIndex] = { ...answer, ungraded: true, points: null, companion: { ungraded: true } };
      task.done = true;
      this._say(this._pick('ungraded') || '👍', 'happy');
      this.onTaskShown();
      return;
    }

    if (task.lockedUntil > Date.now()) return;

    const answer = collectAnswer(mod, root);
    task.attempts++;

    if (answer.isCorrect) {
      task.done = true;
      task.points = COMPANION_POINTS[Math.min(task.attempts, COMPANION_POINTS.length) - 1];
      this.points += task.points;
      qs.answers[qs.currentIndex] = this._record(answer, task);
      const comment = this._pick(task.attempts === 1 ? 'correctFirst' : 'correctLater');
      this._say(`${comment} <span class="companion-plus">+${task.points} Lernpunkte</span>`, 'happy');
      this.onTaskShown();
      return;
    }

    task.wrong++;
    qs.answers[qs.currentIndex] = this._record(answer, task);
    const category = task.wrong >= 3 ? 'wrong3' : answer.points > 0 ? 'partial' : `wrong${task.wrong}`;
    let text = this._pick(category);
    let mood = task.wrong >= 3 ? 'stern' : 'think';

    // Joker: zufällig, erst nach mehreren Fehlversuchen, höchstens einmal je Aufgabe.
    if (!task.jokerOffered && this.jokersLeft > 0 && Math.random() < jokerChance(task.wrong)) {
      task.jokerOffered = true;
      text += `<br><span class="companion-joker-note">🃏 ${this._pick('joker')}</span>`;
      mood = 'happy';
    }

    const pause = penaltySeconds(task.wrong, this.settings);
    if (pause > 0) {
      task.lockedUntil = Date.now() + pause * 1000;
      const penaltyText = this._pick('penalty');
      text += `<br><span class="companion-penalty-note">⏳ ${penaltyText ? `${penaltyText} ` : ''}(${pause} s)</span>`;
      this._startPenalty(task);
    }
    this._say(text, mood);

    // Kopfrechnen und Szenarien lassen sich nicht nachbessern – frisch aufbauen.
    if (ONE_SHOT_TYPES.has(mod.type)) this.view._rebuildCurrentView();
    this._updateStatus();
  }

  /** Antwort mit den Angaben der Lernbegleitung für die Ergebnisliste. */
  _record(answer, task) {
    let note;
    if (task.joker) note = `Joker gespielt nach ${task.attempts} Versuch(en) – 0 Lernpunkte`;
    else if (task.done) note = `${task.points} Lernpunkte im ${task.attempts}. Versuch`;
    else if (task.skipped) note = `übersprungen nach ${task.attempts} Versuch(en) – 0 Lernpunkte`;
    else note = `${task.attempts} Versuch(e), noch nicht gelöst`;
    return {
      ...answer,
      isCorrect: !!(answer.isCorrect && task.done && !task.joker),
      lernpunkte: task.done && !task.joker ? task.points : 0,
      score: answer.score ? `${note} · ${answer.score}` : note,
      companion: { attempts: task.attempts, joker: task.joker, skipped: !!task.skipped },
    };
  }

  async _advance() {
    const qs = this._qs();
    const mod = this._module();
    const task = this._task();
    if (!task.done && this._isGraded(mod)) {
      const ok = await this.view.app.appConfirm(
        'Ohne richtige Lösung weiter? Für diese Aufgabe gibt es dann keine Lernpunkte.',
      );
      if (!ok) return;
      task.skipped = true;
      task.done = true;
      qs.answers[qs.currentIndex] = this._record(collectAnswer(mod, this.view._quizModuleContainer), task);
    }
    this._stopTimer();
    this.view._goNext();
  }

  // ---------- Joker ----------

  _playJoker() {
    const qs = this._qs();
    const mod = this._module();
    const task = this._task();
    if (!task.jokerOffered || task.done) return;
    task.joker = true;
    task.done = true;
    task.lockedUntil = 0;
    this.jokersUsed++;
    this._stopTimer();
    this._endPenaltyUi();
    const answer = collectAnswer(mod, this.view._quizModuleContainer);
    qs.answers[qs.currentIndex] = this._record(answer, task);
    this.view._revealSolution({ ...answer, isCorrect: false });
    this._say('Hier ist die Lösung. Schau sie dir gut an – beim nächsten Mal klappt es ohne Joker!', 'happy');
    this.onTaskShown();
  }

  // ---------- Zeitstrafe ----------

  _startPenalty(task) {
    this._stopTimer();
    const btn = this.view._btnQuizNext;
    const view = this._currentView();
    const label = this.panel?.querySelector('.companion-penalty');
    const tick = () => {
      const left = Math.ceil((task.lockedUntil - Date.now()) / 1000);
      if (left <= 0 || task.done) {
        this._endPenaltyUi();
        if (!task.done) this._say('So, weiter geht’s. Diesmal mit Überlegung!', 'think');
        return;
      }
      this._penaltyActive = true;
      btn.disabled = true;
      btn.textContent = `⏳ Denkpause ${left} s`;
      view?.classList.add('companion-paused');
      if (label) {
        label.classList.remove('hidden');
        label.textContent = `⏳ noch ${left} s`;
      }
      this._timer = setTimeout(tick, 250);
    };
    tick();
  }

  _endPenaltyUi() {
    this._stopTimer();
    const btn = this.view._btnQuizNext;
    // Nur eine eigene Sperre aufheben – manche Aufgaben sperren den Knopf
    // selbst, bis alle Teilfragen gesehen sind.
    if (this._penaltyActive) btn.disabled = !!this._currentView()?.querySelector('[data-next-locked="true"]');
    this._penaltyActive = false;
    this._currentView()?.classList.remove('companion-paused');
    this.panel?.querySelector('.companion-penalty')?.classList.add('hidden');
    const task = this._task();
    const mod = this._module();
    if (task && !task.done && this._isGraded(mod)) btn.textContent = '🦉 Prüfen';
  }

  _stopTimer() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }
}
