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

/**
 * Was eine Lehrkraft ausgeblendet hat: die Themengebiete selbst und alle
 * Tags, die ausschließlich zu ausgeblendeten Gebieten gehören. Ein Tag, der
 * auch unter einem sichtbaren Gebiet hängt, bleibt sichtbar.
 */
export function hiddenTagIds(tags) {
  const list = tags || [];
  const out = new Set(list.filter((t) => t.isArea && t.hidden).map((t) => t.id));
  if (out.size === 0) return out;
  const visibleAreas = new Set(list.filter((t) => t.isArea && !t.hidden).map((t) => t.id));
  for (const t of list) {
    const areas = t.isArea ? [] : t.areaIds || [];
    if (areas.length && areas.every((id) => !visibleAreas.has(id))) out.add(t.id);
  }
  return out;
}

/**
 * Persönliche Auswahl der Themengebiete: anhaken = anzeigen. Speichert auf
 * dem Server und lädt die Tags neu; `onDone` zeichnet die Ansicht neu.
 */
export function openAreaVisibilityDialog(app, onDone) {
  const areas = areaTags(app.state.tags);
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="import-modules-card" style="min-width:360px; max-width:520px; max-height:82vh; overflow:auto">
      <h3>👁 Themengebiete auswählen</h3>
      <p class="hint">Nur angehakte Themengebiete erscheinen in Filtern, Tag-Auswahl und Gliederung.
        Das gilt nur für dich; an den Tags selbst ändert sich nichts.</p>
      ${areas.length === 0
        ? '<p class="hint">Es gibt noch keine Themengebiete.</p>'
        : `<div class="area-visibility-list">${areas.map((a) => `
          <label class="tag-filter-option">
            <input type="checkbox" value="${escapeAttr(a.id)}" ${a.hidden ? '' : 'checked'} />
            ${chipHtml(a)}
          </label>`).join('')}</div>
        <div class="school-row" style="margin-top:8px">
          <button type="button" class="btn btn-secondary btn-sm btn-all">Alle</button>
          <button type="button" class="btn btn-secondary btn-sm btn-none">Keine</button>
        </div>`}
      <div class="confirm-actions">
        <button class="btn btn-primary btn-save">Übernehmen</button>
        <button class="btn btn-secondary btn-cancel">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const boxes = () => [...overlay.querySelectorAll('.area-visibility-list input')];
  overlay.querySelector('.btn-all')?.addEventListener('click', () => boxes().forEach((b) => { b.checked = true; }));
  overlay.querySelector('.btn-none')?.addEventListener('click', () => boxes().forEach((b) => { b.checked = false; }));
  overlay.querySelector('.btn-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.btn-save').addEventListener('click', async () => {
    const hidden = boxes().filter((b) => !b.checked).map((b) => b.value);
    const res = await app.api.setHiddenAreas(hidden);
    if (!res || res.success !== true) { app.showToast('Fehler: ' + (res?.message || 'Speichern fehlgeschlagen'), 'error'); return; }
    close();
    await app.loadTags();
    app.showToast(hidden.length ? `${hidden.length} Themengebiet(e) ausgeblendet.` : 'Alle Themengebiete sichtbar.', 'success');
    onDone?.();
  });
}

export function chipHtml(tag) {
  const cls = `tag-chip${tag.isArea ? ' area-chip' : ''}${tag.isSchoolTag ? ' school-tag' : ''}`;
  const title = tag.isSchoolTag ? ' title="Vorgabe der Schule"' : '';
  return `<span class="${cls}"${title} style="--tag-color:${escapeAttr(tag.color || DEFAULT_TAG_COLOR)}">${tag.isArea ? '📁 ' : ''}${escapeHtml(tag.name)}</span>`;
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
 * - buildItem:   (Eintrag, Themengebiet-ID des Abschnitts | null) -> DOM-Element
 *                (wird je Abschnitt neu gebaut; das Gebiet steht schon in der
 *                Überschrift und muss auf der Karte nicht noch einmal stehen)
 * - buildHead:   Themengebiet -> HTML der Überschrift (Standard: Chip)
 * - countLabel:  Anzahl -> Text neben der Überschrift
 * - defaultOpen: Abschnitte anfangs offen statt zu
 * - expandAll:   alles offen, ohne es zu merken (z. B. bei aktivem Filter)
 * - showEmpty:   auch Themengebiete ohne Einträge zeigen
 * - respectHidden: persönlich ausgeblendete Themengebiete weglassen; was nur
 *                dort hinge, kommt in einen zugeklappten Abschnitt am Ende
 */
/**
 * Reihenfolge wie in renderAreaGroups: Themengebiete alphabetisch, dann "Ohne
 * Themengebiet", zuletzt nur ausgeblendete. Ein Eintrag mit mehreren Gebieten
 * zählt zum ersten. Innerhalb eines Gebiets bleibt die Eingabereihenfolge –
 * so lässt sich vorher sortieren und dann seitenweise blättern, ohne dass ein
 * Gebiet über mehrere Seiten verstreut ist.
 */
export function orderByArea(items, tags, respectHidden = false) {
  const allAreas = areaTags(tags);
  const hidden = new Set(respectHidden ? allAreas.filter((a) => a.hidden).map((a) => a.id) : []);
  const rank = new Map(allAreas.filter((a) => !hidden.has(a.id)).map((a, i) => [a.id, i]));
  const rankOf = (item) => {
    const ids = [...areasOfTagIds(item.tagIds, tags)];
    if (ids.length === 0) return rank.size;
    const shown = ids.filter((id) => rank.has(id)).map((id) => rank.get(id));
    return shown.length ? Math.min(...shown) : rank.size + 1;
  };
  return items.map((item, i) => [rankOf(item), i, item])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([, , item]) => item);
}

export function renderAreaGroups(container, items, opts) {
  const {
    tags, scope, buildItem, buildHead, countLabel,
    defaultOpen = false, expandAll = false, showEmpty = false, respectHidden = false,
  } = opts;
  const allAreas = areaTags(tags);
  if (allAreas.length === 0) return false;
  const hiddenAreas = new Set(respectHidden ? allAreas.filter((a) => a.hidden).map((a) => a.id) : []);
  const areas = allAreas.filter((a) => !hiddenAreas.has(a.id));

  const groups = new Map(areas.map((a) => [a.id, []]));
  const loose = [];
  const hiddenOnly = [];
  for (const item of items) {
    const ids = areasOfTagIds(item.tagIds, tags);
    const shown = [...ids].filter((id) => !hiddenAreas.has(id));
    if (ids.size === 0) loose.push(item);
    else if (shown.length === 0) hiddenOnly.push(item);
    else shown.forEach((id) => groups.get(id)?.push(item));
  }

  const toggled = loadToggled(scope);
  const section = (key, head, list, areaId = null) => {
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
    for (const item of list) body.appendChild(buildItem(item, areaId));
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
    if (list.length || showEmpty) section(area.id, buildHead ? buildHead(area) : chipHtml(area), list, area.id);
  }
  if (loose.length) section('__none__', '<span class="area-group-none">Ohne Themengebiet</span>', loose);
  if (hiddenOnly.length) {
    section('__hidden__', '<span class="area-group-none">🙈 Ausgeblendete Themengebiete</span>', hiddenOnly)
      .classList.add('area-group-hidden');
  }
  return true;
}

/**
 * Tag-Checkboxen für Filter und Formular. Mit Themengebieten in Zeilen:
 * Themengebiet vorn, seine Tags dahinter, zuletzt die Tags ohne Gebiet.
 * Ein Tag in mehreren Themengebieten hat mehrere Häkchen, die gemeinsam
 * umschalten.
 *
 * `visible(tag)` blendet Tags aus (Suche); `onToggle(id, checked)` meldet
 * jede Änderung. Persönlich ausgeblendete Themengebiete und ihre Tags fehlen,
 * außer sie sind gerade angehakt – eine bestehende Zuordnung bleibt sichtbar.
 */
function renderTagChoices(box, tags, selected, { visible: matches = () => true, onToggle }) {
  const hidden = hiddenTagIds(tags);
  const visible = (tag) => selected.has(tag.id) || (!hidden.has(tag.id) && matches(tag));
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

  const shownAreas = new Set();
  for (const area of areas) {
    if (hidden.has(area.id) && !selected.has(area.id)) continue;
    const children = plain.filter((t) => (t.areaIds || []).includes(area.id) && visible(t));
    if (!visible(area) && children.length === 0) continue;
    shownAreas.add(area.id);
    row(option(area), children);
  }
  // Ohne (sichtbares) Themengebiet – dazu angehakte Tags, deren Gebiete alle ausgeblendet sind.
  const loose = plain.filter((t) => !(t.areaIds || []).some((a) => shownAreas.has(a)) && visible(t));
  if (loose.length) row(null, loose);
}

// ==================== TAGS VIEW ====================

/**
 * Verwaltung der Schlagworte, mit denen Lernthemen und Themen-Links
 * eingeordnet werden. Bewusst eine gepflegte Liste statt freier Eingabe:
 * So steht "Arduino" nicht dreimal unterschiedlich geschrieben im Filter.
 */
export class TagsView {
  /**
   * Dieselbe Verwaltung für die eigenen Tags (Menü "Tags") und für die
   * Tag-Struktur der Schule ("Meine Schule"). Unterschiede:
   *   prefix – Präfix der Element-IDs (leer bzw. "school" → schoolTagName …)
   *   source – woher die Tags kommen und wohin Änderungen gehen
   *   scope  – Schlüssel für den gemerkten Auf-/Zu-Zustand
   * In den eigenen Tags stehen die Schul-Vorgaben schreibgeschützt mit drin.
   */
  constructor(app, { prefix = '', source = null, scope = 'tags' } = {}) {
    this.app = app;
    this._scope = scope;
    this._source = source || {
      load: () => app.loadTags(),
      create: (data) => app.api.createTag(data),
      update: (id, data) => app.api.updateTag(id, data),
      remove: (id) => app.api.deleteTag(id),
      editable: (tag) => !tag.isSchoolTag,
      hideable: true,
    };
    this._tags = [];

    const $ = (id) => document.getElementById(prefix ? prefix + id[0].toUpperCase() + id.slice(1) : id);
    this._list    = $('tagsList');
    this._form    = $('tagForm');
    this._input   = $('tagName');
    this._color   = $('tagColor');
    this._hex     = $('tagColorHex');
    this._btnCopyColor = $('btnCopyTagColor');
    this._editId  = null;
    this._btnCancel = $('btnCancelTag');
    this._formTitle = $('tagFormTitle');
    this._isArea  = $('tagIsArea');
    this._areaWrap = $('tagAreaChoicesWrap');
    this._areaBox = $('tagAreaChoices');
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
    const areas = areaTags(this._tags).filter((a) => a.id !== this._editId);
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
        ? await this._source.update(this._editId, { name, color, isArea, areaIds })
        : await this._source.create({ name, color, isArea, areaIds });
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
    const res = await this._source.remove(tag.id);
    if (!res || res.success !== true) {
      this.app.showToast('Löschen fehlgeschlagen: ' + (res?.message || 'unbekannter Fehler'), 'error');
      await this.refresh();
      return;
    }
    this.app.showToast(`${tag.isArea ? 'Themengebiet' : 'Tag'} gelöscht.`, 'info');
    if (this._editId === tag.id) this._resetForm();
    await this.refresh();
  }

  async refresh() {
    const loaded = await this._source.load();
    const tags = Array.isArray(loaded) ? loaded : [];
    this._tags = tags;
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
      scope: this._scope,
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
        if (!area) return;
        const head = group.querySelector('.area-group-head');
        if (area.hidden && this._source.hideable) {
          group.classList.add('area-group-hidden');
          head.querySelector('.area-group-count')?.insertAdjacentHTML('afterend', '<span class="hint">🙈 ausgeblendet</span>');
        }
        head.appendChild(this._actions(area));
      });
    } else {
      for (const tag of tags) this._list.appendChild(this._buildRow(tag));
    }
  }

  _usage(tag) {
    return `${tag.topicCount} Thema/Themen · ${tag.moduleCount || 0} Modul(e) · ${tag.linkCount} Link(s)`;
  }

  /**
   * Bearbeiten/Löschen; in einer Überschrift ohne Auf-/Zuklappen. Eine
   * Vorgabe der Schule ist hier nur zu sehen, gepflegt wird sie unter
   * "Meine Schule".
   */
  _actions(tag) {
    const span = document.createElement('span');
    span.className = 'tag-row-actions';
    // Ein-/Ausblenden ist persönlich und geht auch bei Vorgaben der Schule.
    if (this._source.hideable && tag.isArea) {
      const eye = document.createElement('button');
      eye.className = 'btn btn-secondary btn-sm btn-toggle-area';
      eye.textContent = tag.hidden ? '👁 Einblenden' : '🙈 Ausblenden';
      eye.title = tag.hidden
        ? 'Wieder in Filtern, Tag-Auswahl und Gliederung zeigen'
        : 'Interessiert mich nicht – in Filtern, Tag-Auswahl und Gliederung weglassen (nur für mich)';
      eye.addEventListener('click', (e) => { e.preventDefault(); this._toggleHidden(tag); });
      span.appendChild(eye);
    }
    if (!this._source.editable(tag)) {
      span.insertAdjacentHTML('beforeend', '<span class="hint" title="Gepflegt vom Schuladmin">🏫 Vorgabe der Schule</span>');
      return span;
    }
    span.insertAdjacentHTML('beforeend', `
      <button class="btn btn-secondary btn-sm btn-edit-tag">✏️ Bearbeiten</button>
      <button class="btn btn-danger btn-sm btn-delete-tag">🗑</button>`);
    span.querySelector('.btn-edit-tag').addEventListener('click', (e) => { e.preventDefault(); this._startEdit(tag); });
    span.querySelector('.btn-delete-tag').addEventListener('click', (e) => { e.preventDefault(); this._delete(tag); });
    return span;
  }

  async _toggleHidden(area) {
    const hidden = new Set(this._tags.filter((t) => t.isArea && t.hidden).map((t) => t.id));
    if (area.hidden) hidden.delete(area.id); else hidden.add(area.id);
    const res = await this.app.api.setHiddenAreas([...hidden]);
    if (!res || res.success !== true) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this.app.showToast(area.hidden ? `„${area.name}“ wird wieder angezeigt.` : `„${area.name}“ ausgeblendet – nur für dich.`, 'success');
    await this.refresh();
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

    // Persönliche Auswahl der Themengebiete direkt aus der Filterleiste.
    const modeLabel = this._modeToggle?.closest('label');
    if (modeLabel) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-sm btn-area-visibility';
      btn.textContent = '👁 Themengebiete';
      btn.title = 'Auswählen, welche Themengebiete dich interessieren';
      btn.addEventListener('click', () => openAreaVisibilityDialog(app, () => { this.render(); this._onChange?.(); }));
      modeLabel.after(btn);
    }
  }

  /** Trifft ein Eintrag (Thema oder Link) die aktuelle Tag-Auswahl? */
  matches(entity) {
    this._pruneSelection();
    if (this._selected.size === 0) return true;
    // Ein gewähltes Themengebiet trifft auch alles, was über einen seiner
    // Tags dazugehört.
    const tags = this.app.state.tags || [];
    const own = new Set([...(entity.tagIds || []), ...areasOfTagIds(entity.tagIds, tags)]);
    if (this._mode === 'all') return [...this._selected].every((id) => own.has(id));
    return [...this._selected].some((id) => own.has(id));
  }

  get selectedIds() {
    this._pruneSelection();
    return [...this._selected];
  }

  /**
   * Gelöschte Tags aus der Auswahl werfen. Sonst filterte ein Haken weiter,
   * den man nirgends mehr sieht – die Liste bliebe rätselhaft leer.
   */
  _pruneSelection() {
    const known = new Set((this.app.state.tags || []).map((t) => t.id));
    for (const id of [...this._selected]) if (!known.has(id)) this._selected.delete(id);
  }

  /**
   * Zeichnet die Tag-Checkboxen. Das Freitextfeld schränkt nur die
   * *Anzeige* der Tags ein – bereits angehakte Tags bleiben immer sichtbar,
   * sonst verschwände die eigene Auswahl beim Weitertippen.
   */
  render() {
    if (!this._chips) return;
    const all = this.app.state.tags || [];
    this._pruneSelection();
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
