import { escapeHtml, escapeAttr, copyQrSvgAsPng, copyShareSheetAsPng } from '../utils.js';
import { LINK_MODE_LABELS } from './login.js';
import { TagFilter, TagPicker } from './tags.js';

// ==================== THEMEN-LINKS ====================

const ALL_MODES = ['quiz', 'exam', 'learn'];

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
  }

  // ---------- Liste ----------

  async refresh() {
    await this.app.loadTags();
    // Für den Auswahlbaum zählen nicht nur die eigenen Themen, sondern auch
    // die, die mir jemand zur Nutzung freigegeben hat.
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
            ? 'Noch keine Themen-Links. Lege einen an, z. B. „TG12 Informatik Arduino“.'
            : 'Kein Link passt zum gewählten Filter.'}</p>
        </div>`;
      return;
    }

    for (const link of links) {
      const card = document.createElement('div');
      card.className = 'link-card' + (link.active ? '' : ' link-card-inactive');
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
              gelöscht oder die Freigabe wurde zurückgezogen.</p>` : ''}
          <div class="link-card-tags">${this._renderTagChips(link.tagIds)}</div>
        </div>
        <div class="link-card-actions">
          <button class="btn btn-secondary btn-sm btn-link-share" ${link.active ? '' : 'disabled title="Link ist deaktiviert"'}>🔗 Link &amp; QR</button>
          <button class="btn btn-secondary btn-sm btn-link-toggle">${link.active ? '⏸ Deaktivieren' : '▶️ Aktivieren'}</button>
          <button class="btn btn-secondary btn-sm btn-link-edit">✏️ Bearbeiten</button>
          <button class="btn btn-danger btn-sm btn-link-delete">🗑</button>
        </div>`;

      card.querySelector('.btn-link-share').addEventListener('click', () => this._openShareDialog(link));
      card.querySelector('.btn-link-edit').addEventListener('click', () => this._openEditor(link));
      card.querySelector('.btn-link-toggle').addEventListener('click', async () => {
        await this.app.api.updateLink(link.id, { active: !link.active });
        this.app.showToast(link.active ? 'Link deaktiviert.' : 'Link aktiviert.', 'info');
        this.refresh();
      });
      card.querySelector('.btn-link-delete').addEventListener('click', async () => {
        if (!(await this.app.appConfirm(`Link "${link.name}" löschen? Verteilte QR-Codes führen danach ins Leere.`))) return;
        await this.app.api.deleteLink(link.id);
        this.app.showToast('Link gelöscht.', 'info');
        this.refresh();
      });

      this._list.appendChild(card);
    }
  }

  _renderTagChips(tagIds) {
    const byId = new Map((this.app.state.tags || []).map((t) => [t.id, t]));
    return (tagIds || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((tag) => `<span class="tag-chip" style="--tag-color:${escapeAttr(tag.color || '#4f7cff')}">${escapeHtml(tag.name)}</span>`)
      .join('');
  }

  // ---------- Formular ----------

  _openEditor(link) {
    this._editId = link ? link.id : null;
    this._formTitle.textContent = link ? `Link bearbeiten: ${link.name}` : 'Neuer Themen-Link';
    this._nameInput.value = link ? link.name : '';
    this._passwordInput.value = '';
    this._passwordInput.placeholder = link?.hasPassword
      ? 'Passwort gesetzt – leer lassen, um es zu behalten'
      : 'Leer = kein Passwort';
    this._chkSingle.checked = !!link?.singleAttempt;

    this._renderModes(link ? link.modes : ['quiz']);
    this._tagPicker.render(link ? link.tagIds : []);

    this._selection = new Map();
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
    const examOn = this._selectedModes().includes('exam');
    this._singleRow?.classList.toggle('hidden', !examOn);
    if (!examOn && this._chkSingle) this._chkSingle.checked = false;
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
        head.textContent = '📤 Von Kolleginnen und Kollegen freigegeben';
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

    const payload = { name, modes, selection, tagIds, singleAttempt: !!this._chkSingle.checked };
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
      this.app.showToast(this._editId ? 'Link gespeichert.' : 'Link angelegt.', 'success');
      this._closeEditor();
      await this.refresh();
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
    }
  }

  // ---------- Versenden ----------

  async _openShareDialog(link) {
    this._bindShareDialog();
    this._shareLink = link;
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
      const res = await this.app.api.shareLink(this._shareLink.id, regenerate);
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
        title: 'Themen-Link für Schüler',
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
      await this.app.api.revokeLink(this._shareLink.id);
      overlay.classList.add('hidden');
      this.app.showToast('Link zurückgezogen', 'info');
      this.refresh();
    });
  }
}
