import { escapeHtml, escapeAttr, copyQrSvgAsPng, copyShareSheetAsPng } from '../utils.js';
import { TagFilter, TagPicker } from './tags.js';

// ==================== TOPICS VIEW ====================

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
      onChange: () => this.refresh(),
    });

    this._bindEvents();
  }

  _bindEvents() {
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
    await this.app.loadTopics();
    await this.app.loadTags();
    this._filter.render();

    const all = this.app.state.topics;
    // Der Filter schränkt nur die Anzeige ein – "Alle auswählen" unten bezieht
    // sich deshalb bewusst auf die gerade sichtbaren Themen.
    const topics = all.filter((topic) => this._filter.matches(topic));
    this._topicsList.innerHTML = '';
    this._hideForm();

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
        for (const topic of topics) { if (!topic.selected) await this.app.api.toggleTopicSelection(topic.id, true); }
        this.app.showToast('Alle Lernthemen aktiviert', 'info');
        this.refresh();
      });
      deselectAllBtn.addEventListener('click', async () => {
        for (const topic of topics) { if (topic.selected) await this.app.api.toggleTopicSelection(topic.id, false); }
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

    for (const topic of topics) {
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
            <div class="topic-card-meta">
              <span class="topic-module-count">${moduleCount} Module</span>
              ${isRawTopic ? '<span class="topic-status" style="background:#eef2ff; color:#3730a3;">RAW H5P</span>' : ''}
              <span class="topic-status ${topic.selected ? 'active' : 'inactive'}">${topic.selected ? '✅ Aktiv' : '❌ Inaktiv'}</span>
              ${this._sharingBadges(topic)}
            </div>
            <div class="topic-card-tags">${this._renderTagChips(topic.tagIds)}</div>
          </div>
          <div class="topic-card-actions">
            <label class="toggle-switch" title="Für Schüler freigeben">
              <input type="checkbox" class="topic-toggle" data-topic-id="${topic.id}" ${topic.selected ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
            <button class="btn btn-primary btn-sm btn-open-topic" title="Module verwalten">📦 Module</button>
            <button class="btn btn-secondary btn-sm btn-quick-link" ${topic.selected ? '' : 'disabled'}
              title="${topic.selected ? 'Quick-Link für Schüler (Link + QR-Code)' : 'Erst freigeben, dann ist ein Quick-Link möglich'}">🔗 Quick-Link</button>
            <button class="btn btn-secondary btn-sm btn-edit-topic" title="Bearbeiten">✏️</button>
            <button class="btn btn-secondary btn-sm btn-share-topic" title="Mit Lehrern teilen">👥</button>
            <button class="btn btn-secondary btn-sm btn-export-topic" title="Als JSON exportieren">📤</button>
            <button class="btn btn-secondary btn-sm btn-export-h5p-topic" title="Als H5P exportieren">📦 H5P</button>
            <button class="btn btn-danger btn-sm btn-delete-topic" title="Löschen">🗑</button>
          </div>
        </div>`;

      card.querySelector('.btn-share-topic').addEventListener('click', () => this._openShareDialog(topic));
      card.querySelector('.topic-toggle').addEventListener('change', async (e) => {
        await this.app.api.toggleTopicSelection(topic.id, e.target.checked);
        this.app.showToast(e.target.checked ? t('topics.activated') : t('topics.deactivated'), 'info');
        this.refresh();
      });
      card.querySelector('.btn-open-topic').addEventListener('click', () => this.app.modulesView.openTopicModules(topic.id));
      card.querySelector('.btn-quick-link').addEventListener('click', () => this._openQuickLinkDialog(topic));
      card.querySelector('.btn-edit-topic').addEventListener('click', () => this._openEditor(topic));
      card.querySelector('.btn-export-topic').addEventListener('click', async () => {
        const result = await this.app.api.exportTopic(topic.id);
        if (result.success) this.app.showToast(t('topics.exported'), 'success');
      });
      card.querySelector('.btn-export-h5p-topic').addEventListener('click', async () => {
        const result = await this.app.api.exportTopicAsH5p(topic.id);
        if (result.success) this.app.showToast('📦 H5P exportiert!', 'success');
        else if (result.error) this.app.showToast('❌ H5P-Export fehlgeschlagen: ' + result.error, 'error');
      });
      card.querySelector('.btn-delete-topic').addEventListener('click', async () => {
        if (!(await this.app.appConfirm(t('topics.delete.confirm', { title: topic.title })))) return;
        await this.app.api.deleteTopic(topic.id);
        this.app.showToast(t('topics.deleted'), 'info');
        this.refresh();
      });

      this._topicsList.appendChild(card);
    }

    if (this._btnExportH5p) {
      this._btnExportH5p.disabled = !topics.some(
        (t) => t.h5pImportMode !== 'raw' && (t.modules || []).some((m) => m.moduleSelected !== false)
      );
    }
  }

  // ==================== QUICK-LINK ====================

  /**
   * Zeigt Link und QR-Code für ein Thema. Beim ersten Öffnen wird der Token
   * erzeugt, danach immer derselbe geliefert – ausgeteilte Zettel bleiben also
   * gültig, bis der Lehrer bewusst "Neu" oder "Zurückziehen" wählt.
   */
  async _openQuickLinkDialog(topic) {
    this._bindQuickLinkDialog();
    this._quickLinkTopic = topic;
    const overlay = document.getElementById('quickLinkOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    await this._loadQuickLink(false);
  }

  async _loadQuickLink(regenerate) {
    const topic = this._quickLinkTopic;
    const qrBox   = document.getElementById('quickLinkQr');
    const urlBox  = document.getElementById('quickLinkUrl');
    const info    = document.getElementById('quickLinkTopic');
    const warning = document.getElementById('quickLinkWarning');

    qrBox.innerHTML = '<p class="hint">Wird erzeugt…</p>';
    urlBox.value = '';

    try {
      const res = await this.app.api.createQuickLink(topic.id, regenerate);
      if (!res || !res.url) throw new Error(res?.message || 'Quick-Link konnte nicht erzeugt werden.');

      this._quickLinkData = res;
      info.textContent = `${res.title} · ${res.moduleCount} freigegebene Module`;
      urlBox.value = res.url;
      // QR-SVG kommt vom eigenen Server (qrcode-Bibliothek), kein Fremdinhalt.
      qrBox.innerHTML = res.qrSvg || '<p class="hint">QR-Code nicht verfügbar – bitte den Link verwenden.</p>';
      warning.classList.add('hidden');
      this._setQuickLinkActionsEnabled(true);
    } catch (err) {
      // Nicht freigegeben: kein Link, keine Aktionen – nur die Erklärung.
      this._quickLinkData = null;
      qrBox.innerHTML = '';
      info.textContent = topic.title;
      warning.textContent = err.message;
      warning.classList.remove('hidden');
      this._setQuickLinkActionsEnabled(false);
    }
  }

  /** Kopieren/Drucken/Neu/Zurückziehen nur sinnvoll, wenn ein Link existiert. */
  _setQuickLinkActionsEnabled(enabled) {
    for (const id of ['btnCopyQr', 'btnCopyQuickLink', 'btnCopyQuickLinkSheet', 'btnPrintQuickLink', 'btnRegenQuickLink', 'btnRevokeQuickLink']) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !enabled;
    }
  }

  async _copyQrImage() {
    const ok = await copyQrSvgAsPng(document.querySelector('#quickLinkQr svg'));
    this.app.showToast(
      ok ? 'QR-Code kopiert' : 'QR-Code kopieren klappt hier nicht – bitte drucken oder den Link nutzen.',
      ok ? 'success' : 'error',
    );
  }

  /** Dasselbe Blatt wie beim Drucken, nur als Bild für die Zwischenablage. */
  async _copyQuickLinkSheet() {
    const ok = await copyShareSheetAsPng({
      title: 'Quick-Link für Schüler',
      subtitle: document.getElementById('quickLinkTopic')?.textContent || '',
      svg: document.querySelector('#quickLinkQr svg'),
      url: this._quickLinkData?.url || '',
    });
    this.app.showToast(
      ok ? 'Blatt als Bild kopiert – in OneNote einfügen mit Strg+V.' : 'Als Bild kopieren klappt hier nicht – bitte drucken.',
      ok ? 'success' : 'error',
    );
  }

  _bindQuickLinkDialog() {
    if (this._quickLinkBound) return;
    this._quickLinkBound = true;

    const overlay = document.getElementById('quickLinkOverlay');
    const urlBox  = document.getElementById('quickLinkUrl');

    // Klick markiert den ganzen Link – bequem zum Kopieren am PC.
    urlBox?.addEventListener('focus', () => urlBox.select());
    urlBox?.addEventListener('click', () => urlBox.select());

    document.getElementById('btnCloseQuickLink')?.addEventListener('click', () => {
      overlay.classList.add('hidden');
    });

    document.getElementById('btnCopyQuickLink')?.addEventListener('click', async () => {
      const url = this._quickLinkData?.url;
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        this.app.showToast('Link kopiert', 'success');
      } catch (_) {
        urlBox.select();
        this.app.showToast('Bitte mit Strg+C kopieren', 'info');
      }
    });

    document.getElementById('btnCopyQr')?.addEventListener('click', () => this._copyQrImage());

    document.getElementById('btnCopyQuickLinkSheet')?.addEventListener('click', () => this._copyQuickLinkSheet());

    document.getElementById('btnPrintQuickLink')?.addEventListener('click', () => {
      document.body.classList.add('printing-quicklink');
      const cleanup = () => {
        document.body.classList.remove('printing-quicklink');
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
      setTimeout(cleanup, 2000);
    });

    document.getElementById('btnRegenQuickLink')?.addEventListener('click', async () => {
      const ok = await this.app.appConfirm(
        'Neuen Link erzeugen? Bereits verteilte Links und QR-Codes funktionieren danach nicht mehr.',
      );
      if (ok) await this._loadQuickLink(true);
    });

    document.getElementById('btnRevokeQuickLink')?.addEventListener('click', async () => {
      const ok = await this.app.appConfirm(
        'Quick-Link zurückziehen? Verteilte Links und QR-Codes führen danach ins Leere.',
      );
      if (!ok) return;
      await this.app.api.revokeQuickLink(this._quickLinkTopic.id);
      overlay.classList.add('hidden');
      this.app.showToast('Quick-Link zurückgezogen', 'info');
    });
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


  _renderTagChips(tagIds) {
    const byId = new Map((this.app.state.tags || []).map((t) => [t.id, t]));
    return (tagIds || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((tag) => `<span class="tag-chip" style="--tag-color:${escapeAttr(tag.color || '#4f7cff')}">${escapeHtml(tag.name)}</span>`)
      .join('');
  }

  /**
   * Abzeichen für die beiden Freigabe-Arten. Getrennt ausgewiesen, weil
   * "verwenden" und "kopieren" sehr unterschiedliche Folgen haben.
   */
  _sharingBadges(topic) {
    const out = [];
    const copy = Array.isArray(topic.sharedWith) ? topic.sharedWith : [];
    const access = Array.isArray(topic.sharedAccess) ? topic.sharedAccess : [];

    if (access.length > 0) {
      const forAll = access.some((e) => e.userId === '*');
      out.push(`<span class="topic-shared-badge use">🔗 verwendbar ${forAll ? 'für alle' : 'für ' + access.length}</span>`);
    }
    if (copy.length > 0) {
      const forAll = copy.includes('*');
      out.push(`<span class="topic-shared-badge owner">👥 kopierbar ${forAll ? 'für alle' : 'für ' + copy.length}</span>`);
    }
    return out.join('');
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
      this.app.api.exportTopicAsH5p(exportable[0].id).then((result) => {
        if (result.success) this.app.showToast('📦 H5P exportiert!', 'success');
        else if (result.error) this.app.showToast('❌ H5P-Export fehlgeschlagen: ' + result.error, 'error');
      });
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
      item.querySelector('button').addEventListener('click', async () => {
        this._exportOverlay.classList.add('hidden');
        const result = await this.app.api.exportTopicAsH5p(topic.id);
        if (result.success) this.app.showToast('📦 H5P exportiert!', 'success');
        else if (result.error) this.app.showToast('❌ H5P-Export fehlgeschlagen: ' + result.error, 'error');
      });
      this._exportList.appendChild(item);
    }
    this._exportOverlay.classList.remove('hidden');
  }

  /**
   * Freigabe. Zwei Dinge lassen sich unabhängig voneinander erlauben:
   *
   *   Verwenden – die Kollegin nimmt das Original in ihre eigenen Themen-Links.
   *               Änderungen wirken sofort bei allen, die es verwenden. Die
   *               Ergebnisse landen trotzdem bei ihr, denn dafür zählt der
   *               Eigentümer des Links.
   *   Kopieren  – sie zieht sich eine eigene Kopie und wird deren Eigentümerin.
   *               Spätere Änderungen am Original wandern nicht mit.
   *
   * Das Datenmodell kennt zusätzlich die Stufe 'write' (Module bearbeiten).
   * Sie ist hier bewusst noch nicht wählbar – siehe learning-topic.entity.ts.
   */
  async _openShareDialog(topic) {
    const { state, api } = this.app;
    const { currentUser } = state;
    const isOwner = topic.ownerId === (currentUser && currentUser.id);
    if (!isOwner && currentUser.role !== 'admin') {
      this.app.showToast('Nur der Eigentümer kann dieses Thema freigeben.', 'error');
      return;
    }

    let users = [];
    try {
      users = await api.getColleagues();
    } catch (_) {}
    if (!Array.isArray(users)) users = [];

    const copyList = Array.isArray(topic.sharedWith) ? topic.sharedWith : [];
    const accessList = Array.isArray(topic.sharedAccess) ? topic.sharedAccess : [];
    const levelOf = (id) => accessList.find((e) => e.userId === id)?.level || 'none';

    const copyAll = copyList.includes('*');
    const useAll = levelOf('*') !== 'none';

    const row = (id, label, badge) => `
      <div class="share-user-row" data-user="${escapeAttr(id)}">
        <span class="share-user-name">${badge}${escapeHtml(label)}</span>
        <label class="share-flag">
          <input type="checkbox" class="chk-use" ${levelOf(id) !== 'none' ? 'checked' : ''} />
          <span>verwenden</span>
        </label>
        <label class="share-flag">
          <input type="checkbox" class="chk-copy" ${copyList.includes(id) ? 'checked' : ''} />
          <span>kopieren</span>
        </label>
      </div>`;

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card" style="min-width:420px; max-width:560px">
        <h3>👥 Thema freigeben: <em>${escapeHtml(topic.title)}</em></h3>
        <p class="hint"><strong>Verwenden</strong> heißt: Die Kollegin nimmt dein Original in
          ihre eigenen Themen-Links. Ihre Schülerergebnisse landen bei ihr, nicht bei dir.
          Änderst du später eine Aufgabe, ändert sich ihr Quiz mit – für eine Klassenarbeit
          ist deshalb <strong>kopieren</strong> oft die ruhigere Wahl.</p>

        <div class="share-head-row">
          <span class="share-user-name"><strong>Alle Kolleginnen und Kollegen</strong></span>
          <label class="share-flag">
            <input type="checkbox" id="useAll" ${useAll ? 'checked' : ''} />
            <span>verwenden</span>
          </label>
          <label class="share-flag">
            <input type="checkbox" id="copyAll" ${copyAll ? 'checked' : ''} />
            <span>kopieren</span>
          </label>
        </div>

        <div id="shareUserList" class="share-user-list">
          ${users.length === 0
            ? '<p class="hint">Keine weiteren Lehrkräfte vorhanden.</p>'
            : users.map((u) => row(
                u.id,
                u.displayName || u.email,
                `<span class="user-role-badge ${u.role}">${u.role === 'admin' ? 'Admin' : 'Lehrer'}</span> `,
              )).join('')}
        </div>

        <div class="confirm-actions">
          <button class="btn btn-primary" id="btnShareSave">Freigabe speichern</button>
          <button class="btn btn-secondary" id="btnShareCancel">Abbrechen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const useAllBox = overlay.querySelector('#useAll');
    const copyAllBox = overlay.querySelector('#copyAll');
    const list = overlay.querySelector('#shareUserList');

    // Ist etwas für alle freigegeben, wäre die Einzelauswahl dafür
    // gegenstandslos – die betroffenen Häkchen werden deshalb gesperrt.
    const syncList = () => {
      list.querySelectorAll('.chk-use').forEach((cb) => { cb.disabled = useAllBox.checked; });
      list.querySelectorAll('.chk-copy').forEach((cb) => { cb.disabled = copyAllBox.checked; });
      list.querySelectorAll('.share-user-row').forEach((r) => {
        r.style.opacity = useAllBox.checked && copyAllBox.checked ? '0.45' : '1';
      });
    };
    useAllBox.addEventListener('change', syncList);
    copyAllBox.addEventListener('change', syncList);
    syncList();

    const close = () => overlay.remove();
    overlay.querySelector('#btnShareCancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#btnShareSave').addEventListener('click', async () => {
      const rows = [...list.querySelectorAll('.share-user-row')];

      const sharedWith = copyAllBox.checked
        ? ['*']
        : rows.filter((r) => r.querySelector('.chk-copy').checked).map((r) => r.dataset.user);

      const sharedAccess = useAllBox.checked
        ? [{ userId: '*', level: 'read' }]
        : rows
            .filter((r) => r.querySelector('.chk-use').checked)
            .map((r) => ({ userId: r.dataset.user, level: 'read' }));

      try {
        const res = await api.setTopicSharing(topic.id, { sharedWith, sharedAccess });
        if (res && res.success) {
          close();
          const anything = sharedWith.length || sharedAccess.length;
          this.app.showToast(anything ? 'Freigabe gespeichert' : 'Freigabe aufgehoben', 'success');
          await this.app.loadTopics();
          this.refresh();
        } else {
          this.app.showToast('Fehler: ' + (res?.message || res?.error || 'unbekannt'), 'error');
        }
      } catch (err) {
        this.app.showToast('Fehler beim Speichern: ' + err.message, 'error');
      }
    });
  }

  // ==================== VON KOLLEGEN FREIGEGEBEN ====================

  async refreshSharedTopics() {
    const section = document.getElementById('sharedTopicsSection');
    const list = document.getElementById('sharedTopicsList');
    if (!section || !list) return;

    let topics = [];
    try {
      topics = await this.app.api.getSharedWithMe();
    } catch (_) { topics = []; }
    if (!Array.isArray(topics) || topics.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    list.innerHTML = '';
    for (const t of topics) {
      const card = document.createElement('div');
      card.className = 'topic-card topic-shared';
      card.innerHTML = `
        <div class="topic-card-header">
          <div class="topic-card-info">
            <h3 class="topic-card-title">${escapeHtml(t.title)}</h3>
            <p class="topic-card-desc">${escapeHtml(t.description || '')}</p>
            <div class="topic-card-meta">
              <span class="topic-module-count">${t.moduleCount} Module</span>
              <span class="topic-shared-badge" style="margin-left:8px">von ${escapeHtml(t.ownerName)}</span>
              ${t.canUse ? '<span class="topic-shared-badge use" style="margin-left:6px">🔗 in eigenen Links verwendbar</span>' : ''}
            </div>
          </div>
          <div class="topic-card-actions">
            ${t.canCopy ? '<button class="btn btn-primary btn-sm btn-copy-shared">📥 Zu mir kopieren</button>' : ''}
          </div>
        </div>`;
      // Ohne Kopier-Freigabe gibt es nur den Hinweis, dass das Thema in
      // eigenen Themen-Links verwendet werden darf.
      card.querySelector('.btn-copy-shared')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const res = await this.app.api.copySharedTopic(t.id);
          if (res && res.success) {
            this.app.showToast(`"${res.title}" kopiert – du bist jetzt Eigentümer.`, 'success');
            await this.app.loadTopics();
            this.refresh();
          } else {
            this.app.showToast('Fehler: ' + (res?.message || 'Kopieren fehlgeschlagen'), 'error');
            btn.disabled = false;
          }
        } catch (err) {
          this.app.showToast('Fehler: ' + err.message, 'error');
          btn.disabled = false;
        }
      });
      list.appendChild(card);
    }
  }
}
