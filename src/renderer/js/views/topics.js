import { escapeHtml, escapeAttr } from '../utils.js';

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
    this._chkExamMode     = document.getElementById('chkExamMode');

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
        this._formContainer.classList.remove('hidden');
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
        this._formContainer.classList.add('hidden');
        this.app.state.editingTopicId = null;
      });
    }

    if (this._form) {
      this._form.addEventListener('submit', (e) => this._onFormSubmit(e));
    }

    if (this._chkExamMode) {
      this._chkExamMode.addEventListener('change', async (e) => {
        const enabled = !!e.target.checked;
        const result = await this.app.api.setExamMode(enabled);
        this.app.state.examModeEnabled = !!(result && result.enabled);
        this._chkExamMode.checked = this.app.state.examModeEnabled;
        this.app.showToast(this.app.state.examModeEnabled ? '📝 Prüfungsmodus aktiviert' : '🧠 Lernmodus aktiviert', 'info');
      });
    }
  }

  async refresh() {
    await this.app.loadTopics();
    const { topics } = this.app.state;
    this._topicsList.innerHTML = '';
    this._formContainer.classList.add('hidden');

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
      this._topicsList.innerHTML = `<div class="empty-state"><span class="empty-icon">📂</span><p>Noch keine Lernthemen erstellt.</p></div>`;
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
              ${topic.ownerId && topic.ownerId !== (currentUser && currentUser.id)
                ? '<span class="topic-shared-badge">🔗 Geteilt</span>'
                : (Array.isArray(topic.sharedWith) && topic.sharedWith.length > 0 ? '<span class="topic-shared-badge owner">👥 Freigegeben</span>' : '')}
            </div>
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
    for (const id of ['btnCopyQr', 'btnCopyQuickLink', 'btnPrintQuickLink', 'btnRegenQuickLink', 'btnRevokeQuickLink']) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !enabled;
    }
  }

  /**
   * Kopiert den QR-Code als PNG in die Zwischenablage – zum Einfügen in
   * Arbeitsblätter, Präsentationen oder Moodle. Das SVG wird dafür über ein
   * Canvas gerastert, bewusst großzügig, damit es beim Ausdrucken scharf bleibt.
   */
  async _copyQrImage() {
    const svg = document.querySelector('#quickLinkQr svg');
    if (!svg) return;

    const SIZE = 600;
    try {
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      await img.decode();

      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';           // weißer Grund, sonst scannt es schlecht
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, 0, 0, SIZE, SIZE);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG konnte nicht erzeugt werden.');

      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.app.showToast('QR-Code kopiert', 'success');
    } catch (_) {
      // Ältere Browser können keine Bilder in die Zwischenablage legen.
      this.app.showToast('QR-Code kopieren klappt hier nicht – bitte drucken oder den Link nutzen.', 'error');
    }
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
        'Quick-Link zurückziehen? Schüler können danach nur noch über die normale Anmeldung starten.',
      );
      if (!ok) return;
      await this.app.api.revokeQuickLink(this._quickLinkTopic.id);
      overlay.classList.add('hidden');
      this.app.showToast('Quick-Link zurückgezogen', 'info');
    });
  }

  _openEditor(topic) {
    this.app.state.editingTopicId = topic.id;
    this._formTitle.textContent = t('topics.form.edit');
    this._titleInput.value = topic.title;
    this._descInput.value = topic.description || '';
    if (this._subscribeKeyEl) this._subscribeKeyEl.value = topic.subscribeKey || '';
    this._formContainer.classList.remove('hidden');
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
      selected: state.editingTopicId ? (topics.find((t) => t.id === state.editingTopicId) || {}).selected || false : false,
      createdAt: state.editingTopicId ? (topics.find((t) => t.id === state.editingTopicId) || {}).createdAt || new Date().toISOString() : new Date().toISOString(),
    };

    await api.saveTopic(topicData, !!state.editingTopicId);
    this.app.showToast(state.editingTopicId ? t('topics.updated') : t('topics.created'), 'success');
    this._formContainer.classList.add('hidden');
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

  async _openShareDialog(topic) {
    const { state, api } = this.app;
    const { currentUser } = state;
    const isOwner = topic.ownerId === (currentUser && currentUser.id);
    if (!isOwner && currentUser.role !== 'admin') {
      this.app.showToast('Nur der Eigentümer oder ein Admin kann dieses Thema teilen.', 'error');
      return;
    }

    let users = [];
    try {
      const allUsers = await api.getAllUsers();
      users = allUsers.filter((u) =>
        (u.role === 'teacher' || u.role === 'admin') && u.id !== (currentUser && currentUser.id)
      );
    } catch (_) {}

    const currentShared = Array.isArray(topic.sharedWith) ? topic.sharedWith : [];
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card" style="min-width:360px; max-width:480px">
        <h3>👥 Thema teilen: <em>${escapeHtml(topic.title)}</em></h3>
        <p style="color:var(--text-secondary); font-size:0.9em; margin-bottom:12px">
          Wähle Lehrer/Admins, die dieses Thema bearbeiten dürfen:
        </p>
        <div id="shareUserList" style="display:flex; flex-direction:column; gap:8px; max-height:280px; overflow-y:auto; margin-bottom:16px">
          ${users.length === 0
            ? '<p style="color:var(--text-secondary)">Keine anderen Lehrer/Admins vorhanden.</p>'
            : users.map((u) => `
              <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:8px; border-radius:var(--radius-sm); background:var(--bg-secondary)">
                <input type="checkbox" value="${escapeHtml(u.id)}" ${currentShared.includes(u.id) ? 'checked' : ''} />
                <span class="user-role-badge ${u.role}">${u.role === 'admin' ? 'Admin' : 'Lehrer'}</span>
                <span>${escapeHtml(u.displayName || u.username)}</span>
              </label>`).join('')}
        </div>
        <div class="confirm-actions">
          <button class="btn btn-primary" id="btnShareSave">Freigabe speichern</button>
          <button class="btn btn-secondary" id="btnShareCancel">Abbrechen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#btnShareCancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#btnShareSave').addEventListener('click', async () => {
      const checked = Array.from(overlay.querySelectorAll('#shareUserList input:checked')).map((cb) => cb.value);
      try {
        if (api.setTopicSharing) await api.setTopicSharing(topic.id, checked);
        else if (api.saveTopic) {
          const fullTopic = state.topics.find((tt) => tt.id === topic.id);
          if (fullTopic) { fullTopic.sharedWith = checked; await api.saveTopic(fullTopic); }
        }
        overlay.remove();
        this.app.showToast('Freigabe gespeichert', 'success');
        await this.app.loadTopics();
        this.refresh();
      } catch (err) {
        this.app.showToast('Fehler beim Speichern: ' + err.message, 'error');
      }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }
}
