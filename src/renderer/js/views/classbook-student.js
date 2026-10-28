import { escapeHtml, escapeAttr } from '../utils.js';
import { LINK_MODE_LABELS } from './login.js';
import { offerTeacherName } from './teacher-as-student.js';
import { scanQr } from './qr-scan.js';

// ==================== KLASSENNOTIZBUCH (SCHÜLER) ====================
//
// Klassenbuch-Link `/?k=<token>`: Name und PIN, dann die Aufgaben der Klasse
// mit dem eigenen Stand, die eigenen Ergebnisse und Blätter
// (docs/klassennotizbuch.md). Eine Aufgabe startet den gewöhnlichen Durchlauf
// des Klassenlinks – mit dem Ausweis von hier statt einer Namenseingabe.
// Die Anmeldung hält der Browser für die Sitzung (sessionStorage), so führt
// „Zurück zum Klassenbuch“ ohne neue Anmeldung zurück.
//
// Als installierte App (Home-Bildschirm, eigenes Gerät, `/?app=classbook`)
// führt die App eine Liste „Meine Klassennotizbücher“ – je Klasse und
// Lehrkraft ein Eintrag mit eigener Anmeldung (Name, PIN gelten je Klasse).
// Sie bleibt im localStorage, bis der Schüler sich abmeldet; ein abgelaufener
// Ausweis wird still erneuert. Weitere Notizbücher kommen in der App dazu
// (QR-Code scannen oder Klassencode), denn ein gescannter Link öffnet Safari.

const SESSION_KEY = 'lm_classbook';
const BOOKS_KEY = 'lm_classbooks';
/** Live: nach dem Zurück zur Übersicht dieses Modul öffnen (sessionStorage). */
const OPEN_KEY = 'lm_cb_open';
/** Live: Ziel des 👣 Folgens, das schon einmal geöffnet wurde – nicht bei jedem Neuladen wieder. */
const FOLLOWED_KEY = 'lm_cb_followed';
/** Live: Kennung der zuletzt geöffneten Sendung – jede nur einmal (auch nachgeliefert). */
const SENT_KEY = 'lm_cb_sent';
/** Live: ohne Lebenszeichen so lange gilt die Verbindung als tot (Server pingt alle 25 s). */
const LIVE_SILENT_MS = 60_000;
const sessionGet = (k) => { try { return sessionStorage.getItem(k); } catch (_) { return null; } };
const sessionSet = (k, v) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (_) { /* egal */ } };
const parse = (text) => { try { return JSON.parse(text); } catch (_) { return null; } };

/** Pfad der Schülerseiten: /schueler/ (eigener App-Bereich), sonst /. */
export const studentBase = () => (location.pathname.startsWith('/schueler/') ? '/schueler/' : '/');

/** Läuft die Seite als installierte App? */
export function inApp() {
  try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (_) { return false; }
}

/** App: `{ current, books: [{ token, className, teacher, ticket?, name?, pin? }] }`. */
function loadBooks() {
  try {
    const v = JSON.parse(localStorage.getItem(BOOKS_KEY) || 'null');
    if (v && Array.isArray(v.books)) return v;
  } catch (_) { /* leer anfangen */ }
  return { current: null, books: [] };
}
function storeBooks(v) {
  try { localStorage.setItem(BOOKS_KEY, JSON.stringify(v)); } catch (_) { /* ohne Speicher keine Liste */ }
}
/** Eintrag anlegen bzw. ergänzen. */
function upsertBook(token, fields = {}) {
  const v = loadBooks();
  const b = v.books.find((x) => x.token === token);
  if (b) Object.assign(b, fields); else v.books.push({ token, ...fields });
  storeBooks(v);
  return v;
}

export function classbookSession() {
  if (inApp()) {
    const v = loadBooks();
    const b = v.books.find((x) => x.token === v.current);
    return b?.ticket ? { token: b.token, ticket: b.ticket, name: b.name, pin: b.pin || null } : null;
  }
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; }
}
function saveSession(value) {
  if (inApp()) {
    const v = loadBooks();
    if (value) {
      upsertBook(value.token, { ticket: value.ticket, name: value.name, pin: value.pin || null });
      storeBooks({ ...loadBooks(), current: value.token });
    } else {
      const b = v.books.find((x) => x.token === v.current);
      if (b) { delete b.ticket; delete b.pin; }
      storeBooks(v);
    }
    return;
  }
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch (_) { /* ohne Speicher: nach jedem Durchlauf neu anmelden */ }
}
/** Zurück zur Startseite des Klassennotizbuchs (neu laden, die Sitzung bleibt). */
export function backToClassbook() {
  const s = classbookSession();
  if (s?.token) window.location.href = `${studentBase()}?k=${encodeURIComponent(s.token)}`;
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
    // Name auf dem Home-Bildschirm (iPad) – eine App für alle Klassennotizbücher.
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'Klassenbuch');
    if (inApp()) {
      const v = upsertBook(token, { className: info.className, teacher: info.teacher || '' });
      storeBooks({ ...v, current: token });
    }
    const s = classbookSession();
    if (s?.token === token && s.ticket && (await this._home())) return;
    this._login();
  }

  _login(message = '', { askPin = false, askTest = false, name = '' } = {}) {
    const { info } = this;
    const el = this._show(`
      ${inApp() ? '<button type="button" class="btn btn-secondary btn-sm cb-to-list" id="cbToList">☰ Meine Klassennotizbücher</button>' : ''}
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
    el.querySelector('#cbToList')?.addEventListener('click', () => this.showList());
    const form = el.querySelector('#cbLoginForm');
    // Angemeldete Lehrkraft (Fortbildung): mit ihrem Namen – PIN wie jeder Schüler.
    void offerTeacherName(el.querySelector('#cbName'), () => {
      if (info.firstLoginOpen) form.requestSubmit(); else el.querySelector('#cbPin').focus();
    });
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

  /** Als App: abgelaufenen Ausweis mit gemerktem Namen und PIN erneuern. */
  async _relogin() {
    const s = classbookSession();
    if (!inApp() || !s?.name || !s.pin) return false;
    const res = await post(`${encodeURIComponent(this.token)}/login`, { name: s.name, pin: s.pin }).catch(() => null);
    if (!res || res.failed || res.pin) return false;
    saveSession({ ...s, ticket: res.ticket, name: res.name });
    return true;
  }

  /** Startseite; false, wenn die Anmeldung nicht mehr gilt. */
  async _home() {
    const s = classbookSession();
    const data = await post(`${encodeURIComponent(this.token)}/home`, { ticket: s?.ticket }).catch(() => null);
    if (!data || data.failed) {
      if (data?.expired) {
        if (await this._relogin()) return this._home();
        saveSession(null);
        this._login(data.message || '');
        return true;
      }
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
        <span class="cb-head-actions">
          ${inApp() ? '<button type="button" class="btn btn-secondary btn-sm" id="cbToList" title="Alle deine Klassennotizbücher">☰ Alle</button>'
            : '<button type="button" class="btn btn-secondary btn-sm" id="cbInstall" title="Klassennotizbuch als App auf den Home-Bildschirm – öffnet direkt hier, angemeldet">📲 Als App</button>'}
          <button type="button" class="btn btn-secondary btn-sm" id="cbLogout">Abmelden</button>
        </span>
      </div>
      <p class="hint cb-install-hint hidden" id="cbInstallHint"></p>
      ${exams ? `<h3 class="cb-section">📝 Klassenarbeit</h3>${exams}` : ''}
      <h3 class="cb-section">📋 Aufgaben</h3>
      ${assignments || '<p class="hint">Gerade sind keine Aufgaben freigegeben.</p>'}
      ${data.pending
        ? '<p class="hint cb-pending">Deine Ergebnisse und Blätter erscheinen hier, sobald deine Lehrkraft deinen Namen in der Klassenliste bestätigt hat.</p>'
        : `<h3 class="cb-section">📈 Meine Ergebnisse</h3>${results}<h3 class="cb-section">✍️ Meine Blätter</h3>${works}`}`);
    el.querySelector('#cbToList')?.addEventListener('click', () => { this._stopWatch(); this.showList(); });
    el.querySelector('#cbInstall')?.addEventListener('click', async () => {
      // Chrome, Edge: Dialog des Browsers. iPad/iPhone: Teilen → Zum Home-Bildschirm.
      const prompt = this.app.installPrompt;
      if (prompt) {
        this.app.installPrompt = null;
        prompt.prompt();
        await prompt.userChoice.catch(() => null);
        return;
      }
      const hint = el.querySelector('#cbInstallHint');
      hint.innerHTML = '<strong>So kommt das Klassennotizbuch auf den Home-Bildschirm:</strong> In Safari auf <b>Teilen</b> (□ mit Pfeil nach oben) tippen, dann <b>„Zum Home-Bildschirm“</b>. In der App meldest du dich einmal mit Name und PIN an und bleibst angemeldet, bis du dich abmeldest. Klassennotizbücher anderer Lehrkräfte fügst du in der App mit ➕ hinzu.';
      hint.classList.remove('hidden');
    });
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
    this._connectLive();
    // Von der Lehrkraft geschickt bzw. 👣 Folgen, während eine Aufgabe offen war.
    const pending = parse(sessionGet(OPEN_KEY));
    sessionSet(OPEN_KEY, null);
    if (pending?.token === this.token) void this._enter(pending.linkId, null, pending.moduleId);
    return true;
  }

  // ---- Live: 📡 An Klasse senden, 👣 Folgen ----

  /**
   * Verbindung zum Server halten – auch während einer Aufgabe (die Seite
   * bleibt dieselbe). Das iPad trennt sie still, wenn der Bildschirm aus oder
   * die App im Hintergrund war; deshalb neu verbinden, sobald die Seite wieder
   * sichtbar ist oder eine Minute kein Lebenszeichen kam.
   */
  _connectLive(force = false) {
    const s = classbookSession();
    if (!s?.ticket || typeof EventSource === 'undefined') return;
    if (!force && this._live && this._liveToken === this.token && this._live.readyState !== EventSource.CLOSED) return;
    this._live?.close();
    this._liveToken = this.token;
    this._liveSeen = Date.now();
    const src = new EventSource(`/api/public/classbook/${encodeURIComponent(this.token)}/live?ticket=${encodeURIComponent(s.ticket)}`);
    this._live = src;
    if (!this._liveWatch) {
      this._liveWatch = setInterval(() => {
        if (this._live && Date.now() - this._liveSeen > LIVE_SILENT_MS) this._connectLive(true);
      }, 15000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this._live) this._connectLive(true);
      });
    }
    const seen = () => { this._liveSeen = Date.now(); };
    src.addEventListener('ping', seen);
    src.addEventListener('send', (e) => { seen(); this._liveSent(parse(e.data)); });
    src.addEventListener('state', (e) => {
      seen();
      const st = parse(e.data);
      // Beim (Wieder-)Verbinden: eine Sendung, die das Gerät verpasst hat.
      if (st?.sent) this._liveSent(st.sent);
      if (!st?.follow || !st.marker) return;
      const key = `${this.token}:${st.marker.linkId}:${st.marker.moduleId}`;
      if (sessionGet(FOLLOWED_KEY) === key) return;
      sessionSet(FOLLOWED_KEY, key);
      this._liveOpen(st.marker, true);
    });
    src.onerror = () => {
      // Abgelaufener Ausweis o. Ä.: EventSource gibt auf – später mit frischem Ausweis.
      if (src.readyState === EventSource.CLOSED && this._live === src) {
        this._live = null;
        setTimeout(() => this._connectLive(), 15000);
      }
    };
  }

  /** Gesendetes Modul – jede Sendung nur einmal (sie kommt beim Wiederverbinden noch einmal mit). */
  _liveSent(sent) {
    if (!sent?.linkId) return;
    if (sent.id) {
      if (sessionGet(SENT_KEY) === sent.id) return;
      sessionSet(SENT_KEY, sent.id);
    }
    this._liveOpen(sent, false);
  }

  /**
   * Modul öffnen, das die Lehrkraft schickt (`follow`: dem 📍 folgen). Auf der
   * Übersicht sofort; in einer anderen Aufgabe beim Senden als Hinweis zum
   * Antippen, beim Folgen nach 3 s – Zeit, das Blatt zu speichern.
   */
  _liveOpen(target, follow) {
    if (!this._el.classList.contains('hidden') && this.data) { void this._enter(target.linkId, null, target.moduleId); return; }
    if (this.current?.linkId === target.linkId && this.current?.moduleId === target.moduleId) return;
    const title = target.title || this.data?.assignments?.flatMap((a) => a.topics).flatMap((t) => t.units).find((u) => u.id === target.moduleId)?.title || 'ein Modul';
    const go = () => {
      sessionSet(OPEN_KEY, JSON.stringify({ token: this.token, linkId: target.linkId, moduleId: target.moduleId }));
      backToClassbook();
    };
    document.querySelector('.cb-live-banner')?.remove();
    const banner = document.createElement('div');
    banner.className = 'cb-live-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = follow
      ? `<span>👣 Weiter zu <strong>${escapeHtml(title)}</strong> …</span><button type="button" class="btn btn-secondary btn-sm" data-go>Jetzt</button>`
      : `<span>📡 Deine Lehrkraft schickt <strong>${escapeHtml(title)}</strong></span>
         <button type="button" class="btn btn-secondary btn-sm" data-go>Öffnen</button>
         <button type="button" class="btn btn-secondary btn-sm" data-close aria-label="Später">✕</button>`;
    document.body.appendChild(banner);
    banner.querySelector('[data-go]').addEventListener('click', go);
    banner.querySelector('[data-close]')?.addEventListener('click', () => banner.remove());
    if (follow) setTimeout(() => { if (banner.isConnected) go(); }, 3000);
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
      if (err) window.location.href = `${studentBase()}?l=${encodeURIComponent(res.linkToken)}&m=contest`;
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

  // ---- Schüler-App: Liste der Klassennotizbücher ----

  /**
   * Start der installierten App (`/?app=classbook&k=<token>`): Das Notizbuch
   * des Links kommt in die Liste. Mit einem Eintrag öffnet es direkt, sonst die Liste.
   */
  async startApp(token) {
    if (!inApp() && token) { await this.start(token); return; }
    if (token) upsertBook(token);
    const { books } = loadBooks();
    if (inApp() && books.length === 1) { await this.start(books[0].token); return; }
    // Ohne Eintrag (am PC installiert): die Liste mit ➕ Klassennotizbuch hinzufügen.
    this.showList();
  }

  showList(message = '') {
    const { books } = loadBooks();
    const el = this._show(`
      <div class="cb-head">
        <div><span class="quick-entry-label">📒 Klassenbuch</span><h2>Meine Klassennotizbücher</h2></div>
      </div>
      ${message ? `<p class="login-error">${escapeHtml(message)}</p>` : ''}
      ${books.length ? `<ul class="cb-books">${books.map((b) => `
        <li><button type="button" class="cb-book" data-token="${escapeAttr(b.token)}">
            <strong>${escapeHtml(b.className || 'Klassennotizbuch')}</strong>${b.teacher ? ` – ${escapeHtml(b.teacher)}` : ''}
            <span class="hint">${b.ticket ? `angemeldet als ${escapeHtml(b.name || '')}` : 'nicht angemeldet'}</span></button>
          <button type="button" class="btn btn-secondary btn-sm cb-book-del" data-token="${escapeAttr(b.token)}" title="Aus der Liste nehmen (deine Ergebnisse bleiben)">✕</button></li>`).join('')}</ul>`
        : '<p class="hint">Noch kein Klassennotizbuch – füge eines hinzu.</p>'}
      <button type="button" class="btn btn-primary btn-full" id="cbAdd">➕ Klassennotizbuch hinzufügen</button>`);
    el.querySelectorAll('.cb-book').forEach((btn) => btn.addEventListener('click', () => this.start(btn.dataset.token)));
    el.querySelectorAll('.cb-book-del').forEach((btn) => btn.addEventListener('click', async () => {
      const b = books.find((x) => x.token === btn.dataset.token);
      if (!(await this.app.appConfirm(`„${b?.className || 'Klassennotizbuch'}“ aus der Liste nehmen? Deine Ergebnisse und Blätter bleiben – mit Klassencode oder QR-Code kommt es wieder dazu.`))) return;
      const v = loadBooks();
      storeBooks({ current: v.current === btn.dataset.token ? null : v.current, books: v.books.filter((x) => x.token !== btn.dataset.token) });
      this.showList();
    }));
    el.querySelector('#cbAdd').addEventListener('click', () => this._addBook());
  }

  /** Hinzufügen: QR-Code (Klassenbuch-Link) scannen oder Klassencode eintippen. */
  _addBook(message = '') {
    const el = this._show(`
      <button type="button" class="btn btn-secondary btn-sm cb-to-list" id="cbToList">☰ Meine Klassennotizbücher</button>
      <div class="quick-entry-topic"><span class="quick-entry-label">➕ Klassennotizbuch hinzufügen</span></div>
      <button type="button" class="btn btn-primary btn-full" id="cbScan">📷 QR-Code scannen</button>
      <div class="cb-scan hidden" id="cbScanBox"><div class="cb-scan-view"></div>
        <button type="button" class="btn btn-secondary btn-full" id="cbScanStop">Abbrechen</button></div>
      <form class="login-form" id="cbCodeForm">
        <div class="form-group">
          <label for="cbCode">… oder Klassencode</label>
          <input type="text" id="cbCode" class="cb-code-input" placeholder="z. B. K7M4-QX9P" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" />
          <small class="hint">Steht bei deiner Lehrkraft neben dem QR-Code des Klassennotizbuchs.</small>
        </div>
        <p class="login-error ${message ? '' : 'hidden'}" id="cbAddErr">${escapeHtml(message)}</p>
        <button type="submit" class="btn btn-secondary btn-full">Hinzufügen</button>
      </form>`);
    let scan = null;
    const stopScan = () => { scan?.cancel(); scan = null; el.querySelector('#cbScanBox').classList.add('hidden'); el.querySelector('#cbScan').classList.remove('hidden'); };
    el.querySelector('#cbToList').addEventListener('click', () => { stopScan(); this.showList(); });
    el.querySelector('#cbScanStop').addEventListener('click', stopScan);
    el.querySelector('#cbScan').addEventListener('click', async () => {
      el.querySelector('#cbScan').classList.add('hidden');
      el.querySelector('#cbScanBox').classList.remove('hidden');
      scan = scanQr(el.querySelector('.cb-scan-view'));
      let text;
      try { text = await scan.done; } catch (err) {
        stopScan();
        this._addBook(err?.name === 'NotAllowedError' ? 'Die Kamera ist nicht erlaubt. Erlaube sie in den Einstellungen – oder tipp den Klassencode ein.' : (err?.message || 'Die Kamera lässt sich nicht starten.'));
        return;
      }
      if (text === null) return; // abgebrochen
      stopScan();
      let token = null;
      try {
        const url = new URL(text, location.origin);
        if (url.origin === location.origin) token = url.searchParams.get('k');
      } catch (_) { /* kein Link */ }
      if (!token) { this._addBook('Das ist kein QR-Code eines Klassennotizbuchs von hier. Bitte den QR-Code aus „Klassenbuch-Link“ scannen.'); return; }
      await this._added(token);
    });
    el.querySelector('#cbCodeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = el.querySelector('#cbCode').value.trim();
      if (!code) return;
      const res = await fetch(`/api/public/classbook/code/${encodeURIComponent(code.replace(/[\s-]/g, '').toUpperCase())}`).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : null;
      if (!res?.ok || !data?.token) { this._addBook(data?.message || 'Der Server ist nicht erreichbar.'); return; }
      await this._added(data.token);
    });
  }

  /** Neues Notizbuch: in die Liste und öffnen (Anmeldung mit Name und PIN dieser Klasse). */
  async _added(token) {
    upsertBook(token);
    await this.start(token);
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
    this.current = { linkId, moduleId: onlyModule || null };
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
