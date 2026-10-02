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

// ==================== THEMENGEBIETE ====================

/** Themengebiete (Tags mit isArea), alphabetisch. */
export function areaTags(tags) {
  return (tags || []).filter((t) => t.isArea).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Themengebiete zu einer Tag-Auswahl: direkt vergebene Themengebiete plus die,
 * zu denen die vergebenen Tags gehören. Darüber landet ein Thema mit dem Tag
 * "Arduino" automatisch unter "Informatik", ohne dass man beides vergibt.
 */
export function areasOfTagIds(tagIds, tags) {
  const byId = new Map((tags || []).map((t) => [t.id, t]));
  const out = new Set();
  for (const id of tagIds || []) {
    const tag = byId.get(id);
    if (!tag) continue;
    if (tag.isArea) out.add(id);
    else for (const a of tag.areaIds || []) if (byId.get(a)?.isArea) out.add(a);
  }
  return out;
}

export function chipHtml(tag) {
  return `<span class="tag-chip${tag.isArea ? ' area-chip' : ''}" style="--tag-color:${escapeAttr(tag.color || DEFAULT_TAG_COLOR)}">${tag.isArea ? '📁 ' : ''}${escapeHtml(tag.name)}</span>`;
}

// Welche Abschnitte jemand auf- bzw. zugeklappt hat, merkt sich nur der
// eigene Browser – eine reine Ansichtssache.
function loadToggled(scope) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`lm_area_toggled:${scope}`) || '[]'));
  } catch (_) {
    return new Set();
  }
}
function saveToggled(scope, set) {
  try { localStorage.setItem(`lm_area_toggled:${scope}`, JSON.stringify([...set])); } catch (_) {}
}

/**
 * Zeichnet Einträge (Themen, Links, Tags) als aufklappbare Abschnitte je
 * Themengebiet, zuletzt "Ohne Themengebiet". Ein Eintrag mit mehreren
 * Themengebieten steht in jedem davon – man findet ihn dort, wo man sucht.
 *
 * Gibt es noch kein Themengebiet, zeichnet die Funktion nichts und liefert
 * false; der Aufrufer bleibt dann bei der flachen Liste.
 *
 * - scope:       Schlüssel für den gemerkten Auf-/Zu-Zustand
 * - buildItem:   Eintrag -> DOM-Element (wird je Abschnitt neu gebaut)
 * - buildHead:   Themengebiet -> HTML der Überschrift (Standard: Chip)
 * - countLabel:  Anzahl -> Text neben der Überschrift
 * - defaultOpen: Abschnitte anfangs offen statt zu
 * - expandAll:   alles offen, ohne es zu merken (z. B. bei aktivem Filter)
 * - showEmpty:   auch Themengebiete ohne Einträge zeigen
 */
export function renderAreaGroups(container, items, opts) {
  const { tags, scope, buildItem, buildHead, countLabel, defaultOpen = false, expandAll = false, showEmpty = false } = opts;
  const areas = areaTags(tags);
  if (areas.length === 0) return false;

  const groups = new Map(areas.map((a) => [a.id, []]));
  const loose = [];
  for (const item of items) {
    const ids = areasOfTagIds(item.tagIds, tags);
    if (ids.size === 0) loose.push(item);
    else ids.forEach((id) => groups.get(id)?.push(item));
  }

  const toggled = loadToggled(scope);
  const section = (key, head, list) => {
    const details = document.createElement('details');
    details.className = 'area-group';
    details.dataset.areaKey = key;
    details.open = expandAll || (defaultOpen !== toggled.has(key));
    details.innerHTML = `
      <summary class="area-group-head">
        <span class="area-group-title">${head}</span>
        <span class="area-group-count">${escapeHtml(countLabel(list.length))}</span>
      </summary>
      <div class="area-group-body"></div>`;
    const body = details.querySelector('.area-group-body');
    for (const item of list) body.appendChild(buildItem(item));
    details.addEventListener('toggle', () => {
      if (expandAll) return;
      const now = loadToggled(scope);
      if (details.open !== defaultOpen) now.add(key);
      else now.delete(key);
      saveToggled(scope, now);
    });
    container.appendChild(details);
    return details;
  };

  for (const area of areas) {
    const list = groups.get(area.id);
    if (list.length || showEmpty) section(area.id, buildHead ? buildHead(area) : chipHtml(area), list);
  }
  if (loose.length) section('__none__', '<span class="area-group-none">Ohne Themengebiet</span>', loose);
  return true;
}

/**
 * Tag-Checkboxen für Filter und Formular. Mit Themengebieten in Zeilen:
 * Themengebiet vorn, seine Tags dahinter, zuletzt die Tags ohne Gebiet.
 * Ein Tag in mehreren Themengebieten hat mehrere Häkchen, die gemeinsam
 * umschalten.
 *
 * `visible(tag)` blendet Tags aus (Suche); `onToggle(id, checked)` meldet
 * jede Änderung.
 */
function renderTagChoices(box, tags, selected, { visible = () => true, onToggle }) {
  const option = (tag) => {
    const label = document.createElement('label');
    label.className = 'tag-filter-option';
    label.innerHTML = `
      <input type="checkbox" value="${escapeAttr(tag.id)}" ${selected.has(tag.id) ? 'checked' : ''} />
      ${chipHtml(tag)}`;
    label.querySelector('input').addEventListener('change', (e) => {
      box.querySelectorAll(`input[value="${CSS.escape(tag.id)}"]`).forEach((cb) => { cb.checked = e.target.checked; });
      onToggle(tag.id, e.target.checked);
    });
    return label;
  };

  const areas = areaTags(tags);
  if (areas.length === 0) {
    tags.filter(visible).forEach((tag) => box.appendChild(option(tag)));
    return;
  }

  const plain = tags.filter((t) => !t.isArea);
  const row = (head, children) => {
    const div = document.createElement('div');
    div.className = 'tag-area-row';
    if (head) div.appendChild(head);
    else div.insertAdjacentHTML('beforeend', '<span class="area-group-none">Ohne Themengebiet</span>');
    const kids = document.createElement('span');
    kids.className = 'tag-area-children';
    children.forEach((tag) => kids.appendChild(option(tag)));
    div.appendChild(kids);
    box.appendChild(div);
  };

  for (const area of areas) {
    const children = plain.filter((t) => (t.areaIds || []).includes(area.id) && visible(t));
    if (!visible(area) && children.length === 0) continue;
    row(option(area), children);
  }
  const loose = plain.filter((t) => !(t.areaIds || []).some((a) => areas.some((x) => x.id === a)) && visible(t));
  if (loose.length) row(null, loose);
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
    this._isArea  = document.getElementById('tagIsArea');
    this._areaWrap = document.getElementById('tagAreaChoicesWrap');
    this._areaBox = document.getElementById('tagAreaChoices');
    this._areaSelected = new Set();

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
    this._isArea?.addEventListener('change', () => this._renderAreaChoices());
  }

  /**
   * Zuordnung zu Themengebieten im Formular. Ein Themengebiet selbst hängt
   * unter keinem anderen – dann bleibt die Auswahl ausgeblendet.
   */
  _renderAreaChoices() {
    if (!this._areaBox || !this._areaWrap) return;
    const areas = areaTags(this.app.state.tags).filter((a) => a.id !== this._editId);
    const hide = !!this._isArea?.checked;
    this._areaWrap.classList.toggle('hidden', hide);
    this._areaBox.innerHTML = '';
    if (hide) return;
    if (areas.length === 0) {
      this._areaBox.innerHTML = '<span class="hint">Noch keine Themengebiete – lege zuerst eins an (Haken oben).</span>';
      return;
    }
    for (const area of areas) {
      const label = document.createElement('label');
      label.className = 'tag-filter-option';
      label.innerHTML = `
        <input type="checkbox" value="${escapeAttr(area.id)}" ${this._areaSelected.has(area.id) ? 'checked' : ''} />
        ${chipHtml(area)}`;
      label.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) this._areaSelected.add(area.id);
        else this._areaSelected.delete(area.id);
      });
      this._areaBox.appendChild(label);
    }
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
    if (this._isArea) this._isArea.checked = false;
    this._areaSelected = new Set();
    this._renderAreaChoices();
  }

  async _onSubmit(e) {
    e.preventDefault();
    const name = (this._input?.value || '').trim();
    if (!name) return;
    const color = this._color?.value || null;
    const isArea = !!this._isArea?.checked;
    const areaIds = isArea ? [] : [...this._areaSelected];

    try {
      const res = this._editId
        ? await this.app.api.updateTag(this._editId, { name, color, isArea, areaIds })
        : await this.app.api.createTag({ name, color, isArea, areaIds });
      if (res && res.message && !res.id) {
        this.app.showToast(res.message, 'error');
        return;
      }
      this.app.showToast(this._editId ? 'Tag gespeichert.' : (isArea ? 'Themengebiet angelegt.' : 'Tag angelegt.'), 'success');
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
    if (this._formTitle) {
      this._formTitle.textContent = `${tag.isArea ? 'Themengebiet' : 'Tag'} bearbeiten: ${tag.name}`;
    }
    this._btnCancel?.classList.remove('hidden');
    if (this._isArea) this._isArea.checked = !!tag.isArea;
    this._areaSelected = new Set(tag.areaIds || []);
    this._renderAreaChoices();
    this._form?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async _delete(tag) {
    const used = tag.topicCount + tag.linkCount + (tag.moduleCount || 0);
    const warn = used > 0
      ? `\n\nDer Tag ist derzeit ${tag.topicCount}× an Themen, ${tag.moduleCount || 0}× an Modulen und ${tag.linkCount}× an Links vergeben und wird dort entfernt.`
      : '';
    const areaWarn = tag.isArea
      ? '\n\nTags, die nur zu diesem Themengebiet gehören, stehen danach unter „Ohne Themengebiet“.'
      : '';
    if (!(await this.app.appConfirm(`${tag.isArea ? 'Themengebiet' : 'Tag'} "${tag.name}" löschen?${warn}${areaWarn}`))) return;
    await this.app.api.deleteTag(tag.id);
    this.app.showToast('Tag gelöscht.', 'info');
    if (this._editId === tag.id) this._resetForm();
    await this.refresh();
  }

  async refresh() {
    const tags = await this.app.loadTags();
    this._renderAreaChoices();
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

    // Gegliedert: je Themengebiet eine aufklappbare Überschrift mit seinen
    // Tags darunter. Die Überschrift ist selbst ein Tag und lässt sich dort
    // bearbeiten. Ohne Themengebiete bleibt es bei der flachen Liste.
    const grouped = renderAreaGroups(this._list, tags.filter((t) => !t.isArea).map((t) => ({ ...t, tagIds: t.areaIds })), {
      tags,
      scope: 'tags',
      defaultOpen: true,
      showEmpty: true,
      buildItem: (tag) => this._buildRow(tag),
      buildHead: (area) => `${chipHtml(area)}<span class="tag-usage">${this._usage(area)}</span>`,
      countLabel: (n) => `${n} Tag${n === 1 ? '' : 's'}`,
    });
    if (grouped) {
      // Bearbeiten/Löschen des Themengebiets direkt an der Überschrift.
      const byId = new Map(tags.map((t) => [t.id, t]));
      this._list.querySelectorAll('.area-group').forEach((group) => {
        const area = byId.get(group.dataset.areaKey);
        if (area) group.querySelector('.area-group-head').appendChild(this._actions(area));
      });
    } else {
      for (const tag of tags) this._list.appendChild(this._buildRow(tag));
    }
  }

  _usage(tag) {
    return `${tag.topicCount} Thema/Themen · ${tag.moduleCount || 0} Modul(e) · ${tag.linkCount} Link(s)`;
  }

  /** Bearbeiten/Löschen; in einer Überschrift ohne Auf-/Zuklappen. */
  _actions(tag) {
    const span = document.createElement('span');
    span.className = 'tag-row-actions';
    span.innerHTML = `
      <button class="btn btn-secondary btn-sm btn-edit-tag">✏️ Bearbeiten</button>
      <button class="btn btn-danger btn-sm btn-delete-tag">🗑</button>`;
    span.querySelector('.btn-edit-tag').addEventListener('click', (e) => { e.preventDefault(); this._startEdit(tag); });
    span.querySelector('.btn-delete-tag').addEventListener('click', (e) => { e.preventDefault(); this._delete(tag); });
    return span;
  }

  _buildRow(tag) {
    const row = document.createElement('div');
    row.className = 'tag-row';
    row.innerHTML = `${chipHtml(tag)}<span class="tag-usage">${this._usage(tag)}</span>`;
    row.appendChild(this._actions(tag));
    return row;
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
    // Ein gewähltes Themengebiet trifft auch alles, was über einen seiner
    // Tags dazugehört.
    const tags = this.app.state.tags || [];
    const own = new Set([...(entity.tagIds || []), ...areasOfTagIds(entity.tagIds, tags)]);
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
    const isVisible = (tag) => this._selected.has(tag.id) || !needle || tag.name.toLowerCase().includes(needle);
    const visible = all.filter(isVisible);

    this._chips.innerHTML = '';
    if (all.length === 0) {
      this._chips.innerHTML = '<span class="hint">Noch keine Tags angelegt.</span>';
      return;
    }
    if (visible.length === 0) {
      this._chips.innerHTML = '<span class="hint">Kein Tag passt zur Eingabe.</span>';
      return;
    }

    renderTagChoices(this._chips, all, this._selected, {
      visible: isVisible,
      onToggle: (id, checked) => {
        if (checked) this._selected.add(id);
        else this._selected.delete(id);
        this._onChange?.();
      },
    });
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
        <label class="tag-picker-new-isarea" title="Als Gliederungsüberschrift für Lernthemen und Tags">
          <input type="checkbox" class="tag-picker-new-area-flag" /> Themengebiet
        </label>
        <select class="tag-picker-new-area" aria-label="Themengebiet des neuen Tags"></select>
        <button type="button" class="btn btn-secondary btn-sm tag-picker-new-btn">+ Tag anlegen</button>
      </div>` : ''}`;

    this._box = this._root.querySelector('.tag-picker');

    if (this._allowCreate) {
      this._newName  = this._root.querySelector('.tag-picker-new-name');
      this._newColor = this._root.querySelector('.tag-picker-new-color');
      this._newAreaFlag = this._root.querySelector('.tag-picker-new-area-flag');
      this._newArea  = this._root.querySelector('.tag-picker-new-area');
      // Ein Themengebiet hängt selbst unter keinem Themengebiet.
      this._newAreaFlag.addEventListener('change', () => {
        this._newArea.classList.toggle('hidden', this._newAreaFlag.checked || areaTags(this.app.state.tags).length === 0);
      });
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

  /** Auswahl "Themengebiet" in der Anlege-Zeile – nur, wenn es welche gibt. */
  _renderAreaSelect() {
    if (!this._newArea) return;
    const areas = areaTags(this.app.state.tags);
    const current = this._newArea.value;
    this._newArea.innerHTML = '<option value="">ohne Themengebiet</option>' +
      areas.map((a) => `<option value="${escapeAttr(a.id)}">in: ${escapeHtml(a.name)}</option>`).join('');
    if (areas.some((a) => a.id === current)) this._newArea.value = current;
    this._newArea.classList.toggle('hidden', areas.length === 0 || this._newAreaFlag.checked);
  }

  _renderOptions() {
    if (!this._box) return;
    const tags = this.app.state.tags || [];
    this._box.innerHTML = '';
    this._renderAreaSelect();

    if (tags.length === 0) {
      this._box.innerHTML = this._allowCreate
        ? '<span class="hint">Noch keine Tags – lege unten direkt einen an.</span>'
        : '<span class="hint">Noch keine Tags angelegt – siehe Menüpunkt „Tags“.</span>';
      return;
    }

    renderTagChoices(this._box, tags, this._selected, {
      onToggle: (id, checked) => {
        if (checked) this._selected.add(id);
        else this._selected.delete(id);
      },
    });
  }

  async _createTag() {
    const name = (this._newName?.value || '').trim();
    if (!name) { this.app.showToast('Bitte einen Namen für den Tag eingeben.', 'error'); return; }
    const color = this._newColor?.value || DEFAULT_TAG_COLOR;
    const isArea = !!this._newAreaFlag?.checked;
    const areaId = isArea ? '' : (this._newArea?.value || '');

    try {
      const res = await this.app.api.createTag({ name, color, isArea, areaIds: areaId ? [areaId] : [] });
      // Der Server meldet Namenskonflikte als message ohne id.
      if (!res || !res.id) {
        this.app.showToast((res && res.message) || 'Tag konnte nicht angelegt werden.', 'error');
        return;
      }
      await this.app.loadTags();
      this._selected.add(res.id);
      this._newName.value = '';
      this._newAreaFlag.checked = false;
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
