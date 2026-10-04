import { escapeHtml, escapeAttr, copyQrSvgAsPng, copyShareSheetAsPng } from '../utils.js';
import { LINK_MODE_LABELS } from './login.js';
import { TagFilter, TagPicker, renderAreaGroups, chipHtml } from './tags.js';
import { GRADABLE_TYPES } from '../answer-eval.js';
import { saveRedirectFile } from './contest.js';

// ==================== THEMEN-LINKS ====================

const ALL_MODES = ['quiz', 'exam', 'learn', 'companion', 'contest'];
/** Modi, zwischen denen Schüler über "Link & QR" wählen. */
const PRACTICE_MODES = ['quiz', 'learn', 'companion'];

/** Texte des Freigabe-Dialogs je Link. */
const SHARE_TEXTS = {
  practice: {
    title: '🔗 Schülerfreigabe – Link zum Üben',
    hint: 'Schüler öffnen den Link oder scannen den Code, geben ihren Namen ein und wählen, wie sie üben '
      + '(Quiz, Lernen mit Lösungen, Lernbegleitung – je nachdem, was du freigegeben hast).',
  },
  exam: {
    title: '📝 Klassenarbeit – eigener Link',
    hint: 'Dieser Link führt direkt in die Klassenarbeit – getrennt vom Übungslink. Wer ihn hat, kommt hinein: '
      + 'erst zu Beginn zeigen und danach mit „Zurückziehen“ oder „Neu“ schließen.',
  },
};

/**
 * Verwaltung der Themen-Links: benannte Zugänge wie "TG12 Informatik
 * Arduino", die eine Auswahl aus den eigenen Themen bündeln und festlegen,
 * in welchen Modi damit gearbeitet werden darf.
 */
export class LinksView {
  constructor(app) {
    this.app = app;

    this._list        = document.getElementById('linksList');
    this._btnNew      = document.getElementById('btnNewLink');
    this._formBox     = document.getElementById('linkFormContainer');
    this._form        = document.getElementById('linkForm');
    this._formTitle   = document.getElementById('linkFormTitle');
    this._nameInput   = document.getElementById('linkName');
    this._passwordInput = document.getElementById('linkPassword');
    this._chkSingle   = document.getElementById('linkSingleAttempt');
    this._singleRow   = document.getElementById('linkSingleAttemptRow');
    this._modesBox    = document.getElementById('linkModes');
    this._tagPicker   = new TagPicker(app, document.getElementById('linkTags'));
    this._treeBox     = document.getElementById('linkTopicTree');
    this._btnCancel   = document.getElementById('btnCancelLink');
    this._selectionSummary = document.getElementById('linkSelectionSummary');
    this._companionRow = document.getElementById('linkCompanionRow');
    this._contestRow   = document.getElementById('linkContestRow');
    this._contestTimes = document.getElementById('linkContestTimes');
    /** Eigene Zeiten je Aufgabe im Formular: Modul-ID → Sekunden. */
    this._contestSeconds = {};

    /** Auswahl im Formular: topicId → { all, moduleIds:Set }. */
    this._selection = new Map();
    this._editId = null;

    this._filter = new TagFilter(app, {
      searchInput: document.getElementById('linkTagSearch'),
      chipList: document.getElementById('linkTagFilterChips'),
      modeToggle: document.getElementById('linkTagFilterAll'),
      onChange: () => this._renderList(),
    });

    this._bindEvents();
  }

  _bindEvents() {
    this._btnNew?.addEventListener('click', () => this._openEditor(null));
    this._btnCancel?.addEventListener('click', () => this._closeEditor());
    this._form?.addEventListener('submit', (e) => this._onSubmit(e));

    // Die Einmal-Teilnahme greift nur in der Klassenarbeit – sonst wäre die
    // Option eine leere Zusage.
    this._modesBox?.addEventListener('change', () => this._syncModeDependentFields());
    // Die Standardzeit steht als Platzhalter bei jeder einzelnen Aufgabe.
    document.getElementById('linkContestSeconds')?.addEventListener('input', () => this._renderContestTimes());
  }

  // ---------- Liste ----------

  async refresh() {
    await this.app.loadTags();
    // Für den Auswahlbaum zählen nicht nur die eigenen Themen, sondern auch
    // die, auf die ich ein Nutzungsrecht aus dem Shop habe.
    try {
      this._usableTopics = await this.app.api.getUsableTopics();
    } catch (_) {
      this._usableTopics = [];
    }
    if (!Array.isArray(this._usableTopics)) this._usableTopics = [];
    this._links = await this.app.api.getLinks();
    if (!Array.isArray(this._links)) this._links = [];
    this._filter.render();
    this._renderList();
  }

  _renderList() {
    if (!this._list) return;
    const links = (this._links || []).filter((l) => this._filter.matches(l));

    this._list.innerHTML = '';
    if (links.length === 0) {
      this._list.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🔗</span>
          <p>${(this._links || []).length === 0
            ? 'Noch keine Schülerfreigaben. Lege eine an, z. B. „TG12 Informatik Arduino“.'
            : 'Keine Freigabe passt zum gewählten Filter.'}</p>
        </div>`;
      return;
    }

    const grouped = renderAreaGroups(this._list, links, {
      tags: this.app.state.tags,
      scope: 'links',
      respectHidden: true,
      expandAll: this._filter.selectedIds.length > 0,
      buildItem: (link) => this._buildCard(link),
      countLabel: (n) => (n === 1 ? '1 Freigabe' : `${n} Freigaben`),
    });
    if (!grouped) for (const link of links) this._list.appendChild(this._buildCard(link));
  }

  /** Karte einer Schülerfreigabe mit allen Aktionen. */
  _buildCard(link) {
    const card = document.createElement('div');
    card.className = 'link-card' + (link.active ? '' : ' link-card-inactive');
    const off = link.active ? '' : 'disabled title="Link ist deaktiviert"';
    card.innerHTML = `
      <div class="link-card-main">
        <h3 class="link-card-title">
          ${link.active ? '🔗' : '⏸'} ${escapeHtml(link.name)}
          ${link.hasPassword ? '<span class="link-badge" title="Passwort erforderlich">🔒</span>' : ''}
          ${link.singleAttempt ? '<span class="link-badge" title="Klassenarbeit nur einmal">1×</span>' : ''}
        </h3>
        <div class="link-card-modes">
          ${(link.modes || []).map((m) => `
            <span class="link-mode-badge">${LINK_MODE_LABELS[m]?.icon || ''} ${escapeHtml(LINK_MODE_LABELS[m]?.label || m)}</span>
          `).join('')}
        </div>
        <p class="link-card-meta">
          ${link.topicCount} Thema/Themen · ${link.moduleCount} Aufgabe${link.moduleCount !== 1 ? 'n' : ''}
          ${link.active ? '' : ' · deaktiviert'}
          ${link.usesForeignContent ? ' · nutzt fremde Inhalte' : ''}
        </p>
        ${link.unavailableTopics ? `
          <p class="link-card-warning">⚠️ ${link.unavailableTopics} Thema/Themen nicht mehr verfügbar –
            gelöscht oder das Nutzungsrecht ist entfallen.</p>` : ''}
        <div class="link-card-tags">${this._renderTagChips(link.tagIds)}</div>
      </div>
      <div class="link-card-actions">
        ${this._hasPractice(link) ? `<button class="btn btn-secondary btn-sm btn-link-share" ${off} title="Link zum Üben: Quiz, Lernen mit Lösungen, Lernbegleitung">🔗 Link &amp; QR</button>` : ''}
        ${(link.modes || []).includes('exam') ? `<button class="btn btn-secondary btn-sm btn-link-exam" ${off} title="Eigener Link der Klassenarbeit">📝 Klassenarbeit</button>` : ''}
        ${(link.modes || []).includes('contest') ? `<button class="btn btn-primary btn-sm btn-link-contest" ${off}>🏆 Quiz-Arena</button>` : ''}
        <button class="btn btn-secondary btn-sm btn-link-toggle">${link.active ? '⏸ Deaktivieren' : '▶️ Aktivieren'}</button>
        <button class="btn btn-secondary btn-sm btn-link-edit">✏️ Bearbeiten</button>
        <button class="btn btn-danger btn-sm btn-link-delete">🗑</button>
      </div>`;

    card.querySelector('.btn-link-share')?.addEventListener('click', () => this._openShareDialog(link, 'practice'));
    card.querySelector('.btn-link-exam')?.addEventListener('click', () => this._openShareDialog(link, 'exam'));
    card.querySelector('.btn-link-contest')?.addEventListener('click', () => this._openContestDialog(link));
    card.querySelector('.btn-link-edit').addEventListener('click', () => this._openEditor(link));
    card.querySelector('.btn-link-toggle').addEventListener('click', async () => {
      await this.app.api.updateLink(link.id, { active: !link.active });
      this.app.showToast(link.active ? 'Freigabe deaktiviert.' : 'Freigabe aktiviert.', 'info');
      this.refresh();
    });
    card.querySelector('.btn-link-delete').addEventListener('click', async () => {
      if (!(await this.app.appConfirm(`Freigabe "${link.name}" löschen? Verteilte QR-Codes führen danach ins Leere.`))) return;
      await this.app.api.deleteLink(link.id);
      this.app.showToast('Freigabe gelöscht.', 'info');
      this.refresh();
    });


    return card;
  }

  _renderTagChips(tagIds) {
    const byId = new Map((this.app.state.tags || []).map((t) => [t.id, t]));
    return (tagIds || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((tag) => chipHtml(tag))
      .join('');
  }

  // ---------- Formular ----------

  _openEditor(link) {
    this._editId = link ? link.id : null;
    this._formTitle.textContent = link ? `Freigabe bearbeiten: ${link.name}` : 'Neue Schülerfreigabe';
    this._nameInput.value = link ? link.name : '';
    this._passwordInput.value = '';
    this._passwordInput.placeholder = link?.hasPassword
      ? 'Passwort gesetzt – leer lassen, um es zu behalten'
      : 'Leer = kein Passwort';
    this._chkSingle.checked = !!link?.singleAttempt;

    this._renderModes(link ? link.modes : ['quiz']);
    this._tagPicker.render(link ? link.tagIds : []);
    this._fillModeSettings(link);

    this._selection = new Map();
    // Tag-Vorschläge beginnen beim Öffnen neu (siehe _applySuggestedTags).
    this._autoTags = null;
    this._dismissedTags = new Set();
    for (const entry of link?.selection || []) {
      this._selection.set(entry.topicId, {
        all: !!entry.all,
        moduleIds: new Set(entry.moduleIds || []),
      });
    }
    this._renderTree();
    this._syncModeDependentFields();

    this._formBox.classList.remove('hidden');
    this._nameInput.focus();
  }

  _closeEditor() {
    this._formBox.classList.add('hidden');
    this._editId = null;
    this._selection = new Map();
  }

  _renderModes(active) {
    const set = new Set(active || []);
    this._modesBox.innerHTML = '';
    for (const mode of ALL_MODES) {
      const meta = LINK_MODE_LABELS[mode];
      const label = document.createElement('label');
      label.className = 'link-mode-choice';
      label.innerHTML = `
        <input type="checkbox" value="${escapeAttr(mode)}" ${set.has(mode) ? 'checked' : ''} />
        <span class="link-mode-choice-text">
          <strong>${meta.icon} ${escapeHtml(meta.label)}</strong>
          <small>${escapeHtml(meta.hint)}</small>
        </span>`;
      this._modesBox.appendChild(label);
    }
  }

  _selectedModes() {
    return [...this._modesBox.querySelectorAll('input:checked')].map((i) => i.value);
  }

  /** Einmal-Teilnahme nur anbieten, wenn die Klassenarbeit erlaubt ist. */
  _syncModeDependentFields() {
    const modes = this._selectedModes();
    const examOn = modes.includes('exam');
    this._singleRow?.classList.toggle('hidden', !examOn);
    if (!examOn && this._chkSingle) this._chkSingle.checked = false;
    this._companionRow?.classList.toggle('hidden', !modes.includes('companion'));
    this._contestRow?.classList.toggle('hidden', !modes.includes('contest'));
    if (modes.includes('contest')) this._renderContestTimes();
  }

  /** Lernbegleitung und Quiz-Arena: gespeicherte Werte ins Formular, Vorgaben als Platzhalter. */
  async _fillModeSettings(link) {
    const cs = link?.companionSettings || {};
    const val = (v) => (v === null || v === undefined ? '' : String(v));
    document.getElementById('linkJokerMax').value = val(cs.jokerMax);
    document.getElementById('linkPenaltyStart').value = val(cs.penaltyStart);
    document.getElementById('linkPenaltyMax').value = val(cs.penaltyMax);

    const ct = link?.contestSettings || {};
    document.getElementById('linkContestMaxPoints').value = val(ct.maxPoints);
    document.getElementById('linkContestSeconds').value = val(ct.defaultSeconds);
    document.getElementById('linkContestSound').checked = ct.sound !== false;
    this._contestSeconds = { ...(ct.seconds || {}) };

    // Was ohne Eintrag gilt, steht grau im Feld.
    try {
      const companion = await this.app.api.getCompanion();
      const eff = companion?.effective?.settings;
      if (eff) {
        document.getElementById('linkJokerMax').placeholder = String(eff.jokerMax);
        document.getElementById('linkPenaltyStart').placeholder = String(eff.penaltyStart);
        document.getElementById('linkPenaltyMax').placeholder = String(eff.penaltyMax);
      }
    } catch (_) { /* Platzhalter bleiben leer */ }
  }

  /** Aufgaben der aktuellen Auswahl, die in der Quiz-Arena vorkommen (automatisch bewertbar). */
  _contestModules() {
    const topics = this._usableTopics || [];
    const out = [];
    for (const entry of this._buildSelection()) {
      const topic = topics.find((t) => t.id === entry.topicId);
      if (!topic) continue;
      const roots = (topic.modules || []).filter((m) => !m.parentId).sort((a, b) => a.orderIndex - b.orderIndex);
      const chosen = new Set(entry.all ? roots.map((m) => m.id) : entry.moduleIds);
      for (const m of roots) {
        const kids = (topic.modules || []).filter((k) => k.parentId === m.id);
        const picked = chosen.has(m.id) || kids.some((k) => chosen.has(k.id));
        if (picked && GRADABLE_TYPES.has(m.type)) out.push({ ...m, _topicTitle: topic.title });
      }
    }
    return out;
  }

  _renderContestTimes() {
    if (!this._contestTimes) return;
    const modules = this._contestModules();
    if (modules.length === 0) {
      this._contestTimes.innerHTML = '<p class="hint">Die Auswahl enthält noch keine automatisch bewertbare Aufgabe.</p>';
      return;
    }
    const def = document.getElementById('linkContestSeconds').value || '30';
    this._contestTimes.innerHTML = modules.map((m) => `
      <label class="link-contest-time">
        <span>${(H5P_TYPES[m.type] || {}).icon || ''} ${escapeHtml(m.title)} <small class="hint">${escapeHtml(m._topicTitle)}</small></span>
        <input type="number" min="5" max="600" data-module="${escapeAttr(m.id)}"
          value="${escapeAttr(String(this._contestSeconds[m.id] ?? ''))}" placeholder="${escapeAttr(def)}" /> s
      </label>`).join('');
    this._contestTimes.querySelectorAll('input[data-module]').forEach((inp) => {
      inp.addEventListener('input', () => {
        if (inp.value === '') delete this._contestSeconds[inp.dataset.module];
        else this._contestSeconds[inp.dataset.module] = Number(inp.value);
      });
    });
  }

  _modeSettingsPayload() {
    const num = (id) => {
      const v = document.getElementById(id).value.trim();
      return v === '' ? null : Number(v);
    };
    // Nur Zeiten von Aufgaben, die noch in der Auswahl sind.
    const ids = new Set(this._contestModules().map((m) => m.id));
    const seconds = Object.fromEntries(Object.entries(this._contestSeconds).filter(([id, v]) => ids.has(id) && v));
    return {
      companionSettings: {
        jokerMax: num('linkJokerMax'),
        penaltyStart: num('linkPenaltyStart'),
        penaltyMax: num('linkPenaltyMax'),
      },
      contestSettings: {
        maxPoints: num('linkContestMaxPoints') ?? 1000,
        defaultSeconds: num('linkContestSeconds') ?? 30,
        sound: document.getElementById('linkContestSound').checked,
        seconds,
      },
    };
  }

  // ---------- Auswahlbaum ----------

  /**
   * Zeigt Themen, ihre Module und – sofern vorhanden – deren Submodule als
   * Baum mit Checkboxen. "Ganzes Thema" nimmt auch später ergänzte Module
   * automatisch mit; sonst gilt genau das, was angehakt ist.
   */
  _renderTree() {
    const topics = this._usableTopics || [];
    this._treeBox.innerHTML = '';

    if (topics.length === 0) {
      this._treeBox.innerHTML = '<div class="empty-state"><p>Noch keine Lernthemen angelegt.</p></div>';
      return;
    }

    let foreignHeaderDone = false;
    for (const topic of topics) {
      // Fremde Themen stehen hinten und bekommen eine eigene Überschrift.
      if (!topic.isOwn && !foreignHeaderDone) {
        foreignHeaderDone = true;
        const head = document.createElement('div');
        head.className = 'link-tree-section';
        head.textContent = '🔗 Zur Nutzung erworben';
        this._treeBox.appendChild(head);
      }
      const modules = (topic.modules || []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
      const roots = modules.filter((m) => !m.parentId);
      const entry = this._selection.get(topic.id);

      const node = document.createElement('div');
      node.className = 'link-tree-topic';
      node.innerHTML = `
        <div class="link-tree-topic-head">
          <label class="link-tree-check">
            <input type="checkbox" class="chk-topic-all" ${entry?.all ? 'checked' : ''} />
            <strong>${escapeHtml(topic.title)}</strong>
          </label>
          ${topic.isOwn ? '' : `<span class="link-tree-owner" title="Inhalt einer anderen Lehrkraft – Ergebnisse landen trotzdem bei dir">von ${escapeHtml(topic.ownerName || 'Unbekannt')}</span>`}
          <span class="link-tree-count">${roots.length} Modul(e)</span>
          <button type="button" class="btn btn-secondary btn-sm btn-toggle-modules">Module zeigen</button>
        </div>
        <div class="link-tree-modules hidden"></div>`;

      const modulesBox = node.querySelector('.link-tree-modules');
      const chkAll = node.querySelector('.chk-topic-all');

      const ensureEntry = () => {
        if (!this._selection.has(topic.id)) {
          this._selection.set(topic.id, { all: false, moduleIds: new Set() });
        }
        return this._selection.get(topic.id);
      };

      const renderModules = () => {
        modulesBox.innerHTML = '';
        const sel = this._selection.get(topic.id);
        for (const root of roots) {
          const kids = modules.filter((m) => m.parentId === root.id);
          const row = document.createElement('div');
          row.className = 'link-tree-module';
          row.innerHTML = `
            <label class="link-tree-check">
              <input type="checkbox" class="chk-module" value="${escapeAttr(root.id)}"
                ${sel?.all || sel?.moduleIds.has(root.id) ? 'checked' : ''} ${sel?.all ? 'disabled' : ''} />
              <span>${escapeHtml(root.title)}</span>
            </label>
            ${kids.length ? '<div class="link-tree-submodules"></div>' : ''}`;

          row.querySelector('.chk-module').addEventListener('change', (e) => {
            const cur = ensureEntry();
            if (e.target.checked) cur.moduleIds.add(root.id);
            else cur.moduleIds.delete(root.id);
            this._updateSelectionSummary();
          });

          const subBox = row.querySelector('.link-tree-submodules');
          for (const kid of kids) {
            const sub = document.createElement('label');
            sub.className = 'link-tree-check link-tree-subcheck';
            sub.innerHTML = `
              <input type="checkbox" class="chk-submodule" value="${escapeAttr(kid.id)}"
                ${sel?.all || sel?.moduleIds.has(kid.id) ? 'checked' : ''} ${sel?.all ? 'disabled' : ''} />
              <span>${escapeHtml(kid.title)}</span>`;
            sub.querySelector('input').addEventListener('change', (e) => {
              const cur = ensureEntry();
              if (e.target.checked) cur.moduleIds.add(kid.id);
              else cur.moduleIds.delete(kid.id);
              this._updateSelectionSummary();
            });
            subBox.appendChild(sub);
          }

          modulesBox.appendChild(row);
        }
      };

      chkAll.addEventListener('change', (e) => {
        const cur = ensureEntry();
        cur.all = e.target.checked;
        if (cur.all) cur.moduleIds = new Set();
        if (!cur.all && cur.moduleIds.size === 0) this._selection.delete(topic.id);
        renderModules();
        this._updateSelectionSummary();
      });

      node.querySelector('.btn-toggle-modules').addEventListener('click', (e) => {
        const hidden = modulesBox.classList.toggle('hidden');
        e.target.textContent = hidden ? 'Module zeigen' : 'Module verbergen';
        if (!hidden) renderModules();
      });

      // Bereits einzeln gewählte Module sofort sichtbar machen.
      if (entry && !entry.all && entry.moduleIds.size > 0) {
        modulesBox.classList.remove('hidden');
        node.querySelector('.btn-toggle-modules').textContent = 'Module verbergen';
        renderModules();
      }

      this._treeBox.appendChild(node);
    }

    this._updateSelectionSummary();
  }

  _buildSelection() {
    const out = [];
    for (const [topicId, entry] of this._selection) {
      if (entry.all) out.push({ topicId, all: true });
      else if (entry.moduleIds.size > 0) out.push({ topicId, all: false, moduleIds: [...entry.moduleIds] });
    }
    return out;
  }

  _updateSelectionSummary() {
    if (!this._selectionSummary) return;
    const selection = this._buildSelection();
    const topics = this._usableTopics || [];
    let modules = 0;
    for (const entry of selection) {
      const topic = topics.find((t) => t.id === entry.topicId);
      modules += entry.all
        ? (topic?.modules || []).filter((m) => !m.parentId).length
        : entry.moduleIds.length;
    }
    this._selectionSummary.textContent = selection.length === 0
      ? 'Noch nichts ausgewählt.'
      : `${selection.length} Thema/Themen · ${modules} Aufgabe(n) ausgewählt`;
    if (this._selectedModes().includes('contest')) this._renderContestTimes();
    this._applySuggestedTags();
  }

  /** Tags der gewählten Themen und Module (bei ganzem Thema: aller seiner Module). */
  _suggestedTags() {
    const topics = this._usableTopics || [];
    const out = new Set();
    for (const entry of this._buildSelection()) {
      const topic = topics.find((t) => t.id === entry.topicId);
      if (!topic) continue;
      (topic.tagIds || []).forEach((id) => out.add(id));
      const chosen = new Set(entry.all ? (topic.modules || []).map((m) => m.id) : entry.moduleIds);
      for (const m of topic.modules || []) {
        if (chosen.has(m.id)) (m.tagIds || []).forEach((id) => out.add(id));
      }
    }
    return out;
  }

  /**
   * Übernimmt die Tags der Auswahl als Vorgabe. Kommt Inhalt dazu, kommen
   * seine Tags dazu; fällt er weg, gehen nur die automatisch gesetzten Tags
   * mit. Was die Lehrkraft selbst angehakt oder abgewählt hat, bleibt so.
   * Beim Bearbeiten gilt die gespeicherte Auswahl als Ausgangspunkt – das
   * Öffnen allein ändert nichts.
   */
  _applySuggestedTags() {
    const suggested = this._suggestedTags();
    if (this._autoTags === null) {
      this._autoTags = this._editId ? suggested : new Set();
      if (this._editId) return;
    }
    const current = new Set(this._tagPicker.selectedIds);
    const before = this._autoTags;
    // Ein vorgeschlagener Tag, den die Lehrkraft abgewählt hat, bleibt abgewählt.
    this._dismissedTags = this._dismissedTags || new Set();
    for (const id of before) if (!current.has(id)) this._dismissedTags.add(id);

    let changed = false;
    for (const id of before) {
      if (!suggested.has(id) && current.delete(id)) changed = true;
    }
    for (const id of suggested) {
      if (!before.has(id) && !this._dismissedTags.has(id) && !current.has(id)) {
        current.add(id);
        changed = true;
      }
    }
    this._autoTags = new Set([...suggested].filter((id) => current.has(id)));
    if (changed) this._tagPicker.render([...current]);
  }

  // ---------- Speichern ----------

  async _onSubmit(e) {
    e.preventDefault();
    const name = this._nameInput.value.trim();
    const modes = this._selectedModes();
    const selection = this._buildSelection();

    if (!name) { this.app.showToast('Bitte einen Namen eingeben.', 'error'); return; }
    if (modes.length === 0) { this.app.showToast('Bitte mindestens einen Modus auswählen.', 'error'); return; }
    if (selection.length === 0) { this.app.showToast('Bitte mindestens ein Thema oder Modul auswählen.', 'error'); return; }

    const tagIds = this._tagPicker.selectedIds;
    const password = this._passwordInput.value.trim();

    const payload = { name, modes, selection, tagIds, singleAttempt: !!this._chkSingle.checked, ...this._modeSettingsPayload() };
    // Beim Bearbeiten bleibt ein vorhandenes Passwort bestehen, solange das
    // Feld leer ist – sonst würde man es beim Umbenennen versehentlich löschen.
    if (!this._editId || password) payload.accessPassword = password;

    try {
      const res = this._editId
        ? await this.app.api.updateLink(this._editId, payload)
        : await this.app.api.createLink(payload);
      if (!res || !res.id) {
        this.app.showToast(res?.message || 'Speichern fehlgeschlagen.', 'error');
        return;
      }
      this.app.showToast(this._editId ? 'Freigabe gespeichert.' : 'Freigabe angelegt.', 'success');
      this._closeEditor();
      await this.refresh();
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
    }
  }

  // ---------- Quiz-Arena ----------

  /**
   * Leitungs-Link (für die Lehrkraft, z. B. am Beamer) und Schüler-Link.
   * Beide gibt es auch als HTML-Datei, die beim Öffnen sofort hinspringt.
   */
  async _openContestDialog(link) {
    const res = await this.app.api.contestShareLink(link.id).catch(() => null);
    if (!res || !res.hostUrl) {
      this.app.showToast(res?.message || 'Quiz-Arena-Links konnten nicht erzeugt werden.', 'error');
      return;
    }
    document.getElementById('contestShareOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'contestShareOverlay';
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card quicklink-card">
        <h3>🏆 Quiz-Arena – ${escapeHtml(res.name)}</h3>

        <div class="form-group">
          <label>1. Wartebereich öffnen (für dich, z. B. am Beamer)</label>
          <div class="quicklink-url-row">
            <input type="text" readonly value="${escapeAttr(res.hostUrl)}" class="contest-host-url" />
            <button type="button" class="btn btn-secondary btn-sm" data-copy="${escapeAttr(res.hostUrl)}">📋</button>
          </div>
          <div class="form-actions" style="margin-top:8px;">
            <a class="btn btn-primary btn-sm" href="${escapeAttr(res.hostUrl)}" target="_blank" rel="noopener">▶️ Wartebereich öffnen</a>
            <button type="button" class="btn btn-secondary btn-sm" data-save="host">💾 Als Startdatei speichern</button>
          </div>
          <span class="hint">Wer diesen Link hat, kann die Quiz-Arena leiten – nicht an Schüler weitergeben.
            Die Startdatei kannst du z. B. auf dem Desktop des Beamer-PCs ablegen.</span>
        </div>

        <div class="form-group">
          <label>2. Schüler machen mit (wird auch im Wartebereich groß angezeigt)</label>
          <div class="quicklink-qr-row"><div class="quicklink-qr">${res.qrSvg || ''}</div></div>
          <div class="quicklink-url-row">
            <input type="text" readonly value="${escapeAttr(res.joinUrl)}" />
            <button type="button" class="btn btn-secondary btn-sm" data-copy="${escapeAttr(res.joinUrl)}">📋</button>
            <button type="button" class="btn btn-secondary btn-sm" data-save="join" title="HTML-Datei, die den Schüler-Link öffnet">💾</button>
          </div>
        </div>

        <div class="confirm-actions">
          <button type="button" class="btn btn-secondary" data-regen title="Alter Leitungs-Link und Startdatei werden ungültig">🔄 Leitungs-Link erneuern</button>
          <button type="button" class="btn btn-primary" data-close>Fertig</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
    overlay.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.copy);
          this.app.showToast('Link kopiert', 'success');
        } catch (_) {
          this.app.showToast('Bitte mit Strg+C kopieren', 'info');
        }
      });
    });
    overlay.querySelector('[data-save="host"]').addEventListener('click', () =>
      saveRedirectFile(res.hostUrl, `Quiz-Arena ${res.name} – Leitung`, `QuizArena_${res.name}_Leitung`));
    overlay.querySelector('[data-save="join"]').addEventListener('click', () =>
      saveRedirectFile(res.joinUrl, `Quiz-Arena ${res.name} – mitmachen`, `QuizArena_${res.name}_Schueler`));
    overlay.querySelector('[data-regen]').addEventListener('click', async () => {
      if (!(await this.app.appConfirm('Leitungs-Link erneuern? Der alte Link und gespeicherte Startdateien funktionieren dann nicht mehr.'))) return;
      const again = await this.app.api.contestShareLink(link.id, true).catch(() => null);
      if (!again?.hostUrl) {
        this.app.showToast(again?.message || 'Erneuern fehlgeschlagen.', 'error');
        return;
      }
      overlay.remove();
      this._openContestDialog(link);
      this.app.showToast('Neuer Leitungs-Link erzeugt.', 'success');
    });
  }

  // ---------- Versenden ----------

  /** Hat die Freigabe Übungsmodi (Quiz, Lernen mit Lösungen, Lernbegleitung)? */
  _hasPractice(link) {
    return (link.modes || []).some((m) => PRACTICE_MODES.includes(m));
  }

  /** access: 'practice' (Link & QR) oder 'exam' (eigener Link der Klassenarbeit). */
  async _openShareDialog(link, access = 'practice') {
    this._bindShareDialog();
    this._shareLink = link;
    this._shareAccess = access;
    const texts = SHARE_TEXTS[access];
    document.getElementById('linkShareTitle').textContent = texts.title;
    document.getElementById('linkShareHint').textContent = texts.hint;
    const overlay = document.getElementById('linkShareOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    await this._loadShare(false);
  }

  async _loadShare(regenerate) {
    const qrBox = document.getElementById('linkShareQr');
    const urlBox = document.getElementById('linkShareUrl');
    const info = document.getElementById('linkShareInfo');
    const warning = document.getElementById('linkShareWarning');

    qrBox.innerHTML = '<p class="hint">Wird erzeugt…</p>';
    urlBox.value = '';
    warning.classList.add('hidden');

    try {
      const res = await this.app.api.shareLink(this._shareLink.id, regenerate, this._shareAccess);
      if (!res || !res.url) throw new Error(res?.message || 'Link konnte nicht erzeugt werden.');

      this._shareData = res;
      const modeNames = (res.modes || []).map((m) => LINK_MODE_LABELS[m]?.label || m).join(', ');
      info.textContent = `${res.name} · ${res.moduleCount} Aufgabe(n) · ${modeNames}`;
      urlBox.value = res.url;
      // QR-SVG kommt vom eigenen Server (qrcode-Bibliothek), kein Fremdinhalt.
      qrBox.innerHTML = res.qrSvg || '<p class="hint">QR-Code nicht verfügbar – bitte den Link verwenden.</p>';
    } catch (err) {
      this._shareData = null;
      qrBox.innerHTML = '';
      info.textContent = this._shareLink.name;
      warning.textContent = err.message;
      warning.classList.remove('hidden');
    }
  }

  _bindShareDialog() {
    if (this._shareBound) return;
    this._shareBound = true;

    const overlay = document.getElementById('linkShareOverlay');
    const urlBox = document.getElementById('linkShareUrl');

    urlBox?.addEventListener('focus', () => urlBox.select());
    urlBox?.addEventListener('click', () => urlBox.select());

    document.getElementById('btnCloseLinkShare')?.addEventListener('click', () => overlay.classList.add('hidden'));

    document.getElementById('btnCopyLinkShareUrl')?.addEventListener('click', async () => {
      const url = this._shareData?.url;
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        this.app.showToast('Link kopiert', 'success');
      } catch (_) {
        urlBox.select();
        this.app.showToast('Bitte mit Strg+C kopieren', 'info');
      }
    });

    document.getElementById('btnCopyLinkShareQr')?.addEventListener('click', async () => {
      const ok = await copyQrSvgAsPng(document.querySelector('#linkShareQr svg'));
      this.app.showToast(
        ok ? 'QR-Code kopiert' : 'QR-Code kopieren klappt hier nicht – bitte drucken oder den Link nutzen.',
        ok ? 'success' : 'error',
      );
    });

    // Dasselbe Blatt wie beim Drucken, nur als Bild fuer die Zwischenablage.
    document.getElementById('btnCopyLinkShareSheet')?.addEventListener('click', async () => {
      const ok = await copyShareSheetAsPng({
        title: SHARE_TEXTS[this._shareAccess || 'practice'].title.replace(/^\S+\s/, ''),
        subtitle: document.getElementById('linkShareInfo')?.textContent || '',
        svg: document.querySelector('#linkShareQr svg'),
        url: this._shareData?.url || '',
      });
      this.app.showToast(
        ok ? 'Blatt als Bild kopiert – in OneNote einfügen mit Strg+V.' : 'Als Bild kopieren klappt hier nicht – bitte drucken.',
        ok ? 'success' : 'error',
      );
    });

    document.getElementById('btnPrintLinkShare')?.addEventListener('click', () => {
      document.body.classList.add('printing-quicklink');
      const cleanup = () => {
        document.body.classList.remove('printing-quicklink');
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
      setTimeout(cleanup, 2000);
    });

    document.getElementById('btnRegenLinkShare')?.addEventListener('click', async () => {
      const ok = await this.app.appConfirm(
        'Neuen Link erzeugen? Bereits verteilte Links und QR-Codes funktionieren danach nicht mehr.',
      );
      if (ok) await this._loadShare(true);
    });

    document.getElementById('btnRevokeLinkShare')?.addEventListener('click', async () => {
      const ok = await this.app.appConfirm(
        'Link zurückziehen? Schüler kommen danach nicht mehr hinein, der Eintrag bleibt aber erhalten.',
      );
      if (!ok) return;
      await this.app.api.revokeLink(this._shareLink.id, this._shareAccess);
      overlay.classList.add('hidden');
      this.app.showToast('Link zurückgezogen', 'info');
      this.refresh();
    });
  }
}
