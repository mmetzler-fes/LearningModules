import { rememberStudent, rememberedStudent } from '../class-device.js';
import { escapeHtml, escapeAttr } from '../utils.js';
import { nestEmbedded } from '../../lm-editor/src/doc/doc-quiz.js';
import { isDocLike } from '../quiz-usage.js';
import { LINK_MODE_LABELS } from './login.js';
import { offerTeacherName } from './teacher-as-student.js';
import { scanQr } from './qr-scan.js';
import { workspace, transition } from '../workspace.js';
import { icon } from '../../lm-editor/src/util/icons.js';

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

/** 👁 Vorschau der Lehrkraft: nur in diesem Tab, nie in der Liste der Schüler-App. */
const PREVIEW_KEY = 'lm_cb_preview';
const previewSession = () => parse(sessionGet(PREVIEW_KEY));

export function classbookSession() {
  const preview = previewSession();
  if (preview) return preview;
  if (inApp()) {
    const v = loadBooks();
    const b = v.books.find((x) => x.token === v.current);
    return b?.ticket ? { token: b.token, ticket: b.ticket, name: b.name, pin: b.pin || null } : null;
  }
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; }
}
function saveSession(value) {
  if (previewSession()) {
    sessionSet(PREVIEW_KEY, value ? JSON.stringify({ ...value, preview: true }) : null);
    return;
  }
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
/** Startseite ohne Neuladen (ClassbookStudent#_homeInPlace) – true, wenn es so ging. */
let homeInPlace = null;

/** Zurück zur Startseite des Klassennotizbuchs (neu laden, die Sitzung bleibt). */
export function backToClassbook() {
  // Mit Tabs liegt die Startseite noch da: gleich zeigen und still auffrischen – kein Neuladen, kein Flackern.
  try { if (homeInPlace?.()) return; } catch (err) { console.warn('Home ohne Neuladen ging nicht:', err); }
  workspace.willReload?.();
  // Angemeldet mit dem Schulkonto in mehreren Klassen: Home zeigt alle.
  if (allGet() === '1') { window.location.href = `${studentBase()}?app=classbook&all=1`; return; }
  const s = classbookSession();
  if (s?.token) window.location.href = `${studentBase()}?k=${encodeURIComponent(s.token)}`;
}

/** Home mit allen Klassennotizbüchern (Anmeldung mit dem Schulkonto) – bleibt für diese Sitzung. */
const ALL_KEY = 'lm_cb_all';
// „Alle meine Klassen“ (Schulkonto) bleibt auf dem Gerät gewählt – auch nach dem Schließen von App oder Browser.
const allGet = () => { try { return localStorage.getItem(ALL_KEY) || sessionStorage.getItem(ALL_KEY); } catch (_) { return null; } };
const allSet = (v) => {
  try {
    if (v === null) { localStorage.removeItem(ALL_KEY); sessionStorage.removeItem(ALL_KEY); } else localStorage.setItem(ALL_KEY, v);
  } catch (_) { /* ohne Speicher: nur für diese Sitzung */ }
};
/** Klassennotizbücher mit Anmeldung auf diesem Gerät. */
const signedBooks = () => loadBooks().books.filter((b) => b.ticket);

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
  if (u.work) parts.push(`<span class="cb-worked" title="Blatt bearbeitet">${ico('pen')}</span>`);
  return parts.join(' ');
}

const TYPE_ICON = { document: '📄', attachment: '📎' };

// Gezeichnete Symbole (Strich wie im Stift-Editor) statt Emojis – auf dem iPad ruhiger und gleich groß.
const ICONS = {
  folder: 'M3 6.5a1.5 1.5 0 011.5-1.5h4l2 2.5h9A1.5 1.5 0 0121 9v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18z',
  section: 'M5 4h10l4 4v12H5zM8.5 11h7M8.5 14.5h7M8.5 18h4',
  topic: 'M4 5.5C6.5 4 9.5 4 12 5.5v14c-2.5-1.5-5.5-1.5-8 0zM12 5.5c2.5-1.5 5.5-1.5 8 0v14c-2.5-1.5-5.5-1.5-8 0',
  document: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 15.5h6',
  attachment: 'M20 11.5l-7.8 7.8a5 5 0 01-7.1-7.1l8.2-8.2a3.3 3.3 0 014.7 4.7l-8.2 8.2a1.7 1.7 0 01-2.4-2.4l7.4-7.4',
  quiz: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.3M12 17h.01',
  key: 'M8 14a4 4 0 110-.01M11 12h9M17 12v3M20 12v2.5',
  board: 'M3 4.5h18v12H3zM8 21l4-4.5 4 4.5M7 12.5c1.5-2.5 3-2.5 4-1s2.5 1.5 5-2',
  pin: 'M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0113 0c0 4.9-6.5 11-6.5 11zM12 7.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  notebook: 'M6 3h12v18H6zM6 7H4M6 12H4M6 17H4M10 7.5h5',
  tasks: 'M9 4h6v3H9zM7 5.5H5V21h14V5.5h-2M8.5 12l2 2 4-4M8.5 17.5h7',
  chart: 'M4 20h16M7 16v-4M11 16V8M15 16v-6M19 16V5',
  pen: 'M4 20l1.2-4.4L15.6 5.2a2.1 2.1 0 013 3L8.2 18.6 4 20zM13.8 7l3.2 3.2',
  exam: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3',
  list: 'M4 6h16M4 12h16M4 18h16',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  install: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14',
  learn: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8V16h7.2v-2.2A6 6 0 0012 3z',
  companion: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  contest: 'M8 4h8v5a4 4 0 01-8 0zM8 6H5v1.5A3 3 0 008 10.5M16 6h3v1.5a3 3 0 01-3 3M12 13v4M8.5 20h7M10 17h4v3h-4z',
};
const MODE_ICON = { quiz: 'quiz', exam: 'exam', learn: 'learn', companion: 'companion', contest: 'contest' };
const ico = (name, cls = '') => `<svg class="cb-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
const UNIT_ICON = (type) => ico(type === 'document' ? 'document' : type === 'attachment' ? 'attachment' : 'quiz');
// Nach der Anmeldung einmal je Sitzung: 📍 Merker öffnen (sonst Home) – nicht bei jedem Zurück nach Home.
const LANDED_KEY = 'lm_ws_landed';

/** Titel und Symbol eines Moduls bzw. einer Zuweisung für den Tab. */
function tabInfo(data, linkId, moduleId) {
  const a = (data?.assignments || []).find((x) => x.linkId === linkId);
  if (!a) return { title: 'Aufgabe', icon: '📄' };
  if (moduleId) {
    for (const t of a.topics || []) {
      const u = (t.units || []).find((x) => x.id === moduleId);
      if (u) {
        // Ein Lernthema mit genau einem Dokument heißt wie die Zuweisung (so steht es auch im Baum).
        const docs = nestEmbedded(t.units).top.filter(isDocLike);
        const title = a.topics.length === 1 && docs.length === 1 && docs[0].id === u.id ? a.name : u.title;
        return { title: title || a.name || 'Aufgabe', icon: TYPE_ICON[u.type] || '🧩' };
      }
    }
  }
  return { title: a.name || 'Aufgabe', icon: '📘' };
}

/** Baum der Aufgaben eines Klassennotizbuchs (Bereiche, Abschnitte, Zuweisungen) – für Home mit einer oder mehreren Klassen. */
function treeHtml(data, boards, solutions) {
  // 📍 Merker: { anchor, current: { linkId, topicId, moduleId }, openNodeIds, hasNext } – oder null.
  const mk = data.marker;
  const weiterBtn = mk?.hasNext ? `<button type="button" class="btn btn-secondary btn-sm cb-weiter" data-weiter>Weiter ${icon('next')}</button>` : '';
  const cardOf = (a) => {
    const modes = a.modes.map((m) => {
      const meta = LINK_MODE_LABELS[m];
      return meta ? `<button type="button" class="btn btn-primary btn-sm" data-start="${escapeAttr(a.linkId)}" data-mode="${escapeAttr(m)}" title="${escapeAttr(meta.hint)}">${MODE_ICON[m] ? ico(MODE_ICON[m]) : meta.icon} ${escapeHtml(meta.label)}</button>` : '';
    }).join('');
    // Module eingeklappt; beim 📍-Merker der Lehrkraft ist sein Lernthema offen.
    const marked = (t, u) => mk && mk.current.linkId === a.linkId && mk.current.topicId === t.id && (!u || mk.current.moduleId === u.id);
    const unitRow = (t, u, embedded = false, quizCount = 0, title = u.title) => `
          <li class="${marked(t, u) ? 'cb-marked' : ''} ${embedded ? 'cb-embedded' : ''}">${a.modes.length ? `<button type="button" class="cb-unit" data-start="${escapeAttr(a.linkId)}" data-module="${escapeAttr(u.id)}">` : '<span class="cb-unit">'}
            ${marked(t, u) ? ico('pin', 'cb-pin') : ''}${UNIT_ICON(u.type)} ${escapeHtml(title || 'Aufgabe')}${a.modes.length ? '</button>' : '</span>'}
            <span class="nb-meta">${escapeHtml((typeof H5P_TYPES !== 'undefined' && H5P_TYPES[u.type]?.name) || '')}${quizCount ? ` · ${quizCount === 1 ? '1 Quiz' : `${quizCount} Quizze`}` : ''}</span>
            <span class="cb-state">${unitState(u)}</span></li>`;
    // Wie im Lernnotizbuch: Quizze im Dokument stehen eingerückt darunter.
    const unitRows = (t, pick = () => true, ownTitle = false, skipRow = false) => {
      const { top, quizzesOf } = nestEmbedded(t.units);
      return top.filter(pick).map((u) => {
        const quizzes = quizzesOf.get(u.id) || [];
        const solution = solutions.has(u.id) ? `
          <li class="cb-embedded"><button type="button" class="cb-unit" data-solution-ink="${escapeAttr(u.id)}" title="Die Lösung deiner Lehrkraft – nur zum Ansehen. Dein eigenes Blatt bleibt, wie es ist.">${ico('key')} Lösung</button>
            <span class="nb-meta">zum Ansehen</span></li>` : '';
        const board = boards.has(u.id) ? `
          <li class="cb-embedded"><button type="button" class="cb-unit" data-board="${escapeAttr(u.id)}" title="Das Tafelbild deiner Lehrkraft – nur zum Ansehen. Dein eigenes Blatt bleibt, wie es ist.">${ico('board')} Tafelbild</button>
            <span class="nb-meta">zum Ansehen</span></li>` : '';
        return (skipRow ? '' : unitRow(t, u, false, quizzes.length, ownTitle ? t.title : u.title)) + solution + board + quizzes.map((q) => unitRow(t, q, true)).join('');
      }).join('');
    };
    // Wie im Lernnotizbuch: Ein Lernthema mit genau einem Dokument ist eine Zeile (das Dokument unter dem
    // Titel des Lernthemas), Quizze außerhalb des Dokuments stehen gesammelt unter „🧩 Weitere Quizze“.
    const soleDoc = (t) => {
      const docs = nestEmbedded(t.units).top.filter(isDocLike);
      return docs.length === 1 ? docs[0] : null;
    };
    const singleRows = (t, doc, skipRow = false) => {
      const rest = nestEmbedded(t.units).top.filter((u) => u.id !== doc.id);
      const restOpen = rest.some((u) => marked(t, u));
      return unitRows(t, (u) => u.id === doc.id, true, skipRow) + (rest.length ? `
          <li class="cb-quiz-set"><details ${restOpen ? 'open' : ''}><summary><span class="cb-twisty" aria-hidden="true"></span>
            <span class="nb-icon" aria-hidden="true">${ico('quiz')}</span><span class="cb-row-title">Weitere Quizze</span>
            <span class="nb-meta">${count(rest)}</span></summary>
            <ul class="cb-units">${unitRows(t, (u) => u.id !== doc.id)}</ul></details></li>` : '');
    };
    const count = (units) => {
      const done = units.filter((u) => u.done || u.work).length;
      return data.pending ? `${units.length} Module` : `${done}/${units.length} erledigt`;
    };
    const here = `<span class="cb-here">${ico('pin', 'cb-pin')} Hier sind wir</span>${weiterBtn}`;
    const only = a.topics.length === 1 ? a.topics[0] : null;
    // Ein Lernthema mit genau einem Dokument: Die Zeile der Zuweisung ist das Dokument (Klick auf den Titel öffnet es).
    const single = only && soleDoc(only);
    const titleHtml = single && a.modes.length
      ? `<button type="button" class="cb-unit cb-row-title" data-start="${escapeAttr(a.linkId)}" data-module="${escapeAttr(single.id)}" title="${escapeAttr(`${a.name} öffnen`)}">${marked(only, single) ? ico('pin', 'cb-pin') : ''}${escapeHtml(a.name)}</button>`
      : `<span class="cb-row-title" title="${escapeAttr(a.name)}">${escapeHtml(a.name)}</span>`;
    const icon = single ? UNIT_ICON(single.type) : nestEmbedded(only?.units || []).top.length && !nestEmbedded(only.units).top.some(isDocLike) ? ico('quiz') : ico('topic');
    // Dieselben Zeilen wie im Lernnotizbuch; ein einzelnes Lernthema braucht keine zweite Zeile.
    // Lernthema = ein Dokument: Aufklappen nur, wenn darunter etwas steht (Weitere Quizze, Lösung, Tafelbild).
    const leaf = single && !nestEmbedded(only.units).top.some((u) => u.id !== single.id) && !solutions.has(single.id) && !boards.has(single.id);
    if (leaf) {
      return `<div class="cb-assignment cb-leaf"><div class="cb-leaf-row"><span class="cb-twisty cb-twisty-none" aria-hidden="true"></span>
        <span class="nb-icon" aria-hidden="true">${icon}</span>${titleHtml}
        <span class="nb-meta">${count(a.topics.flatMap((t) => t.units))}</span>
        <span class="cb-state">${unitState(single)}</span>
        ${marked(only) ? here : ''}
        <span class="cb-actions">${modes}</span></div></div>`;
    }
    return `<details class="cb-assignment" ${a.topics.some((t) => marked(t)) ? 'open' : ''}>
      <summary><span class="cb-twisty" aria-hidden="true"></span>
        <span class="nb-icon" aria-hidden="true">${icon}</span>${titleHtml}
        <span class="nb-meta">${count(a.topics.flatMap((t) => t.units))}</span>
        ${single ? `<span class="cb-state">${unitState(single)}</span>` : ''}
        ${only && marked(only) ? here : ''}
        <span class="cb-actions">${modes}</span></summary>
      ${only ? `<ul class="cb-units">${single ? singleRows(only, single, true) : unitRows(only)}</ul>` : a.topics.map((t) => soleDoc(t) ? `<ul class="cb-units cb-single">${singleRows(t, soleDoc(t))}</ul>` : `<details class="cb-topic" ${marked(t) ? 'open' : ''}>
        <summary class="cb-topic-title"><span class="cb-twisty" aria-hidden="true"></span>
          <span class="nb-icon" aria-hidden="true">${ico('topic')}</span><span class="cb-row-title" title="${escapeAttr(t.title)}">${escapeHtml(t.title)}</span>
          <span class="nb-meta">${count(t.units)}</span>
          ${marked(t) ? here : ''}</summary>
        <ul class="cb-units">${unitRows(t)}</ul>
      </details>`).join('')}
    </details>`;
  };
  // Baum wie bei der Lehrkraft: Bereiche/Abschnitte eingeklappt – außer auf dem Weg zum 📍 Merker
  // (den liefert der Server schon aufgelöst in `mk.openNodeIds`, egal auf welcher Ebene gepinnt ist).
  const nodes = data.nodes || [];
  const inNode = (a, id) => {
    for (let n = nodes.find((x) => x.id === a.nodeId); n; n = nodes.find((x) => x.id === n.parentId)) if (n.id === id) return true;
    return false;
  };
  const level = (parentId) => {
    const inner = nodes.filter((n) => n.parentId === parentId).sort((x, y) => x.orderIndex - y.orderIndex).map((n) => {
      const body = level(n.id);
      if (!body) return '';
      const mine = data.assignments.filter((a) => a.nodeId === n.id || inNode(a, n.id));
      const units = mine.flatMap((a) => a.topics.flatMap((t) => t.units));
      const done = units.filter((u) => u.done || u.work).length;
      const onPath = !!mk?.openNodeIds?.includes(n.id);
      return `<details class="cb-snode" ${onPath ? 'open' : ''}>
        <summary><span class="cb-twisty" aria-hidden="true"></span>
          <span class="nb-icon" aria-hidden="true">${ico(n.kind === 'section' ? 'section' : 'folder')}</span><span class="cb-node-title cb-row-title" title="${escapeAttr(n.title)}">${escapeHtml(n.title)}</span>
          <span class="nb-meta">${data.pending ? `${units.length} Module` : `${done}/${units.length} erledigt`}</span>
          ${onPath ? `<span class="cb-here">${ico('pin', 'cb-pin')}</span>` : ''}</summary>
        <div class="cb-node-body">${body}</div></details>`;
    }).join('');
    const cards = data.assignments.filter((a) => (a.nodeId || null) === parentId).sort((x, y) => (x.order ?? 0) - (y.order ?? 0)).map(cardOf).join('');
    return inner + cards;
  };
  const assignments = level(null);
  return assignments;
}

export class ClassbookStudent {
  constructor(app) {
    this.app = app;
    homeInPlace = () => this._homeInPlace();
  }

  /**
   * 🏠 ohne Neuladen: Aufgabe verlassen, die Startseite (noch im DOM) an derselben Stelle zeigen und
   * im Hintergrund neu laden. Nur mit Tabs; die Quiz-Arena und die Klassenarbeit laden wie bisher neu.
   */
  _homeInPlace() {
    const all = allGet() === '1';
    if (!workspace.on || !this._el?.innerHTML.trim() || (all ? !this.all : !this.data)) return false;
    this.app.quizView.leaveRun?.();
    const login = this.app.loginView;
    login._appContainer?.classList.add('hidden');
    login._loginScreen?.classList.remove('hidden');
    document.body.classList.remove('student-run', 'companion-run');
    document.querySelector('#loginScreen .login-card')?.classList.add('login-card-wide');
    this._el.classList.remove('hidden');
    workspace.markHome();
    const top = this._scrollTop || 0;
    if (login._loginScreen) login._loginScreen.scrollTop = top;
    const refresh = all ? this.homeAll({ quiet: true }) : this._home({ quiet: true });
    void refresh.then(() => { if (login._loginScreen) login._loginScreen.scrollTop = top; }).catch(() => {});
    return true;
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

  /** 🔗 Quick-Link `?tb=<token>`: Tafelbild bzw. Lösung ohne Anmeldung, nur zum Ansehen. */
  async startBoardLink(token) {
    const res = await fetch(`/api/public/classbook/view/${encodeURIComponent(token)}`).catch(() => null);
    const board = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !board?.content) {
      this._show(`<p class="login-error">${escapeHtml(board?.message || 'Der Server ist nicht erreichbar.')}</p>`);
      return;
    }
    const label = board.kind === 'solution' ? 'Lösung' : 'Tafelbild';
    const el = this._show(`<div class="cb-head"><div><span class="quick-entry-label">${label}</span><h2>${escapeHtml(board.title)}</h2></div></div>
      <p class="hint">Nur zum Ansehen – gespeichert wird nichts.</p>
      <button type="button" class="btn btn-primary" data-open>${label} ansehen</button>`);
    const open = async () => {
      const { openBoardView } = await import('../ink/ink-open.js');
      await openBoardView(board, label);
    };
    el.querySelector('[data-open]').addEventListener('click', () => open().catch((err) => this.app.showToast(err.message, 'error')));
    await open().catch(() => { /* Knopf bleibt */ });
  }

  async start(token) {
    this.token = token;
    // Vom Knopf 👁 Vorschau: Der Ausweis steht im Fragment und geht so nicht an den Server.
    // 🧪 Ausprobieren einer Klassenarbeit hängt ihre Link-ID mit `&exam=` an – dann nur sie zeigen.
    const fromTeacher = /^#preview=([^&]+)(?:&exam=([^&]+))?$/.exec(location.hash);
    if (fromTeacher) {
      sessionSet(PREVIEW_KEY, JSON.stringify({
        token, ticket: decodeURIComponent(fromTeacher[1]), name: '', preview: true,
        ...(fromTeacher[2] ? { examOnly: decodeURIComponent(fromTeacher[2]) } : {}),
      }));
      history.replaceState(null, '', location.pathname + location.search);
    }
    // Direkt zu einem Modul (z. B. aus einer OneNote-Seite): `&cl=<Zuweisung>&mod=<Modul>` –
    // geöffnet wird es nach der Anmeldung, wie ein von der Lehrkraft geschicktes Modul.
    const params = new URLSearchParams(location.search);
    if (params.get('cl') && params.get('mod')) {
      sessionSet(OPEN_KEY, JSON.stringify({ token, linkId: params.get('cl'), moduleId: params.get('mod') }));
      history.replaceState(null, '', `${location.pathname}?k=${encodeURIComponent(token)}${location.hash}`);
    }
    const inPreview = previewSession()?.token === token;
    if (inPreview) this.app.authStore.suspend();
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
    if (inApp() && !inPreview) {
      // Eigener Link auf einen Bereich: eigener Eintrag mit seinem Titel.
      const v = upsertBook(token, { className: info.scopeTitle ? `${info.className} · ${info.scopeTitle}` : info.className, teacher: info.teacher || '' });
      storeBooks({ ...v, current: token });
    }
    // Zurück von „Mit Microsoft anmelden“: Einlöse-Code gegen den Ausweis tauschen.
    if (params.get('sso') || params.get('ssoError')) {
      const code = params.get('sso');
      const error = params.get('ssoError');
      history.replaceState(null, '', `${location.pathname}?k=${encodeURIComponent(token)}`);
      if (error) { this._login(error); return; }
      const res = await fetch('/api/sso/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
        .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) })).catch(() => null);
      if (!res?.ok || !res.body?.ticket) { this._login(res?.body?.message || 'Die Anmeldung hat nicht geklappt. Bitte mit Name und PIN anmelden.'); return; }
      saveSession({ token, ticket: res.body.ticket, name: res.body.name, pin: null });
      if (res.body.deviceTicket && res.body.classId) rememberStudent(res.body.classId, { ticket: res.body.deviceTicket, name: res.body.name });
      if (await this._home()) return;
    }
    const s = classbookSession();
    if (s?.token === token && s.ticket && (await this._home())) return;
    // Auf diesem Gerät schon in der Klasse angemeldet (Klassennotizbuch, Klassenlink): ohne Name und PIN weiter.
    const known = !inPreview && rememberedStudent(info.classId);
    if (known) {
      const res = await post(`${encodeURIComponent(token)}/login`, { deviceTicket: known.ticket }).catch(() => null);
      if (res && !res.failed && res.ticket) {
        saveSession({ token, ticket: res.ticket, name: res.name, pin: null });
        if (await this._home()) return;
      }
    }
    this._login();
  }

  _login(message = '', { askPin = false, askTest = false, name = '' } = {}) {
    const { info } = this;
    const el = this._show(`
      ${inApp() ? `<button type="button" class="btn btn-secondary btn-sm cb-to-list" id="cbToList">${icon('list')} Meine Klassennotizbücher</button>` : ''}
      <div class="quick-entry-topic">
        <span class="quick-entry-label">${icon('notebook')} Klassennotizbuch</span>
        <h2>${escapeHtml(info.className)}${info.scopeTitle ? ` · ${escapeHtml(info.scopeTitle)}` : ''}</h2>
        ${info.teacher ? `<p class="hint">${escapeHtml(info.teacher)}</p>` : ''}
      </div>
      <form class="login-form" id="cbLoginForm">
        <div class="form-group">
          <label for="cbName">Dein Name</label>
          <input type="text" id="cbName" required placeholder="Vor- und Nachname..." autocomplete="off" value="${escapeAttr(name)}" />
        </div>
        <div class="form-group">
          <label for="cbPin">${icon('key')} PIN</label>
          <input type="password" id="cbPin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="off" placeholder="4 Ziffern" />
          <small class="hint">${info.firstLoginOpen
            ? 'Zum allerersten Mal hier? Dann lass das Feld leer – du bekommst deine PIN angezeigt.'
            : 'Deine PIN aus 4 Ziffern. Kennst du sie nicht, frag deine Lehrkraft.'}</small>
        </div>
        <div class="form-group ${askTest ? '' : 'hidden'}" id="cbTestGroup">
          <label for="cbTest">${icon('test')} Testpasswort</label>
          <input type="password" id="cbTest" autocomplete="off" placeholder="Passwort deines Testschülers" />
        </div>
        <p class="login-error ${message ? '' : 'hidden'}" id="cbErr">${escapeHtml(message)}</p>
        <button type="submit" class="btn btn-primary btn-full">${icon('notebook')} Öffnen</button>
      </form>`);
    el.querySelector('#cbToList')?.addEventListener('click', () => this.showList());
    const form = el.querySelector('#cbLoginForm');
    // Schule mit „Mit Microsoft anmelden“ für Schüler: Knopf über dem Formular, Name und PIN bleiben.
    void fetch(`/api/sso/classbook/${encodeURIComponent(this.token)}`).then((r) => r.json()).then((o) => {
      if (!o?.enabled || !form.isConnected) return;
      const box = document.createElement('div');
      box.className = 'sso-buttons';
      box.innerHTML = `<a class="btn btn-primary btn-full sso-btn" href="/api/sso/start?purpose=student&amp;k=${encodeURIComponent(this.token)}">
        <span class="sso-ms" aria-hidden="true"></span> Mit Microsoft anmelden</a><div class="sso-or"><span>oder mit Name und PIN</span></div>`;
      form.before(box);
    }).catch(() => { /* ohne Schulkonto */ });
    // Angemeldete Lehrkraft (Fortbildung): mit ihrem Namen – eingetragen (👩‍🏫) oder in offener Klasse auch ohne PIN.
    void offerTeacherName(el.querySelector('#cbName'), info.classId, () => el.querySelector('#cbPin').focus(), {
      onJoin: async (authToken) => {
        const res = await fetch(`/api/classbook/join/${encodeURIComponent(this.token)}`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } })
          .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) })).catch(() => null);
        if (!res?.ok || !res.body?.ticket) { this._login(res?.body?.message || 'Der Server ist nicht erreichbar.'); return; }
        saveSession({ token: this.token, ticket: res.body.ticket, name: res.body.name, pin: null });
        if (res.body.deviceTicket && res.body.classId) rememberStudent(res.body.classId, { ticket: res.body.deviceTicket, name: res.body.name });
        await this._home();
      },
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
      if (res.deviceTicket && res.classId) rememberStudent(res.classId, { ticket: res.deviceTicket, name: res.name });
      if (res.pin) this._showPin(res.pin);
      else await this._home();
    });
  }

  _showPin(pin) {
    const el = this._show(`
      <div class="quick-entry-topic">
        <span class="quick-entry-label">${icon('key')} Deine PIN</span>
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
    // Gemerkte Anmeldung des Geräts (gilt, solange die PIN dieselbe ist).
    const known = !s?.preview && rememberedStudent(this.info?.classId);
    if (known && (!s?.pin || !inApp())) {
      const res = await post(`${encodeURIComponent(this.token)}/login`, { deviceTicket: known.ticket }).catch(() => null);
      if (res && !res.failed && res.ticket) { saveSession({ token: this.token, ticket: res.ticket, name: res.name, pin: s?.pin || null }); return true; }
    }
    if (!inApp() || !s?.name || !s.pin) return false;
    const res = await post(`${encodeURIComponent(this.token)}/login`, { name: s.name, pin: s.pin }).catch(() => null);
    if (!res || res.failed || res.pin) return false;
    saveSession({ ...s, ticket: res.ticket, name: res.name });
    return true;
  }

  /** Startseite; false, wenn die Anmeldung nicht mehr gilt. */
  async _home({ quiet = false } = {}) {
    const s = classbookSession();
    const [data, boardList, solutionList] = await Promise.all([
      post(`${encodeURIComponent(this.token)}/home`, { ticket: s?.ticket, examOnly: s?.examOnly }).catch(() => null),
      post(`${encodeURIComponent(this.token)}/boards`, { ticket: s?.ticket }).catch(() => null),
      post(`${encodeURIComponent(this.token)}/solutions`, { ticket: s?.ticket }).catch(() => null),
    ]);
    // ✍️ Tafelbilder und 🔑 Lösungen, die die Lehrkraft für die Klasse eingeschaltet hat (Modul-IDs der Dokumente).
    const boards = new Set(Array.isArray(boardList) ? boardList.map((b) => b.moduleId) : []);
    const solutions = new Set(Array.isArray(solutionList) ? solutionList.map((b) => b.moduleId) : []);
    if (!data || data.failed) {
      if (data?.expired) {
        if (await this._relogin()) return this._home({ quiet });
        saveSession(null);
        this._login(data.message || '');
        return true;
      }
      this._show(`<p class="login-error">${escapeHtml(data?.message || 'Der Server ist nicht erreichbar.')}</p>`);
      return !!data;
    }
    this.data = data;
    document.querySelector('#loginScreen .login-card')?.classList.add('login-card-wide');
    // 🏠 und Tabs (docs/arbeitsflaeche.md) – nicht in der 👁 Vorschau und nicht in der Klassenarbeit allein.
    const useTabs = !s?.preview && !data.examOnly && !data.arena;
    if (useTabs) {
      workspace.start({
        key: `s:${this.token}`,
        onOpen: (tab) => this._enter(tab.linkId, tab.mode || null, tab.moduleId || null, null, { fromTab: true }),
        onHome: () => backToClassbook(),
      });
      workspace.markHome();
    }
    this._watchArena();
    if (data.arena) { this._arenaHome(data); return true; }
    const mk = data.marker;
    const assignments = treeHtml(data, boards, solutions);
    const results = data.results.length
      ? `<ul class="cb-list">${data.results.map((r) => `<li><span>${escapeHtml(r.linkName || 'Aufgabe')} <span class="hint">${escapeHtml(LINK_MODE_LABELS[r.mode]?.label || r.mode || '')} · ${escapeHtml(when(r.at))}</span></span>
          ${r.maxScore ? `<span class="result-score ${pctClass(r.percentage)}">${r.percentage ?? Math.round((r.score / r.maxScore) * 100)} %</span>` : '<span class="hint">ohne Wertung</span>'}</li>`).join('')}</ul>`
      : '<p class="hint">Noch keine Ergebnisse.</p>';
    const works = data.works.length
      ? `<ul class="cb-list">${data.works.map((w) => `<li>${w.gone
        ? (w.viewable
          ? `<button type="button" class="cb-unit" data-gone-work="${escapeAttr(w.workId)}" title="Das Dokument gibt es nicht mehr. Dein Blatt lässt sich noch ansehen.">${icon('document')} ${escapeHtml(w.title)}</button> <span class="hint">nur zum Ansehen</span>`
          : `<span class="cb-unit">${icon('document')} ${escapeHtml(w.title)}</span> <span class="hint">nicht mehr verfügbar</span>`)
        : `<button type="button" class="cb-unit" data-start="${escapeAttr(w.linkId)}" data-module="${escapeAttr(w.moduleId)}">${icon('document')} ${escapeHtml(w.title)}</button>`}
          <span class="hint">${escapeHtml(when(w.at))}</span></li>`).join('')}</ul>`
      : '<p class="hint">Noch keine Blätter – sie entstehen, wenn du ein Dokument mit dem Stift bearbeitest.</p>';
    const EXAM_STATE = {
      open: `<button type="button" class="btn btn-primary btn-sm" data-exam>${icon('exam')} Klassenarbeit starten</button>`,
      running: `<button type="button" class="btn btn-primary btn-sm" data-exam>${icon('exam')} Weiterschreiben</button>`,
      reentry: `<button type="button" class="btn btn-primary btn-sm" data-exam>${icon('exam')} Wieder einsteigen</button>`,
      locked: '<span class="hint">Schon begonnen – zum Weiterschreiben gibt deine Lehrkraft den Wiedereinstieg frei.</span>',
      submitted: `<span class="hint">${icon('check', 'lm-ico-ok')} abgegeben</span>`,
    };
    const exams = (data.exams || []).map((x) => `<div class="cb-exam" data-link="${escapeAttr(x.linkId)}">
        <strong>${icon('exam')} ${escapeHtml(x.name)}</strong>${EXAM_STATE[x.state] || ''}${x.hiddenFromStudents ? ' <span class="hint" title="Im Klassennotizbuch aus (○) – nur deine Vorschau sieht sie">· für Schüler noch aus</span>' : ''}</div>`).join('');
    const preview = !!s?.preview;
    const examOnly = !!data.examOnly;
    const el = this._show(`
      ${preview ? `<p class="cb-preview-note">${icon('eye')} <strong>Vorschau:</strong> ${examOnly ? 'So schreibt ein Schüler diese Klassenarbeit. Zählt nicht mit und lässt sich beliebig wiederholen.' : 'So sieht es deine Klasse. Ergebnisse und Blätter stehen im Klassennotizbuch als 🧪 und zählen nicht mit.'}</p>` : ''}
      <div class="cb-head">
        <div><span class="quick-entry-label">${ico('notebook')} ${escapeHtml(data.className)}${data.scopeTitle ? ` · ${escapeHtml(data.scopeTitle)}` : ''}</span><h2>${escapeHtml(data.name)}</h2></div>
        <span class="cb-head-actions">
          ${preview ? '' : inApp() ? `<button type="button" class="btn btn-secondary cb-head-btn" id="cbToList" title="Alle deine Klassennotizbücher">${ico('list')} Alle</button>`
            : `<button type="button" class="btn btn-secondary cb-head-btn" id="cbInstall" title="Klassennotizbuch als App auf den Home-Bildschirm – öffnet direkt hier, angemeldet">${icon('install')} Als App</button>`}
          <button type="button" class="btn btn-secondary cb-head-btn" id="cbLogout">${preview ? 'Vorschau beenden' : `${ico('logout')} Abmelden`}</button>
        </span>
      </div>
      <p class="hint cb-install-hint hidden" id="cbInstallHint"></p>
      ${exams ? `<h3 class="cb-section">${ico('exam')} Klassenarbeit</h3>${exams}` : ''}
      ${examOnly ? '' : `<h3 class="cb-section">${ico('tasks')} Aufgaben</h3>
      ${assignments ? `<div class="cb-tree">${assignments}</div>` : '<p class="hint">Gerade sind keine Aufgaben freigegeben.</p>'}
      ${data.pending
        ? '<p class="hint cb-pending">Deine Ergebnisse und Blätter erscheinen hier, sobald deine Lehrkraft deinen Namen in der Klassenliste bestätigt hat.</p>'
        : `<h3 class="cb-section">${ico('chart')} Meine Ergebnisse</h3>${results}<h3 class="cb-section">${ico('pen')} Meine Blätter</h3>${works}`}`}`);
    el.querySelector('#cbToList')?.addEventListener('click', () => { this._stopWatch(); workspace.stop(); this.showList(); });
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
      if (preview) window.close(); // Tab von der Lehrkraft geöffnet; lässt er sich nicht schließen, folgt die Anmeldeseite
      this._stopWatch();
      saveSession(null);
      workspace.stop();
      sessionSet(LANDED_KEY, null);
      document.querySelector('#loginScreen .login-card')?.classList.remove('login-card-wide');
      this._login();
    });
    // Im Kopf einer Zuweisung öffnet der Titel das Dokument, ohne die Zeile auf- oder zuzuklappen.
    el.querySelectorAll('[data-start]').forEach((btn) => btn.addEventListener('click', (e) => { if (btn.closest('summary')) e.preventDefault(); }));
    el.querySelectorAll('[data-start]').forEach((btn) => btn.addEventListener('click', () => this._enter(btn.dataset.start, btn.dataset.mode || null, btn.dataset.module || null, btn)));
    el.querySelectorAll('[data-board], [data-solution-ink]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      const kind = btn.dataset.board ? 'boards' : 'solutions';
      const id = btn.dataset.board || btn.dataset.solutionInk;
      const board = await post(`${encodeURIComponent(this.token)}/${kind}/${encodeURIComponent(id)}`, { ticket: classbookSession()?.ticket }).catch(() => null);
      try {
        if (!board?.content) throw new Error(board?.message || 'Das ist gerade nicht freigegeben.');
        const { openBoardView } = await import('../ink/ink-open.js');
        await openBoardView(board, kind === 'boards' ? 'Tafelbild' : 'Lösung');
      } catch (err) {
        this.app.showToast(err.message, 'error');
      }
      btn.disabled = false;
    }));
    el.querySelectorAll('[data-gone-work]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      const work = await post(`${encodeURIComponent(this.token)}/gone-work`, { ticket: classbookSession()?.ticket, workId: btn.dataset.goneWork }).catch(() => null);
      try {
        if (!work?.content) throw new Error(work?.message || 'Dieses Blatt ist nicht mehr verfügbar.');
        const { openGoneWork } = await import('../ink/ink-open.js');
        await openGoneWork(work);
      } catch (err) {
        this.app.showToast(err.message, 'error');
      }
      btn.disabled = false;
    }));
    // ➡️ Weiter: einen Schritt im 📍-Pfad vor, dann neu laden – blockiert dabei nichts, alle anderen Module bleiben wählbar.
    el.querySelector('[data-weiter]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation(); // sitzt in der <summary> eines Lernthemas – nicht zusätzlich auf-/zuklappen
      const s = classbookSession();
      await post(`${encodeURIComponent(this.token)}/weiter/next`, { ticket: s?.ticket }).catch(() => null);
      await this._home();
    });
    // 📍 Merker: dorthin scrollen und den Fokus aufs Modul legen.
    const here = quiet ? null : el.querySelector('.cb-marked .cb-unit');
    if (here) {
      here.scrollIntoView({ block: 'center' });
      here.focus({ preventScroll: true });
    }
    el.querySelectorAll('[data-exam]').forEach((btn) => btn.addEventListener('click', () => this._enter(btn.closest('[data-link]').dataset.link, 'exam', null, btn)));
    this._connectLive();
    // Von der Lehrkraft geschickt bzw. 👣 Folgen, während eine Aufgabe offen war.
    const pending = parse(sessionGet(OPEN_KEY));
    sessionSet(OPEN_KEY, null);
    if (pending?.token === this.token) { void this._enter(pending.linkId, null, pending.moduleId); return true; }
    // Nach „🔄 Aktualisieren“: weiter im Tab, der offen war.
    if (useTabs && workspace.reopenAfterUpdate()) return true;
    // Gleich nach der Anmeldung: dort weiter, wo die Lehrkraft den 📍 Merker gesetzt hat – sonst bleibt Home.
    if (useTabs && sessionGet(LANDED_KEY) !== this.token) {
      sessionSet(LANDED_KEY, this.token);
      if (mk?.current?.linkId && mk.current.moduleId) void this._enter(mk.current.linkId, null, mk.current.moduleId);
    }
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
      ? `<span>${icon('follow')} Weiter zu <strong>${escapeHtml(title)}</strong> …</span><button type="button" class="btn btn-secondary btn-sm" data-go>Jetzt</button>`
      : `<span>${icon('broadcast')} Deine Lehrkraft schickt <strong>${escapeHtml(title)}</strong></span>
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
        <div><span class="quick-entry-label">${icon('notebook')} ${escapeHtml(data.className)}</span><h2>${escapeHtml(data.name)}</h2></div>
      </div>
      <div class="quick-entry-topic cb-arena">
        <span class="quick-entry-label">${icon('contest')} Quiz-Arena</span>
        <h2>${escapeHtml(data.arena.name)}</h2>
        <p>Deine Lehrkraft hat die Quiz-Arena geöffnet.</p>
      </div>
      <button type="button" class="btn btn-primary btn-full" id="cbArenaJoin">${icon('contest')} In den Wartebereich</button>`);
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
    // Mit dem Schulkonto in mehreren Klassen angemeldet: Home mit allen.
    if (!token && (allGet() === '1' || (inApp() && signedBooks().length > 1))) { await this.homeAll(); return; }
    if (inApp() && books.length === 1) { await this.start(books[0].token); return; }
    // Ohne Eintrag (am PC installiert): die Liste mit ➕ Klassennotizbuch hinzufügen.
    this.showList();
  }

  /** Knopf „Mit Microsoft anmelden“ für die Schüler-App in `box` – nur, wenn eine Schule es für Schüler anbietet. */
  async offerAppSso(box, { before = null } = {}) {
    if (!box) return;
    const o = await fetch('/api/sso/app').then((r) => r.json()).catch(() => null);
    const schools = o?.schools || [];
    if (!schools.length || !box.isConnected) return;
    const href = (sc) => `/api/sso/start?purpose=app&school=${encodeURIComponent(sc.schoolId)}&ret=${encodeURIComponent(studentBase())}`;
    const wrap = document.createElement('div');
    wrap.className = 'sso-buttons';
    wrap.innerHTML = schools.map((sc) => `<a class="btn btn-primary btn-full sso-btn" href="${escapeAttr(href(sc))}">
        <span class="sso-ms" aria-hidden="true"></span> Mit Microsoft anmelden${schools.length > 1 ? ` – ${escapeHtml(sc.name)}` : ''}</a>`).join('')
      + '<div class="sso-or"><span>alle deine Klassen auf einmal – oder mit Klassencode</span></div>';
    if (before) before.before(wrap); else box.prepend(wrap);
  }

  /** Zurück von „Mit Microsoft anmelden“ in der Schüler-App: alle Klassennotizbücher auf diesem Gerät eintragen. */
  async handleAppSso(params) {
    const code = params.get('sso');
    const error = params.get('ssoError');
    history.replaceState(null, '', `${studentBase()}?app=classbook`);
    if (error) { this.showList(error); return; }
    const res = await fetch('/api/sso/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) })).catch(() => null);
    const books = res?.body?.books;
    if (!res?.ok || !Array.isArray(books) || !books.length) { this.showList(res?.body?.message || 'Die Anmeldung hat nicht geklappt.'); return; }
    for (const b of books) {
      upsertBook(b.token, { className: b.className, teacher: b.teacher, ticket: b.ticket, name: b.name, pin: null, classId: b.classId || null, deviceTicket: b.deviceTicket || null });
      if (b.deviceTicket && b.classId) rememberStudent(b.classId, { ticket: b.deviceTicket, name: b.name });
    }
    sessionSet(LANDED_KEY, null);
    if (books.length === 1) { allSet(null); await this.start(books[0].token); return; }
    allSet('1');
    await this.homeAll();
  }

  /** Dieses Klassennotizbuch ist ab jetzt das angemeldete (Ausweis aus der Liste des Geräts). */
  _useBook(token) {
    const b = loadBooks().books.find((x) => x.token === token);
    this.token = token;
    if (inApp()) storeBooks({ ...loadBooks(), current: token });
    else if (b?.ticket) saveSession({ token, ticket: b.ticket, name: b.name || '', pin: null });
  }

  /**
   * 🏠 Home mit allen Klassennotizbüchern (Schulkonto): je Klasse ihr Baum, darunter Klassenarbeiten.
   * Ergebnisse und Blätter stehen im einzelnen Klassennotizbuch (📒 öffnen).
   */
  async homeAll({ quiet = false } = {}) {
    const list = signedBooks();
    if (list.length < 2) { allSet(null); if (list[0]) await this.start(list[0].token); else this.showList(); return; }
    allSet('1');
    if (!quiet) this._show('<p class="hint">Deine Klassennotizbücher werden geladen …</p>');
    const loaded = await Promise.all(list.map(async (b) => {
      // Der Tagesausweis gilt 12 Stunden – abgelaufen, holt ihn der Geräteausweis (300 Tage) neu.
      const probe = await post(`${encodeURIComponent(b.token)}/home`, { ticket: b.ticket }).catch(() => null);
      if (probe?.expired) {
        const dev = b.deviceTicket || (b.classId && rememberedStudent(b.classId)?.ticket);
        const res = dev ? await post(`${encodeURIComponent(b.token)}/login`, { deviceTicket: dev }).catch(() => null) : null;
        if (res && !res.failed && res.ticket) {
          b.ticket = res.ticket;
          upsertBook(b.token, { ticket: res.ticket });
        }
      }
      const [data, boards, solutions] = await Promise.all([
        probe && !probe.expired ? probe : post(`${encodeURIComponent(b.token)}/home`, { ticket: b.ticket }).catch(() => null),
        post(`${encodeURIComponent(b.token)}/boards`, { ticket: b.ticket }).catch(() => null),
        post(`${encodeURIComponent(b.token)}/solutions`, { ticket: b.ticket }).catch(() => null),
      ]);
      return { b, data, boards: new Set(Array.isArray(boards) ? boards.map((x) => x.moduleId) : []), solutions: new Set(Array.isArray(solutions) ? solutions.map((x) => x.moduleId) : []) };
    }));
    const ok = loaded.filter((x) => x.data && !x.data.failed && !x.data.arena);
    if (!ok.length) { this.showList('Die Anmeldung ist abgelaufen. Bitte noch einmal mit Microsoft anmelden.'); return; }
    this.all = new Map(ok.map((x) => [x.b.token, x.data]));
    document.querySelector('#loginScreen .login-card')?.classList.add('login-card-wide');
    workspace.start({
      key: 's:all',
      onOpen: async (tab) => {
        if (tab.token) { this._useBook(tab.token); this.data = this.all?.get(tab.token) || null; }
        await this._enter(tab.linkId, tab.mode || null, tab.moduleId || null, null, { fromTab: true });
      },
      onHome: () => backToClassbook(),
    });
    workspace.markHome();
    const name = ok[0].data.name;
    const EXAM = { open: `${icon('exam')} Klassenarbeit starten`, running: `${icon('exam')} Weiterschreiben`, reentry: `${icon('exam')} Wieder einsteigen` };
    const el = this._show(`
      <div class="cb-head">
        <div><span class="quick-entry-label">${ico('notebook')} Meine Klassennotizbücher</span><h2>${escapeHtml(name)}</h2></div>
        <span class="cb-head-actions"><button type="button" class="btn btn-secondary cb-head-btn" id="cbLogoutAll">${ico('logout')} Abmelden</button></span>
      </div>
      ${ok.map(({ b, data, boards, solutions }) => {
        const exams = (data.exams || []).filter((x) => EXAM[x.state]).map((x) => `<div class="cb-exam" data-link="${escapeAttr(x.linkId)}"><strong>${icon('exam')} ${escapeHtml(x.name)}</strong>
          <button type="button" class="btn btn-primary btn-sm" data-exam>${EXAM[x.state]}</button></div>`).join('');
        const tree = treeHtml(data, boards, solutions);
        return `<details class="cb-book-tree" data-cb-token="${escapeAttr(b.token)}" open>
          <summary><span class="cb-twisty" aria-hidden="true"></span><span class="nb-icon" aria-hidden="true">${ico('notebook')}</span>
            <span class="cb-row-title">${escapeHtml(data.className)}${data.scopeTitle ? ` · ${escapeHtml(data.scopeTitle)}` : ''}</span>
            <span class="nb-meta">${escapeHtml(b.teacher || '')}</span>
            <button type="button" class="btn btn-secondary btn-sm" data-cb-only title="Nur dieses Klassennotizbuch – mit Ergebnissen und Blättern">Ergebnisse ›</button></summary>
          ${exams}
          ${tree ? `<div class="cb-tree">${tree}</div>` : '<p class="hint">Gerade sind keine Aufgaben freigegeben.</p>'}
        </details>`;
      }).join('')}`);
    const sectionOf = (node) => node.closest('[data-cb-token]')?.dataset.cbToken;
    const use = (token) => { this._useBook(token); this.data = this.all.get(token); };
    el.querySelectorAll('[data-start]').forEach((btn) => btn.addEventListener('click', (e) => {
      if (btn.closest('summary')) e.preventDefault();
      use(sectionOf(btn));
      void this._enter(btn.dataset.start, btn.dataset.mode || null, btn.dataset.module || null, btn);
    }));
    el.querySelectorAll('[data-exam]').forEach((btn) => btn.addEventListener('click', () => {
      use(sectionOf(btn));
      void this._enter(btn.closest('[data-link]').dataset.link, 'exam', null, btn);
    }));
    el.querySelectorAll('[data-board], [data-solution-ink]').forEach((btn) => btn.addEventListener('click', async () => {
      const token = sectionOf(btn);
      use(token);
      const kind = btn.dataset.board ? 'boards' : 'solutions';
      const board = await post(`${encodeURIComponent(token)}/${kind}/${encodeURIComponent(btn.dataset.board || btn.dataset.solutionInk)}`, { ticket: classbookSession()?.ticket }).catch(() => null);
      try {
        if (!board?.content) throw new Error(board?.message || 'Das ist gerade nicht freigegeben.');
        const { openBoardView } = await import('../ink/ink-open.js');
        await openBoardView(board, kind === 'boards' ? 'Tafelbild' : 'Lösung');
      } catch (err) { this.app.showToast(err.message, 'error'); }
    }));
    el.querySelectorAll('[data-cb-only]').forEach((btn) => btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      allSet(null);
      workspace.stop();
      await this.start(sectionOf(btn));
    }));
    el.querySelectorAll('[data-weiter]').forEach((btn) => btn.remove()); // ➡️ Weiter gehört ins einzelne Klassennotizbuch
    el.querySelector('#cbLogoutAll').addEventListener('click', () => {
      const v = loadBooks();
      for (const b of v.books) { delete b.ticket; delete b.pin; }
      storeBooks(v);
      saveSession(null);
      allSet(null);
      sessionSet(LANDED_KEY, null);
      workspace.stop();
      this.showList();
    });
    // Nach dem Aktualisieren: weiter im Tab; gleich nach der Anmeldung: dort, wo ein 📍 Merker steht.
    if (workspace.reopenAfterUpdate()) return true;
    if (sessionGet(LANDED_KEY) !== 'all') {
      sessionSet(LANDED_KEY, 'all');
      const hit = ok.find((x) => x.data.marker?.current?.linkId && x.data.marker.current.moduleId);
      if (hit) { use(hit.b.token); void this._enter(hit.data.marker.current.linkId, null, hit.data.marker.current.moduleId); }
    }
    return true;
  }

  showList(message = '') {
    const { books } = loadBooks();
    const el = this._show(`
      <div class="cb-head">
        <div><span class="quick-entry-label">${icon('notebook')} Klassenbuch</span><h2>Meine Klassennotizbücher</h2></div>
      </div>
      ${message ? `<p class="login-error">${escapeHtml(message)}</p>` : ''}
      ${books.length ? `<ul class="cb-books">${books.map((b) => `
        <li><button type="button" class="cb-book" data-token="${escapeAttr(b.token)}">
            <strong>${escapeHtml(b.className || 'Klassennotizbuch')}</strong>${b.teacher ? ` – ${escapeHtml(b.teacher)}` : ''}
            <span class="hint">${b.ticket ? `angemeldet als ${escapeHtml(b.name || '')}` : 'nicht angemeldet'}</span></button>
          <button type="button" class="btn btn-secondary btn-sm cb-book-del" data-token="${escapeAttr(b.token)}" title="Aus der Liste nehmen (deine Ergebnisse bleiben)">✕</button></li>`).join('')}</ul>`
        : '<p class="hint">Noch kein Klassennotizbuch – füge eines hinzu.</p>'}
      <button type="button" class="btn btn-primary btn-full" id="cbAdd">${icon('plus')} Klassennotizbuch hinzufügen</button>
      ${signedBooks().length > 1 ? `<button type="button" class="btn btn-secondary btn-full" id="cbAll">${icon('home')} Alle meine Klassen</button>` : ''}`);
    void this.offerAppSso(el, { before: el.querySelector('#cbAdd') });
    el.querySelector('#cbAll')?.addEventListener('click', () => this.homeAll());
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
      <button type="button" class="btn btn-secondary btn-sm cb-to-list" id="cbToList">${icon('list')} Meine Klassennotizbücher</button>
      <div class="quick-entry-topic"><span class="quick-entry-label">${icon('plus')} Klassennotizbuch hinzufügen</span></div>
      <button type="button" class="btn btn-primary btn-full" id="cbScan">${icon('camera')} QR-Code scannen</button>
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
  async _enter(linkId, mode, onlyModule, btn, { fromTab = false } = {}) {
    const s = classbookSession();
    // Ohne geladenes Klassennotizbuch (Tab nach dem Neuladen): erst Home laden, dann öffnen.
    if (fromTab && !this.data) {
      sessionSet(OPEN_KEY, JSON.stringify({ token: this.token, linkId, moduleId: onlyModule }));
      backToClassbook();
      return;
    }
    const assignment = this.data?.assignments.find((a) => a.linkId === linkId);
    const chosen = mode || (assignment?.modes.includes('quiz') ? 'quiz' : assignment?.modes[0]) || 'quiz';
    if (btn) btn.disabled = true;
    this.current = { linkId, moduleId: onlyModule || null };
    // Vom Home aus: Stelle merken (🏠 kommt dorthin zurück) und den Wechsel abdecken.
    const fromHome = !this._el.classList.contains('hidden');
    if (fromHome) this._scrollTop = document.getElementById('loginScreen')?.scrollTop || 0;
    const covered = workspace.on && !fromTab && mode !== 'exam';
    if (covered) transition.show('open');
    try {
      const res = await post(`${encodeURIComponent(this.token)}/enter`, { ticket: s?.ticket, linkId, exam: chosen === 'exam' });
      if (!res?.linkToken) throw new Error(res?.message || 'Diese Aufgabe ist gerade nicht freigegeben.');
      const data = await this.app.api.startLinkRun(res.linkToken, { mode: chosen, classTicket: s.ticket });
      if (!data?.topics) throw new Error(data?.message || 'Der Start ist fehlgeschlagen.');
      // Klassenarbeit: ohne Tabs (nichts anderes offen).
      if (chosen === 'exam') workspace.stop();
      // Arbeitsfläche: Tab merken; ein Dokument öffnet gleich im Stift-Editor.
      if (workspace.on && chosen !== 'exam') {
        workspace.mark({ id: `${linkId}|${onlyModule || ''}`, linkId, moduleId: onlyModule || null, mode: mode || null, token: this.token, ...tabInfo(this.data, linkId, onlyModule) });
        const mods = (data.topics || []).flatMap((t) => t.modules || []);
        if (onlyModule && mods.find((m) => m.id === onlyModule)?.type === 'document') data.startView = 'ink';
      }
      if (s.pin && data.studentTicket) {
        const { rememberPin } = await import('../ink/work-store.js');
        rememberPin(data.studentTicket, s.pin);
      }
      document.querySelector('#loginScreen .login-card')?.classList.remove('login-card-wide');
      this._el.classList.add('hidden');
      await this.app.loginView._enterLinkRun(res.linkToken, data, '', onlyModule);
      if (covered) await transition.done();
    } catch (err) {
      if (covered) transition.hide();
      this.app.showToast(err.message || 'Der Server ist nicht erreichbar.', 'error');
      if (btn) btn.disabled = false;
    }
  }
}
