import { escapeHtml, escapeAttr } from '../utils.js';
import { LINK_MODE_LABELS } from './login.js';

// ==================== KLASSENNOTIZBUCH (SCHÜLER) ====================
//
// Klassenbuch-Link `/?k=<token>`: Name und PIN, dann die Aufgaben der Klasse
// mit dem eigenen Stand, die eigenen Ergebnisse und Blätter
// (docs/klassennotizbuch.md). Eine Aufgabe startet den gewöhnlichen Durchlauf
// des Klassenlinks – mit dem Ausweis von hier statt einer Namenseingabe.
// Die Anmeldung hält der Browser für die Sitzung (sessionStorage), so führt
// „Zurück zum Klassenbuch“ ohne neue Anmeldung zurück.

const SESSION_KEY = 'lm_classbook';

export function classbookSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; }
}
function saveSession(value) {
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch (_) { /* ohne Speicher: nach jedem Durchlauf neu anmelden */ }
}
/** Zurück zur Startseite des Klassennotizbuchs (neu laden, die Sitzung bleibt). */
export function backToClassbook() {
  const s = classbookSession();
  if (s?.token) window.location.href = `/?k=${encodeURIComponent(s.token)}`;
}

async function post(path, body) {
  const res = await fetch(`/api/public/classbook/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? data : { ...data, failed: true };
}

const when = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
const pctClass = (v) => (v === null || v === undefined ? '' : v >= 70 ? 'good' : v >= 40 ? 'medium' : 'poor');

/** Stand eines Moduls als kleines Zeichen. */
function unitState(u) {
  const parts = [];
  if (u.done) parts.push(u.pct === null || u.pct === undefined ? '<span class="cb-done" title="erledigt">✓</span>' : `<span class="result-score ${pctClass(u.pct)}" title="bestes Ergebnis">${u.pct} %</span>`);
  if (u.work) parts.push('<span title="Blatt bearbeitet">✍️</span>');
  return parts.join(' ');
}

const TYPE_ICON = { document: '📄', attachment: '📎' };

export class ClassbookStudent {
  constructor(app) {
    this.app = app;
  }

  get _el() { return document.getElementById('classbookSection'); }

  _show(html) {
    const el = this._el;
    document.getElementById('studentLoginSection')?.classList.add('hidden');
    document.getElementById('adminLoginSection')?.classList.add('hidden');
    el.classList.remove('hidden');
    el.innerHTML = html;
    return el;
  }

  async start(token) {
    this.token = token;
    this._show('<p class="hint">Klassennotizbuch wird geladen…</p>');
    let info;
    try {
      const res = await fetch(`/api/public/classbook/${encodeURIComponent(token)}`);
      info = await res.json();
      if (!res.ok) throw new Error(info?.message || 'Dieser Klassenbuch-Link ist ungültig.');
    } catch (err) {
      this._show(`<p class="login-error">${escapeHtml(err.message || 'Der Server ist nicht erreichbar.')}</p>`);
      return;
    }
    this.info = info;
    const s = classbookSession();
    if (s?.token === token && s.ticket && (await this._home())) return;
    this._login();
  }

  _login(message = '', { askPin = false, askTest = false, name = '' } = {}) {
    const { info } = this;
    const el = this._show(`
      <div class="quick-entry-topic">
        <span class="quick-entry-label">📒 Klassennotizbuch</span>
        <h2>${escapeHtml(info.className)}</h2>
        ${info.teacher ? `<p class="hint">${escapeHtml(info.teacher)}</p>` : ''}
      </div>
      <form class="login-form" id="cbLoginForm">
        <div class="form-group">
          <label for="cbName">Dein Name</label>
          <input type="text" id="cbName" required placeholder="Vor- und Nachname..." autocomplete="off" value="${escapeAttr(name)}" />
        </div>
        <div class="form-group">
          <label for="cbPin">🔑 PIN</label>
          <input type="password" id="cbPin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="off" placeholder="4 Ziffern" />
          <small class="hint">${info.firstLoginOpen
            ? 'Zum allerersten Mal hier? Dann lass das Feld leer – du bekommst deine PIN angezeigt.'
            : 'Deine PIN aus 4 Ziffern. Kennst du sie nicht, frag deine Lehrkraft.'}</small>
        </div>
        <div class="form-group ${askTest ? '' : 'hidden'}" id="cbTestGroup">
          <label for="cbTest">🧪 Testpasswort</label>
          <input type="password" id="cbTest" autocomplete="off" placeholder="Passwort deines Testschülers" />
        </div>
        <p class="login-error ${message ? '' : 'hidden'}" id="cbErr">${escapeHtml(message)}</p>
        <button type="submit" class="btn btn-primary btn-full">📒 Öffnen</button>
      </form>`);
    const form = el.querySelector('#cbLoginForm');
    // Kein Pflichtfeld: Ob es ohne PIN geht (Erstanmeldung), entscheidet der Server.
    (askTest ? el.querySelector('#cbTest') : name && askPin ? el.querySelector('#cbPin') : el.querySelector('#cbName')).focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const typed = el.querySelector('#cbName').value.trim();
      const pin = el.querySelector('#cbPin').value.trim();
      const testGroup = el.querySelector('#cbTestGroup');
      const testPassword = testGroup.classList.contains('hidden') ? undefined : el.querySelector('#cbTest').value;
      const res = await post(`${encodeURIComponent(this.token)}/login`, { name: typed, pin: pin || undefined, testPassword }).catch(() => null);
      if (!res || res.failed) {
        this._login(res?.message || 'Der Server ist nicht erreichbar.', { askPin: !!res?.needPin, askTest: !!res?.needTestPassword, name: typed });
        return;
      }
      saveSession({ token: this.token, ticket: res.ticket, name: res.name, pin: res.pin || pin || null });
      if (res.pin) this._showPin(res.pin);
      else await this._home();
    });
  }

  _showPin(pin) {
    const el = this._show(`
      <div class="quick-entry-topic">
        <span class="quick-entry-label">🔑 Deine PIN</span>
        <p class="cb-pin">${escapeHtml(pin)}</p>
        <p><strong>Schreib sie dir auf!</strong> Mit deinem Namen und dieser PIN kommst du immer wieder an deine Aufgaben, Ergebnisse und Blätter – auch an einem anderen Gerät.</p>
        <p class="hint">Die PIN wird nur dieses eine Mal angezeigt. Vergessen? Deine Lehrkraft sieht sie in der Klassenliste.</p>
      </div>
      <button type="button" class="btn btn-primary btn-full" id="cbPinOk">Aufgeschrieben – weiter</button>`);
    el.querySelector('#cbPinOk').addEventListener('click', () => this._home());
  }

  /** Startseite; false, wenn die Anmeldung nicht mehr gilt. */
  async _home() {
    const s = classbookSession();
    const data = await post(`${encodeURIComponent(this.token)}/home`, { ticket: s?.ticket }).catch(() => null);
    if (!data || data.failed) {
      if (data?.expired) { saveSession(null); this._login(data.message || ''); return true; }
      this._show(`<p class="login-error">${escapeHtml(data?.message || 'Der Server ist nicht erreichbar.')}</p>`);
      return !!data;
    }
    this.data = data;
    document.querySelector('#loginScreen .login-card')?.classList.add('login-card-wide');
    this._watchArena();
    if (data.arena) { this._arenaHome(data); return true; }
    const mk = data.marker;
    const cardOf = (a) => {
      const modes = a.modes.map((m) => {
        const meta = LINK_MODE_LABELS[m];
        return meta ? `<button type="button" class="btn btn-primary btn-sm" data-start="${escapeAttr(a.linkId)}" data-mode="${escapeAttr(m)}" title="${escapeAttr(meta.hint)}">${meta.icon} ${escapeHtml(meta.label)}</button>` : '';
      }).join('');
      // Module eingeklappt; beim 📍-Merker der Lehrkraft ist sein Lernthema offen.
      const marked = (t, u) => mk && mk.linkId === a.linkId && mk.topicId === t.id && (!u || mk.moduleId === u.id);
      return `<details class="cb-assignment" open>
        <summary><strong>${escapeHtml(a.name)}</strong></summary>
        <div class="cb-actions">${modes}</div>
        ${a.topics.map((t) => {
          const done = t.units.filter((u) => u.done || u.work).length;
          return `<details class="cb-topic" ${marked(t) ? 'open' : ''}>
          <summary class="cb-topic-title">📘 ${escapeHtml(t.title)}
            <span class="hint">${data.pending ? `${t.units.length} Module` : `${done}/${t.units.length} erledigt`}</span>
            ${marked(t) ? '<span class="cb-here">📍 Hier sind wir</span>' : ''}</summary>
          <ul class="cb-units">${t.units.map((u) => `
            <li class="${marked(t, u) ? 'cb-marked' : ''}">${a.modes.length ? `<button type="button" class="cb-unit" data-start="${escapeAttr(a.linkId)}" data-module="${escapeAttr(u.id)}">` : '<span class="cb-unit">'}
              ${marked(t, u) ? '📍 ' : ''}${TYPE_ICON[u.type] || '🧩'} ${escapeHtml(u.title || 'Aufgabe')}${a.modes.length ? '</button>' : '</span>'}
              <span class="cb-state">${unitState(u)}</span></li>`).join('')}</ul>
        </details>`;
        }).join('')}
      </details>`;
    };
    // Baum wie bei der Lehrkraft: Bereiche/Abschnitte eingeklappt – außer auf dem Weg zum 📍 Merker.
    const nodes = data.nodes || [];
    const inNode = (a, id) => {
      for (let n = nodes.find((x) => x.id === a.nodeId); n; n = nodes.find((x) => x.id === n.parentId)) if (n.id === id) return true;
      return false;
    };
    const markedLink = mk ? data.assignments.find((a) => a.linkId === mk.linkId) : null;
    const level = (parentId) => {
      const inner = nodes.filter((n) => n.parentId === parentId).sort((x, y) => x.orderIndex - y.orderIndex).map((n) => {
        const body = level(n.id);
        if (!body) return '';
        const mine = data.assignments.filter((a) => a.nodeId === n.id || inNode(a, n.id));
        const units = mine.flatMap((a) => a.topics.flatMap((t) => t.units));
        const done = units.filter((u) => u.done || u.work).length;
        return `<details class="cb-snode" ${markedLink && inNode(markedLink, n.id) ? 'open' : ''}>
          <summary><span class="cb-node-title">${n.kind === 'section' ? '📑' : '📂'} ${escapeHtml(n.title)}</span>
            <span class="hint">${data.pending ? `${units.length} Module` : `${done}/${units.length} erledigt`}</span>
            ${markedLink && inNode(markedLink, n.id) ? '<span class="cb-here">📍</span>' : ''}</summary>
          <div class="cb-node-body">${body}</div></details>`;
      }).join('');
      const cards = data.assignments.filter((a) => (a.nodeId || null) === parentId).sort((x, y) => (x.order ?? 0) - (y.order ?? 0)).map(cardOf).join('');
      return inner + cards;
    };
    const assignments = level(null);
    const results = data.results.length
      ? `<ul class="cb-list">${data.results.map((r) => `<li><span>${escapeHtml(r.linkName || 'Aufgabe')} <span class="hint">${escapeHtml(LINK_MODE_LABELS[r.mode]?.label || r.mode || '')} · ${escapeHtml(when(r.at))}</span></span>
          ${r.maxScore ? `<span class="result-score ${pctClass(r.percentage)}">${r.percentage ?? Math.round((r.score / r.maxScore) * 100)} %</span>` : '<span class="hint">ohne Wertung</span>'}</li>`).join('')}</ul>`
      : '<p class="hint">Noch keine Ergebnisse.</p>';
    const works = data.works.length
      ? `<ul class="cb-list">${data.works.map((w) => `<li><button type="button" class="cb-unit" data-start="${escapeAttr(w.linkId)}" data-module="${escapeAttr(w.moduleId)}">📄 ${escapeHtml(w.title)}</button>
          <span class="hint">${escapeHtml(when(w.at))}</span></li>`).join('')}</ul>`
      : '<p class="hint">Noch keine Blätter – sie entstehen, wenn du ein Dokument mit „✍️ Mit Stift bearbeiten“ öffnest.</p>';
    const EXAM_STATE = {
      open: '<button type="button" class="btn btn-primary btn-sm" data-exam>📝 Klassenarbeit starten</button>',
      running: '<button type="button" class="btn btn-primary btn-sm" data-exam>📝 Weiterschreiben</button>',
      reentry: '<button type="button" class="btn btn-primary btn-sm" data-exam>📝 Wieder einsteigen</button>',
      locked: '<span class="hint">Schon begonnen – zum Weiterschreiben gibt deine Lehrkraft den Wiedereinstieg frei.</span>',
      submitted: '<span class="hint">✅ abgegeben</span>',
    };
    const exams = (data.exams || []).map((x) => `<div class="cb-exam" data-link="${escapeAttr(x.linkId)}">
        <strong>📝 ${escapeHtml(x.name)}</strong>${EXAM_STATE[x.state] || ''}</div>`).join('');
    const el = this._show(`
      <div class="cb-head">
        <div><span class="quick-entry-label">📒 ${escapeHtml(data.className)}</span><h2>${escapeHtml(data.name)}</h2></div>
        <button type="button" class="btn btn-secondary btn-sm" id="cbLogout">Abmelden</button>
      </div>
      ${exams ? `<h3 class="cb-section">📝 Klassenarbeit</h3>${exams}` : ''}
      <h3 class="cb-section">📋 Aufgaben</h3>
      ${assignments || '<p class="hint">Gerade sind keine Aufgaben freigegeben.</p>'}
      ${data.pending
        ? '<p class="hint cb-pending">Deine Ergebnisse und Blätter erscheinen hier, sobald deine Lehrkraft deinen Namen in der Klassenliste bestätigt hat.</p>'
        : `<h3 class="cb-section">📈 Meine Ergebnisse</h3>${results}<h3 class="cb-section">✍️ Meine Blätter</h3>${works}`}`);
    el.querySelector('#cbLogout').addEventListener('click', () => {
      this._stopWatch();
      saveSession(null);
      document.querySelector('#loginScreen .login-card')?.classList.remove('login-card-wide');
      this._login();
    });
    el.querySelectorAll('[data-start]').forEach((btn) => btn.addEventListener('click', () => this._enter(btn.dataset.start, btn.dataset.mode || null, btn.dataset.module || null, btn)));
    // 📍 Merker: dorthin scrollen und den Fokus aufs Modul legen.
    const here = el.querySelector('.cb-marked .cb-unit');
    if (here) {
      here.scrollIntoView({ block: 'center' });
      here.focus({ preventScroll: true });
    }
    el.querySelectorAll('[data-exam]').forEach((btn) => btn.addEventListener('click', () => this._enter(btn.closest('[data-link]').dataset.link, 'exam', null, btn)));
    return true;
  }

  /**
   * Quiz-Arena offen: Nur sie ist zu sehen. Angemeldet geht es mit dem Namen
   * aus dem Klassennotizbuch direkt in den Wartebereich.
   */
  _arenaHome(data) {
    const el = this._show(`
      <div class="cb-head">
        <div><span class="quick-entry-label">📒 ${escapeHtml(data.className)}</span><h2>${escapeHtml(data.name)}</h2></div>
      </div>
      <div class="quick-entry-topic cb-arena">
        <span class="quick-entry-label">🏆 Quiz-Arena</span>
        <h2>${escapeHtml(data.arena.name)}</h2>
        <p>Deine Lehrkraft hat die Quiz-Arena geöffnet.</p>
      </div>
      <button type="button" class="btn btn-primary btn-full" id="cbArenaJoin">🏆 In den Wartebereich</button>`);
    el.querySelector('#cbArenaJoin').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const s = classbookSession();
      const res = await post(`${encodeURIComponent(this.token)}/enter`, { ticket: s?.ticket, linkId: data.arena.linkId }).catch(() => null);
      if (!res?.linkToken) {
        this.app.showToast(res?.message || 'Die Quiz-Arena ist gerade nicht erreichbar.', 'error');
        btn.disabled = false;
        return;
      }
      this._stopWatch();
      document.querySelector('#loginScreen .login-card')?.classList.remove('login-card-wide');
      this._el.classList.add('hidden');
      const err = await this.app.contestView.joinAsPlayer(res.linkToken, { studentName: s?.name || data.name, password: '' });
      // Testschüler oder ein anderer Haken: über die gewohnte Namenseingabe der Arena.
      if (err) window.location.href = `/?l=${encodeURIComponent(res.linkToken)}&m=contest`;
    });
  }

  /** Alle 5 s fragen, ob die Lehrkraft die Quiz-Arena geöffnet oder beendet hat – dann neu aufbauen. */
  _watchArena() {
    this._stopWatch();
    this._poll = setInterval(async () => {
      if (this._el.classList.contains('hidden')) { this._stopWatch(); return; }
      const res = await post(`${encodeURIComponent(this.token)}/arena`, { ticket: classbookSession()?.ticket }).catch(() => null);
      if (!res || res.failed) return;
      if ((res.arena?.linkId || null) !== (this.data?.arena?.linkId || null)) await this._home();
    }, 5000);
  }

  _stopWatch() {
    if (this._poll) clearInterval(this._poll);
    this._poll = null;
  }

  /** Aufgabe starten – ganz oder nur ein Modul; ohne Modus der erste der Zuweisung. */
  async _enter(linkId, mode, onlyModule, btn) {
    const s = classbookSession();
    const assignment = this.data?.assignments.find((a) => a.linkId === linkId);
    const chosen = mode || (assignment?.modes.includes('quiz') ? 'quiz' : assignment?.modes[0]) || 'quiz';
    if (btn) btn.disabled = true;
    try {
      const res = await post(`${encodeURIComponent(this.token)}/enter`, { ticket: s?.ticket, linkId, exam: chosen === 'exam' });
      if (!res?.linkToken) throw new Error(res?.message || 'Diese Aufgabe ist gerade nicht freigegeben.');
      const data = await this.app.api.startLinkRun(res.linkToken, { mode: chosen, classTicket: s.ticket });
      if (!data?.topics) throw new Error(data?.message || 'Der Start ist fehlgeschlagen.');
      if (s.pin && data.studentTicket) {
        const { rememberPin } = await import('../ink/work-store.js');
        rememberPin(data.studentTicket, s.pin);
      }
      document.querySelector('#loginScreen .login-card')?.classList.remove('login-card-wide');
      this._el.classList.add('hidden');
      await this.app.loginView._enterLinkRun(res.linkToken, data, '', onlyModule);
    } catch (err) {
      this.app.showToast(err.message || 'Der Server ist nicht erreichbar.', 'error');
      if (btn) btn.disabled = false;
    }
  }
}
