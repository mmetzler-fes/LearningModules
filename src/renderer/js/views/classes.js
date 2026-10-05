import { escapeHtml, escapeAttr } from '../utils.js';
import { readStudentList, needsPassword, WrongPassword } from '../odf/student-list.js';

// ==================== KLASSEN ====================

/** Antwort des Servers ein Fehler? Fehler kommen als JSON mit statusCode. */
const failed = (res) => !res || res.statusCode >= 400;

/**
 * Kleiner Formulardialog. `fields`: [{ name, label, value, type, placeholder }].
 * Liefert die Werte als Objekt oder `null` bei Abbruch.
 */
export function formDialog({ title, hint = '', fields, submitLabel = 'Speichern' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <form class="import-modules-card form-dialog">
        <h3>${escapeHtml(title)}</h3>
        ${hint ? `<p class="hint">${hint}</p>` : ''}
        ${fields.map((f) => `
          <div class="form-group">
            <label>${escapeHtml(f.label)}
              <input name="${escapeAttr(f.name)}" type="${escapeAttr(f.type || 'text')}" value="${escapeAttr(f.value || '')}"
                     placeholder="${escapeAttr(f.placeholder || '')}" maxlength="80" autocomplete="off" />
            </label>
          </div>`).join('')}
        <div class="confirm-actions">
          <button type="submit" class="btn btn-primary">${escapeHtml(submitLabel)}</button>
          <button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const done = (value) => { overlay.remove(); resolve(value); };
    overlay.querySelector('.btn-cancel').addEventListener('click', () => done(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      done(Object.fromEntries(fields.map((f) => [f.name, form.elements[f.name].value])));
    });
    form.querySelector('input')?.focus();
  });
}

/**
 * Klassen der Lehrkraft je Schuljahr, mit Schülerliste und Import der
 * Klassenliste aus dem SchülerLernTool.
 */
export class ClassesView {
  constructor(app) {
    this.app = app;
    this._yearSelect = document.getElementById('classYear');
    this._list       = document.getElementById('classesList');
    this._detail     = document.getElementById('classDetail');
    this._fileInput  = document.getElementById('classImportFile');
    this._btnNew     = document.getElementById('btnNewClass');

    this._year = null;
    this._currentYear = null;
    /** Geöffnete Klasse (Schülerliste) oder null für die Übersicht. */
    this._openId = null;

    this._bindEvents();
  }

  _bindEvents() {
    this._yearSelect?.addEventListener('change', () => {
      this._year = this._yearSelect.value;
      this._openId = null;
      this.refresh();
    });
    this._btnNew?.addEventListener('click', () => this._createClass());
    this._fileInput?.addEventListener('change', () => {
      const file = this._fileInput.files?.[0];
      this._fileInput.value = '';
      if (file && this._openId) this._importFile(this._openId, file);
    });
  }

  async refresh() {
    const info = await this.app.api.getSchoolYear();
    if (failed(info)) {
      this.app.showToast('Fehler: ' + (info?.message || 'Schuljahr nicht abrufbar'), 'error');
      return;
    }
    this._currentYear = info.current;
    if (!this._year || !info.years.includes(this._year)) this._year = info.current;
    this._yearSelect.innerHTML = info.years
      .map((y) => `<option value="${escapeAttr(y)}" ${y === this._year ? 'selected' : ''}>${escapeHtml(y)}${y === info.current ? ' (aktuell)' : ''}</option>`)
      .join('');

    if (this._openId) await this._renderDetail();
    else await this._renderList();
  }

  // ---- Übersicht ----

  async _renderList() {
    this._detail.classList.add('hidden');
    this._detail.innerHTML = '';
    this._list.classList.remove('hidden');
    this._btnNew.classList.remove('hidden');

    const classes = await this.app.api.getClasses(this._year);
    if (failed(classes)) {
      this._list.innerHTML = `<p class="hint">Fehler: ${escapeHtml(classes?.message || 'Klassen nicht abrufbar')}</p>`;
      return;
    }
    if (classes.length === 0) {
      this._list.innerHTML = `<div class="empty-state"><p>Im ${escapeHtml(this._year)} hast du noch keine Klassen.</p></div>`;
      return;
    }
    this._list.innerHTML = '';
    for (const c of classes) {
      const card = document.createElement('div');
      card.className = 'link-card class-card';
      card.innerHTML = `
        <div class="link-card-main">
          <h3 class="link-card-title">🏫 ${escapeHtml(c.name)}</h3>
          <p class="link-card-meta">
            ${c.studentCount === 1 ? '1 Schüler' : `${c.studentCount} Schüler`}
            ${c.pendingCount ? ` · <span class="class-pending-note">${c.pendingCount} unbestätigt</span>` : ''}
            ${c.strict ? ' · 🔒 strikt' : ''}
          </p>
        </div>
        <div class="link-card-actions">
          <button class="btn btn-primary btn-sm btn-class-open">👥 Schülerliste</button>
          <button class="btn btn-secondary btn-sm btn-class-rename">✏️ Umbenennen</button>
          <button class="btn btn-danger btn-sm btn-class-delete" title="Klasse löschen">🗑</button>
        </div>`;
      card.querySelector('.btn-class-open').addEventListener('click', () => { this._openId = c.id; this.refresh(); });
      card.querySelector('.btn-class-rename').addEventListener('click', () => this._renameClass(c));
      card.querySelector('.btn-class-delete').addEventListener('click', () => this._deleteClass(c));
      this._list.appendChild(card);
    }
  }

  async _createClass() {
    const values = await formDialog({
      title: `➕ Neue Klasse im ${this._year}`,
      fields: [{ name: 'name', label: 'Klassenname', placeholder: 'z. B. TG12' }],
      submitLabel: 'Anlegen',
    });
    if (!values) return;
    const res = await this.app.api.createClass({ name: values.name, schoolYear: this._year });
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this.app.showToast(`Klasse „${res.name}“ angelegt.`, 'success');
    this._openId = res.id;
    this.refresh();
  }

  async _renameClass(c) {
    const values = await formDialog({
      title: '✏️ Klasse umbenennen',
      hint: 'Zum Schuljahreswechsel bitte nicht umbenennen, sondern die Klasse ins neue Schuljahr übernehmen – '
        + 'sonst stehen die Ergebnisse des alten Jahres unter dem neuen Namen.',
      fields: [{ name: 'name', label: 'Klassenname', value: c.name }],
    });
    if (!values) return;
    const res = await this.app.api.updateClass(c.id, { name: values.name });
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this.refresh();
  }

  async _deleteClass(c) {
    const ok = await this.app.appConfirm(
      `Klasse „${c.name}“ (${c.schoolYear}) mit ihrer Schülerliste löschen?\n\nBereits gespeicherte Ergebnisse bleiben erhalten.`,
    );
    if (!ok) return;
    const res = await this.app.api.deleteClass(c.id);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    if (this._openId === c.id) this._openId = null;
    this.app.showToast(`Klasse „${c.name}“ gelöscht.`, 'info');
    this.refresh();
  }

  // ---- Schülerliste ----

  async _renderDetail() {
    const klasse = await this.app.api.getClass(this._openId);
    if (failed(klasse)) {
      this._openId = null;
      return this._renderList();
    }
    this._list.classList.add('hidden');
    this._btnNew.classList.add('hidden');
    this._detail.classList.remove('hidden');

    const students = klasse.students || [];
    const pending = students.filter((s) => s.status === 'pending').length;
    this._detail.innerHTML = `
      <div class="class-detail-head">
        <button class="btn btn-secondary btn-sm btn-class-back">← Alle Klassen</button>
        <h3>🏫 ${escapeHtml(klasse.name)} <span class="class-year">${escapeHtml(klasse.schoolYear || '')}</span></h3>
        <div class="link-card-actions">
          <button class="btn btn-secondary btn-sm btn-class-import" title="Klassenliste aus dem SchülerLernTool oder Tabelle mit Name und Vorname">📥 Schülerliste einlesen</button>
          <button class="btn btn-secondary btn-sm btn-class-rename">✏️ Umbenennen</button>
        </div>
      </div>
      <p class="hint">${students.length === 1 ? '1 Schüler' : `${students.length} Schüler`}${pending ? ` · ${pending} unbestätigt – bei der Anmeldung entstanden, bitte prüfen` : ''}</p>

      <form class="class-add-student">
        <input name="firstName" placeholder="Vorname(n)" maxlength="80" autocomplete="off" required />
        <input name="lastName" placeholder="Name" maxlength="80" autocomplete="off" />
        <button type="submit" class="btn btn-primary btn-sm">➕ Schüler</button>
      </form>

      ${students.length === 0
        ? '<div class="empty-state"><p>Noch keine Schüler. Lege sie hier an oder lies die Klassenliste ein.</p></div>'
        : `<table class="class-students">
            <thead><tr><th>Name</th><th>Vorname</th><th></th><th></th></tr></thead>
            <tbody>${students.map((s) => `
              <tr data-id="${escapeAttr(s.id)}" class="${s.status === 'pending' ? 'is-pending' : ''}">
                <td>${escapeHtml(s.lastName) || '<span class="hint">–</span>'}</td>
                <td>${escapeHtml(s.firstName)}</td>
                <td>${s.status === 'pending' ? '<span class="class-pending-note">unbestätigt</span>' : ''}</td>
                <td class="class-student-actions">
                  ${s.status === 'pending' ? '<button class="btn btn-secondary btn-sm btn-student-confirm" title="Bestätigen">✓</button>' : ''}
                  <button class="btn btn-secondary btn-sm btn-student-edit" title="Bearbeiten">✏️</button>
                  <button class="btn btn-danger btn-sm btn-student-delete" title="Entfernen">🗑</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>`}`;

    const byId = new Map(students.map((s) => [s.id, s]));
    this._detail.querySelector('.btn-class-back').addEventListener('click', () => { this._openId = null; this.refresh(); });
    this._detail.querySelector('.btn-class-import').addEventListener('click', () => this._fileInput.click());
    this._detail.querySelector('.btn-class-rename').addEventListener('click', () => this._renameClass(klasse));

    const addForm = this._detail.querySelector('.class-add-student');
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await this.app.api.addClassStudent(klasse.id, {
        firstName: addForm.elements.firstName.value,
        lastName: addForm.elements.lastName.value,
      });
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      await this._renderDetail();
      this._detail.querySelector('.class-add-student input')?.focus();
    });

    this._detail.querySelectorAll('tr[data-id]').forEach((row) => {
      const s = byId.get(row.dataset.id);
      row.querySelector('.btn-student-confirm')?.addEventListener('click', () => this._updateStudent(klasse.id, s, { confirm: true }));
      row.querySelector('.btn-student-edit').addEventListener('click', async () => {
        const values = await formDialog({
          title: '✏️ Schüler bearbeiten',
          fields: [
            { name: 'firstName', label: 'Vorname(n)', value: s.firstName },
            { name: 'lastName', label: 'Name', value: s.lastName },
          ],
        });
        if (values) this._updateStudent(klasse.id, s, { ...values, confirm: true });
      });
      row.querySelector('.btn-student-delete').addEventListener('click', async () => {
        if (!(await this.app.appConfirm(`„${s.firstName} ${s.lastName}“ aus der Klasse entfernen?`))) return;
        const res = await this.app.api.deleteClassStudent(klasse.id, s.id);
        if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
        this._renderDetail();
      });
    });
  }

  async _updateStudent(classId, student, data) {
    const res = await this.app.api.updateClassStudent(classId, student.id, data);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this._renderDetail();
  }

  // ---- Import ----

  /**
   * Datei lesen (im Browser, auch das Passwort bleibt hier), Vorschau vom
   * Server holen, nach Bestätigung übernehmen.
   */
  async _importFile(classId, file) {
    let list;
    try {
      let password = null;
      if (await needsPassword(file)) {
        const values = await formDialog({
          title: '🔒 Passwort der Klassenliste',
          hint: 'Die Datei ist verschlüsselt – im SchülerLernTool mit dem App-Passwort. '
            + 'Entschlüsselt wird nur hier im Browser; das Passwort wird nicht übertragen.',
          fields: [{ name: 'password', label: 'Passwort', type: 'password' }],
          submitLabel: 'Öffnen',
        });
        if (!values) return;
        password = values.password;
      }
      list = await readStudentList(file, password);
    } catch (err) {
      this.app.showToast(err instanceof WrongPassword ? err.message : 'Datei nicht lesbar: ' + err.message, 'error');
      return;
    }
    if (list.students.length === 0) {
      this.app.showToast('Die Datei enthält keine Schüler.', 'info');
      return;
    }

    const preview = await this.app.api.importClassStudents(classId, list.students, true);
    if (failed(preview)) { this.app.showToast('Fehler: ' + (preview?.message || '?'), 'error'); return; }
    if (preview.added === 0 && preview.updated === 0) {
      this.app.showToast(`Nichts zu ändern – alle ${preview.unchanged} Schüler sind schon in der Klasse.`, 'info');
      return;
    }
    if (!(await this._confirmImport(list, preview))) return;

    const res = await this.app.api.importClassStudents(classId, list.students, false);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this.app.showToast(`Übernommen: ${res.added} neu, ${res.updated} aktualisiert.`, 'success');
    this._renderDetail();
  }

  _confirmImport(list, preview) {
    const names = (arr) => arr.map((n) => `<li>${escapeHtml(n)}</li>`).join('');
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="import-modules-card class-import-preview">
          <h3>📥 Schülerliste einlesen</h3>
          ${list.className ? `<p class="hint">Aus der Datei: Klasse „${escapeHtml(list.className)}“.</p>` : ''}
          ${preview.added ? `<p><strong>${preview.added} neu</strong></p><ul>${names(preview.addNames)}</ul>` : ''}
          ${preview.updated ? `<p><strong>${preview.updated} aktualisiert</strong></p><ul>${names(preview.updateNames)}</ul>` : ''}
          ${preview.unchanged ? `<p>${preview.unchanged} unverändert</p>` : ''}
          ${preview.duplicates.length ? `<p class="link-card-warning">⚠️ Mehrfach in der Datei: ${escapeHtml(preview.duplicates.join(', '))}</p>` : ''}
          <p class="hint">Schüler, die in der Datei fehlen, bleiben in der Klasse.</p>
          <div class="confirm-actions">
            <button class="btn btn-primary btn-ok">Übernehmen</button>
            <button class="btn btn-secondary btn-cancel">Abbrechen</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('.btn-ok').addEventListener('click', () => done(true));
      overlay.querySelector('.btn-cancel').addEventListener('click', () => done(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    });
  }
}
