import { escapeHtml } from '../utils.js';
import { syncDrawings, openDrawingsDialog } from './drawings-dialog.js';

// ==================== NOTEBOOKS: VORSCHAU-SPALTE ====================
//
// Rechts neben dem Baum: ein Modul so, wie die Schüler es über ihren Link
// sehen – auch ein Dokument samt eingebetteten Quizzen und ohne Lösungen –,
// ein Lernthema mit seinen Modulen oder eine Übersicht über Book, Bereich,
// Abschnitt. Baum und Vorschau lassen sich zuklappen, die Breite lässt sich
// ziehen; beides merkt sich der Browser.

const LAYOUT_KEY = 'lm_nb_layout';
const MIN_PREVIEW = 300;
const MIN_TREE = 320;

function loadLayout() {
  const def = { tree: true, preview: true, width: 0 };
  try { return { ...def, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') }; } catch (_) { return def; }
}

const types = () => (typeof H5P_TYPES !== 'undefined' ? H5P_TYPES : {});

export class NotebookPreview {
  /** `view`: die NotebooksView – für Baum, Themen und Knoten. */
  constructor(view) {
    this.view = view;
    this.app = view.app;
    this._split = document.getElementById('nbSplit');
    this._pane = document.getElementById('nbPreviewPane');
    this._head = document.getElementById('nbPreviewActions');
    this._body = document.getElementById('nbPreviewBody');
    this._layout = loadLayout();
    // Module je Lernthema (voller Inhalt) – bis zum nächsten Neuladen der Ansicht.
    this._modules = new Map();
    // Was gerade gezeigt wird: { kind: 'module' | 'topic' | 'node', key, … }.
    this._current = null;
    document.getElementById('btnNbTreeFold')?.addEventListener('click', () => this._fold('tree'));
    document.getElementById('btnNbPreviewFold')?.addEventListener('click', () => this._fold('preview'));
    this._bindSplitter(document.getElementById('nbSplitter'));
    this._applyLayout();
    this._empty();
  }

  /** Ist die Vorschau aufgeklappt? Sonst bleibt der Baum wie früher. */
  get open() { return !!this._split && this._layout.preview; }

  /** Schlüssel der gezeigten Zeile ('m:…', 't:…', 'n:…') – der Baum hebt sie hervor. */
  get currentKey() { return this._current?.key || null; }

  // ---------- Spalten ----------

  _save() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this._layout)); } catch (_) { /* nur für diese Sitzung */ }
  }

  /** Eine Spalte auf- oder zuklappen; beide zu geht nicht – dann geht die andere auf. */
  _fold(which) {
    const other = which === 'tree' ? 'preview' : 'tree';
    this._layout[which] = !this._layout[which];
    if (!this._layout[which] && !this._layout[other]) this._layout[other] = true;
    this._save();
    this._applyLayout();
    if (which === 'preview' && this._layout.preview) this._redraw();
  }

  _applyLayout() {
    if (!this._split) return;
    const { tree, preview, width } = this._layout;
    this._split.classList.toggle('nb-tree-folded', !tree);
    this._split.classList.toggle('nb-preview-folded', !preview);
    this._pane.style.width = tree && preview && width ? `${width}px` : '';
    const set = (id, open, openText, foldedText, label) => {
      const b = document.getElementById(id);
      if (!b) return;
      b.textContent = open ? openText : foldedText;
      b.title = `${label} ${open ? 'zuklappen' : 'aufklappen'}`;
      b.setAttribute('aria-expanded', String(open));
    };
    set('btnNbTreeFold', tree, '◀', '▶', 'Notebooks');
    set('btnNbPreviewFold', preview, '▶', '◀', 'Vorschau');
  }

  /** Trenner ziehen: Breite der Vorschau; Doppelklick stellt sie zurück. */
  _bindSplitter(handle) {
    if (!handle) return;
    handle.addEventListener('pointerdown', (e) => {
      if (!this._layout.tree || !this._layout.preview) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const box = this._split.getBoundingClientRect();
      const move = (ev) => {
        const w = Math.round(box.right - ev.clientX);
        this._layout.width = Math.max(MIN_PREVIEW, Math.min(box.width - MIN_TREE, w));
        this._pane.style.width = `${this._layout.width}px`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        this._save();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    handle.addEventListener('dblclick', () => {
      this._layout.width = 0;
      this._save();
      this._applyLayout();
    });
  }

  // ---------- Inhalt ----------

  /** Nach dem Neuladen der Notebooks: frische Daten, das Gezeigte neu zeichnen. */
  refresh() {
    this._modules.clear();
    this._redraw();
  }

  _redraw() {
    const c = this._current;
    if (!c || !this.open) return;
    if (c.kind === 'node') {
      const node = this.view._nodes?.get(c.id);
      if (node) this.showNode(node); else this._empty();
      return;
    }
    const topic = this.view._topics?.get(c.topicId) || c.topic;
    if (c.kind === 'topic') { this.showTopic(topic); return; }
    const mod = (topic?.modules || []).find((m) => m.id === c.id) || c.mod;
    this.showModule(topic, mod);
  }

  _clear() {
    this._body.querySelectorAll('video, audio').forEach((m) => { try { m.pause(); } catch (_) {} });
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    this._body.innerHTML = '';
    this._head.innerHTML = '';
  }

  _empty() {
    this._current = null;
    this._clear();
    this._body.innerHTML = `<div class="empty-state nb-preview-empty"><span class="empty-icon">👁</span>
      <p>Links ein Modul anklicken – hier erscheint es so, wie die Schüler es sehen.
      Ein Lernthema oder Ordner zeigt eine Übersicht.</p></div>`;
  }

  _select(current) {
    this._current = current;
    this.view._markCurrent();
  }

  _button(label, title, run) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-secondary btn-sm';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', run);
    this._head.appendChild(b);
  }

  /** Module eines Lernthemas mit vollem Inhalt (auch Kopien und Erworbenes). */
  _topicModules(topic) {
    if (!this._modules.has(topic.id)) {
      this._modules.set(topic.id, (async () => {
        const mods = await this.app.api.getTopicModules(topic.id).catch(() => null);
        if (Array.isArray(mods)) return mods;
        // Aus einem erworbenen Bereich: nur über die Ansicht für Geteiltes.
        const shared = await this.app.api.getSharedTopicView(topic.id).catch(() => null);
        if (Array.isArray(shared?.modules)) return shared.modules;
        throw new Error(mods?.message || shared?.message || 'Module lassen sich nicht laden.');
      })());
      // Einen Fehlschlag (z. B. Server startet gerade neu) nicht merken – der nächste Klick lädt neu.
      this._modules.get(topic.id).catch(() => this._modules.delete(topic.id));
    }
    return this._modules.get(topic.id);
  }

  /** Ein Modul – so, wie die Schüler es über den Link sehen. */
  async showModule(topic, mod) {
    const key = 'm:' + mod.id;
    this._select({ kind: 'module', key, id: mod.id, topicId: topic.id, topic, mod });
    this._clear();
    const own = topic.isOwn;
    // Dokumente mit der Freischaltung „Stift-Editor“: oben, damit man ihn auch weiter unten im Blatt findet.
    if (mod.type === 'document' && this.app.state.currentUser?.features?.includes('inkEditor')) {
      this._button('✍️ Stift', 'Das Blatt mit Stift, Finger oder Maus beschriften – gespeichert auf diesem Gerät', async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          const all = await this._topicModules(topic).catch(() => []);
          const full = all.find((m) => m.id === mod.id) || mod;
          const { openDocumentInk } = await import('../ink/ink-open.js');
          // Eigenes Dokument: Einfügen (⊕) und Schreibfelder gehen ins Dokument; danach die Vorschau auffrischen.
          await openDocumentInk({
            mode: 'teacher', mod: full, embedModule: (id) => all.find((m) => m.id === id) || null,
            editable: own, topicModules: all,
            onSaved: () => { this._modules.delete(topic.id); if (this.currentKey === key) this.showModule(topic, mod); },
          });
        } catch (err) { this.app.showToast(`Stift-Editor: ${err.message}`, 'error'); }
        b.disabled = false;
      });
    }
    if (own) this._button('✏️ Bearbeiten', 'Im Modul-Editor öffnen (auch Doppelklick auf den Titel)', () => this.app.modulesView.openFrom('teacher-notebooks', topic.id, mod, 'edit'));
    // Zeichnungen mit Quelle (.odg in der Nextcloud): Übersicht, und geänderte gleich neu zeichnen.
    if (own && mod.type === 'document') {
      const reload = async () => { this._modules.delete(topic.id); if (this.currentKey === key) await this.showModule(topic, mod); };
      this._button('🖍 Zeichnungen', 'Zeichnungen dieses Lernthemas in LibreOffice Draw bearbeiten (.odg in der Nextcloud)', () => openDrawingsDialog(this.app, topic, { onChanged: reload }));
      syncDrawings(this.app, topic.id, { quiet: true }).then((n) => { if (n) reload(); });
    }
    this._button('⛶ Vollbild', 'Vorschau über die ganze Seite', () => this.app.modulesView.openFrom('teacher-notebooks', topic.id, mod, 'preview'));
    this._body.innerHTML = '<p class="hint">Wird geladen …</p>';

    let modules;
    try { modules = await this._topicModules(topic); } catch (err) {
      if (this.currentKey === key) this._body.innerHTML = `<p class="login-error">${escapeHtml(err.message)}</p>`;
      return;
    }
    if (this.currentKey !== key) return; // inzwischen etwas anderes gewählt
    const full = modules.find((m) => m.id === mod.id) || mod;
    this._body.innerHTML = '';
    const notes = [];
    if (own && !topic.selected) notes.push('Das Lernthema ist nicht für Schüler freigegeben – sie sehen es erst danach.');
    if (full.moduleSelected === false) notes.push('Dieses Modul ist inaktiv – Schüler sehen es nicht.');
    if (notes.length) {
      const p = document.createElement('p');
      p.className = 'hint nb-preview-note';
      p.textContent = notes.join(' ');
      this._body.appendChild(p);
    }
    const host = document.createElement('div');
    host.className = 'nb-preview-module';
    // Erst einhängen, dann aufbauen: Manche Aufgaben messen beim Aufbau ihre Größe.
    this._body.appendChild(host);
    this.app.renderer.renderPreview(full, types()[full.type] || {}, host, {
      // Wie im Durchlauf der Schüler (views/quiz.js): Lösungen im Dokument
      // bleiben verborgen, Quizze im Dokument laufen mit.
      quizMode: true,
      embedModule: (id) => modules.find((m) => m.id === id) || null,
      // Dokumente: „✍️ Bearbeiten“ mit Stift, dazu das Lösungsblatt einblendbar
      // – nur mit der Freischaltung „Stift-Editor“.
      inkEdit: this.app.state.currentUser?.features?.includes('inkEditor') ? 'teacher' : null,
      // Eigenes Lernthema: ⊕ im Stift-Editor fügt ins Dokument ein (wie „✍️ Stift“ oben).
      inkDocument: topic.isOwn ? {
        module: full, topicId: topic.id, modules,
        onSaved: () => { this._modules.delete(topic.id); if (this.currentKey === key) this.showModule(topic, mod); },
      } : null,
    });
  }

  /** Ein Lernthema: Stand und seine Module – ein Klick zeigt das Modul. */
  showTopic(topic) {
    if (!topic) { this._empty(); return; }
    this._select({ kind: 'topic', key: 't:' + topic.id, topicId: topic.id, topic });
    this._clear();
    if (topic.isMirror) {
      const m = topic.mirror;
      this._body.innerHTML = `<h3 class="nb-preview-title">📂 ${escapeHtml(m.title)}</h3>
        <p class="hint">Zur Nutzung erworben von ${escapeHtml(m.sellerName || '')} · ${m.topics.length} Lernthem${m.topics.length === 1 ? 'a' : 'en'}.
        Links aufklappen und ein Modul anklicken.</p>`;
      return;
    }
    const mods = (topic.modules || []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const roots = mods.filter((m) => !m.parentId);
    const state = topic.isOwn
      ? (topic.selected ? '● für Schüler freigegeben' : '○ nicht freigegeben')
      : `🔗 erworben von ${escapeHtml(topic.ownerName || '')}`;
    this._body.innerHTML = `<h3 class="nb-preview-title">${topic.isOwn ? '📘' : '📗'} ${escapeHtml(topic.title)}</h3>
      <p class="hint">${state} · ${roots.length} Modul${roots.length === 1 ? '' : 'e'}</p>
      <ol class="nb-preview-list"></ol>`;
    const list = this._body.querySelector('.nb-preview-list');
    const item = (m, sub) => {
      const t = types()[m.type] || {};
      const li = document.createElement('li');
      li.className = `${sub ? 'nb-preview-sub' : ''} ${m.moduleSelected === false ? 'nb-off' : ''}`;
      li.innerHTML = `<button type="button" class="nb-preview-link">${t.icon || '🧩'} ${escapeHtml(m.title)}</button>
        <span class="hint">${escapeHtml(t.name || m.type)}${m.moduleSelected === false ? ' · inaktiv' : ''}</span>`;
      li.querySelector('button').addEventListener('click', () => this.showModule(topic, m));
      list.appendChild(li);
    };
    for (const r of roots) {
      item(r, false);
      for (const k of mods.filter((m) => m.parentId === r.id)) item(k, true);
    }
    if (!roots.length) list.outerHTML = '<p class="hint">Noch keine Module.</p>';
  }

  /** Book, Bereich oder Abschnitt: was darin steckt. */
  showNode(node) {
    this._select({ kind: 'node', key: 'n:' + node.id, id: node.id });
    this._clear();
    const kinds = { book: ['📓', 'Book'], area: ['📂', 'Bereich'], section: ['📑', 'Abschnitt'] };
    const [icon, label] = kinds[node.kind] || ['📂', ''];
    const topics = this.view._topicsBelow(node.id).filter((t) => !t.isMirror);
    const modules = topics.reduce((n, t) => n + (t.modules || []).filter((m) => !m.parentId).length, 0);
    const shared = topics.filter((t) => t.isOwn && t.selected).length;
    const path = this.view._path(node.parentId);
    this._body.innerHTML = `<h3 class="nb-preview-title">${icon} ${escapeHtml(node.title)}</h3>
      <p class="hint">${label}${path ? ` in ${escapeHtml(path)}` : ''}</p>
      <ul class="nb-preview-facts">
        <li><strong>${topics.length}</strong> Lernthem${topics.length === 1 ? 'a' : 'en'}, davon ${shared} für Schüler freigegeben</li>
        <li><strong>${modules}</strong> Modul${modules === 1 ? '' : 'e'}</li>
      </ul>
      <p class="hint">Aufklappen und ein Modul anklicken, um es hier zu sehen.</p>
      ${this.view._docsEnabled() ? '<p><button type="button" class="btn btn-secondary btn-sm nb-preview-docsettings" title="Kurs, Kopfzeile, Nummerierung (z. B. „Zählung beginnt hier“) und KI-Vorgaben für die Dokumente darunter">📄 Dokument-Einstellungen…</button></p>' : ''}`;
    this._body.querySelector('.nb-preview-docsettings')?.addEventListener('click', () => {
      this.view._editDocSettings(node).catch((err) => this.view.app.showToast('Fehler: ' + err.message, 'error'));
    });
  }
}
