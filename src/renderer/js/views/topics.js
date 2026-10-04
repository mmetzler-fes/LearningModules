import { escapeHtml, escapeAttr, copyQrSvgAsPng, copyShareSheetAsPng } from '../utils.js';
import { TagFilter, TagPicker, renderAreaGroups, chipHtml } from './tags.js';

// ==================== TOPICS VIEW ====================

/** Lernthemen je Seite – mehr Karten auf einmal machen die Ansicht träge. */
const TOPICS_PER_PAGE = 10;

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
    // Themen und Tags gleichzeitig laden statt nacheinander.
    await Promise.all([this.app.loadTopics(), this.app.loadTags()]);
    this._filter.render();
    this._hideForm();
    this._render();
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
    const matching = all.filter((topic) => this._filter.matches(topic));
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
      buildItem: (topic) => this._buildCard(topic),
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
  _buildCard(topic) {
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
    card.querySelector('.btn-quick-link').addEventListener('click', () => this._openQuickLinkDialog(topic));
    card.querySelector('.btn-edit-topic').addEventListener('click', () => this._openEditor(topic));
    card.querySelector('.btn-export-topic').addEventListener('click', () => this.openExportDialog(topic));
    card.querySelector('.btn-delete-topic').addEventListener('click', async () => {
      // Wer das Thema per "Use" verwendet, verliert es mit – das gehört vor
      // die Entscheidung.
      const users = topic.useCount
        ? `\n\n${topic.useCount} Person${topic.useCount === 1 ? ' verwendet' : 'en verwenden'} dieses Thema über den Shop ` +
          'und verliert es damit ebenfalls – auch wenn dafür bezahlt wurde.'
        : '';
      if (!(await this.app.appConfirm(t('topics.delete.confirm', { title: topic.title }) + users))) return;
      await this.app.api.deleteTopic(topic.id);
      this.app.showToast(t('topics.deleted'), 'info');
      this.refresh();
    });

    return card;
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
    const shareNote = document.getElementById('quickLinkShareNote');
    shareNote.classList.add('hidden');

    qrBox.innerHTML = '<p class="hint">Wird erzeugt…</p>';
    urlBox.value = '';

    try {
      const res = await this.app.api.createQuickLink(topic.id, regenerate);
      if (!res || !res.url) throw new Error(res?.message || 'Quick-Link konnte nicht erzeugt werden.');

      this._quickLinkData = res;
      info.textContent = res.isOwn === false
        // Bei fremden Inhalten gehört der Link trotzdem mir – wer das nicht
        // weiß, sucht die Ergebnisse später beim Falschen.
        ? `${res.title} · ${res.moduleCount} freigegebene Module · fremdes Thema, die Ergebnisse kommen zu dir`
        : `${res.title} · ${res.moduleCount} freigegebene Module`;
      urlBox.value = res.url;
      // QR-SVG kommt vom eigenen Server (qrcode-Bibliothek), kein Fremdinhalt.
      qrBox.innerHTML = res.qrSvg || '<p class="hint">QR-Code nicht verfügbar – bitte den Link verwenden.</p>';
      warning.classList.add('hidden');
      this._setQuickLinkActionsEnabled(true);
      // Beim ersten Quick-Link entsteht dazu eine Schülerfreigabe – sagen,
      // wo sie zu finden ist.
      if (res.createdShare) {
        shareNote.textContent = `➕ Dazu wurde die Schülerfreigabe „${res.createdShare.name}“ angelegt – `
          + 'mit Quiz, Lernbegleitung und Quiz-Arena. Du findest sie unter Schülerfreigaben.';
        shareNote.classList.remove('hidden');
      }
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
        <h3>📤 Exportieren: <em>${escapeHtml(info.title)}</em></h3>
        ${foreign > 0 && own > 0 ? `<p class="login-error">⚠️ Dieses Thema enthält ${foreign} fremde${foreign === 1 ? 's' : ''} Modul${foreign === 1 ? '' : 'e'}.
          Unverschlüsselt werden nur deine ${own} eigenen exportiert.</p>` : ''}
        ${own === 0 ? '<p class="login-error">Dieses Thema enthält keine von dir verfassten Module – es lässt sich nur verschlüsselt exportieren.</p>' : ''}
        <div class="settings-group">
          <h3>Offen – nur eigene Module (${own})</h3>
          <p class="hint">Zum Weitergeben außerhalb der App oder für andere H5P-Plattformen.</p>
          <div class="confirm-actions" style="justify-content:flex-start">
            <button class="btn btn-secondary" id="btnExpJson" ${own ? '' : 'disabled'}>📤 JSON</button>
            <button class="btn btn-secondary" id="btnExpH5p" ${own ? '' : 'disabled'}>📦 H5P</button>
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
    overlay.querySelector('#btnExpH5p').addEventListener('click', () => run(() => this.app.api.exportTopicAsH5p(topic.id), '📦 H5P exportiert!'));
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
      this._openQuickLinkDialog({ id: entry.id, title: entry.title }));

    card.querySelector('.btn-return-grant').addEventListener('click', async (e) => {
      const ok = await this.app.appConfirm(
        `Nutzungsrecht an „${entry.title}" zurückgeben?\n\n` +
        (paid ? 'Bezahlte Punkte werden nicht erstattet. ' : '') +
        'Deine Themen- und Quick-Links liefern das Thema danach nicht mehr aus.',
      );
      if (!ok) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        for (const g of entry.grants) {
          const res = await this.app.api.revokeGrant(g.id);
          if (!res || !res.success) throw new Error(res?.message || 'Zurückgeben fehlgeschlagen');
        }
        this.app.showToast('Nutzungsrecht zurückgegeben', 'info');
        this.refreshSharedTopics();
      } catch (err) {
        this.app.showToast('Fehler: ' + err.message, 'error');
        btn.disabled = false;
      }
    });
    return card;
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
