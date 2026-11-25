import { moveDocumentControls } from '../document-bar.js';
import { escapeHtml } from '../utils.js';
import { syncDrawings } from './drawings-dialog.js';

// ==================== NOTEBOOKS: VORSCHAU-SPALTE ====================
//
// Rechts neben dem Baum: ein Modul so, wie die Schüler es über ihren Link
// sehen – auch ein Dokument samt eingebetteten Quizzen und ohne Lösungen –,
// ein Lernthema mit seinen Modulen oder eine Übersicht über Book, Bereich,
// Abschnitt. Baum und Vorschau lassen sich zuklappen, die Breite lässt sich
// ziehen; beides merkt sich der Browser.

const MIN_PREVIEW = 300;
const MIN_TREE = 320;

/** Element-IDs und Einstellungen; das Klassennotizbuch setzt eigene (class-results.js). */
const DEFAULTS = {
  layoutKey: 'lm_nb_layout',
  split: 'nbSplit', pane: 'nbPreviewPane', actions: 'nbPreviewActions', label: 'nbPreviewLabel', body: 'nbPreviewBody',
  treeFold: 'btnNbTreeFold', previewFold: 'btnNbPreviewFold', splitter: 'nbSplitter',
  treeName: 'Notebooks',
  // Ansicht, zu der „✏️ Bearbeiten“ und „⛶ Vollbild“ zurückkehren.
  from: 'teacher-notebooks',
  emptyText: 'Links ein Modul anklicken – hier erscheint es so, wie die Schüler es sehen. Ein Lernthema oder Ordner zeigt eine Übersicht.',
};

function loadLayout(key) {
  const def = { tree: true, preview: true, width: 0 };
  try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch (_) { return def; }
}

const types = () => (typeof H5P_TYPES !== 'undefined' ? H5P_TYPES : {});

export class NotebookPreview {
  /**
   * `view`: die Ansicht mit dem Baum – braucht `_markCurrent()`; die
   * NotebooksView liefert dazu Themen und Knoten (`_topics`, `_nodes`, …).
   * `opts`: siehe DEFAULTS.
   */
  constructor(view, opts = {}) {
    this.view = view;
    this.app = view.app;
    this._opts = { ...DEFAULTS, ...opts };
    const el = (k) => document.getElementById(this._opts[k]);
    this._split = el('split');
    this._pane = el('pane');
    this._head = el('actions');
    this._label = el('label');
    // Klick auf den Titel der Vorschau: Vorschau über die ganze Seite (wie ⛶ Vollbild), wenn ein Modul gezeigt wird.
    this._labelAction = null;
    this._label?.addEventListener('click', () => this._labelAction?.());
    this._label?.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && this._labelAction) { e.preventDefault(); this._labelAction(); } });
    this._body = el('body');
    this._layout = loadLayout(this._opts.layoutKey);
    // Module je Lernthema (voller Inhalt) – bis zum nächsten Neuladen der Ansicht.
    this._modules = new Map();
    // Was gerade gezeigt wird: { kind: 'module' | 'topic' | 'node', key, … }.
    this._current = null;
    el('treeFold')?.addEventListener('click', () => this._fold('tree'));
    el('previewFold')?.addEventListener('click', () => this._fold('preview'));
    this._bindSplitter(el('splitter'));
    this._applyLayout();
    this._empty();
  }

  /** Ist die Vorschau aufgeklappt? Sonst bleibt der Baum wie früher. */
  get open() { return !!this._split && this._layout.preview; }

  /** Schlüssel der gezeigten Zeile ('m:…', 't:…', 'n:…') – der Baum hebt sie hervor. */
  get currentKey() { return this._current?.key || null; }

  // ---------- Spalten ----------

  _save() {
    try { localStorage.setItem(this._opts.layoutKey, JSON.stringify(this._layout)); } catch (_) { /* nur für diese Sitzung */ }
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
    set(this._opts.treeFold, tree, '◀', '▶', this._opts.treeName);
    set(this._opts.previewFold, preview, '▶', '◀', 'Vorschau');
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
    this.showModule(topic, mod, { notes: c.notes });
  }

  _clear() {
    this._body.querySelectorAll('video, audio').forEach((m) => { try { m.pause(); } catch (_) {} });
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    this._body.innerHTML = '';
    this._head.innerHTML = '';
    this._setLabelAction(null);
    this._setLabel('👁 Vorschau');
  }

  /** Titel der Vorschau anklickbar machen (oder nicht). */
  _setLabelAction(run) {
    this._labelAction = run;
    if (!this._label) return;
    this._label.classList.toggle('nb-preview-label-link', !!run);
    if (run) { this._label.setAttribute('role', 'button'); this._label.tabIndex = 0; } else { this._label.removeAttribute('role'); this._label.removeAttribute('tabindex'); }
  }

  /** Text in der Titelleiste; ein langer Titel wird gekürzt und steht ganz im Tooltip. */
  _setLabel(text, title = '') {
    if (!this._label) return;
    this._label.textContent = text;
    this._label.title = this._labelAction ? `${title ? `${title} – ` : ''}Klick: Vorschau über die ganze Seite` : title;
  }

  /** Dokument: Titel und Knöpfe in die feste Titelleiste (document-bar.js), gleich hinter ✍️ Stift. */
  _compactDocument(host, mod) {
    this._setLabel(`📄 ${mod.title || 'Dokument'}`, mod.title || '');
    // Eigenes Dokument: Der ✍️ aus dem Blatt kommt mit (er fügt ins Dokument ein); erworbenes hat oben schon einen.
    const stift = this._head.querySelector('[data-nb-stift]');
    moveDocumentControls(host, mod, this._head, { before: stift || this._head.firstChild, stiftKnopf: !!stift });
  }

  _empty() {
    this._current = null;
    this._clear();
    this._body.innerHTML = `<div class="empty-state nb-preview-empty"><span class="empty-icon">👁</span>
      <p>${escapeHtml(this._opts.emptyText)}</p></div>`;
  }

  _select(current) {
    this._current = current;
    this.view._markCurrent();
  }

  _button(label, title, run) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-secondary btn-sm';
    // Symbol und Text getrennt: Bei wenig Platz bleibt nur das Symbol (siehe .nb-btn-text).
    const [icon, ...words] = label.split(' ');
    b.append(icon);
    if (words.length) {
      const text = document.createElement('span');
      text.className = 'nb-btn-text';
      text.textContent = ` ${words.join(' ')}`;
      b.append(text);
    }
    b.title = title || label;
    b.addEventListener('click', run);
    if (label.includes('Stift')) b.dataset.nbStift = '1';
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

  /** Ein Modul – so, wie die Schüler es über den Link sehen. `notes`: zusätzliche Hinweise (z. B. „in dieser Klasse aus“). */
  async showModule(topic, mod, { notes: extra = [] } = {}) {
    const key = 'm:' + mod.id;
    this._select({ kind: 'module', key, id: mod.id, topicId: topic.id, topic, mod, notes: extra });
    this._clear();
    const own = topic.isOwn;
    // Stift-Editor oben nur bei erworbenen Dokumenten – eigene beschriftet man im Modul-Editor („Mit Stift
    // bearbeiten“); drei gleich aussehende Stifte nebeneinander waren verwirrend.
    if (mod.type === 'document' && !own && this.app.state.currentUser?.features?.includes('inkEditor')) {
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
    if (own) this._button('✏️ Bearbeiten', 'Im Modul-Editor öffnen (auch Doppelklick auf den Titel)', () => this.app.modulesView.openFrom(this._opts.from, topic.id, mod, 'edit'));
    // Zur Nutzung erworben, Kopieren erlaubt: Bearbeiten legt eine eigene Kopie an (sie ersetzt die Nutzung).
    // Nur zum Verwenden: kein Bearbeiten – es ist ein Link aufs Original.
    const copyGrant = !own && mod.type === 'document' ? (topic.grants || []).find((g) => g.allowCopy && !g.onlyForeign) : null;
    if (copyGrant) this._button('✏️ Bearbeiten', 'Eigene Kopie anlegen und bearbeiten – mit Verweis auf den Autor', () => this._editAsCopy(topic, mod, copyGrant));
    // Zeichnungen mit Quelle (.odg in der Nextcloud): Übersicht, und geänderte gleich neu zeichnen.
    if (own && mod.type === 'document') {
      const reload = async () => { this._modules.delete(topic.id); if (this.currentKey === key) await this.showModule(topic, mod); };
      syncDrawings(this.app, topic.id, { quiet: true }).then((n) => { if (n) reload(); });
      // GoodNotes steht im ⋯ des Lernthemas (Rückmeldung: Leiste = Arbeitsblatt, Lösung, Stift, Bearbeiten, Vollbild).
    }
    // Über die ganze Seite – mit Weiter/Zurück durch die übrigen Module des Lernthemas.
    // Klassennotizbuch: Die Module tragen `enabled` – geblättert wird durch das, was die Klasse sieht.
    const classIds = (topic.modules || []).some((m) => 'enabled' in m) ? topic.modules.filter((m) => m.enabled).map((m) => m.id) : null;
    const wholePage = () => this.app.modulesView.openTopicPlayer(this._opts.from, topic.id, mod.id, classIds);
    this._button('⛶ Vollbild', 'Vorschau über die ganze Seite', wholePage);
    this._setLabelAction(wholePage);
    this._setLabel(this._label?.textContent || '👁 Vorschau', mod.title || '');
    this._body.innerHTML = '<p class="hint">Wird geladen …</p>';

    let modules;
    try { modules = await this._topicModules(topic); } catch (err) {
      if (this.currentKey === key) this._body.innerHTML = `<p class="login-error">${escapeHtml(err.message)}</p>`;
      return;
    }
    if (this.currentKey !== key) return; // inzwischen etwas anderes gewählt
    const full = modules.find((m) => m.id === mod.id) || mod;
    this._body.innerHTML = '';
    const notes = [...extra];
    if (own && !topic.selected) notes.push('Das Lernthema ist nicht für Schüler freigegeben – sie sehen es erst danach.');
    if (full.moduleSelected === false) notes.push('Dieses Modul ist inaktiv – Schüler sehen es nicht.');
    if (mod.lockedForStudents && own) notes.push('🔒 Schüler sehen das nicht – nur über den Link der Klassenarbeit. Freigeben: ⋯ → 🔓 Zur Besprechung freigeben.');
    else if (mod.lockedForOthers && !own) notes.push('🔒 Deine Schüler sehen das nicht – nur über den Link der Klassenarbeit.');
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
    if (full.type === 'document') this._compactDocument(host, full);
  }

  /** Genutztes Dokument bearbeiten: erst eine eigene Kopie (ersetzt die Nutzung), dann der Modul-Editor. */
  async _editAsCopy(topic, mod, grant) {
    const whole = grant.scopeType === 'node' || grant.scopeType === 'modules';
    const ok = await this.app.appConfirm(
      `Eigene Kopie von „${topic.title}“ anlegen und bearbeiten?\n\n`
      + (whole ? 'Das gilt für das ganze Angebot (Bereich bzw. Auswahl), zu dem dieses Lernthema gehört – alles wird deine Kopie.\n\n' : '')
      + `Die Kopie gehört dir und verweist auf ${topic.ownerName || 'den Autor'}. Sie ersetzt die Nutzung: Verbesserungen des Autors kommen danach nicht mehr von selbst an. `
      + 'Klassennotizbücher und Links, die auf das Original zeigen, bitte auf die Kopie umstellen.',
    );
    if (!ok) return;
    try {
      const res = await this.app.api.grantToCopy(grant.id, topic.id);
      if (!res?.success) throw new Error(res?.message || 'Kopieren fehlgeschlagen');
      const mods = res.topicId ? await this.app.api.getTopicModules(res.topicId).catch(() => []) : [];
      const copy = (Array.isArray(mods) ? mods : []).find((m) => m.originId === (mod.originId || mod.id)) || null;
      this.app.showToast('Eigene Kopie angelegt – sie ersetzt die Nutzung.', 'success');
      await this.view.refresh?.();
      if (copy) this.app.modulesView.openFrom(this._opts.from, res.topicId, copy, 'edit');
    } catch (err) {
      this.app.showToast(`Kopie: ${err.message}`, 'error');
    }
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
    if (roots.length) {
      // Alle Module nacheinander über die ganze Seite (◀ Zurück / Weiter ▶).
      // Klassennotizbuch: nur, was die Klasse sieht (Module mit `enabled`).
      const classIds = roots.some((m) => 'enabled' in m) ? roots.filter((m) => m.enabled).map((m) => m.id) : null;
      const all = () => this.app.modulesView.openTopicPlayer(this._opts.from, topic.id, null, classIds);
      this._button('⛶ Vollbild', roots.length > 1 ? `Alle ${roots.length} Module nacheinander über die ganze Seite – mit Weiter und Zurück` : 'Über die ganze Seite', all);
      this._setLabelAction(all);
      this._setLabel(this._label?.textContent || '👁 Vorschau', topic.title || '');
    }
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
