import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== TAGS VIEW ====================

/**
 * Verwaltung der Schlagworte, mit denen Lernthemen und Themen-Links
 * eingeordnet werden. Bewusst eine gepflegte Liste statt freier Eingabe:
 * So steht "Arduino" nicht dreimal unterschiedlich geschrieben im Filter.
 */
export class TagsView {
  constructor(app) {
    this.app = app;

    this._list    = document.getElementById('tagsList');
    this._form    = document.getElementById('tagForm');
    this._input   = document.getElementById('tagName');
    this._color   = document.getElementById('tagColor');
    this._editId  = null;
    this._btnCancel = document.getElementById('btnCancelTag');
    this._formTitle = document.getElementById('tagFormTitle');

    this._bindEvents();
  }

  _bindEvents() {
    this._form?.addEventListener('submit', (e) => this._onSubmit(e));
    this._btnCancel?.addEventListener('click', () => this._resetForm());
  }

  _resetForm() {
    this._editId = null;
    if (this._input) this._input.value = '';
    if (this._color) this._color.value = '#4f7cff';
    if (this._formTitle) this._formTitle.textContent = 'Neuer Tag';
    this._btnCancel?.classList.add('hidden');
  }

  async _onSubmit(e) {
    e.preventDefault();
    const name = (this._input?.value || '').trim();
    if (!name) return;
    const color = this._color?.value || null;

    try {
      const res = this._editId
        ? await this.app.api.updateTag(this._editId, { name, color })
        : await this.app.api.createTag({ name, color });
      if (res && res.message && !res.id) {
        this.app.showToast(res.message, 'error');
        return;
      }
      this.app.showToast(this._editId ? 'Tag umbenannt.' : 'Tag angelegt.', 'success');
      this._resetForm();
      await this.refresh();
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
    }
  }

  _startEdit(tag) {
    this._editId = tag.id;
    if (this._input) { this._input.value = tag.name; this._input.focus(); }
    if (this._color) this._color.value = tag.color || '#4f7cff';
    if (this._formTitle) this._formTitle.textContent = `Tag bearbeiten: ${tag.name}`;
    this._btnCancel?.classList.remove('hidden');
  }

  async _delete(tag) {
    const used = tag.topicCount + tag.linkCount;
    const warn = used > 0
      ? `\n\nDer Tag ist derzeit ${tag.topicCount}× an Themen und ${tag.linkCount}× an Links vergeben und wird dort entfernt.`
      : '';
    if (!(await this.app.appConfirm(`Tag "${tag.name}" löschen?${warn}`))) return;
    await this.app.api.deleteTag(tag.id);
    this.app.showToast('Tag gelöscht.', 'info');
    if (this._editId === tag.id) this._resetForm();
    await this.refresh();
  }

  async refresh() {
    const tags = await this.app.loadTags();
    if (!this._list) return;

    this._list.innerHTML = '';
    if (tags.length === 0) {
      this._list.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🏷</span>
          <p>Noch keine Tags. Lege welche an, z. B. „Informatik“ oder „Arduino“.</p>
        </div>`;
      return;
    }

    for (const tag of tags) {
      const row = document.createElement('div');
      row.className = 'tag-row';
      row.innerHTML = `
        <span class="tag-chip" style="--tag-color:${escapeAttr(tag.color || '#4f7cff')}">${escapeHtml(tag.name)}</span>
        <span class="tag-usage">${tag.topicCount} Thema/Themen · ${tag.linkCount} Link(s)</span>
        <span class="tag-row-actions">
          <button class="btn btn-secondary btn-sm btn-edit-tag">✏️ Umbenennen</button>
          <button class="btn btn-danger btn-sm btn-delete-tag">🗑</button>
        </span>`;
      row.querySelector('.btn-edit-tag').addEventListener('click', () => this._startEdit(tag));
      row.querySelector('.btn-delete-tag').addEventListener('click', () => this._delete(tag));
      this._list.appendChild(row);
    }
  }
}

/**
 * Gemeinsamer Filterbaustein für Themen und Links: Freitextfeld, darunter
 * die passenden Tags als Checkboxen, dazu der Schalter zwischen ODER und UND.
 *
 * Der Aufrufer bekommt über `onChange` nur noch die Filterfunktion gereicht
 * und muss die Logik nicht kennen.
 */
export class TagFilter {
  constructor(app, { searchInput, chipList, modeToggle, onChange }) {
    this.app = app;
    this._search = searchInput;
    this._chips = chipList;
    this._modeToggle = modeToggle;
    this._onChange = onChange;
    this._selected = new Set();
    this._mode = 'any'; // 'any' = mindestens ein Tag, 'all' = alle Tags

    this._search?.addEventListener('input', () => this.render());
    this._modeToggle?.addEventListener('change', () => {
      this._mode = this._modeToggle.checked ? 'all' : 'any';
      this._onChange?.();
    });
  }

  /** Trifft ein Eintrag (Thema oder Link) die aktuelle Tag-Auswahl? */
  matches(entity) {
    if (this._selected.size === 0) return true;
    const own = new Set(entity.tagIds || []);
    if (this._mode === 'all') return [...this._selected].every((id) => own.has(id));
    return [...this._selected].some((id) => own.has(id));
  }

  get selectedIds() {
    return [...this._selected];
  }

  /**
   * Zeichnet die Tag-Checkboxen. Das Freitextfeld schränkt nur die
   * *Anzeige* der Tags ein – bereits angehakte Tags bleiben immer sichtbar,
   * sonst verschwände die eigene Auswahl beim Weitertippen.
   */
  render() {
    if (!this._chips) return;
    const all = this.app.state.tags || [];
    const needle = (this._search?.value || '').toLowerCase().trim();
    const visible = all.filter(
      (tag) => this._selected.has(tag.id) || !needle || tag.name.toLowerCase().includes(needle),
    );

    this._chips.innerHTML = '';
    if (all.length === 0) {
      this._chips.innerHTML = '<span class="hint">Noch keine Tags angelegt.</span>';
      return;
    }
    if (visible.length === 0) {
      this._chips.innerHTML = '<span class="hint">Kein Tag passt zur Eingabe.</span>';
      return;
    }

    for (const tag of visible) {
      const label = document.createElement('label');
      label.className = 'tag-filter-option';
      label.innerHTML = `
        <input type="checkbox" value="${escapeAttr(tag.id)}" ${this._selected.has(tag.id) ? 'checked' : ''} />
        <span class="tag-chip" style="--tag-color:${escapeAttr(tag.color || '#4f7cff')}">${escapeHtml(tag.name)}</span>`;
      label.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) this._selected.add(tag.id);
        else this._selected.delete(tag.id);
        this._onChange?.();
      });
      this._chips.appendChild(label);
    }
  }
}
