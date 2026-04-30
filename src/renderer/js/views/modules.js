import { escapeHtml, escapeAttr, generateId } from '../utils.js';
import { ModuleDescriptionEditor } from '../desc-editor.js';

// ==================== MODULES VIEW ====================

export class ModulesView {
  constructor(app) {
    this.app = app;

    this._modulesList      = document.getElementById('modulesList');
    this._searchModules    = document.getElementById('searchModules');
    this._filterType       = document.getElementById('filterType');
    this._btnCreate        = document.getElementById('btnCreateModule');
    this._btnImport        = document.getElementById('btnImportModules');
    this._btnExportTopic   = document.getElementById('btnExportCurrentTopic');
    this._btnExportH5p     = document.getElementById('btnExportModulesAsH5p');
    this._btnTransfer      = document.getElementById('btnTransferModules');
    this._btnBack          = document.getElementById('backToTopics');
    this._importOverlay    = document.getElementById('importModulesOverlay');
    this._importModulesList = document.getElementById('importModulesList');
    this._importBtnCancel  = document.getElementById('importModulesBtnCancel');
    this._importBtnOk      = document.getElementById('importModulesBtnOk');
    this._transferOverlay  = document.getElementById('transferModulesOverlay');
    this._transferTopicList = document.getElementById('transferTopicList');
    this._transferHint     = document.getElementById('transferModulesHint');
    this._transferBtnMove  = document.getElementById('transferModulesBtnMove');
    this._transferBtnCopy  = document.getElementById('transferModulesBtnCopy');
    this._transferBtnCancel = document.getElementById('transferModulesBtnCancel');
    this._moduleForm       = document.getElementById('moduleForm');
    this._moduleIdInput    = document.getElementById('moduleId');
    this._moduleTitleInput = document.getElementById('moduleTitleInput');
    this._moduleTypeSelect = document.getElementById('moduleType');
    this._btnCancelModule  = document.getElementById('btnCancelModule');
    this._createViewTitle  = document.getElementById('createViewTitle');
    this._playerTitle      = document.getElementById('playerTitle');
    this._h5pContainer     = document.getElementById('h5pContainer');
    this._btnBackFromPlayer = document.getElementById('btnBackFromPlayer');

    this._pendingImportModules = [];
    this._transferSelectedIds  = [];
    this._transferTargetId     = null;

    this._descEditor = new ModuleDescriptionEditor();
    this._descEditor.init();

    this._bindEvents();
  }

  _bindEvents() {
    if (this._searchModules) this._searchModules.addEventListener('input', () => this.refresh());
    if (this._filterType) this._filterType.addEventListener('change', () => this.refresh());

    if (this._btnBack) {
      this._btnBack.addEventListener('click', () => {
        this.app.state.currentTopicId = null;
        this.app.state.currentTopicRawSummary = null;
        this._updateToolbarForTopicMode();
        this.app.navigateToView('teacher-topics');
      });
    }

    if (this._btnCreate) {
      this._btnCreate.addEventListener('click', () => {
        this._resetModuleForm();
        this.app.navigateToView('create-module');
      });
    }

    if (this._btnExportTopic) {
      this._btnExportTopic.addEventListener('click', async () => {
        if (!this.app.state.currentTopicId) return;
        const result = await this.app.api.exportTopic(this.app.state.currentTopicId);
        if (result.success) this.app.showToast(t('topics.exported'), 'success');
      });
    }

    if (this._btnExportH5p) {
      this._btnExportH5p.addEventListener('click', async () => {
        if (!this.app.state.currentTopicId) return;
        const result = await this.app.api.exportSelectedModulesAsH5p(this.app.state.currentTopicId);
        if (result.success) {
          const msg = result.exported === result.total
            ? `📦 ${result.exported} Modul(e) als H5P exportiert!`
            : `📦 ${result.exported} von ${result.total} Modul(en) exportiert.`;
          this.app.showToast(result.errors && result.errors.length > 0 ? msg + ` (${result.errors.length} Fehler)` : msg, 'success');
        } else if (result.error) {
          this.app.showToast('❌ H5P-Export fehlgeschlagen: ' + result.error, 'error');
        }
      });
    }

    // Import Modules — must be called synchronously in click handler to open file dialog
    if (this._btnImport) {
      this._btnImport.addEventListener('click', () => {
        if (!this.app.state.currentTopicId) {
          this.app.showToast('Bitte zuerst ein Thema öffnen.', 'error');
          return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const formData = new FormData();
          formData.append('file', file);
          formData.append('topicId', this.app.state.currentTopicId);
          const token = this.app.authStore.getToken();
          const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
          try {
            const res = await fetch('/api/interchange/import-json', { method: 'POST', headers, body: formData });
            const data = await res.json();
            if (data.success) {
              this.app.showToast(`${data.importedCount} Modul(e) importiert.`, 'success');
              await this.loadTopicModules(this.app.state.currentTopicId);
            } else {
              this.app.showToast('Import fehlgeschlagen: ' + (data.message || 'Unbekannter Fehler'), 'error');
            }
          } catch (err) {
            this.app.showToast('Import fehlgeschlagen: ' + err.message, 'error');
          }
        };
        input.click();
      });
    }

    if (this._importBtnCancel) {
      this._importBtnCancel.addEventListener('click', () => {
        this._importOverlay.classList.add('hidden');
        this._pendingImportModules = [];
      });
    }
    if (this._importBtnOk) {
      this._importBtnOk.addEventListener('click', async () => {
        const checked = this._importModulesList.querySelectorAll('input[type=checkbox]:checked');
        const selectedIds = new Set([...checked].map((cb) => cb.dataset.modId));
        const selected = this._pendingImportModules.filter((m) => selectedIds.has(m.id));
        if (selected.length === 0) { this.app.showToast('Keine Module ausgewählt.', 'error'); return; }
        const result = await this.app.api.confirmImportModules(this.app.state.currentTopicId, selected);
        this._importOverlay.classList.add('hidden');
        this._pendingImportModules = [];
        if (result && result.success) {
          this.app.showToast(`${selected.length} Modul(e) importiert.`, 'success');
          await this.loadTopicModules(this.app.state.currentTopicId);
        } else {
          this.app.showToast('Import fehlgeschlagen.', 'error');
        }
      });
    }

    if (this._btnTransfer) {
      this._btnTransfer.addEventListener('click', () => this._openTransferDialog());
    }
    if (this._transferBtnCancel) {
      this._transferBtnCancel.addEventListener('click', () => { this._transferOverlay.classList.add('hidden'); });
    }
    if (this._transferBtnMove) {
      this._transferBtnMove.addEventListener('click', () => this._handleTransfer('move'));
    }
    if (this._transferBtnCopy) {
      this._transferBtnCopy.addEventListener('click', () => this._handleTransfer('copy'));
    }

    if (this._moduleTypeSelect) {
      this._moduleTypeSelect.addEventListener('change', () => {
        const typeId = this._moduleTypeSelect.value;
        if (typeId && H5P_TYPES[typeId]) {
          const existing = this.app.state.editingModuleId
            ? (this.app.state.currentTopicModules.find((m) => m.id === this.app.state.editingModuleId) || {}).content || {}
            : {};
          this.app.state.contentEditor.render(typeId, existing);
        } else {
          this.app.state.contentEditor.clear();
        }
      });
    }

    if (this._moduleForm) {
      this._moduleForm.addEventListener('submit', (e) => this._onModuleFormSubmit(e));
    }
    if (this._btnCancelModule) {
      this._btnCancelModule.addEventListener('click', () => {
        this._resetModuleForm();
        this.app.navigateToView('teacher-modules');
      });
    }

    if (this._btnBackFromPlayer) {
      this._btnBackFromPlayer.addEventListener('click', () => {
        this._h5pContainer.innerHTML = '';
        const { currentUser } = this.app.state;
        if (currentUser && currentUser.role !== 'student') this.app.navigateToView('teacher-modules');
        else this.app.navigateToView('student-quiz');
      });
    }
  }

  populateTypeSelects() {
    const types = getH5pTypesArray();
    if (this._moduleTypeSelect) {
      this._moduleTypeSelect.innerHTML = '<option value="">— Modultyp wählen —</option>';
      for (const t of types) {
        const opt = document.createElement('option');
        opt.value = t.id; opt.textContent = `${t.icon} ${t.name}`;
        this._moduleTypeSelect.appendChild(opt);
      }
    }
    if (this._filterType) {
      this._filterType.innerHTML = '<option value="">Alle Typen</option>';
      for (const t of types) {
        const opt = document.createElement('option');
        opt.value = t.id; opt.textContent = `${t.icon} ${t.name}`;
        this._filterType.appendChild(opt);
      }
    }
  }

  async openTopicModules(topicId) {
    this.app.state.currentTopicId = topicId;
    this.app.state.currentTopicModules = await this.app.api.getTopicModules(topicId);
    this.app.navigateToView('teacher-modules');
  }

  async loadTopicModules(topicId) {
    this.app.state.currentTopicId = topicId;
    this.app.state.currentTopicModules = await this.app.api.getTopicModules(topicId);
    this.refresh();
  }

  _updateToolbarForTopicMode() {
    const { currentTopicId, currentTopicRawSummary } = this.app.state;
    const isRaw = !!currentTopicRawSummary;
    if (this._btnCreate) this._btnCreate.style.display = (!currentTopicId || isRaw) ? 'none' : '';
    if (this._btnImport) this._btnImport.style.display = (!currentTopicId || isRaw) ? 'none' : '';
    if (this._btnTransfer) this._btnTransfer.style.display = (!currentTopicId || isRaw) ? 'none' : '';
    if (this._btnExportH5p) this._btnExportH5p.style.display = (!currentTopicId || isRaw) ? 'none' : '';
    if (this._btnExportTopic) this._btnExportTopic.style.display = currentTopicId ? '' : 'none';
  }

  async refresh() {
    const { state } = this.app;
    const { currentTopicId } = state;

    this._updateToolbarForTopicMode();

    if (!currentTopicId) {
      this._modulesList.innerHTML = '<div class="empty-state"><span class="empty-icon">📂</span><p>Bitte wählen Sie zuerst ein Lernthema.</p></div>';
      return;
    }

    const topic = state.topics.find((t) => t.id === currentTopicId);
    const rawSummary = topic && topic.h5pImportMode === 'raw' ? (topic.h5pRawSummary || state.currentTopicRawSummary) : null;
    state.currentTopicRawSummary = rawSummary || null;
    this._updateToolbarForTopicMode();

    if (rawSummary) {
      const search = (this._searchModules.value || '').toLowerCase().trim();
      let items = Array.isArray(rawSummary.items) ? rawSummary.items : [];
      if (search) {
        items = items.filter((item) =>
          (item.title || '').toLowerCase().includes(search) ||
          (item.library || '').toLowerCase().includes(search)
        );
      }
      this._modulesList.innerHTML = '';
      const info = document.createElement('div');
      info.className = 'empty-state'; info.style.marginBottom = '12px';
      info.innerHTML = `<span class="empty-icon">📦</span><p>RAW-H5P-Projekt: Inhalt wird read-only angezeigt.</p>`;
      this._modulesList.appendChild(info);
      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = `<span class="empty-icon">🔍</span><p>Keine Inhalte gefunden.</p>`;
        this._modulesList.appendChild(empty);
        return;
      }
      items.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'module-card module-card-disabled';
        card.innerHTML = `
          <div class="module-card-icon">📄</div>
          <div class="module-card-info">
            <div class="module-card-title">${escapeHtml(item.title || `Inhalt ${idx + 1}`)}</div>
            <div class="module-card-meta">
              <span class="module-card-type">${escapeHtml((item.library || '').split(' ')[0] || rawSummary.mainLibrary || 'H5P')}</span>
            </div>
          </div>
          <div class="module-card-actions">
            <button class="btn btn-secondary btn-sm" disabled>Nur Anzeige</button>
          </div>`;
        this._modulesList.appendChild(card);
      });
      return;
    }

    state.currentTopicModules = await this.app.api.getTopicModules(currentTopicId);
    const search = (this._searchModules.value || '').toLowerCase().trim();
    const typeFilter = this._filterType ? this._filterType.value : '';
    let filtered = state.currentTopicModules;
    if (search) filtered = filtered.filter((m) => m.title.toLowerCase().includes(search) || (m.description && m.description.toLowerCase().includes(search)));
    if (typeFilter) filtered = filtered.filter((m) => m.type === typeFilter);

    this._modulesList.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = state.currentTopicModules.length === 0
        ? `<span class="empty-icon">📭</span><p>Noch keine Module in diesem Thema.</p>`
        : `<span class="empty-icon">🔍</span><p>Keine Module gefunden.</p>`;
      this._modulesList.appendChild(empty);
      return;
    }

    // Select/Deselect All Buttons
    const selectAllRow = document.createElement('div');
    selectAllRow.style.cssText = 'display:flex; justify-content:flex-end; gap:12px; margin-bottom:10px;';
    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'btn btn-secondary btn-sm'; selectAllBtn.textContent = 'Alle auswählen';
    const deselectAllBtn = document.createElement('button');
    deselectAllBtn.className = 'btn btn-secondary btn-sm'; deselectAllBtn.textContent = 'Alle abwählen';
    selectAllBtn.addEventListener('click', async () => {
      const ids = filtered.map((m) => m.id);
      await this.app.api.bulkToggleModules(currentTopicId, ids, true);
      this.app.showToast('Alle Module aktiviert', 'info'); this.refresh();
    });
    deselectAllBtn.addEventListener('click', async () => {
      const ids = filtered.map((m) => m.id);
      await this.app.api.bulkToggleModules(currentTopicId, ids, false);
      this.app.showToast('Alle Module deaktiviert', 'info'); this.refresh();
    });
    selectAllRow.appendChild(selectAllBtn); selectAllRow.appendChild(deselectAllBtn);
    this._modulesList.appendChild(selectAllRow);

    const canReorder = !search && !typeFilter;
    let dragSrcCard = null;

    for (let fi = 0; fi < filtered.length; fi++) {
      const mod = filtered[fi];
      const typeDef = H5P_TYPES[mod.type] || {};
      const isSelected = mod.moduleSelected !== false;
      const card = document.createElement('div');
      card.className = `module-card ${isSelected ? '' : 'module-card-disabled'}`;
      card.dataset.moduleId = mod.id;
      card.innerHTML = `
        ${canReorder ? '<div class="module-drag-handle" title="Reihenfolge ändern">☰</div>' : ''}
        <span class="module-card-number">${fi + 1}.</span>
        <input type="checkbox" class="module-select-checkbox" title="Modul für Schüler aktivieren" ${isSelected ? 'checked' : ''} />
        <div class="module-card-icon">${typeDef.icon || '📦'}</div>
        <div class="module-card-info">
          <div class="module-card-title">${escapeHtml(mod.title)}</div>
          <div class="module-card-meta">
            <span class="module-card-type">${typeDef.name || mod.type}</span>
            ${mod.createdAt ? new Date(mod.createdAt).toLocaleDateString('de-DE') : ''}
          </div>
        </div>
        <div class="module-card-actions">
          <button class="btn btn-secondary btn-sm btn-preview" title="Vorschau">▶ Vorschau</button>
          <button class="btn btn-secondary btn-sm btn-edit" title="Bearbeiten">✏️ Bearbeiten</button>
          <button class="btn btn-danger btn-sm btn-delete" title="Löschen">🗑</button>
        </div>`;

      if (canReorder) {
        const handle = card.querySelector('.module-drag-handle');
        handle.addEventListener('mousedown', () => { card.draggable = true; });
        card.addEventListener('dragstart', (e) => { dragSrcCard = card; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', mod.id); });
        card.addEventListener('dragend', () => { card.draggable = false; card.classList.remove('dragging'); dragSrcCard = null; this._modulesList.querySelectorAll('.module-card').forEach((c) => c.classList.remove('drag-over')); });
        card.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragSrcCard && dragSrcCard !== card) { this._modulesList.querySelectorAll('.module-card').forEach((c) => c.classList.remove('drag-over')); card.classList.add('drag-over'); } });
        card.addEventListener('dragleave', () => { card.classList.remove('drag-over'); });
        card.addEventListener('drop', async (e) => {
          e.preventDefault(); card.classList.remove('drag-over');
          if (!dragSrcCard || dragSrcCard === card) return;
          const cards = [...this._modulesList.querySelectorAll('.module-card')];
          const srcIdx = cards.indexOf(dragSrcCard); const dstIdx = cards.indexOf(card);
          if (srcIdx < dstIdx) card.after(dragSrcCard); else card.before(dragSrcCard);
          this._modulesList.querySelectorAll('.module-card .module-card-number').forEach((el, i) => { el.textContent = `${i + 1}.`; });
          const newOrder = [...this._modulesList.querySelectorAll('.module-card[data-module-id]')].map((c) => c.dataset.moduleId);
          await this.app.api.reorderModules(currentTopicId, newOrder);
        });
      }

      card.querySelector('.module-select-checkbox').addEventListener('change', async (e) => {
        await this.app.api.toggleModuleSelection(currentTopicId, mod.id, e.target.checked);
        mod.moduleSelected = e.target.checked;
        card.classList.toggle('module-card-disabled', !e.target.checked);
      });
      card.querySelector('.btn-preview').addEventListener('click', () => this._openPlayer(mod));
      card.querySelector('.btn-edit').addEventListener('click', () => this._openEditor(mod));
      card.querySelector('.btn-delete').addEventListener('click', () => this._deleteModule(mod));
      this._modulesList.appendChild(card);
    }
  }

  _openPlayer(mod) {
    const typeDef = H5P_TYPES[mod.type] || {};
    this._playerTitle.textContent = mod.title;
    this.app.navigateToView('player');
    this._h5pContainer.innerHTML = '';
    this.app.renderer.renderPreview(mod, typeDef, this._h5pContainer);
  }

  _openEditor(mod) {
    this.app.state.editingModuleId = mod.id;
    this._createViewTitle.textContent = t('module.edit.title');
    this._moduleIdInput.value = mod.id;
    this._moduleTitleInput.value = mod.title;
    this._moduleTypeSelect.value = mod.type;
    this._descEditor.setHtml(mod.description || '');
    this.app.navigateToView('create-module');
    this.app.state.contentEditor.render(mod.type, mod.content || {});
  }

  async _deleteModule(mod) {
    if (!(await this.app.appConfirm(t('modules.delete.confirm', { title: mod.title })))) return;
    const result = await this.app.api.deleteModule(this.app.state.currentTopicId, mod.id);
    if (result.success) {
      this.app.showToast(t('modules.deleted'), 'info');
      this.app.state.currentTopicModules = await this.app.api.getTopicModules(this.app.state.currentTopicId);
      this.refresh();
    }
  }

  _resetModuleForm() {
    this.app.state.editingModuleId = null;
    this._moduleIdInput.value = '';
    this._moduleTitleInput.value = '';
    this._moduleTypeSelect.value = '';
    this._descEditor.setHtml('');
    this.app.state.contentEditor.clear();
    this._createViewTitle.textContent = t('module.create.title');
  }

  async _onModuleFormSubmit(e) {
    e.preventDefault();
    const { state, api } = this.app;
    if (!state.currentTopicId) { this.app.showToast(t('module.missing.topic'), 'error'); return; }

    const title = this._moduleTitleInput.value.trim();
    const type  = this._moduleTypeSelect.value;
    const description = this._descEditor.getHtml().trim();

    if (!title || !type) { this.app.showToast(t('module.missing.fields'), 'error'); return; }

    const content = state.contentEditor.collectData();
    const existing = state.editingModuleId ? state.currentTopicModules.find((m) => m.id === state.editingModuleId) : null;

    const moduleData = {
      id: state.editingModuleId || generateId(),
      title, type, description, content,
      moduleSelected: existing ? existing.moduleSelected : true,
      createdAt: existing ? (existing.createdAt || new Date().toISOString()) : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await api.saveModule(state.currentTopicId, moduleData);
    if (result.success) {
      this.app.showToast(state.editingModuleId ? t('module.updated') : t('module.saved'), 'success');
      state.currentTopicModules = await api.getTopicModules(state.currentTopicId);
      this._resetModuleForm();
      this.app.navigateToView('teacher-modules');
    } else {
      this.app.showToast(t('module.save.error'), 'error');
    }
  }

  _openTransferDialog() {
    const { state } = this.app;
    const { currentTopicId, currentTopicModules, topics } = state;
    if (!currentTopicId) return;

    this._transferSelectedIds = currentTopicModules.filter((m) => m.moduleSelected !== false).map((m) => m.id);
    if (this._transferSelectedIds.length === 0) {
      this.app.showToast('Keine Module ausgewählt. Bitte aktiviere Module in der Übersicht.', 'error');
      return;
    }

    const available = topics.filter((t) => t.id !== currentTopicId);
    this._transferTopicList.innerHTML = '';
    this._transferTargetId = null;
    this._transferBtnMove.disabled = true;
    this._transferBtnCopy.disabled = true;

    if (available.length === 0) {
      this._transferTopicList.innerHTML = '<div class="empty-state"><p>Keine anderen Lernthemen verfügbar.</p></div>';
    } else {
      for (const topic of available) {
        const item = document.createElement('div');
        item.className = 'import-module-item'; item.style.cursor = 'pointer';
        item.innerHTML = `
          <input type="radio" name="transferTarget" value="${topic.id}" id="transfer_tgt_${topic.id}" style="cursor:pointer;" />
          <label for="transfer_tgt_${topic.id}" style="cursor:pointer; flex:1; padding-left:10px;">
            <span class="import-module-title">📚 ${escapeHtml(topic.title)}</span>
          </label>`;
        item.addEventListener('click', () => {
          item.querySelector('input').checked = true;
          this._transferTargetId = topic.id;
          this._transferBtnMove.disabled = false; this._transferBtnCopy.disabled = false;
        });
        item.querySelector('input').addEventListener('change', (e) => {
          if (e.target.checked) { this._transferTargetId = topic.id; this._transferBtnMove.disabled = false; this._transferBtnCopy.disabled = false; }
        });
        this._transferTopicList.appendChild(item);
      }
    }
    this._transferHint.textContent = `${this._transferSelectedIds.length} Modul(e) ausgewählt. Wähle das Ziel-Thema aus:`;
    this._transferOverlay.classList.remove('hidden');
  }

  async _handleTransfer(mode) {
    if (!this._transferTargetId || this._transferSelectedIds.length === 0) return;
    const { state, api } = this.app;
    const result = await api.transferModules(state.currentTopicId, this._transferTargetId, this._transferSelectedIds, mode);
    if (result && result.success) {
      this.app.showToast(`${result.count} Modul(e) erfolgreich ${mode === 'move' ? 'verschoben' : 'kopiert'}.`, 'success');
    } else {
      this.app.showToast('Ein Fehler ist aufgetreten: ' + (result?.error || 'Unbekannt'), 'error');
    }
    this._transferOverlay.classList.add('hidden');
    state.topics = await api.getTopics();
    this.app.topicsView.refresh();
    state.currentTopicModules = await api.getTopicModules(state.currentTopicId);
    this.refresh();
  }
}
