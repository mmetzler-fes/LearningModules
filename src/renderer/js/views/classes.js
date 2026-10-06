import { escapeHtml, escapeAttr } from '../utils.js';
import { readStudentList, readClassLists, needsPassword, WrongPassword } from '../odf/student-list.js';
import { renderRetentionNotice } from './results.js';

// ==================== KLASSEN ====================

/** Antwort des Servers ein Fehler? Fehler kommen als JSON mit statusCode. */
const failed = (res) => !res || res.statusCode >= 400 || res.success === false;

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
 * Klasse für einen Klassenlink wählen: die eigenen Klassen des aktuellen
 * Schuljahrs als Knöpfe, darunter ein Feld für eine neue Klasse. Liefert die
 * Klasse oder `null` bei Abbruch.
 */
export async function pickClass(app, { title, hint = '' }) {
  const info = await app.api.getSchoolYear();
  if (failed(info)) { app.showToast('Fehler: ' + (info?.message || 'Schuljahr nicht abrufbar'), 'error'); return null; }
  const classes = await app.api.getClasses(info.current);
  if (failed(classes)) { app.showToast('Fehler: ' + (classes?.message || 'Klassen nicht abrufbar'), 'error'); return null; }

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card class-picker">
        <h3>${escapeHtml(title)}</h3>
        ${hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ''}
        ${classes.length
          ? `<div class="class-picker-list">${classes.map((c) => `
              <button type="button" class="btn btn-secondary class-picker-choice" data-id="${escapeAttr(c.id)}">🏫 ${escapeHtml(c.name)}</button>`).join('')}
            </div>`
          : `<p class="hint">Im ${escapeHtml(info.current)} hast du noch keine Klassen – lege gleich eine an.</p>`}
        <form class="class-picker-new">
          <input name="name" placeholder="Neue Klasse, z. B. TG12" maxlength="40" autocomplete="off" />
          <button type="submit" class="btn btn-primary btn-sm">➕ Anlegen und wählen</button>
        </form>
        <p class="hint">Schuljahr ${escapeHtml(info.current)}.</p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (value) => { overlay.remove(); resolve(value); };
    overlay.querySelector('.btn-cancel').addEventListener('click', () => done(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    overlay.querySelectorAll('.class-picker-choice').forEach((btn) => {
      btn.addEventListener('click', () => done(classes.find((c) => c.id === btn.dataset.id)));
    });
    const form = overlay.querySelector('.class-picker-new');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await app.api.createClass({ name: form.elements.name.value, schoolYear: info.current });
      if (failed(res)) { app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      app.showToast(`Klasse „${res.name}“ angelegt.`, 'success');
      done(res);
    });
    (overlay.querySelector('.class-picker-choice') || form.elements.name).focus();
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
    this._notices    = document.getElementById('classesNotices');
    this._detail     = document.getElementById('classDetail');
    this._fileInput  = document.getElementById('classImportFile');
    this._btnNew     = document.getElementById('btnNewClass');
    this._btnImportAll = document.getElementById('btnImportClasses');
    this._fileInputAll = document.getElementById('classesImportFile');

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
    this._btnImportAll?.addEventListener('click', () => this._fileInputAll.click());
    this._fileInputAll?.addEventListener('change', () => {
      const file = this._fileInputAll.files?.[0];
      this._fileInputAll.value = '';
      if (file) this._importClassesFile(file);
    });
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

  /** Nach dem Login einmal je Sitzung: Gibt es Klassen aus dem Vorjahr zu übernehmen? */
  async checkRollover() {
    try {
      if (sessionStorage.getItem('lm_rollover_hint')) return;
      sessionStorage.setItem('lm_rollover_hint', '1');
    } catch (_) { /* dann eben bei jedem Login */ }
    const offers = await this.app.api.getIncomingClassShares();
    if (!failed(offers) && offers.length) {
      this.app.showToast(`${offers.length} geteilte Klasse(n) warten auf dich – unter 🏫 Klassen.`, 'info');
    }
    const info = await this.app.api.getRollover();
    if (failed(info) || !info.classes?.length) return;
    this.app.showToast(`Neues Schuljahr ${info.to}: ${info.classes.length} Klasse(n) aus ${info.from} übernehmen – unter 🏫 Klassen.`, 'info');
  }

  /** Hinweise über der Klassenliste: Schuljahreswechsel. */
  async _renderNotices() {
    this._notices.innerHTML = '';
    const retention = document.createElement('div');
    this._notices.appendChild(retention);
    renderRetentionNotice(this.app, retention);
    const offers = await this.app.api.getIncomingClassShares();
    for (const offer of failed(offers) ? [] : offers) {
      const box = document.createElement('div');
      box.className = 'class-notice';
      box.innerHTML = `
        <div><strong>👥 ${escapeHtml(offer.fromName)}</strong> teilt die Klasse <strong>${escapeHtml(offer.className)}</strong>
          (${escapeHtml(offer.schoolYear || '')}) mit dir. Annehmen legt eine eigene Klasse mit dieser Schülerliste an.</div>
        <div class="link-card-actions">
          <button class="btn btn-primary btn-sm btn-accept">Annehmen</button>
          <button class="btn btn-secondary btn-sm btn-decline">Ablehnen</button>
        </div>`;
      const answer = async (accept) => {
        const res = await this.app.api.answerClassShare(offer.id, accept);
        if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); this.refresh(); return; }
        if (accept) {
          this.app.showToast(`Klasse „${res.class.name}“ mit ${res.students} Schülern angelegt.`, 'success');
          this._year = res.class.schoolYear;
        }
        this.refresh();
      };
      box.querySelector('.btn-accept').addEventListener('click', () => answer(true));
      box.querySelector('.btn-decline').addEventListener('click', () => answer(false));
      this._notices.appendChild(box);
    }

    if (this._year !== this._currentYear) return;
    const info = await this.app.api.getRollover();
    if (failed(info) || !info.classes?.length) return;
    const box = document.createElement('div');
    box.className = 'class-notice';
    box.innerHTML = `
      <div><strong>📅 Neues Schuljahr ${escapeHtml(info.to)}</strong> – ${info.classes.length} Klasse(n) aus ${escapeHtml(info.from)}
        warten auf deine Entscheidung: übernehmen (mit Schülerliste) oder nicht mehr benötigt.</div>
      <button class="btn btn-primary btn-sm">Klassen übernehmen …</button>`;
    box.querySelector('button').addEventListener('click', () => this._openRollover(info));
    this._notices.appendChild(box);
  }

  /** Assistent: je Klasse des Vorjahres übernehmen (mit neuem Namen) oder aufgeben. */
  _openRollover(info) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card class-import-preview rollover-card">
        <h3>📅 Klassen ins ${escapeHtml(info.to)} übernehmen</h3>
        <p class="hint">Übernommen wird die Schülerliste (bestätigte Schüler); die Klasse aus ${escapeHtml(info.from)} bleibt mit
          ihren Ergebnissen erhalten. <strong>Links mitnehmen</strong> hängt ihre Klassenlinks an die neue Klasse – ausgeteilte
          QR-Codes gelten weiter. Nicht angehakte Klassen gelten als nicht mehr benötigt; ihre Klassenlinks werden deaktiviert.</p>
        <table class="class-students">
          <thead><tr><th>Übernehmen</th><th>${escapeHtml(info.from)}</th><th>Name im ${escapeHtml(info.to)}</th><th>Schüler</th><th>Links mitnehmen</th></tr></thead>
          <tbody>${info.classes.map((c) => `
            <tr data-id="${escapeAttr(c.id)}">
              <td><input type="checkbox" class="ro-take" checked /></td>
              <td>${escapeHtml(c.name)}</td>
              <td><input type="text" class="ro-name" maxlength="40" value="${escapeAttr(c.suggestedName)}" /></td>
              <td>${c.studentCount}</td>
              <td>${c.linkCount ? `<label><input type="checkbox" class="ro-links" checked /> ${c.linkCount}</label>` : '–'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="confirm-actions">
          <button class="btn btn-primary btn-ok">Übernehmen</button>
          <button class="btn btn-secondary btn-cancel">Später</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelectorAll('tr[data-id]').forEach((row) => {
      const take = row.querySelector('.ro-take');
      const sync = () => row.querySelectorAll('.ro-name, .ro-links').forEach((el) => { el.disabled = !take.checked; });
      take.addEventListener('change', sync);
    });
    overlay.querySelector('.btn-cancel').addEventListener('click', close);
    overlay.querySelector('.btn-ok').addEventListener('click', async () => {
      const items = [...overlay.querySelectorAll('tr[data-id]')].map((row) => ({
        classId: row.dataset.id,
        take: row.querySelector('.ro-take').checked,
        name: row.querySelector('.ro-name').value,
        moveLinks: !!row.querySelector('.ro-links')?.checked,
      }));
      const dropped = items.filter((i) => !i.take).length;
      if (dropped && !(await this.app.appConfirm(`${dropped} Klasse(n) nicht übernehmen? Ihre Klassenlinks werden deaktiviert; die Ergebnisse bleiben.`))) return;
      const res = await this.app.api.rollover(items);
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      close();
      this.app.showToast(`${res.taken.length} Klasse(n) übernommen${res.dropped.length ? `, ${res.dropped.length} nicht mehr benötigt` : ''}.`, 'success');
      this._year = info.to;
      this.refresh();
    });
  }

  async _renderList() {
    this._renderNotices();
    this._detail.classList.add('hidden');
    this._detail.innerHTML = '';
    this._list.classList.remove('hidden');
    this._btnNew.classList.remove('hidden');
    this._btnImportAll?.classList.remove('hidden');

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
            ${c.linkCount ? ` · ${c.linkCount === 1 ? '1 Klassenlink' : `${c.linkCount} Klassenlinks`}` : ''}
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
    const links = c.linkCount
      ? `\n\nAuch ${c.linkCount === 1 ? 'ihr Klassenlink wird' : `ihre ${c.linkCount} Klassenlinks werden`} gelöscht – verteilte QR-Codes führen dann ins Leere.`
      : '';
    const ok = await this.app.appConfirm(
      `Klasse „${c.name}“ (${c.schoolYear}) mit ihrer Schülerliste löschen?${links}\n\nBereits gespeicherte Ergebnisse bleiben erhalten.`,
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
    this._notices.innerHTML = '';
    this._btnNew.classList.add('hidden');
    this._btnImportAll?.classList.add('hidden');
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
          <button class="btn btn-secondary btn-sm btn-class-share" title="Kolleginnen und Kollegen bekommen eine eigene Kopie mit dieser Schülerliste">👥 Teilen</button>
        </div>
      </div>
      <p class="hint class-shares-line"></p>
      <p class="hint">${students.length === 1 ? '1 Schüler' : `${students.length} Schüler`}${pending ? ` · ${pending} unbestätigt – bei der Anmeldung entstanden: bestätigen (✓) oder einem Schüler zuordnen (⇄)` : ''}</p>
      <label class="tag-filter-mode class-strict-toggle">
        <input type="checkbox" class="chk-class-strict" ${klasse.strict ? 'checked' : ''} />
        <span><strong>🔒 strikt</strong> – über Klassenlinks kommt nur hinein, wer eindeutig in der Liste steht
          (Vorname, bei Gleichnamigen dazu der Anfang des Nachnamens). Aus: Unbekannte Namen kommen als
          unbestätigte Einträge dazu – praktisch kurz für Nachzügler.</span>
      </label>

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
                  ${s.status === 'pending' && students.some((o) => o.status === 'confirmed') ? '<button class="btn btn-secondary btn-sm btn-student-merge" title="Einem Schüler der Liste zuordnen – seine Ergebnisse gehen mit">⇄</button>' : ''}
                  <button class="btn btn-secondary btn-sm btn-student-edit" title="Bearbeiten">✏️</button>
                  <button class="btn btn-danger btn-sm btn-student-delete" title="Entfernen">🗑</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>`}`;

    const byId = new Map(students.map((s) => [s.id, s]));
    this._detail.querySelector('.chk-class-strict').addEventListener('change', async (e) => {
      const res = await this.app.api.updateClass(klasse.id, { strict: e.target.checked });
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); e.target.checked = !e.target.checked; return; }
      this.app.showToast(e.target.checked
        ? `${klasse.name}: strikt – nur Schüler aus der Liste.`
        : `${klasse.name}: offen – neue Namen kommen als unbestätigte Einträge dazu.`, 'info');
    });
    this._detail.querySelector('.btn-class-back').addEventListener('click', () => { this._openId = null; this.refresh(); });
    this._detail.querySelector('.btn-class-import').addEventListener('click', () => this._fileInput.click());
    this._detail.querySelector('.btn-class-rename').addEventListener('click', () => this._renameClass(klasse));
    this._detail.querySelector('.btn-class-share').addEventListener('click', () => this._shareClass(klasse));
    this.app.api.getClassShares(klasse.id).then((shares) => {
      const line = this._detail.querySelector('.class-shares-line');
      if (!line || failed(shares) || !shares.length) return;
      const label = { offered: 'offen', accepted: 'angenommen', declined: 'abgelehnt' };
      line.textContent = 'Geteilt mit: ' + shares.map((s) => `${s.toName} (${label[s.status] || s.status})`).join(', ');
    });

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
      row.querySelector('.btn-student-merge')?.addEventListener('click', () => this._mergeStudent(klasse, s, students));
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

  /** Klasse Kolleginnen und Kollegen der eigenen Schule anbieten. */
  async _shareClass(klasse) {
    const colleagues = await this.app.api.getColleagues();
    if (failed(colleagues) || !colleagues.length) {
      this.app.showToast('Keine Kolleginnen und Kollegen deiner Schule gefunden.', 'info');
      return;
    }
    const chosen = await new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="import-modules-card class-import-preview">
          <h3>👥 „${escapeHtml(klasse.name)}“ teilen</h3>
          <p class="hint">Wer annimmt, bekommt eine eigene Klasse mit Name und Schülerliste (Stand beim Annehmen).
            Danach sind beide unabhängig; Ergebnisse sieht jede Lehrkraft nur von ihren eigenen Links.</p>
          <input type="search" class="search-input share-filter" placeholder="Name suchen…" style="width:100%;margin-bottom:8px" />
          <div class="share-list">${colleagues
            .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'))
            .map((c) => `<label class="tag-filter-option" data-text="${escapeAttr(`${c.displayName} ${c.email}`.toLowerCase())}">
              <input type="checkbox" value="${escapeAttr(c.id)}" /> ${escapeHtml(c.displayName)} <small class="hint">${escapeHtml(c.email)}</small></label>`).join('')}
          </div>
          <div class="confirm-actions">
            <button class="btn btn-primary btn-ok">Angebot senden</button>
            <button class="btn btn-secondary btn-cancel">Abbrechen</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('.share-filter').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        overlay.querySelectorAll('.share-list label').forEach((l) => { l.style.display = !q || l.dataset.text.includes(q) ? '' : 'none'; });
      });
      overlay.querySelector('.btn-ok').addEventListener('click', () =>
        done([...overlay.querySelectorAll('.share-list input:checked')].map((b) => b.value)));
      overlay.querySelector('.btn-cancel').addEventListener('click', () => done(null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    });
    if (!chosen || !chosen.length) return;
    const res = await this.app.api.shareClass(klasse.id, chosen);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this.app.showToast(res.offered ? `Angebot an ${res.offered} Person(en) gesendet.` : 'Die Angebote waren schon offen.', 'success');
    this._renderDetail();
  }

  /** Unbestätigten Eintrag einem Schüler zuordnen. */
  async _mergeStudent(klasse, pending, students) {
    const targets = students.filter((o) => o.status === 'confirmed');
    const target = await new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="import-modules-card">
          <h3>⇄ „${escapeHtml(`${pending.firstName} ${pending.lastName}`.trim())}“ zuordnen</h3>
          <p class="hint">Wer war das? Seine Ergebnisse gehen auf diesen Schüler über, der unbestätigte Eintrag verschwindet.</p>
          <select class="merge-target" size="${Math.min(10, targets.length)}" style="width:100%">
            ${targets.map((o) => `<option value="${escapeAttr(o.id)}">${escapeHtml(`${o.lastName}, ${o.firstName}`)}</option>`).join('')}
          </select>
          <div class="confirm-actions">
            <button class="btn btn-primary btn-ok">Zuordnen</button>
            <button class="btn btn-secondary btn-cancel">Abbrechen</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const done = (v) => { overlay.remove(); resolve(v); };
      const select = overlay.querySelector('.merge-target');
      overlay.querySelector('.btn-ok').addEventListener('click', () => done(select.value || null));
      select.addEventListener('dblclick', () => done(select.value || null));
      overlay.querySelector('.btn-cancel').addEventListener('click', () => done(null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    });
    if (!target) return;
    const res = await this.app.api.mergeClassStudent(klasse.id, pending.id, target);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this.app.showToast(`Zugeordnet${res.moved ? ` – ${res.moved} Ergebnis(se) übernommen` : ''}.`, 'success');
    this._renderDetail();
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
  /**
   * Datei öffnen – bei Bedarf mit Passwort, das nur hier im Browser bleibt.
   * `reader` liest den Inhalt; `null` bei Abbruch oder Fehler (mit Meldung).
   */
  async _readFile(file, reader) {
    try {
      let password = null;
      if (await needsPassword(file)) {
        const values = await formDialog({
          title: '🔒 Passwort der Datei',
          hint: 'Die Datei ist verschlüsselt – im SchülerLernTool mit dem App-Passwort. '
            + 'Entschlüsselt wird nur hier im Browser; das Passwort wird nicht übertragen.',
          fields: [{ name: 'password', label: 'Passwort', type: 'password' }],
          submitLabel: 'Öffnen',
        });
        if (!values) return null;
        password = values.password;
      }
      return await reader(file, password);
    } catch (err) {
      this.app.showToast(err instanceof WrongPassword ? err.message : 'Datei nicht lesbar: ' + err.message, 'error');
      return null;
    }
  }

  async _importFile(classId, file) {
    const list = await this._readFile(file, readStudentList);
    if (!list) return;
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

  /** Export „Klassen für LearningModules“ (oder eine Klassenliste): Vorschau, dann alle übernehmen. */
  async _importClassesFile(file) {
    const lists = await this._readFile(file, readClassLists);
    if (!lists) return;
    const classes = lists
      .filter((l) => l.students.length || l.className)
      .map((l) => ({ name: l.className || '', classId: l.classId || null, students: l.students }));
    if (classes.some((c) => !c.name)) {
      this.app.showToast('In der Datei fehlt der Klassenname („Klasse“ in Zeile 1). Eine einzelne Liste bitte in der Klasse selbst einlesen.', 'error');
      return;
    }
    if (classes.length === 0) { this.app.showToast('Die Datei enthält keine Klassen.', 'info'); return; }

    const payload = { classes, schoolYear: this._year };
    const preview = await this.app.api.importClasses({ ...payload, dryRun: true });
    if (failed(preview)) { this.app.showToast('Fehler: ' + (preview?.message || '?'), 'error'); return; }
    const choice = await this._confirmClassesImport(preview.classes);
    if (!choice) return;

    const res = await this.app.api.importClasses({ ...payload, strict: choice.strict });
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    const added = res.classes.reduce((n, c) => n + c.added, 0);
    const created = res.classes.filter((c) => !c.exists).length;
    this.app.showToast(`${res.classes.length} Klassen eingelesen (${created} neu), ${added} Schüler aufgenommen${choice.strict ? ', strikt' : ''}.`, 'success');
    const years = [...new Set(res.classes.map((c) => c.schoolYear))];
    if (years.length === 1) this._year = years[0];
    this._openId = null;
    this.refresh();
  }

  _confirmClassesImport(rows) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="import-modules-card class-import-preview">
          <h3>📥 Klassen einlesen</h3>
          <table class="class-students">
            <thead><tr><th>Klasse</th><th>Schuljahr</th><th></th><th>Schüler</th></tr></thead>
            <tbody>${rows.map((c) => `
              <tr>
                <td>${escapeHtml(c.name)}</td>
                <td>${escapeHtml(c.schoolYear)}</td>
                <td>${c.exists ? 'vorhanden' : '<strong>neu</strong>'}</td>
                <td>${[c.added ? `${c.added} neu` : '', c.updated ? `${c.updated} aktualisiert` : '', c.unchanged ? `${c.unchanged} unverändert` : '']
                  .filter(Boolean).join(', ') || '–'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
          <label class="tag-filter-mode class-strict-choice"><input type="checkbox" class="chk-strict" checked />
            <span><strong>🔒 Danach strikt</strong> – über Klassenlinks kommt nur hinein, wer eindeutig in der Liste steht.
              Für Nachzügler lässt sich das je Klasse kurz ausschalten.</span></label>
          <p class="hint">Schüler, die schon in einer Klasse stehen, aber in der Datei fehlen, bleiben erhalten.</p>
          <div class="confirm-actions">
            <button class="btn btn-primary btn-ok">Übernehmen</button>
            <button class="btn btn-secondary btn-cancel">Abbrechen</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('.btn-ok').addEventListener('click', () => done({ strict: overlay.querySelector('.chk-strict').checked }));
      overlay.querySelector('.btn-cancel').addEventListener('click', () => done(null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    });
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
