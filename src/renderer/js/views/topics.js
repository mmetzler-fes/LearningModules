import { escapeHtml, escapeAttr, showImportReport } from '../utils.js';
import { pickClass } from './classes.js';
import { TagFilter, TagPicker, renderAreaGroups, orderByArea, chipHtml } from './tags.js';
import { helpHint } from './help-view.js';

// ==================== TOPICS VIEW ====================

/** Lernthemen je Seite – mehr Karten auf einmal machen die Ansicht träge. */
const TOPICS_PER_PAGE = 10;

/** Letzte Änderung an einem Thema oder einem seiner Module (ms, 0 = unbekannt). */
function lastChange(topic) {
  let latest = Date.parse(topic.updatedAt) || 0;
  for (const m of topic.modules || []) latest = Math.max(latest, Date.parse(m.updatedAt) || 0);
  return latest;
}

export class TopicsView {
  constructor(app) {
    this.app = app;

    this._topicsList      = document.getElementById('topicsList');
    this._formContainer   = document.getElementById('topicFormContainer');
    this._form            = document.getElementById('topicForm');
    this._formTitle       = document.getElementById('topicFormTitle');
    this._titleInput      = document.getElementById('topicTitle');
    this._descInput       = document.getElementById('topicDescription');
    this._btnNew          = document.getElementById('btnNewTopic');
    this._btnImport       = document.getElementById('btnImportTopic');
    this._btnImportH5p    = document.getElementById('btnImportH5p');
    this._btnExportH5p    = document.getElementById('btnExportH5p');
    this._btnCancel       = document.getElementById('btnCancelTopic');
    this._subscribeKeyEl  = document.getElementById('topicSubscribeKey');
    this._exportOverlay   = document.getElementById('exportH5pTopicOverlay');
    this._exportList      = document.getElementById('exportH5pTopicList');
    this._exportBtnCancel = document.getElementById('exportH5pBtnCancel');
    this._section         = document.getElementById('view-teacher-topics');
    this._tagPicker       = new TagPicker(app, document.getElementById('topicTags'));

    this._filter = new TagFilter(app, {
      searchInput: document.getElementById('topicTagSearch'),
      chipList: document.getElementById('topicTagFilterChips'),
      modeToggle: document.getElementById('topicTagFilterAll'),
      // Filtern ändert nur die Anzeige – kein erneutes Laden vom Server.
      onChange: () => { this._page = 0; this._render(); },
    });
    this._page = 0;

    this._bindEvents();
  }

  _bindEvents() {
    document.getElementById('btnH5pTypes')?.addEventListener('click', () => this._openH5pTypes());
    document.getElementById('btnAiPrompt')?.addEventListener('click', () => this.app.navigateToView('teacher-ai-prompt'));
    if (this._btnNew) {
      this._btnNew.addEventListener('click', () => {
        this.app.state.editingTopicId = null;
        this._formTitle.textContent = t('topics.form.new');
        this._titleInput.value = '';
        this._descInput.value = '';
        if (this._subscribeKeyEl) this._subscribeKeyEl.value = '';
        this._tagPicker.render([]);
        this._showForm();
      });
    }

    if (this._btnImport) {
      this._btnImport.addEventListener('click', async () => {
        const result = await this.app.api.importTopic();
        if (result.success) {
          this.app.showToast(t('topics.import.success', { title: result.topicTitle || 'Thema', count: result.importedCount }), 'success');
          showImportReport(result);
          this.refresh();
        } else if (result.error) {
          this.app.showToast(t('topics.import.error') + result.error, 'error');
        }
      });
    }

    if (this._btnImportH5p) {
      this._btnImportH5p.addEventListener('click', async () => {
        const result = await this.app.api.importH5p({ importMode: 'native' });
        if (result.success) {
          this.app.showToast(`🎉 H5P "${result.topicTitle}" importiert — ${result.importedCount} Modul(e) angelegt!`, 'success');
          this.refresh();
        } else if (result.error) {
          this.app.showToast('❌ H5P-Import fehlgeschlagen: ' + result.error, 'error');
        }
      });
    }

    if (this._btnExportH5p) {
      this._btnExportH5p.addEventListener('click', () => this._onExportH5p());
    }

    if (this._exportBtnCancel) {
      this._exportBtnCancel.addEventListener('click', () => {
        this._exportOverlay.classList.add('hidden');
      });
    }

    if (this._btnCancel) {
      this._btnCancel.addEventListener('click', () => {
        this._hideForm();
        this.app.state.editingTopicId = null;
      });
    }

    if (this._form) {
      this._form.addEventListener('submit', (e) => this._onFormSubmit(e));
    }
  }

  async refresh() {
    this.refreshSharedTopics();
    // Themen und Tags gleichzeitig laden statt nacheinander.
    await Promise.all([this.app.loadTopics(), this.app.loadTags()]);
    this._filter.render();
    this._hideForm();
    this._render();
    this._renderStats();
  }

  /** Kleine Zahlenleiste über den Themen (früher das Dashboard). */
  async _renderStats() {
    const topics = this.app.state.topics || [];
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('statTopics', topics.length);
    set('statModules', topics.reduce((sum, t) => sum + (t.modules || []).length, 0));
    set('statActive', topics.filter((t) => t.selected).length);
    try {
      const results = await this.app.api.getQuizResults();
      set('statResults', Array.isArray(results) ? results.length : 0);
    } catch (_) { /* Zahl bleibt stehen */ }
  }

  /** Übersicht der H5P-Modultypen (früher auf dem Dashboard). */
  _openH5pTypes() {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card h5p-types-card">
        <h3>${escapeHtml(t('dashboard.types.title'))}</h3>
        <div class="type-grid">${getH5pTypesArray().map((type) => `
          <div class="type-card">
            <div class="type-card-icon">${type.icon}</div>
            <div class="type-card-name">${escapeHtml(type.name)}</div>
            <div class="type-card-desc">${escapeHtml(type.description)}</div>
          </div>`).join('')}
        </div>
        <div class="confirm-actions"><button type="button" class="btn btn-primary btn-close">Schließen</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.btn-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  /**
   * Zeichnet die Liste aus den geladenen Themen: Filter anwenden, dann eine
   * Seite mit höchstens TOPICS_PER_PAGE Karten. Geprüft werden dabei nur die
   * Tags der Themen selbst.
   */
  _render() {
    const all = this.app.state.topics || [];
    // Der Filter schränkt nur die Anzeige ein – "Alle auswählen" unten bezieht
    // sich deshalb bewusst auf die gerade sichtbaren Themen.
    // Geblättert wird Themengebiet für Themengebiet, darin das zuletzt
    // geänderte Thema zuerst – so ist ein Gebiet nie über Seiten verstreut.
    const matching = orderByArea(
      all.filter((topic) => this._filter.matches(topic))
        .map((topic) => [lastChange(topic), topic])
        .sort((a, b) => b[0] - a[0])
        .map(([, topic]) => topic),
      this.app.state.tags,
      true,
    );
    const pages = Math.max(1, Math.ceil(matching.length / TOPICS_PER_PAGE));
    this._page = Math.min(Math.max(0, this._page || 0), pages - 1);
    const topics = matching.slice(this._page * TOPICS_PER_PAGE, (this._page + 1) * TOPICS_PER_PAGE);
    this._topicsList.innerHTML = '';

    if (topics.length > 0) {
      const selectAllRow = document.createElement('div');
      selectAllRow.style.cssText = 'display:flex; justify-content:flex-end; gap:12px; margin-bottom:10px;';

      const selectAllBtn = document.createElement('button');
      selectAllBtn.className = 'btn btn-secondary btn-sm';
      selectAllBtn.textContent = 'Alle auswählen';
      selectAllBtn.title = 'Alle Lernthemen aktivieren';

      const deselectAllBtn = document.createElement('button');
      deselectAllBtn.className = 'btn btn-secondary btn-sm';
      deselectAllBtn.textContent = 'Alle abwählen';
      deselectAllBtn.title = 'Alle Lernthemen deaktivieren';

      selectAllBtn.addEventListener('click', async () => {
        for (const topic of matching) { if (!topic.selected) await this.app.api.toggleTopicSelection(topic.id, true); }
        this.app.showToast('Alle Lernthemen aktiviert', 'info');
        this.refresh();
      });
      deselectAllBtn.addEventListener('click', async () => {
        for (const topic of matching) { if (topic.selected) await this.app.api.toggleTopicSelection(topic.id, false); }
        this.app.showToast('Alle Lernthemen deaktiviert', 'info');
        this.refresh();
      });

      selectAllRow.appendChild(selectAllBtn);
      selectAllRow.appendChild(deselectAllBtn);
      this._topicsList.appendChild(selectAllRow);
    }

    if (topics.length === 0) {
      this._topicsList.innerHTML = all.length === 0
        ? '<div class="empty-state"><span class="empty-icon">📂</span><p>Noch keine Lernthemen erstellt.</p></div>'
        : '<div class="empty-state"><span class="empty-icon">🏷</span><p>Kein Thema passt zum gewählten Filter.</p></div>';
      if (this._btnExportH5p) this._btnExportH5p.disabled = true;
      return;
    }

    // Blättern oben und unten, damit man bei langen Seiten nicht scrollen muss.
    if (pages > 1) this._topicsList.appendChild(this._pager(matching.length, pages));

    // Mit Themengebieten gegliedert und aufklappbar; bei aktivem Tag-Filter
    // ist alles offen, damit kein Treffer im zugeklappten Abschnitt steckt.
    const grouped = renderAreaGroups(this._topicsList, topics, {
      tags: this.app.state.tags,
      scope: 'topics',
      respectHidden: true,
      expandAll: this._filter.selectedIds.length > 0,
      buildItem: (topic, areaId) => this._buildCard(topic, areaId),
      countLabel: (n) => (n === 1 ? '1 Lernthema' : `${n} Lernthemen`),
    });
    if (!grouped) for (const topic of topics) this._topicsList.appendChild(this._buildCard(topic));
    if (pages > 1) this._topicsList.appendChild(this._pager(matching.length, pages));

    if (this._btnExportH5p) {
      this._btnExportH5p.disabled = !topics.some(
        (t) => t.h5pImportMode !== 'raw' && (t.modules || []).some((m) => m.moduleSelected !== false)
      );
    }
  }

  /** Blättern: ← Zurück · Seite x von y · Weiter →. */
  _pager(count, pages) {
    const from = this._page * TOPICS_PER_PAGE + 1;
    const to = Math.min(count, (this._page + 1) * TOPICS_PER_PAGE);
    const bar = document.createElement('div');
    bar.className = 'topics-pager';
    bar.innerHTML = `
      <button class="btn btn-secondary btn-sm" data-dir="-1" ${this._page === 0 ? 'disabled' : ''}>← Zurück</button>
      <span class="topics-pager-info">Seite ${this._page + 1} von ${pages} · Lernthemen ${from}–${to} von ${count}</span>
      <button class="btn btn-secondary btn-sm" data-dir="1" ${this._page >= pages - 1 ? 'disabled' : ''}>Weiter →</button>`;
    bar.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._page += Number(btn.dataset.dir);
        this._render();
        this._topicsList.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    return bar;
  }

  /** Karte eines Lernthemas mit allen Aktionen. */
  /** areaId: Themengebiet des Abschnitts – sein Tag steht schon in der Überschrift. */
  _buildCard(topic, areaId = null) {
    const isRawTopic = topic.h5pImportMode === 'raw';
    const moduleCount = isRawTopic
      ? (topic.h5pRawSummary && topic.h5pRawSummary.itemCount) || 0
      : (topic.modules || []).length;
    const { currentUser } = this.app.state;
    const card = document.createElement('div');
    card.className = `topic-card ${topic.selected ? 'topic-active' : 'topic-inactive'}`;
    card.innerHTML = `
      <div class="topic-card-header">
        <div class="topic-card-info">
          <h3 class="topic-card-title">${escapeHtml(topic.title)}</h3>
          <p class="topic-card-desc">${escapeHtml(topic.description || '')}</p>
          ${this._originLine(topic)}
          <div class="topic-card-meta">
            <span class="topic-module-count">${moduleCount} Module</span>
            ${isRawTopic ? '<span class="topic-status" style="background:#eef2ff; color:#3730a3;">RAW H5P</span>' : ''}
            <span class="topic-status ${topic.selected ? 'active' : 'inactive'}">${topic.selected ? '✅ Aktiv' : '❌ Inaktiv'}</span>
            ${this._rightsBadges(topic)}
          </div>
          <div class="topic-card-tags">${this._renderTagChips(topic.tagIds, areaId)}</div>
        </div>
        <div class="topic-card-actions">
          <label class="toggle-switch" title="Für Schüler freigeben">
            <input type="checkbox" class="topic-toggle" data-topic-id="${topic.id}" ${topic.selected ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
          <button class="btn btn-primary btn-sm btn-open-topic" title="Module verwalten">📦 Module</button>
          <button class="btn btn-secondary btn-sm btn-quick-link"
            title="${topic.selected ? 'Link + QR-Code für eine Klasse' : 'Noch nicht freigegeben – beim Klick lässt es sich gleich freigeben'}">🔗 Quick-Link</button>
          <button class="btn btn-secondary btn-sm btn-edit-topic" title="Bearbeiten">✏️</button>
          <button class="btn btn-secondary btn-sm btn-share-topic" title="Im Shop anbieten oder weitergeben">👥</button>
          <button class="btn btn-secondary btn-sm btn-export-topic" title="Exportieren (JSON, H5P oder verschlüsselt)">📤</button>
          <button class="btn btn-danger btn-sm btn-delete-topic" title="Löschen">🗑</button>
        </div>
      </div>`;

    // Teilen läuft über den Shop – der Knopf führt direkt zum Angebot für dieses Thema.
    card.querySelector('.btn-share-topic').addEventListener('click', () => this.app.shopView.openForTopic(topic.id));
    card.querySelector('.topic-toggle').addEventListener('change', async (e) => {
      await this.app.api.toggleTopicSelection(topic.id, e.target.checked);
      this.app.showToast(e.target.checked ? t('topics.activated') : t('topics.deactivated'), 'info');
      this.refresh();
    });
    card.querySelector('.btn-open-topic').addEventListener('click', () => this.app.modulesView.openTopicModules(topic.id));
    card.querySelector('.btn-quick-link').addEventListener('click', () => this._createQuickClassLink(topic));
    card.querySelector('.btn-edit-topic').addEventListener('click', () => this._openEditor(topic));
    card.querySelector('.btn-export-topic').addEventListener('click', () => this.openExportDialog(topic));
    card.querySelector('.btn-delete-topic').addEventListener('click', async () => {
      if (await this.deleteTopic(topic)) this.refresh();
    });

    return card;
  }

  /**
   * Thema nach Rückfrage löschen; true, wenn gelöscht. Wer das Thema per
   * "Use" verwendet, verliert es mit – das gehört vor die Entscheidung.
   */
  async deleteTopic(topic) {
    const paid = topic.paidUseCount || 0;
    const free = (topic.useCount || 0) - paid;
    const users = [
      paid ? `${paid} Person${paid === 1 ? ' hat' : 'en haben'} für die Nutzung bezahlt und bekomm${paid === 1 ? 't' : 'en'} automatisch eine eigene Kopie.` : '',
      free ? `${free} Person${free === 1 ? ' verwendet' : 'en verwenden'} dieses Thema kostenlos über den Shop und verlier${free === 1 ? 't' : 'en'} es.` : '',
    ].filter(Boolean).map((x) => `\n\n${x}`).join('');
    if (!(await this.app.appConfirm(t('topics.delete.confirm', { title: topic.title }) + users))) return false;
    const res = await this.app.api.deleteTopic(topic.id);
    this.app.showToast(res?.preservedCopies
      ? `${t('topics.deleted')} ${res.preservedCopies} Käufer hab${res.preservedCopies === 1 ? '' : 'en'} eine eigene Kopie erhalten.`
      : t('topics.deleted'), 'info');
    return true;
  }

  // ==================== QUICK-LINK ====================

  /**
   * Quick-Link: Klassen wählen (oder anlegen), daraus entsteht je Klasse ein
   * Klassenlink für das ganze Thema – Parallelklassen in einem Rutsch.
   * Danach geht es zur Klassenübersicht der Schülerfreigaben; bei einer
   * Klasse sind Link und QR-Code gleich offen. Früher verteilte Quick-Links
   * (?q=) bleiben gültig, ihre Ergebnisse stehen unter "ohne Klasse".
   */
  async _createQuickClassLink(topic) {
    // Ein ausgegrauter Knopf erklärte nicht, was fehlt – gerade bei frisch
    // erworbenen Kopien, die gesperrt beginnen. Deshalb hier nachfragen.
    if (!topic.selected) {
      const ok = await this.app.appConfirm(
        `„${topic.title}" ist noch nicht für Schüler freigegeben. Ein Quick-Link führt erst nach der Freigabe zum Thema.\n\nJetzt freigeben und den Quick-Link erstellen?`,
      );
      if (!ok) return;
      await this.app.api.toggleTopicSelection(topic.id, true);
      topic.selected = true;
      this.refresh();
    }
    const classes = await pickClass(this.app, {
      title: `🔗 Quick-Link – ${topic.title}`,
      hint: 'Für welche Klassen? Ergebnisse über einen Link stehen dann unter seiner Klasse.',
      multiple: true,
    });
    if (!classes || !classes.length) return;
    await this.app.linksView.createClassLinks(classes, (klasse) => this.app.api.classLinkFromTopic(topic.id, klasse.id), 'practice');
  }

  /**
   * Beim Bearbeiten nur das Formular zeigen. Es steht am Ende der Seite -
   * bei vielen Themen landete es weit unterhalb des sichtbaren Bereichs und
   * wirkte, als waere nichts passiert.
   */
  _showForm() {
    this._formContainer.classList.remove('hidden');
    this._section?.classList.add('topic-editing');
    this._formContainer.scrollIntoView({ block: 'start', behavior: 'smooth' });
    this._titleInput?.focus();
  }

  _hideForm() {
    this._formContainer.classList.add('hidden');
    this._section?.classList.remove('topic-editing');
  }


  _renderTagChips(tagIds, skipId = null) {
    const byId = new Map((this.app.state.tags || []).map((t) => [t.id, t]));
    return (tagIds || [])
      .filter((id) => id !== skipId)
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((tag) => chipHtml(tag))
      .join('');
  }

  /**
   * Abzeichen zu Rechten und Shop: wie viel selbst verfasst ist, von wem der
   * Rest stammt, was im Shop steht und wer das Thema verwendet.
   */
  _rightsBadges(topic) {
    const out = [];
    const own = topic.ownModuleCount || 0;
    const foreign = topic.foreignModuleCount || 0;
    if (foreign > 0) {
      out.push(`<span class="topic-shared-badge" title="Creator bleibt verzeichnet – du bist Buyer dieser Module">✍️ ${own} eigene · ${foreign} von ${escapeHtml((topic.foreignCreators || []).join(', '))}</span>`);
    }
    const co = topic.creatorOffer;
    if (co && co.active) {
      const modes = [
        co.allowUse ? `Use ${co.priceUse ? co.priceUse + ' P' : 'frei'}` : null,
        co.allowCopy ? `Copy ${co.priceCopy ? co.priceCopy + ' P' : 'frei'}` : null,
      ].filter(Boolean).join(' · ');
      out.push(`<span class="topic-shared-badge owner">🛒 im Shop: ${modes}</span>`);
    }
    const bs = topic.buyerShare;
    if (bs && bs.active) {
      out.push(`<span class="topic-shared-badge use">↪ zur Nutzung weitergegeben</span>`);
    }
    if (topic.useCount > 0) {
      out.push(`<span class="topic-shared-badge use" title="So viele verwenden das Thema über ein Nutzungsrecht">🔗 von ${topic.useCount} verwendet</span>`);
    }
    if (topic.copyCount > 0) {
      out.push(`<span class="topic-shared-badge" title="So oft wurde eine eigene Fassung erworben">📋 ${topic.copyCount}× kopiert</span>`);
    }
    return out.join('');
  }

  // ==================== EXPORT ====================

  /**
   * Export eines Themas. Unverschlüsselt (JSON, H5P) verlassen nur die selbst
   * verfassten Module die App; das ganze Thema samt fremden Modulen gibt es
   * nur verschlüsselt mit dem Masterkey.
   */
  async openExportDialog(topic) {
    let info;
    try {
      info = await this.app.api.getExportInfo(topic.id);
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
      return;
    }
    if (!info || typeof info.ownModules !== 'number') {
      this.app.showToast('Fehler: ' + (info?.message || 'Export nicht möglich'), 'error');
      return;
    }
    const own = info.ownModules;
    const foreign = info.foreignModules;

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card" style="min-width:420px; max-width:560px">
        <h3>📤 Exportieren: <em>${escapeHtml(info.title)}</em> ${helpHint('moodle-und-h5p#ausgeben', 'Hilfe: Exportieren als Moodle-XML und H5P')}</h3>
        ${foreign > 0 && own > 0 ? `<p class="login-error">⚠️ Dieses Thema enthält ${foreign} fremde${foreign === 1 ? 's' : ''} Modul${foreign === 1 ? '' : 'e'}.
          Unverschlüsselt werden nur deine ${own} eigenen exportiert.</p>` : ''}
        ${own === 0 ? '<p class="login-error">Dieses Thema enthält keine von dir verfassten Module – es lässt sich nur verschlüsselt exportieren.</p>' : ''}
        <div class="settings-group">
          <h3>Offen – nur eigene Module (${own})</h3>
          <p class="hint">Zum Weitergeben außerhalb der App oder für andere H5P-Plattformen.</p>
          <div class="confirm-actions" style="justify-content:flex-start">
            <button class="btn btn-secondary" id="btnExpJson" ${own ? '' : 'disabled'}>📤 JSON</button>
            <button class="btn btn-secondary" id="btnExpH5p" ${own ? '' : 'disabled'}>📦 H5P</button>
            <button class="btn btn-secondary" id="btnExpMoodle" ${own ? '' : 'disabled'} title="Fragensammlung für Moodle-Tests (Moodle-XML)">🎓 Moodle-XML</button>
          </div>
        </div>
        <div class="settings-group" style="margin-top:14px">
          <h3>🔒 Verschlüsselt – ganzes Thema (${own + foreign})</h3>
          <p class="hint">Zur Sicherung. Lässt sich nur in einer App mit demselben Masterkey und nur von dir wieder einlesen;
            die Creator der Module bleiben dabei verzeichnet.</p>
          <div class="confirm-actions" style="justify-content:flex-start">
            <button class="btn btn-primary" id="btnExpEnc" ${info.canExportEncrypted ? '' : 'disabled title="Nur für eigene Themen"'}>🔒 Verschlüsselt exportieren</button>
          </div>
        </div>
        <div class="confirm-actions">
          <button class="btn btn-secondary" id="btnExpClose">Schließen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#btnExpClose').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const run = async (fn, okMsg) => {
      const res = await fn();
      if (res && res.success) { this.app.showToast(okMsg, 'success'); close(); }
      else this.app.showToast('Export fehlgeschlagen: ' + (res?.error || '?'), 'error');
    };
    overlay.querySelector('#btnExpJson').addEventListener('click', () => run(() => this.app.api.exportTopic(topic.id), t('topics.exported')));
    overlay.querySelector('#btnExpH5p').addEventListener('click', async () => {
      const res = await this.app.api.exportTopicAsH5p(topic.id);
      if (!res || !res.success) { this.app.showToast('Export fehlgeschlagen: ' + (res?.error || '?'), 'error'); return; }
      this.app.showToast(`📦 H5P-Fragenset mit ${res.count ?? ''} Frage(n) exportiert.`, 'success');
      close();
      showImportReport({ skipped: res.skipped || [], notes: res.notes || [] }, '📋 Export-Bericht');
    });
    overlay.querySelector('#btnExpMoodle').addEventListener('click', async () => {
      const res = await this.app.api.exportTopicAsMoodle(topic.id);
      if (!res || !res.success) { this.app.showToast('Export fehlgeschlagen: ' + (res?.error || '?'), 'error'); return; }
      this.app.showToast(`🎓 ${res.count ?? ''} Moodle-Frage(n) exportiert – in Moodle unter Fragensammlung → Import → Moodle-XML einlesen.`, 'success');
      close();
      showImportReport({ skipped: res.skipped || [], notes: res.notes || [] }, '📋 Export-Bericht');
    });
    overlay.querySelector('#btnExpEnc').addEventListener('click', () => run(() => this.app.api.exportTopicEncrypted(topic.id), '🔒 Verschlüsselt exportiert'));
  }

  /**
   * Herkunftszeile einer Kopie. Reine Nennung, kein Zugriffsrecht – und vom
   * neuen Eigentümer nicht abstellbar, weil der Server die Felder gar nicht
   * erst zum Ändern annimmt.
   */
  _originLine(topic) {
    const origin = topic && topic.origin;
    if (!origin) return '';
    const title = origin.title ? `„${escapeHtml(origin.title)}"` : 'einem Thema';
    return `<p class="topic-card-desc" style="opacity:.75; font-size:.85em">
      📋 Kopie von ${title} · Ursprung: ${escapeHtml(origin.author)}</p>`;
  }

  _openEditor(topic) {
    this.app.state.editingTopicId = topic.id;
    this._formTitle.textContent = t('topics.form.edit');
    this._titleInput.value = topic.title;
    this._descInput.value = topic.description || '';
    if (this._subscribeKeyEl) this._subscribeKeyEl.value = topic.subscribeKey || '';
    this._tagPicker.render(topic.tagIds || []);
    this._showForm();
  }

  async _onFormSubmit(e) {
    e.preventDefault();
    const title = this._titleInput.value.trim();
    if (!title) return;

    const { state, api } = this.app;
    const { topics } = state;

    const topicData = {
      id: state.editingTopicId || ('topic_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6)),
      title,
      description: this._descInput.value.trim(),
      subscribeKey: this._subscribeKeyEl ? (this._subscribeKeyEl.value.trim() || null) : undefined,
      tagIds: this._tagPicker.selectedIds,
      selected: state.editingTopicId ? (topics.find((t) => t.id === state.editingTopicId) || {}).selected || false : false,
      createdAt: state.editingTopicId ? (topics.find((t) => t.id === state.editingTopicId) || {}).createdAt || new Date().toISOString() : new Date().toISOString(),
    };

    await api.saveTopic(topicData, !!state.editingTopicId);
    this.app.showToast(state.editingTopicId ? t('topics.updated') : t('topics.created'), 'success');
    this._hideForm();
    state.editingTopicId = null;
    this.refresh();
  }

  _onExportH5p() {
    const { topics } = this.app.state;
    const exportable = topics.filter(
      (t) => t.h5pImportMode !== 'raw' && (t.modules || []).some((m) => m.moduleSelected !== false)
    );
    if (exportable.length === 0) return;

    if (exportable.length === 1) {
      this.openExportDialog(exportable[0]);
      return;
    }

    this._exportList.innerHTML = '';
    for (const topic of exportable) {
      const activeCount = (topic.modules || []).filter((m) => m.moduleSelected !== false).length;
      const item = document.createElement('div');
      item.className = 'import-module-item';
      item.style.justifyContent = 'space-between';
      item.innerHTML = `
        <div>
          <span class="import-module-title">📚 ${escapeHtml(topic.title)}</span>
          <span class="import-module-type">${activeCount} aktive Modul${activeCount !== 1 ? 'e' : ''}</span>
        </div>
        <button class="btn btn-primary btn-sm">📦 Exportieren</button>`;
      item.querySelector('button').addEventListener('click', () => {
        this._exportOverlay.classList.add('hidden');
        this.openExportDialog(topic);
      });
      this._exportList.appendChild(item);
    }
    this._exportOverlay.classList.remove('hidden');
  }

  // ==================== ZUR NUTZUNG ERWORBEN ====================

  async refreshSharedTopics() {
    const section = document.getElementById('sharedTopicsSection');
    const list = document.getElementById('sharedTopicsList');
    if (!section || !list) return;

    let topics = [];
    try {
      topics = await this.app.api.getGrantedTopics();
    } catch (_) { topics = []; }
    if (!Array.isArray(topics) || topics.length === 0) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    list.innerHTML = '';
    for (const t of topics) list.appendChild(this._grantedTopicCard(t));
  }

  /**
   * Karte eines Themas mit Nutzungsrecht: ansehen, eigener Quick-Link,
   * zurückgeben. Bearbeiten gibt es hier nicht – dafür im Shop eine Kopie.
   */
  _grantedTopicCard(entry) {
    const card = document.createElement('div');
    card.className = 'topic-card topic-shared';
    const paid = entry.grants.reduce((n, g) => n + (g.pricePaid || 0), 0);
    const openRefund = entry.grants.map((g) => g.refundUntil && new Date(g.refundUntil)).filter((d) => d && d.getTime() >= Date.now()).sort((a, b) => a - b)[0];
    const refundBadge = openRefund
      ? `<span class="topic-shared-badge" title="Bis dahin gibt es beim Zurückgeben die Punkte zurück">↩ Rückgabe mit Erstattung bis ${openRefund.toLocaleDateString('de-DE')}</span>`
      : '';
    card.innerHTML = `
      <div class="topic-card-header">
        <div class="topic-card-info">
          <h3 class="topic-card-title">${escapeHtml(entry.title)}</h3>
          <p class="topic-card-desc">${escapeHtml(entry.description || '')}</p>
          ${this._originLine(entry)}
          <div class="topic-card-meta">
            <span class="topic-module-count">${entry.moduleCount} Module</span>
            <span class="topic-shared-badge" style="margin-left:8px">von ${escapeHtml(entry.ownerName)}</span>
            <span class="topic-shared-badge" title="Creator der Module">✍️ ${entry.creators.map(escapeHtml).join(', ')}</span>
            <span class="topic-shared-badge use">${paid ? `🪙 ${paid} Punkte bezahlt` : 'kostenlos'}</span>
            ${refundBadge}
          </div>
        </div>
        <div class="topic-card-actions">
          <button class="btn btn-secondary btn-sm btn-view-shared" title="Module ansehen (nur Anzeige)">👁 Ansehen</button>
          <button class="btn btn-secondary btn-sm btn-quick-shared" title="Eigener Quick-Link auf dieses Thema – die Ergebnisse kommen zu mir">🔗 Quick-Link</button>
          <button class="btn btn-danger btn-sm btn-return-grant" title="Nutzungsrecht zurückgeben">↩ Zurückgeben</button>
        </div>
      </div>`;

    card.querySelector('.btn-view-shared').addEventListener('click', () => this._openSharedTopicViewer(entry));
    // Der Quick-Link gehört mir, nicht dem Eigentümer des Themas: Der Dialog
    // ist derselbe wie bei eigenen Themen, der Token ein eigener.
    card.querySelector('.btn-quick-shared').addEventListener('click', () =>
      this._createQuickClassLink({ id: entry.id, title: entry.title, selected: true }));

    card.querySelector('.btn-return-grant').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      if (await this.returnGrant(entry)) this.refreshSharedTopics();
      else btn.disabled = false;
    });
    return card;
  }

  /**
   * Nutzungsrecht nach Rückfrage zurückgeben; true, wenn zurückgegeben.
   * Innerhalb von 14 Tagen nach dem Kauf gibt es die Punkte zurück.
   */
  async returnGrant(entry) {
    const now = Date.now();
    const paid = entry.grants.reduce((n, g) => n + (g.pricePaid || 0), 0);
    const refundable = entry.grants.filter((g) => g.pricePaid > 0 && g.refundUntil && new Date(g.refundUntil).getTime() >= now);
    const refundSum = refundable.reduce((n, g) => n + g.pricePaid, 0);
    const until = refundable.map((g) => new Date(g.refundUntil)).sort((a, b) => a - b)[0];
    const ok = await this.app.appConfirm(
      `Nutzungsrecht an „${entry.title}" zurückgeben?\n\n` +
      (refundSum ? `Du bekommst ${refundSum} Punkte erstattet (Rückgabe mit Erstattung bis ${until.toLocaleDateString('de-DE')}). `
        : paid ? 'Die 14 Tage für eine Erstattung sind vorbei – bezahlte Punkte werden nicht erstattet. ' : '') +
      'Deine Themen- und Quick-Links liefern das Thema danach nicht mehr aus.',
    );
    if (!ok) return false;
    try {
      let refunded = 0;
      for (const g of entry.grants) {
        const res = await this.app.api.revokeGrant(g.id);
        if (!res || !res.success) throw new Error(res?.message || 'Zurückgeben fehlgeschlagen');
        refunded += res.refunded || 0;
      }
      this.app.showToast(refunded
        ? `Nutzungsrecht zurückgegeben – ${refunded} Punkte erstattet.`
        : 'Nutzungsrecht zurückgegeben', 'info');
      return true;
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
      return false;
    }
  }

  /**
   * Fremdes Thema ansehen: Modulliste im Overlay, Vorschau im selben
   * Fenster. Bewusst eine eigene, schreibfreie Ansicht statt der
   * Modulverwaltung – dort sind alle Knöpfe zum Ändern, die hier nicht
   * greifen dürfen.
   */
  async _openSharedTopicViewer(entry) {
    let topic = null;
    try {
      topic = await this.app.api.getSharedTopicView(entry.id);
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
      return;
    }
    if (!topic || !topic.id) {
      this.app.showToast('Fehler: ' + (topic?.message || 'Thema kann nicht angezeigt werden'), 'error');
      return;
    }

    const modules = Array.isArray(topic.modules) ? topic.modules : [];
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card" style="min-width:480px; max-width:820px; max-height:82vh; overflow:auto">
        <h3>👁 ${escapeHtml(topic.title)}</h3>
        <p class="hint">Thema von <strong>${escapeHtml(topic.ownerName)}</strong> – du darfst es verwenden, aber
          nicht ändern. Für eine eigene Fassung im Shop „Copy" wählen.</p>
        ${topic.origin ? `<p class="hint">📋 Kopie von „${escapeHtml(topic.origin.title || '')}" · Ursprung: ${escapeHtml(topic.origin.author)}</p>` : ''}
        <div id="sharedViewList"></div>
        <div id="sharedViewPreview" class="hidden"></div>
        <div class="confirm-actions">
          <button class="btn btn-secondary" id="btnSharedViewClose">Schließen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const listBox = overlay.querySelector('#sharedViewList');
    const previewBox = overlay.querySelector('#sharedViewPreview');

    if (modules.length === 0) {
      listBox.innerHTML = '<div class="empty-state"><span class="empty-icon">📭</span><p>Dieses Thema hat noch keine Module.</p></div>';
    }
    modules.forEach((mod, idx) => {
      const typeDef = (typeof H5P_TYPES !== 'undefined' && H5P_TYPES[mod.type]) || {};
      const item = document.createElement('div');
      item.className = 'import-module-item';
      item.style.justifyContent = 'space-between';
      item.innerHTML = `
        <div>
          <span class="import-module-title">${typeDef.icon || '📦'} ${idx + 1}. ${escapeHtml(mod.title)}</span>
          <span class="import-module-type">${escapeHtml(typeDef.name || mod.type || '')} · ✍️ ${escapeHtml(mod.creatorName || '')}</span>
        </div>
        <button class="btn btn-secondary btn-sm">▶ Vorschau</button>`;
      item.querySelector('button').addEventListener('click', () => {
        listBox.classList.add('hidden');
        previewBox.classList.remove('hidden');
        previewBox.innerHTML = '';
        const back = document.createElement('button');
        back.className = 'btn btn-secondary btn-sm';
        back.textContent = '← Zurück zur Modulliste';
        back.addEventListener('click', () => {
          previewBox.innerHTML = '';
          previewBox.classList.add('hidden');
          listBox.classList.remove('hidden');
        });
        previewBox.appendChild(back);
        const host = document.createElement('div');
        previewBox.appendChild(host);
        this.app.renderer.renderPreview(mod, typeDef, host);
      });
      listBox.appendChild(item);
    });

    const close = () => overlay.remove();
    overlay.querySelector('#btnSharedViewClose').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }
}
