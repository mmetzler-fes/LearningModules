import { escapeHtml, escapeAttr } from '../utils.js';

const DEFAULT_TAG_COLOR = '#4f7cff';

/**
 * Macht aus einer getippten oder eingefuegten Eingabe einen sauberen Hex-Wert.
 * Erlaubt mit und ohne Raute sowie die Kurzform (#abc), damit ein kopierter
 * Farbwert aus beliebiger Quelle ohne Nacharbeit passt. `null` = unbrauchbar.
 */
function normalizeHex(raw) {
  const value = String(raw || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(value)) {
    return '#' + value.split('').map((c) => c + c).join('').toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(value)) return '#' + value.toLowerCase();
  return null;
}

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
    this._hex     = document.getElementById('tagColorHex');
    this._btnCopyColor = document.getElementById('btnCopyTagColor');
    this._editId  = null;
    this._btnCancel = document.getElementById('btnCancelTag');
    this._formTitle = document.getElementById('tagFormTitle');

    this._bindEvents();
  }

  _bindEvents() {
    this._form?.addEventListener('submit', (e) => this._onSubmit(e));
    this._btnCancel?.addEventListener('click', () => this._resetForm());

    // Farbwaehler und Hex-Feld zeigen immer denselben Wert.
    this._color?.addEventListener('input', () => this._setColor(this._color.value));
    this._hex?.addEventListener('input', () => this._onHexInput());
    // Beim Verlassen unfertige Eingaben auf den zuletzt gueltigen Wert zurueckholen.
    this._hex?.addEventListener('blur', () => this._setColor(this._color?.value));
    this._btnCopyColor?.addEventListener('click', () => this._copyColor());
  }

  /** Setzt Farbwaehler und Hex-Feld gemeinsam auf einen Wert. */
  _setColor(value) {
    const hex = normalizeHex(value) || DEFAULT_TAG_COLOR;
    if (this._color) this._color.value = hex;
    if (this._hex) {
      this._hex.value = hex;
      this._hex.classList.remove('invalid');
    }
  }

  /**
   * Tippen oder Einfuegen im Hex-Feld. Der Text bleibt unangetastet, damit
   * die Eingabe nicht mitten im Tippen umspringt; nur der Farbwaehler zieht
   * nach, sobald der Wert vollstaendig ist.
   */
  _onHexInput() {
    const hex = normalizeHex(this._hex.value);
    if (hex) {
      if (this._color) this._color.value = hex;
      this._hex.classList.remove('invalid');
    } else {
      this._hex.classList.toggle('invalid', this._hex.value.trim() !== '');
    }
  }

  async _copyColor() {
    const hex = this._color?.value || DEFAULT_TAG_COLOR;
    try {
      await navigator.clipboard.writeText(hex);
      this.app.showToast(`Farbwert ${hex} kopiert.`, 'success');
    } catch (_) {
      this._hex?.select();
      this.app.showToast('Bitte mit Strg+C kopieren', 'info');
    }
  }

  _resetForm() {
    this._editId = null;
    if (this._input) this._input.value = '';
    this._setColor(DEFAULT_TAG_COLOR);
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
    this._setColor(tag.color || DEFAULT_TAG_COLOR);
    if (this._formTitle) this._formTitle.textContent = `Tag bearbeiten: ${tag.name}`;
    this._btnCancel?.classList.remove('hidden');
  }

  async _delete(tag) {
    const used = tag.topicCount + tag.linkCount + (tag.moduleCount || 0);
    const warn = used > 0
      ? `\n\nDer Tag ist derzeit ${tag.topicCount}× an Themen, ${tag.moduleCount || 0}× an Modulen und ${tag.linkCount}× an Links vergeben und wird dort entfernt.`
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
        <span class="tag-usage">${tag.topicCount} Thema/Themen · ${tag.moduleCount || 0} Modul(e) · ${tag.linkCount} Link(s)</span>
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

/**
 * Tag-Auswahl zum Einbauen in ein Formular: Haken setzen heisst zuordnen,
 * Haken weg heisst entfernen. Darunter eine Zeile, mit der sich ein fehlender
 * Tag sofort anlegen laesst - ohne den Umweg ueber den Menuepunkt "Tags",
 * bei dem die halb ausgefuellte Bearbeitung verloren ginge.
 *
 * Der neue Tag ist danach gleich angehakt, denn wer ihn hier anlegt, will
 * ihn erkennbar auch vergeben.
 */
export class TagPicker {
  constructor(app, container, { allowCreate = true } = {}) {
    this.app = app;
    this._root = container;
    this._allowCreate = allowCreate;
    this._selected = new Set();
    this._built = false;
  }

  /** Baut das Grundgeruest einmalig auf: Auswahlflaeche plus Anlege-Zeile. */
  _build() {
    if (!this._root || this._built) return;
    this._root.innerHTML = `
      <div class="tag-picker"></div>
      ${this._allowCreate ? `
      <div class="tag-picker-new">
        <input type="text" class="tag-picker-new-name" maxlength="40" autocomplete="off"
               placeholder="Neuer Tag, z. B. Schleifen" aria-label="Name des neuen Tags" />
        <input type="color" class="tag-picker-new-color" value="${DEFAULT_TAG_COLOR}"
               aria-label="Farbe des neuen Tags" />
        <button type="button" class="btn btn-secondary btn-sm tag-picker-new-btn">+ Tag anlegen</button>
      </div>` : ''}`;

    this._box = this._root.querySelector('.tag-picker');

    if (this._allowCreate) {
      this._newName  = this._root.querySelector('.tag-picker-new-name');
      this._newColor = this._root.querySelector('.tag-picker-new-color');
      this._root.querySelector('.tag-picker-new-btn').addEventListener('click', () => this._createTag());
      // Enter im Namensfeld legt den Tag an, statt das umgebende Formular
      // abzuschicken - sonst waere das Modul gespeichert, der Tag aber nicht.
      this._newName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this._createTag(); }
      });
    }
    this._built = true;
  }

  /** Setzt die Auswahl und zeichnet neu. */
  render(selected) {
    this._build();
    if (selected !== undefined) this._selected = new Set(selected || []);
    this._renderOptions();
  }

  _renderOptions() {
    if (!this._box) return;
    const tags = this.app.state.tags || [];
    this._box.innerHTML = '';

    if (tags.length === 0) {
      this._box.innerHTML = this._allowCreate
        ? '<span class="hint">Noch keine Tags – lege unten direkt einen an.</span>'
        : '<span class="hint">Noch keine Tags angelegt – siehe Menüpunkt „Tags“.</span>';
      return;
    }

    for (const tag of tags) {
      const label = document.createElement('label');
      label.className = 'tag-filter-option';
      label.innerHTML = `
        <input type="checkbox" value="${escapeAttr(tag.id)}" ${this._selected.has(tag.id) ? 'checked' : ''} />
        <span class="tag-chip" style="--tag-color:${escapeAttr(tag.color || DEFAULT_TAG_COLOR)}">${escapeHtml(tag.name)}</span>`;
      label.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) this._selected.add(tag.id);
        else this._selected.delete(tag.id);
      });
      this._box.appendChild(label);
    }
  }

  async _createTag() {
    const name = (this._newName?.value || '').trim();
    if (!name) { this.app.showToast('Bitte einen Namen für den Tag eingeben.', 'error'); return; }
    const color = this._newColor?.value || DEFAULT_TAG_COLOR;

    try {
      const res = await this.app.api.createTag({ name, color });
      // Der Server meldet Namenskonflikte als message ohne id.
      if (!res || !res.id) {
        this.app.showToast((res && res.message) || 'Tag konnte nicht angelegt werden.', 'error');
        return;
      }
      await this.app.loadTags();
      this._selected.add(res.id);
      this._newName.value = '';
      this._renderOptions();
      this.app.showToast(`Tag „${res.name}“ angelegt und zugeordnet.`, 'success');
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
    }
  }

  /** Die aktuell angehakten Tag-IDs, beschraenkt auf noch vorhandene Tags. */
  get selectedIds() {
    const known = new Set((this.app.state.tags || []).map((t) => t.id));
    return [...this._selected].filter((id) => known.has(id));
  }
}
