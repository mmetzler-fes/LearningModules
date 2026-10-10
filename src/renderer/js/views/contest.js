import { escapeHtml, escapeAttr } from '../utils.js';
import { downloadBlob } from '../api.js';
import { collectAnswer } from '../answer-eval.js';

// ==================== QUIZ-ARENA ====================

const SESSION_PREFIX = 'lm_contest_';
const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Kleine HTML-Datei, die beim Öffnen sofort zur Adresse springt – zum
 * Ablegen auf dem Desktop des Beamer-PCs oder im Kursordner.
 */
export function redirectHtml(url, title) {
  const u = escapeAttr(url);
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0; url=${u}">
<title>${escapeHtml(title)}</title>
<script>location.replace(${JSON.stringify(url).replace(/</g, '\\u003c')});</script>
</head>
<body style="font-family:sans-serif;padding:2em;">
<p>${escapeHtml(title)} wird geöffnet … Falls nicht: <a href="${u}">${u}</a></p>
</body>
</html>
`;
}

export function saveRedirectFile(url, title, fileName) {
  const safe = String(fileName || title || 'Link').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 80);
  downloadBlob(new Blob([redirectHtml(url, title)], { type: 'text/html' }), `${safe}.html`);
}

// ---------- Tusch ----------

let audioCtx = null;

/** Audio im Browser freischalten – geht nur während eines Klicks. */
function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (_) { /* ohne Ton */ }
}

/**
 * Eingebaute Fanfare, im Browser erzeugt – ohne Datei und ohne Lizenzfrage:
 * drei kurze Auftakte und ein langer Schlussakkord.
 */
function playBuiltinFanfare() {
  unlockAudio();
  if (!audioCtx) return;
  const ctx = audioCtx;
  const master = ctx.createGain();
  master.gain.value = 0.18;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2400;
  master.connect(filter).connect(ctx.destination);

  const note = (freq, start, length) => {
    for (const detune of [-6, 6]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const t0 = ctx.currentTime + start;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(1, t0 + 0.02);
      gain.gain.setValueAtTime(1, t0 + Math.max(0.03, length - 0.08));
      gain.gain.linearRampToValueAtTime(0, t0 + length);
      osc.connect(gain).connect(master);
      osc.start(t0);
      osc.stop(t0 + length + 0.05);
    }
  };
  // G4 G4 G4 C5 … E5 G5 (C-Dur-Schluss)
  const G4 = 392, C5 = 523.25, E5 = 659.25, G5 = 783.99;
  note(G4, 0, 0.14);
  note(G4, 0.16, 0.14);
  note(G4, 0.32, 0.14);
  note(C5, 0.5, 0.35);
  note(G4, 0.9, 0.18);
  for (const f of [C5, E5, G5]) note(f, 1.12, 1.3);
}

export function playFanfare(url) {
  if (url) {
    const audio = new Audio(url);
    audio.play().catch(() => playBuiltinFanfare());
    return;
  }
  playBuiltinFanfare();
}

// ---------- Hilfen für die Anzeige ----------

function fmtPoints(n) {
  return Number(n || 0).toLocaleString('de-DE');
}

function leaderboardHtml(list, { meId = null, showLast = false } = {}) {
  if (!list || list.length === 0) return '<p class="hint">Noch keine Punkte.</p>';
  return `<ol class="contest-board">${list.map((e) => `
    <li class="contest-board-row ${e.id === meId ? 'is-me' : ''}">
      <span class="contest-board-rank">${e.rank <= 3 ? MEDALS[e.rank - 1] : `${e.rank}.`}</span>
      <span class="contest-board-name">${escapeHtml(e.name)}</span>
      ${showLast && e.lastPoints ? `<span class="contest-board-last">+${fmtPoints(e.lastPoints)}</span>` : ''}
      <span class="contest-board-score">${fmtPoints(e.score)}</span>
    </li>`).join('')}</ol>`;
}

/** Siegertreppchen: Platz 2 links, 1 in der Mitte, 3 rechts; Gleichstand teilt sich eine Stufe. */
function podiumHtml(podium) {
  const step = (rank) => {
    const names = (podium || []).filter((e) => e.rank === rank);
    return `
      <div class="podium-step podium-${rank}">
        <div class="podium-names">${names.length
          ? names.map((e) => `<div class="podium-name">${escapeHtml(e.name)}</div><div class="podium-score">${fmtPoints(e.score)} Punkte</div>`).join('')
          : '<div class="podium-name podium-empty">–</div>'}</div>
        <div class="podium-block"><span>${MEDALS[rank - 1]}</span><strong>${rank}</strong></div>
      </div>`;
  };
  return `<div class="podium">${step(2)}${step(1)}${step(3)}</div>`;
}

/** Countdown, der lokal weiterläuft; der Server liefert nur die Restzeit. */
class Countdown {
  constructor() {
    this._timer = null;
    this.deadline = 0;
    this.total = 0;
  }
  set(remainingMs, totalSeconds, onTick, onEnd) {
    this.stop();
    this.deadline = Date.now() + remainingMs;
    this.total = totalSeconds * 1000;
    let ended = false;
    const tick = () => {
      const left = Math.max(0, this.deadline - Date.now());
      onTick(left, this.total);
      if (left <= 0) {
        if (!ended) { ended = true; onEnd?.(); }
        return;
      }
      this._timer = setTimeout(tick, 200);
    };
    tick();
  }
  stop() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }
}

function timerHtml() {
  return `
    <div class="contest-timer">
      <div class="contest-timer-num">–</div>
      <div class="contest-timer-bar"><div class="contest-timer-fill"></div></div>
    </div>`;
}

function updateTimer(root, left, total) {
  const num = root.querySelector('.contest-timer-num');
  const fill = root.querySelector('.contest-timer-fill');
  if (num) num.textContent = String(Math.ceil(left / 1000));
  if (fill) fill.style.width = `${total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0}%`;
  root.querySelector('.contest-timer')?.classList.toggle('contest-timer-low', left <= 5000);
}

// ==================== VIEW ====================

/**
 * Bildschirme des Quiz-Arenas. Sie liegen außerhalb der normalen
 * Oberfläche, denn weder Leitung noch Schüler sind angemeldet.
 *
 * Leitung (`/?wh=<token>`): Wartebereich mit QR-Code, die laufende Frage,
 * Auswertung mit Bestenliste, Siegertreppchen mit Tusch.
 * Schüler (`/?l=<token>&m=contest`): Name eingeben, warten, antworten.
 */
export class ContestView {
  constructor(app) {
    this.app = app;
    this.screen = null;
    this.countdown = new Countdown();
    this.source = null;
  }

  _ensureScreen() {
    document.getElementById('loginScreen')?.classList.add('hidden');
    document.getElementById('appContainer')?.classList.add('hidden');
    if (!this.screen) {
      this.screen = document.createElement('div');
      this.screen.id = 'contestScreen';
      this.screen.className = 'contest-screen';
      document.body.appendChild(this.screen);
    }
    return this.screen;
  }

  _showMessage(icon, title, text, { reload = false, action = null } = {}) {
    this.countdown.stop();
    const screen = this._ensureScreen();
    screen.innerHTML = `
      <div class="contest-message">
        <div class="contest-message-icon">${icon}</div>
        <h2>${escapeHtml(title)}</h2>
        ${text ? `<p>${escapeHtml(text)}</p>` : ''}
        ${action ? `<button class="btn btn-primary" id="contestAction">${escapeHtml(action.label)}</button>` : ''}
        ${reload ? '<button class="btn btn-primary" id="contestReload">🔄 Neu laden</button>' : ''}
      </div>`;
    screen.querySelector('#contestAction')?.addEventListener('click', action?.run);
    screen.querySelector('#contestReload')?.addEventListener('click', () => location.reload());
  }

  _closeSource() {
    if (this.source) this.source.close();
    this.source = null;
  }

  /**
   * Ereignisstrom mit Wiederaufnahme: Bricht er ab (WLAN, Server-Neustart),
   * versucht der Browser es selbst; ist er endgültig zu, ruft `onDead` an.
   */
  _listen(url, handlers, onDead) {
    this._closeSource();
    const source = new EventSource(url);
    this.source = source;
    for (const [event, fn] of Object.entries(handlers)) {
      source.addEventListener(event, (e) => {
        let data = null;
        try { data = JSON.parse(e.data); } catch (_) { return; }
        fn(data);
      });
    }
    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED && this.source === source) {
        this.source = null;
        onDead?.();
      }
    });
  }

  // ==================== LEITUNG ====================

  async startHost(hostToken) {
    this.role = 'host';
    this.hostToken = hostToken;
    this.hostState = null;
    this.question = null;
    this._hostKey = null;
    try {
      this.soundOn = localStorage.getItem('lm_contest_sound') !== 'off';
    } catch (_) {
      this.soundOn = true;
    }
    this._ensureScreen();
    this._showMessage('⏳', 'Wartebereich wird geöffnet …', '');
    await this._hostConnect();
  }

  async _hostConnect() {
    let res;
    try {
      res = await this.app.api.contestHost(this.hostToken, 'open');
    } catch (_) {
      this._showMessage('📡', 'Server nicht erreichbar', 'Bitte die Verbindung prüfen und neu laden.', { reload: true });
      return;
    }
    if (!res || res.statusCode) {
      this._showMessage('🚫', 'Quiz-Arena kann nicht geöffnet werden', res?.message || 'Unbekannter Fehler.');
      return;
    }
    this.hostState = res;
    this._renderHost();
    this._listen(`/api/public/contest/host/${encodeURIComponent(this.hostToken)}/events`, {
      state: (data) => { this.hostState = data; this._renderHost(); },
      question: (data) => {
        this.question = data;
        // Kam die Aufgabe erst nach dem Zustand (z. B. nach einem Neuladen), jetzt nachzeichnen.
        const st = this.hostState;
        if (st && st.index === data.index && (st.phase === 'question' || st.phase === 'reveal') && !this._hostView) {
          this._hostKey = null;
          this._renderHost();
        }
      },
      closed: (data) => {
        this._closeSource();
        this._hostKey = null;
        this._showMessage('👋', 'Quiz-Arena beendet', data?.reason || '', {
          action: { label: '🆕 Neuen Wartebereich öffnen', run: () => this.startHost(this.hostToken) },
        });
      },
    }, () => {
      // Server neu gestartet o. ä.: Wartebereich neu eröffnen.
      setTimeout(() => this._hostConnect(), 2000);
    });
  }

  async _hostAction(action, body) {
    unlockAudio();
    const res = await this.app.api.contestHost(this.hostToken, action, body).catch(() => null);
    if (!res || res.statusCode) {
      this.app.showToast(res?.message || 'Aktion fehlgeschlagen.', 'error');
      return false;
    }
    return true;
  }

  _renderHost() {
    const st = this.hostState;
    if (!st) return;
    const screen = this._ensureScreen();
    const key = `${st.phase}:${st.index}`;
    if (key !== this._hostKey) {
      this._hostKey = key;
      this.countdown.stop();
      if (st.phase === 'lobby' || st.phase === 'question') this._hostView = null;
      screen.innerHTML = '';
      if (st.phase === 'lobby') this._buildHostLobby(screen);
      else if (st.phase === 'question') this._buildHostQuestion(screen);
      else if (st.phase === 'reveal') this._buildHostReveal(screen);
      else if (st.phase === 'podium') this._buildHostPodium(screen);
    }
    this._updateHost(screen);
  }

  _hostTop(st, extra = '') {
    return `
      <header class="contest-top">
        <div class="contest-top-title">🏆 ${escapeHtml(st.linkName || 'Quiz-Arena')}</div>
        <div class="contest-top-info">${extra}</div>
        ${st.phase === 'question' || st.phase === 'reveal' ? `
        <button class="btn btn-secondary btn-sm contest-top-reset" title="Durchgang abbrechen, zurück in den Wartebereich">🔁 Neu starten</button>` : ''}
        ${st.phase !== 'podium' ? `
        <button class="btn btn-secondary btn-sm contest-top-close" title="Quiz-Arena beenden, alle Teilnehmer entfernen">⏹ Beenden</button>` : ''}
        <button class="btn btn-secondary btn-sm contest-sound" title="Tusch an/aus">${this.soundOn ? '🔊' : '🔇'}</button>
      </header>`;
  }

  /**
   * Kopfleiste: Ton, und außerhalb der Siegerehrung Abbrechen und Beenden –
   * sonst steckte ein abgebrochener Durchgang bis zur Siegerehrung fest.
   */
  _bindTop(screen) {
    this._bindSound(screen);
    screen.querySelector('.contest-top-reset')?.addEventListener('click', async () => {
      if (await this.app.appConfirm('Durchgang abbrechen und zurück in den Wartebereich? Die Teilnehmer bleiben, die Punkte beginnen wieder bei 0.')) {
        this._hostAction('reset');
      }
    });
    screen.querySelector('.contest-top-close')?.addEventListener('click', async () => {
      if (await this.app.appConfirm('Quiz-Arena beenden? Alle Teilnehmer werden entfernt; danach kannst du einen leeren Wartebereich öffnen.')) {
        this._hostAction('close');
      }
    });
  }

  _bindSound(screen) {
    screen.querySelector('.contest-sound')?.addEventListener('click', (e) => {
      unlockAudio();
      this.soundOn = !this.soundOn;
      try { localStorage.setItem('lm_contest_sound', this.soundOn ? 'on' : 'off'); } catch (_) {}
      e.currentTarget.textContent = this.soundOn ? '🔊' : '🔇';
    });
  }

  _buildHostLobby(screen) {
    const st = this.hostState;
    screen.innerHTML = `
      ${this._hostTop(st, `${st.total} Aufgabe${st.total !== 1 ? 'n' : ''} · bis ${fmtPoints(st.maxPoints)} Punkte je Aufgabe`)}
      <main class="contest-lobby">
        <section class="contest-join">
          <h2>Mitmachen</h2>
          <div class="contest-qr">${st.qrSvg || ''}</div>
          <div class="contest-join-url">${escapeHtml(st.joinUrl)}</div>
          <div class="contest-join-actions">
            <button class="btn btn-secondary btn-sm" id="contestCopyJoin">📋 Link kopieren</button>
            <button class="btn btn-secondary btn-sm" id="contestSaveJoin" title="HTML-Datei, die den Schüler-Link öffnet">💾 Als Datei</button>
          </div>
        </section>
        <section class="contest-waiting">
          <h2>Im Wartebereich: <span class="contest-player-count">0</span></h2>
          <div class="contest-players"></div>
          <div class="contest-host-actions">
            <button class="btn btn-primary btn-lg" id="contestStart">▶️ Quiz-Arena starten</button>
          </div>
          <p class="hint">Namen mit ✕ entfernen. Wer später kommt, steigt bei der laufenden Aufgabe ein.</p>
        </section>
      </main>`;
    this._bindTop(screen);
    screen.querySelector('#contestCopyJoin').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(st.joinUrl);
        this.app.showToast('Link kopiert', 'success');
      } catch (_) {
        this.app.showToast('Kopieren klappt hier nicht.', 'error');
      }
    });
    screen.querySelector('#contestSaveJoin').addEventListener('click', () =>
      saveRedirectFile(st.joinUrl, `Quiz-Arena ${st.linkName} – mitmachen`, `QuizArena_${st.linkName}_Schueler`));
    screen.querySelector('#contestStart').addEventListener('click', () => this._hostAction('start'));
  }

  _playersHtml(players, { showAnswered = false } = {}) {
    if (!players.length) return '<p class="hint contest-empty">Noch niemand da – QR-Code scannen!</p>';
    return players.map((p) => `
      <span class="contest-chip ${showAnswered && p.answered ? 'is-done' : ''} ${p.online ? '' : 'is-offline'}"
        title="${p.online ? '' : 'Verbindung unterbrochen'}">
        ${showAnswered ? (p.answered ? '✅ ' : '⏳ ') : ''}${escapeHtml(p.name)}
        <button class="contest-kick" data-id="${escapeAttr(p.id)}" title="Entfernen">✕</button>
      </span>`).join('');
  }

  _bindKicks(box) {
    box.querySelectorAll('.contest-kick').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.parentElement.textContent.replace('✕', '').replace(/[✅⏳]/g, '').trim();
        if (!(await this.app.appConfirm(`„${name}“ aus der Quiz-Arena entfernen?`))) return;
        this._hostAction('kick', { playerId: btn.dataset.id });
      });
    });
  }

  _renderQuestionInto(box, interactive) {
    box.innerHTML = '';
    const q = this.question;
    const st = this.role === 'host' ? this.hostState : this.playerState;
    if (!q || q.index !== st.index) {
      box.innerHTML = '<p class="hint">Aufgabe wird geladen …</p>';
      return null;
    }
    const mod = q.module;
    const view = document.createElement('div');
    view.className = 'quiz-module-view contest-module-view';
    if (!interactive) view.setAttribute('inert', '');
    box.appendChild(view);
    this.app.renderer.renderPreview(mod, H5P_TYPES[mod.type] || {}, view, { quizMode: true, examMode: true, upload: {} });
    return view;
  }

  _buildHostQuestion(screen) {
    const st = this.hostState;
    screen.innerHTML = `
      ${this._hostTop(st, `Aufgabe ${st.index + 1} von ${st.total}`)}
      <main class="contest-play">
        <div class="contest-play-head">
          ${timerHtml()}
          <div class="contest-answered">Antworten: <strong class="contest-answered-num">0</strong> / <span class="contest-player-count">0</span></div>
          <button class="btn btn-secondary" id="contestEndTime">⏹ Zeit beenden</button>
        </div>
        <div class="contest-question h5p-container"></div>
        <div class="contest-players contest-players-small"></div>
      </main>`;
    this._bindTop(screen);
    this._hostView = this._renderQuestionInto(screen.querySelector('.contest-question'), false);
    screen.querySelector('#contestEndTime').addEventListener('click', () => this._hostAction('next'));
    this.countdown.set(st.remainingMs, st.seconds, (left, total) => updateTimer(screen, left, total));
  }

  _buildHostReveal(screen) {
    const st = this.hostState;
    const last = st.index + 1 >= st.total;
    // Lösung aus derselben Auswertung wie beim Schüler, angewandt auf die (leere) Ansicht der Leitung.
    let solution = '';
    if (this._hostView && this.question) {
      try { solution = collectAnswer(this.question.module, this._hostView).correctAnswer || ''; } catch (_) {}
    }
    if (solution === '—' || /^\d+\/\d+$/.test(solution)) solution = '';
    // Formelaufgabe: Jeder hatte eigene Werte – am Beamer die Formel, keine Zahl.
    if (this.question?.module?.type === 'formula') {
      solution = (this.question.module.content?.results || []).filter((r) => r?.formula)
        .map((r) => `${r.label || 'Ergebnis'} = ${r.formula}${r.unit ? ` [${r.unit}]` : ''}`).join(' · ');
    }
    screen.innerHTML = `
      ${this._hostTop(st, `Auswertung Aufgabe ${st.index + 1} von ${st.total}`)}
      <main class="contest-reveal">
        <section class="contest-reveal-left">
          <h2>${escapeHtml(this.question?.module?.title || '')}</h2>
          ${solution ? `<div class="contest-solution"><strong>Lösung:</strong> ${escapeHtml(solution)}</div>` : ''}
          <div class="contest-stats"></div>
          <div class="contest-host-actions">
            <button class="btn btn-primary btn-lg" id="contestNext">${last ? '🏆 Zur Siegerehrung' : 'Weiter →'}</button>
          </div>
        </section>
        <section class="contest-reveal-right">
          <h2>Top 10</h2>
          <div class="contest-leaderboard"></div>
        </section>
      </main>`;
    this._bindTop(screen);
    screen.querySelector('#contestNext').addEventListener('click', async () => {
      // Der Tusch muss im Klick starten – sonst blockiert der Browser den Ton.
      if (last && this.soundOn) playFanfare(st.soundUrl);
      await this._hostAction('next');
    });
  }

  _buildHostPodium(screen) {
    const st = this.hostState;
    screen.innerHTML = `
      ${this._hostTop(st, 'Siegerehrung')}
      <main class="contest-final">
        <div class="contest-confetti" aria-hidden="true">${Array.from({ length: 24 }, (_, i) =>
          `<span style="left:${(i * 37) % 100}%;animation-delay:${(i % 8) * 0.25}s">${['🎉', '✨', '🎊', '⭐'][i % 4]}</span>`).join('')}</div>
        <div class="contest-podium-box"></div>
        <section class="contest-final-board">
          <h2>Top 10</h2>
          <div class="contest-leaderboard"></div>
        </section>
        <div class="contest-host-actions">
          <button class="btn btn-secondary" id="contestFanfare">🎺 Tusch</button>
          <button class="btn btn-primary" id="contestAgain">🔁 Neuer Durchgang</button>
          <button class="btn btn-danger" id="contestClose">⏹ Quiz-Arena beenden</button>
        </div>
        <p class="hint">Die Ergebnisse stehen in deiner Ergebnisliste (Modus „Quiz-Arena“).</p>
      </main>`;
    this._bindTop(screen);
    screen.querySelector('#contestFanfare').addEventListener('click', () => playFanfare(st.soundUrl));
    screen.querySelector('#contestAgain').addEventListener('click', async () => {
      if (await this.app.appConfirm('Neuer Durchgang mit denselben Teilnehmern? Die Punkte beginnen wieder bei 0.')) {
        this._hostAction('reset');
      }
    });
    screen.querySelector('#contestClose').addEventListener('click', async () => {
      if (await this.app.appConfirm('Quiz-Arena beenden? Die Schüler sehen dann eine Abschlussmeldung.')) {
        this._hostAction('close');
      }
    });
  }

  /** Was sich innerhalb einer Phase ändert: Teilnehmer, Antworten, Bestenliste. */
  _updateHost(screen) {
    const st = this.hostState;
    screen.querySelectorAll('.contest-player-count').forEach((el) => { el.textContent = String(st.playerCount); });
    const players = screen.querySelector('.contest-players');
    if (players) {
      players.innerHTML = this._playersHtml(st.players || [], { showAnswered: st.phase === 'question' });
      this._bindKicks(players);
    }
    const answered = screen.querySelector('.contest-answered-num');
    if (answered) answered.textContent = String(st.answeredCount);
    const start = screen.querySelector('#contestStart');
    if (start) start.disabled = !st.playerCount;
    const board = screen.querySelector('.contest-leaderboard');
    if (board) board.innerHTML = leaderboardHtml(st.leaderboard, { showLast: st.phase === 'reveal' });
    const stats = screen.querySelector('.contest-stats');
    if (stats && st.roundStats) {
      const s = st.roundStats;
      stats.innerHTML = `
        <span class="contest-stat ok">✅ ${s.correct} richtig</span>
        <span class="contest-stat part">◐ ${s.partial} teilweise</span>
        <span class="contest-stat bad">❌ ${s.wrong} falsch</span>
        <span class="contest-stat none">⏳ ${s.missing} ohne Antwort</span>`;
    }
    const podium = screen.querySelector('.contest-podium-box');
    if (podium) podium.innerHTML = podiumHtml(st.podium);
  }

  // ==================== SCHÜLER ====================

  _storeKey(token) {
    return SESSION_PREFIX + token;
  }

  _loadSession(token) {
    try { return JSON.parse(sessionStorage.getItem(this._storeKey(token)) || 'null'); } catch (_) { return null; }
  }

  _saveSession(token, data) {
    try {
      if (data) sessionStorage.setItem(this._storeKey(token), JSON.stringify(data));
      else sessionStorage.removeItem(this._storeKey(token));
    } catch (_) { /* ohne Wiederaufnahme */ }
  }

  /**
   * Beitritt aus dem Namensformular. Liefert null oder einen Fehler
   * `{ message, needTestPassword }` (Testschüler der Lehrkraft).
   */
  async joinAsPlayer(token, { studentName, password, testPassword }) {
    let res;
    try {
      res = await this.app.api.contestJoin(token, { studentName, password, testPassword });
    } catch (_) {
      return { message: 'Der Server ist nicht erreichbar.' };
    }
    if (!res || !res.playerId) return { message: res?.message || 'Beitritt fehlgeschlagen.', needTestPassword: !!res?.needTestPassword };
    this._saveSession(token, { playerId: res.playerId, secret: res.secret, name: res.name });
    this._enterPlayer(token, res);
    return null;
  }

  /** Nach einem Neuladen: mit gespeicherter Spieler-ID weiter. */
  async resumePlayer(token) {
    const saved = this._loadSession(token);
    if (!saved?.playerId) return false;
    const res = await this.app.api.contestJoin(token, { playerId: saved.playerId, secret: saved.secret }).catch(() => null);
    if (!res || !res.playerId) {
      this._saveSession(token, null);
      return false;
    }
    this._enterPlayer(token, res);
    return true;
  }

  _enterPlayer(token, me) {
    this.role = 'player';
    this.token = token;
    this.me = me;
    this.playerState = null;
    this.question = null;
    this._playerKey = null;
    this._submitted = new Set();
    this._ensureScreen();
    this._showMessage('⏳', 'Verbinde …', '');
    const url = `/api/public/contest/${encodeURIComponent(token)}/events?pid=${encodeURIComponent(me.playerId)}&sec=${encodeURIComponent(me.secret)}`;
    this._listen(url, {
      state: (data) => { this.playerState = data; this._renderPlayer(); },
      question: (data) => { this.question = data; if (this.playerState) this._renderPlayer(); },
      kicked: (data) => {
        this._closeSource();
        this._saveSession(token, null);
        this._showMessage('🚫', 'Entfernt', data?.reason || '');
      },
      closed: (data) => {
        this._closeSource();
        this._saveSession(token, null);
        this._showMessage('👋', 'Die Quiz-Arena ist beendet', data?.reason || 'Danke fürs Mitmachen!');
      },
    }, () => {
      // Endgültig abgebrochen: prüfen, ob es den Platz noch gibt.
      setTimeout(async () => {
        if (!(await this.resumePlayer(token))) {
          this._showMessage('📡', 'Verbindung verloren', 'Die Quiz-Arena ist nicht mehr erreichbar.', { reload: true });
        }
      }, 2000);
    });
  }

  _renderPlayer() {
    const st = this.playerState;
    if (!st) return;
    const screen = this._ensureScreen();
    // Neuer Durchgang: die Aufgaben zählen wieder von vorn.
    if (st.phase === 'lobby') this._submitted.clear();
    const answered = st.answered || this._submitted.has(st.index);
    const key = `${st.phase}:${st.index}:${st.phase === 'question' ? answered : ''}:${this.question?.index ?? ''}`;
    if (key !== this._playerKey) {
      this._playerKey = key;
      this.countdown.stop();
      if (st.phase === 'lobby') this._buildPlayerLobby(screen);
      else if (st.phase === 'question') this._buildPlayerQuestion(screen, answered);
      else if (st.phase === 'reveal') this._buildPlayerReveal(screen);
      else if (st.phase === 'podium') this._buildPlayerPodium(screen);
    }
    screen.querySelectorAll('.contest-player-count').forEach((el) => { el.textContent = String(st.playerCount); });
  }

  _playerTop(st, extra = '') {
    return `
      <header class="contest-top">
        <div class="contest-top-title">🏆 ${escapeHtml(st.linkName || 'Quiz-Arena')}</div>
        <div class="contest-top-info">${extra}</div>
        <div class="contest-me">👤 ${escapeHtml(this.me.name)} · ${fmtPoints(st.me?.score)} P</div>
      </header>`;
  }

  _buildPlayerLobby(screen) {
    const st = this.playerState;
    screen.innerHTML = `
      ${this._playerTop(st)}
      <div class="contest-message">
        <div class="contest-message-icon contest-bounce">🦉</div>
        <h2>Hallo ${escapeHtml(this.me.name)}!</h2>
        <p>Du bist im Wartebereich. Gleich geht es los …</p>
        <p class="hint"><span class="contest-player-count">${st.playerCount}</span> Teilnehmer · ${st.total} Aufgabe${st.total !== 1 ? 'n' : ''}</p>
        <p class="hint">Je schneller und richtiger du antwortest, desto mehr Punkte bekommst du.</p>
      </div>`;
  }

  _buildPlayerQuestion(screen, answered) {
    const st = this.playerState;
    if (answered) {
      screen.innerHTML = `
        ${this._playerTop(st, `Aufgabe ${st.index + 1} von ${st.total}`)}
        <div class="contest-message">
          <div class="contest-message-icon">📨</div>
          <h2>Antwort abgegeben!</h2>
          <p>Warte, bis die Zeit um ist oder alle geantwortet haben.</p>
          ${timerHtml()}
        </div>`;
      this.countdown.set(st.remainingMs, st.seconds, (left, total) => updateTimer(screen, left, total));
      return;
    }
    screen.innerHTML = `
      ${this._playerTop(st, `Aufgabe ${st.index + 1} von ${st.total}`)}
      <main class="contest-play">
        <div class="contest-play-head">${timerHtml()}</div>
        <div class="contest-question h5p-container"></div>
        <div class="contest-submit-row">
          <button class="btn btn-primary btn-lg" id="contestSubmit">✅ Antwort abgeben</button>
        </div>
      </main>`;
    const view = this._renderQuestionInto(screen.querySelector('.contest-question'), true);
    const submit = () => this._submitAnswer(view);
    screen.querySelector('#contestSubmit').addEventListener('click', submit);
    // Bei Ablauf wird abgeschickt, was bis dahin eingetragen ist.
    this.countdown.set(st.remainingMs, st.seconds, (left, total) => updateTimer(screen, left, total), submit);
  }

  async _submitAnswer(view) {
    const st = this.playerState;
    const q = this.question;
    if (!st || !q || !view || this._submitted.has(st.index) || q.index !== st.index) return;
    this._submitted.add(st.index);
    let answer;
    try {
      answer = collectAnswer(q.module, view);
    } catch (_) {
      answer = { points: 0, isCorrect: false, userAnswer: '', correctAnswer: '' };
    }
    const res = await this.app.api.contestAnswer(this.token, {
      playerId: this.me.playerId,
      secret: this.me.secret,
      index: st.index,
      points: answer.points ?? (answer.isCorrect ? 1 : 0),
      isCorrect: !!answer.isCorrect,
      userAnswer: answer.userAnswer,
      correctAnswer: answer.correctAnswer,
    }).catch(() => null);
    if (res && res.statusCode && this.playerState?.phase === 'question') {
      this.app.showToast(res.message || 'Antwort nicht angenommen.', 'error');
    }
    this._renderPlayer();
  }

  _buildPlayerReveal(screen) {
    const st = this.playerState;
    const me = st.me || {};
    const pts = me.lastPoints || 0;
    const r = me.lastCorrectness;
    const icon = r === null || r === undefined ? '⏳' : r >= 1 ? '🎉' : r > 0 ? '👍' : '😕';
    const text = r === null || r === undefined ? 'Keine Antwort abgegeben.'
      : r >= 1 ? 'Richtig!' : r > 0 ? `Teilweise richtig (${Math.round(r * 100)} %)` : 'Leider falsch.';
    screen.innerHTML = `
      ${this._playerTop(st, `Auswertung ${st.index + 1} von ${st.total}`)}
      <main class="contest-player-reveal">
        <div class="contest-result-card ${r >= 1 ? 'ok' : r > 0 ? 'part' : 'bad'}">
          <div class="contest-message-icon">${icon}</div>
          <h2>${escapeHtml(text)}</h2>
          <div class="contest-gain">+${fmtPoints(pts)} Punkte</div>
          <p>Gesamt: <strong>${fmtPoints(me.score)}</strong> · Platz <strong>${me.rank || '–'}</strong> von ${st.playerCount}</p>
        </div>
        <section>
          <h3>Top 10</h3>
          ${leaderboardHtml(st.leaderboard, { meId: me.id, showLast: true })}
        </section>
      </main>`;
  }

  _buildPlayerPodium(screen) {
    const st = this.playerState;
    const me = st.me || {};
    screen.innerHTML = `
      ${this._playerTop(st, 'Siegerehrung')}
      <main class="contest-final">
        ${podiumHtml(st.podium)}
        <div class="contest-result-card ok">
          <h2>${me.rank && me.rank <= 3 ? `${MEDALS[me.rank - 1]} Glückwunsch!` : 'Gut gemacht!'}</h2>
          <p>Du bist auf Platz <strong>${me.rank || '–'}</strong> von ${st.playerCount} mit <strong>${fmtPoints(me.score)}</strong> Punkten.</p>
        </div>
        ${leaderboardHtml(st.leaderboard, { meId: me.id })}
      </main>`;
  }
}
