// ==================== ARBEITSFLÄCHE: 🏠 UND TABS (wie GoodNotes) ====================
//
// Eine Leiste ganz oben: 🏠 Home (Baum des Klassennotizbuchs bzw. Notizbuch der Lehrkraft) und je
// offenem Dokument ein Tab. Darunter liegt, was gerade offen ist – der Stift-Editor rückt über
// --lm-ws-top unter die Leiste (lm-editor/src/css/ink.css), die App über body.ws-on.
//
// Die Tabs bleiben je Gerät erhalten (localStorage); Inhalte sind ohnehin gespeichert. Was ein Tab
// öffnet, entscheidet der Gastgeber (`onOpen`), ebenso Home (`onHome`). Siehe docs/arbeitsflaeche.md.

import { escapeHtml, escapeAttr } from './utils.js';

const STORE = 'lm_ws:';
const MAX_TABS = 12;

/** Aktiver Tab dieses Browser-Tabs (sessionStorage): übersteht ein Neuladen, aber keinen Neustart. */
const SESSION = 'lm_ws_active:';
const sessionRead = (key) => { try { return sessionStorage.getItem(SESSION + key); } catch (_) { return null; } };
const sessionWrite = (key, v) => { try { sessionStorage.setItem(SESSION + key, v); } catch (_) { /* ohne */ } };

const read = (key) => { try { return JSON.parse(localStorage.getItem(STORE + key) || 'null'); } catch (_) { return null; } };
const write = (key, v) => { try { localStorage.setItem(STORE + key, JSON.stringify(v)); } catch (_) { /* privater Modus */ } };

/** Schließt den Stift-Editor, falls offen (speichert vorher). */
async function closeInk() {
  try {
    const { closeInkEditor } = await import('../lm-editor/src/ink/ink-editor.js');
    await closeInkEditor();
  } catch (_) { /* nichts offen */ }
}

/**
 * Ruhiger Übergang zwischen Tabs und Home: Eine Fläche unter der Leiste deckt den Umbau ab (Editor zu,
 * Laden, neuer Editor, Einpassen des Zooms) und blendet weich aus, wenn das Neue steht. Der Ladekreis
 * erscheint erst nach einer kurzen Wartezeit (CSS), damit schnelle Wechsel nicht flackern.
 */
const cover = {
  el: null,
  show(kind) {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'ws-cover';
      this.el.innerHTML = '<span class="ws-spinner" aria-hidden="true"></span>';
      this.el.setAttribute('role', 'status');
      this.el.setAttribute('aria-label', 'Wird geöffnet …');
      document.body.appendChild(this.el);
    }
    this.el.classList.toggle('ws-cover-home', kind === 'home');
    this.el.classList.remove('ws-cover-out');
    clearTimeout(this.timer);
  },
  hide() {
    const el = this.el;
    if (!el) return;
    el.classList.add('ws-cover-out');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (this.el === el) { el.remove(); this.el = null; } }, 220);
  },
};
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Bis das Blatt im Stift-Editor steht (Seiten gelegt, Zoom eingepasst) – oder ohne Editor kurz danach. */
async function settled(maxMs = 8000) {
  const t0 = Date.now();
  // Kommt ein Stift-Editor? Er öffnet kurz nach dem Start der Aufgabe.
  while (!document.querySelector('.ink-overlay .ink-page') && Date.now() - t0 < (document.querySelector('.ink-overlay') ? maxMs : 1200)) await wait(50);
  await frame();
  await frame();
  await wait(120);
}

class Workspace {
  constructor() {
    this.key = null;
    this.tabs = [];
    this.active = 'home';
    this.onOpen = null;
    this.onHome = null;
    this.bar = null;
    this.busy = false;
  }

  get on() { return !!this.key; }

  /**
   * Leiste zeigen. `key`: Speicherort der Tabs (z. B. „s:<Klassenbuch-Token>“, „t:<Lehrkraft>“);
   * `onOpen(tab)`: Tab öffnen; `onHome()`: Home zeigen.
   */
  start({ key, onOpen, onHome, hideEmpty = false }) {
    this.hideEmpty = hideEmpty;
    if (this.key !== key) {
      // Neu geladen (gleicher Browser-Tab): dieses Blatt danach wieder öffnen (reopenAfterUpdate).
      this.reloadTab = sessionRead(key);
      const saved = read(key) || {};
      this.tabs = Array.isArray(saved.tabs) ? saved.tabs.filter((t) => t && t.id) : [];
      this.active = saved.active && this.tabs.some((t) => t.id === saved.active) ? saved.active : 'home';
    }
    this.key = key;
    this.onOpen = onOpen;
    this.onHome = onHome;
    if (!this.bar) {
      this.bar = document.createElement('nav');
      this.bar.className = 'ws-bar';
      this.bar.setAttribute('aria-label', 'Offene Dokumente');
      document.body.prepend(this.bar);
      this._observer = new ResizeObserver(() => this._fit());
      this._observer.observe(this.bar);
    }
    this.render();
  }

  stop() {
    this.key = null;
    this.bar?.remove();
    this.bar = null;
    this._observer?.disconnect();
    document.body.classList.remove('ws-on');
  }

  _save() {
    if (!this.key) return;
    write(this.key, { tabs: this.tabs, active: this.active });
    sessionWrite(this.key, this.active);
  }

  /** Tab merken (oder nach vorn holen) und als aktiv markieren – ohne ihn zu öffnen (das tut der Gastgeber). */
  mark(tab) {
    if (!this.on || !tab?.id) return;
    const i = this.tabs.findIndex((t) => t.id === tab.id);
    if (i >= 0) this.tabs[i] = { ...this.tabs[i], ...tab };
    else {
      this.tabs.push(tab);
      // Zu viele: der am längsten nicht benutzte (nicht der aktive) geht.
      while (this.tabs.length > MAX_TABS) this.tabs.splice(this.tabs.findIndex((t) => t.id !== tab.id), 1);
    }
    this.active = tab.id;
    this._save();
    this.render();
  }

  /** Home ist aktiv (ohne es zu öffnen). */
  markHome() {
    if (!this.on) return;
    this.active = 'home';
    this._save();
    this.render();
  }

  /**
   * Nach „🔄 Aktualisieren“ oder einem Neuladen der Seite: den Tab, der offen war, wieder öffnen
   * (true, wenn es einen gab). Ein neuer Start (neues Fenster, neue Anmeldung) beginnt mit Home.
   */
  reopenAfterUpdate() {
    let id = null;
    try { id = sessionStorage.getItem('lm_ws_reopen'); sessionStorage.removeItem('lm_ws_reopen'); } catch (_) { /* ohne */ }
    id = id || this.reloadTab;
    this.reloadTab = null;
    if (!id || !this.tabs.some((t) => t.id === id)) return false;
    void this.open(id);
    return true;
  }

  async home() {
    if (this.busy) return;
    this.busy = true;
    cover.show('home');
    try {
      await closeInk();
      this.markHome();
      await this.onHome?.();
      await frame();
    } finally {
      this.busy = false;
      // Lädt der Gastgeber die Seite neu, bleibt die Fläche bis dahin stehen.
      if (!this.reloading) cover.hide();
    }
  }

  async open(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || this.busy) return;
    if (id === this.active && document.querySelector('.ink-overlay, #view-student-quiz.active')) return;
    this.busy = true;
    cover.show('open');
    try {
      await closeInk();
      this.active = id;
      this._save();
      this.render();
      await this.onOpen?.(tab);
      if (!this.reloading) await settled();
    } finally {
      this.busy = false;
      if (!this.reloading) cover.hide();
    }
  }

  /** Der Gastgeber lädt gleich die Seite neu: die Abdeckung bis dahin stehen lassen. */
  willReload() {
    this.reloading = true;
  }

  async close(id) {
    const wasActive = this.active === id;
    this.tabs = this.tabs.filter((t) => t.id !== id);
    if (wasActive) {
      this.active = 'home';
      this._save();
      await this.home();
    } else {
      this._save();
      this.render();
    }
  }

  render() {
    if (!this.bar) return;
    // Lehrkräfte: Leiste erst, wenn ein Dokument offen ist (Home ist die App selbst).
    const show = !(this.hideEmpty && !this.tabs.length);
    this.bar.hidden = !show;
    document.body.classList.toggle('ws-on', show);
    this.bar.innerHTML = `
      <button type="button" class="ws-home${this.active === 'home' ? ' active' : ''}" title="Home – alle Dokumente" aria-label="Home – alle Dokumente">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11L12 4l8.5 7M6 9.5V20h4.5v-5.5h3V20H18V9.5"/></svg></button>
      <div class="ws-tabs" role="tablist">
        ${this.tabs.map((t) => `<div class="ws-tab${t.id === this.active ? ' active' : ''}" role="tab" aria-selected="${t.id === this.active}" data-tab="${escapeAttr(t.id)}" title="${escapeAttr(t.title)}">
          <span class="ws-tab-icon" aria-hidden="true">${escapeHtml(t.icon || '📄')}</span>
          <span class="ws-tab-title">${escapeHtml(t.title)}</span>
          <button type="button" class="ws-tab-close" data-close="${escapeAttr(t.id)}" title="Tab schließen" aria-label="${escapeAttr(`${t.title} schließen`)}">✕</button>
        </div>`).join('')}
      </div>
      <button type="button" class="ws-more" hidden title="Alle offenen Dokumente" aria-label="Alle offenen Dokumente">⋯</button>
      <button type="button" class="ws-feedback" title="Feedback: Fehler oder Wunsch melden" aria-label="Feedback"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H10l-5 4v-4H4zM8 9.5h8M8 12.5h5"/></svg></button>`;
    this.bar.querySelector('.ws-home').addEventListener('click', () => this.home());
    this.bar.querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return;
      this.open(el.dataset.tab);
    }));
    this.bar.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close(b.dataset.close);
    }));
    this.bar.querySelector('.ws-more').addEventListener('click', (e) => this._menu(e.currentTarget));
    this.bar.querySelector('.ws-feedback').addEventListener('click', () => window.lmOpenFeedback?.());
    this._fit();
  }

  /** Passen nicht alle Tabs (auch nicht verkleinert): ⋯ listet alle. */
  _fit() {
    const list = this.bar?.querySelector('.ws-tabs');
    const more = this.bar?.querySelector('.ws-more');
    if (!list || !more) return;
    more.hidden = list.scrollWidth <= list.clientWidth + 1;
    // Der aktive Tab bleibt sichtbar.
    list.querySelector('.ws-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  _menu(anchor) {
    document.querySelector('.ws-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'ws-menu ctx-menu';
    menu.innerHTML = this.tabs.map((t) => `<button type="button" class="ctx-menu-item" data-tab="${escapeAttr(t.id)}">${t.id === this.active ? '✓ ' : ''}${escapeHtml(t.icon || '📄')} ${escapeHtml(t.title)}</button>`).join('');
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.max(4, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 4))}px`;
    const off = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
    menu.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      menu.remove();
      document.removeEventListener('pointerdown', off, true);
      this.open(b.dataset.tab);
    }));
  }
}

/** Für den Gastgeber: Übergang abdecken, bis das Neue steht (z. B. Aufgabe aus dem Baum öffnen). */
export const transition = {
  show: (kind = 'open') => cover.show(kind),
  async done() { await settled(); cover.hide(); },
  hide: () => cover.hide(),
};

/** Eine Arbeitsfläche je Seite. */
export const workspace = new Workspace();
