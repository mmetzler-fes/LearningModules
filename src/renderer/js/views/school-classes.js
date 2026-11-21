import { escapeHtml, escapeAttr } from '../utils.js';
import { readSchoolRoster, needsPassword, WrongPassword } from '../odf/student-list.js';
import { buildOds, buildXlsx, buildCsv } from '../odf/sheet-templates.js';
import { downloadBlob } from '../api.js';
import { formDialog } from './classes.js';
import { showContextMenu } from '../utils.js';

// ==================== SCHULADMIN: KLASSEN DER SCHULE ====================
//
// Eine Tabelle mit Nachname, Vorname, Klasse und UserID für alle Klassen einlesen. Gleicher
// Klassenname: aktualisieren. Anderer Name, teilweise dieselben Schüler: übersprungen, mit Grund.
// Lehrkräfte übernehmen Klassen daraus – mit Autoregistrierung sofort, sonst nach Freigabe hier.

const failed = (res) => !res || res.statusCode >= 400 || res.success === false;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export class SchoolClassesView {
  constructor(app) {
    this.app = app;
    this._box = document.getElementById('schoolClassesList');
    this._year = null;
    this._open = new Set();
    this._file = document.getElementById('schoolClassesFile');
    document.getElementById('btnSchoolClassesImport')?.addEventListener('click', () => this._file.click());
    document.getElementById('btnSchoolClassesTemplate')?.addEventListener('click', (e) => this._templateMenu(e.currentTarget));
    document.getElementById('btnSchoolClassesPromote')?.addEventListener('click', () => void this._promote());
    document.getElementById('schoolClassesYear')?.addEventListener('change', (e) => { this._year = e.target.value; this.refresh(); });
    this._file?.addEventListener('change', () => {
      const file = this._file.files?.[0];
      this._file.value = '';
      if (file) void this._import(file);
    });
  }

  /** Nach der Anmeldung: Warten Lehrkräfte auf eine Freigabe? Hinweis und Zähler am Menüpunkt. */
  async checkPending({ toast = true } = {}) {
    const res = await this.app.api.getSchoolClassRequestsPending().catch(() => null);
    const n = Number(res?.pending || 0);
    const badge = document.getElementById('navSchoolClassesAlert');
    if (badge) { badge.textContent = String(n); badge.classList.toggle('hidden', !n); }
    if (n && toast) {
      this.app.showToast(`🎓 ${n === 1 ? 'Eine Lehrkraft wartet' : `${n} Anfragen warten`} auf die Freigabe einer Klasse – Schuladmin → Klassen der Schule.`, 'info');
    }
  }

  async refresh() {
    const data = await this.app.api.getSchoolClassesAdmin(this._year);
    if (failed(data)) { this._box.innerHTML = `<p class="hint">Fehler: ${escapeHtml(data?.message || 'nicht abrufbar')}</p>`; return; }
    this._year = data.schoolYear;
    const sel = document.getElementById('schoolClassesYear');
    if (sel) {
      sel.innerHTML = data.years.map((y) => `<option value="${escapeAttr(y)}" ${y === data.schoolYear ? 'selected' : ''}>${escapeHtml(y)}${y === data.current ? ' (aktuell)' : ''}</option>`).join('');
    }
    void this.checkPending({ toast: false });
    const classes = data.classes;
    this._data = data;
    const waiting = classes.flatMap((c) => c.requests.filter((r) => r.status === 'pending').map((r) => ({ ...r, className: c.name })));
    const allAuto = classes.length && classes.every((c) => c.autoRegister);
    this._box.innerHTML = `
      ${waiting.length ? `<div class="link-card class-request-box">
        <h3>⏳ ${plural(waiting.length, 'Lehrkraft wartet', 'Anfragen warten')} auf Freigabe</h3>
        <table class="class-students"><tbody>${waiting.map((r) => `
          <tr data-req="${escapeAttr(r.id)}">
            <td><strong>${escapeHtml(r.className)}</strong></td>
            <td>${escapeHtml(r.name)} <span class="hint">${escapeHtml(r.email)}</span></td>
            <td class="class-student-actions">
              <button class="btn btn-primary btn-sm btn-req-ok">✓ Freigeben</button>
              <button class="btn btn-secondary btn-sm btn-req-no">Ablehnen</button>
            </td>
          </tr>`).join('')}</tbody></table>
      </div>` : ''}
      ${classes.length ? `<label class="tag-filter-mode school-classes-auto-all">
          <input type="checkbox" class="chk-auto-all" ${allAuto ? 'checked' : ''} />
          <span><strong>⚡ Autoregistrierung für alle Klassen im ${escapeHtml(data.schoolYear)}</strong> – Lehrkräfte übernehmen
            Klassen sofort. Aus: Jede Übernahme wartet auf deine Freigabe.</span></label>` : ''}
      ${classes.length === 0
        ? `<div class="empty-state"><p>Im ${escapeHtml(data.schoolYear)} gibt es noch keine Klassen der Schule. Lies eine Tabelle mit Nachname, Vorname, Klasse und UserID ein.</p></div>`
        : classes.map((c) => this._classCard(c)).join('')}`;
    this._bind(classes);
  }

  _classCard(c) {
    const taken = c.requests.filter((r) => r.status === 'approved');
    const pending = c.requests.filter((r) => r.status === 'pending');
    return `
      <details class="area-group school-section school-class" data-id="${escapeAttr(c.id)}" ${this._open.has(c.id) ? 'open' : ''}>
        <summary>
          <strong>🏫 ${escapeHtml(c.name)}</strong>
          <span class="hint">${plural(c.students.length, 'Schüler', 'Schüler')}${c.autoRegister ? ' · ⚡ Autoregistrierung' : ''}${taken.length ? ` · übernommen von ${escapeHtml(taken.map((r) => r.name).join(', '))}` : ''}${c.promotedTo?.length ? ` · ⏭ versetzt nach ${escapeHtml(c.promotedTo.map((p) => `${p.name} (${p.schoolYear})`).join(', '))}` : ''}</span>
          ${pending.length ? `<span class="class-pending-note">⏳ ${escapeHtml(pending.map((r) => r.name).join(', '))} wartet</span>` : ''}
        </summary>
        <div class="school-class-body">
          <div class="link-card-actions">
            <label class="tag-filter-mode"><input type="checkbox" class="chk-auto" ${c.autoRegister ? 'checked' : ''} /> <span>⚡ Autoregistrierung</span></label>
            <button class="btn btn-secondary btn-sm btn-sc-rename">✏️ Umbenennen</button>
            <button class="btn btn-danger btn-sm btn-sc-delete">🗑 Löschen</button>
          </div>
          ${c.students.length ? `<table class="class-students">
            <thead><tr><th>Nachname</th><th>Vorname</th><th>UserID</th><th></th></tr></thead>
            <tbody>${c.students.map((s) => `<tr data-sid="${escapeAttr(s.id)}">
              <td>${escapeHtml(s.lastName) || '<span class="hint">–</span>'}</td><td>${escapeHtml(s.firstName)}</td>
              <td>${s.loginId ? escapeHtml(s.loginId) : '<span class="hint">–</span>'}</td>
              <td class="class-student-actions"><button class="btn btn-danger btn-sm btn-sc-student-delete" title="Aus der Klassenliste der Schule entfernen – die Klassen der Lehrkräfte bleiben, wie sie sind">🗑</button></td>
            </tr>`).join('')}</tbody></table>` : '<p class="hint">Keine Schüler.</p>'}
        </div>
      </details>`;
  }

  _bind(classes) {
    const byId = new Map(classes.map((c) => [c.id, c]));
    const after = (res, text) => {
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return false; }
      if (text) this.app.showToast(text, 'success');
      this.refresh();
      return true;
    };
    this._box.querySelectorAll('tr[data-req]').forEach((tr) => {
      const id = tr.dataset.req;
      tr.querySelector('.btn-req-ok').addEventListener('click', async () => {
        const res = await this.app.api.answerSchoolClassRequest(id, true);
        after(res, res?.className ? `Freigegeben – „${res.className}“: ${res.added} neu, ${res.updated} aktualisiert.` : 'Freigegeben.');
      });
      tr.querySelector('.btn-req-no').addEventListener('click', async () => after(await this.app.api.answerSchoolClassRequest(id, false), 'Abgelehnt.'));
    });
    this._box.querySelector('.chk-auto-all')?.addEventListener('change', async (e) => {
      const res = await this.app.api.setSchoolClassesAutoRegister(this._year, e.target.checked);
      after(res, e.target.checked ? `Autoregistrierung an${res?.approved ? ` – ${res.approved} wartende Anfrage(n) freigegeben` : ''}.` : 'Autoregistrierung aus – Übernahmen warten auf deine Freigabe.');
    });
    this._box.querySelectorAll('details.school-class').forEach((d) => {
      const c = byId.get(d.dataset.id);
      d.addEventListener('toggle', () => { if (d.open) this._open.add(c.id); else this._open.delete(c.id); });
      d.querySelector('.chk-auto').addEventListener('change', async (e) => {
        const res = await this.app.api.updateSchoolClass(c.id, { autoRegister: e.target.checked });
        after(res, `${c.name}: Autoregistrierung ${e.target.checked ? 'an' : 'aus'}${res?.approved ? ` – ${res.approved} wartende Anfrage(n) freigegeben` : ''}.`);
      });
      d.querySelector('.btn-sc-rename').addEventListener('click', async () => {
        const v = await formDialog({
          title: `✏️ ${c.name} umbenennen`,
          hint: 'So heißt die Klasse in der Tabelle? Dann wird sie beim nächsten Einlesen aktualisiert. Die Klassen der Lehrkräfte behalten ihren Namen.',
          fields: [{ name: 'name', label: 'Klassenname', value: c.name }],
        });
        if (v) after(await this.app.api.updateSchoolClass(c.id, { name: v.name }), 'Umbenannt.');
      });
      d.querySelector('.btn-sc-delete').addEventListener('click', async () => {
        if (!(await this.app.appConfirm(`Klasse „${c.name}“ aus der Klassenliste der Schule löschen?\n\nDie Klassen der Lehrkräfte bleiben erhalten, sind danach aber nicht mehr mit der Schulliste verbunden.`))) return;
        after(await this.app.api.deleteSchoolClass(c.id), 'Gelöscht.');
      });
      d.querySelectorAll('tr[data-sid]').forEach((tr) => tr.querySelector('.btn-sc-student-delete').addEventListener('click', async () => {
        after(await this.app.api.deleteSchoolClassStudent(c.id, tr.dataset.sid), null);
      }));
    });
  }

  _templateMenu(anchor) {
    const rows = [['Nachname', 'Vorname', 'Klasse', 'UserID'], ['Mustermann', 'Max', 'TG12', 'max.mustermann'], ['Musterfrau', 'Erika', 'E1ME1', 'erika.musterfrau']];
    const save = (blob, ext) => {
      downloadBlob(blob, `Klassen_der_Schule.${ext}`);
      this.app.showToast('Vorlage gespeichert – Beispielzeilen ersetzen, dann „📥 Klassen einlesen“.', 'success');
    };
    const r = anchor.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 4, [
      { label: '📗 LibreOffice (.ods)', onClick: () => save(buildOds(rows), 'ods') },
      { label: '📘 Excel (.xlsx)', onClick: () => save(buildXlsx(rows), 'xlsx') },
      { label: '📄 CSV (.csv)', onClick: () => save(buildCsv(rows), 'csv') },
    ]);
  }

  async _import(file) {
    let rows;
    try {
      let password = null;
      if (await needsPassword(file)) {
        const v = await formDialog({
          title: '🔒 Passwort der Datei', hint: 'Entschlüsselt wird nur hier im Browser; das Passwort wird nicht übertragen.',
          fields: [{ name: 'password', label: 'Passwort', type: 'password' }], submitLabel: 'Öffnen',
        });
        if (!v) return;
        password = v.password;
      }
      rows = await readSchoolRoster(file, password);
    } catch (err) {
      this.app.showToast(err instanceof WrongPassword ? err.message : 'Datei nicht lesbar: ' + err.message, 'error');
      return;
    }
    if (!rows.length) { this.app.showToast('Die Datei enthält keine Schüler.', 'info'); return; }
    const payload = { rows, schoolYear: this._year };
    const preview = await this.app.api.importSchoolClasses({ ...payload, dryRun: true });
    if (failed(preview)) { this.app.showToast('Fehler: ' + (preview?.message || '?'), 'error'); return; }
    const choice = await this._confirm(preview.classes);
    if (!choice) return;
    const res = await this.app.api.importSchoolClasses({ ...payload, autoRegister: choice.autoRegister });
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    const done = res.classes.filter((c) => c.action !== 'skipped');
    const skipped = res.classes.filter((c) => c.action === 'skipped');
    this.app.showToast(`${plural(done.length, 'Klasse', 'Klassen')} eingelesen (${done.filter((c) => c.action === 'created').length} neu)${skipped.length ? `, ${skipped.length} übersprungen` : ''}.`, skipped.length ? 'info' : 'success');
    const years = [...new Set(done.map((c) => c.schoolYear))];
    if (years.length === 1) this._year = years[0];
    await this.refresh();
    if (skipped.length) this._report(skipped);
  }

  _confirm(rows) {
    const what = (c) => c.action === 'skipped'
      ? `<span class="link-card-warning">⚠️ wird übersprungen: ${escapeHtml(c.reason)}</span>`
      : [c.added ? `${c.added} neu` : '', c.updated ? `${c.updated} aktualisiert` : '', c.unchanged ? `${c.unchanged} unverändert` : '']
        .filter(Boolean).join(', ') + (c.renamed?.length ? `<br><span class="hint">Name korrigiert: ${escapeHtml(c.renamed.join('; '))}</span>` : '')
        + (c.duplicates?.length ? `<br><span class="link-card-warning">Doppelt in der Datei: ${escapeHtml(c.duplicates.join(', '))}</span>` : '');
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="import-modules-card class-import-preview">
          <h3>📥 Klassen der Schule einlesen</h3>
          <table class="class-students">
            <thead><tr><th>Klasse</th><th>Schuljahr</th><th></th><th>Schüler</th></tr></thead>
            <tbody>${rows.map((c) => `<tr>
              <td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.schoolYear)}</td>
              <td>${c.action === 'created' ? '<strong>neu</strong>' : c.action === 'updated' ? 'aktualisieren' : '–'}</td>
              <td>${what(c) || '–'}</td></tr>`).join('')}</tbody>
          </table>
          <label class="tag-filter-mode"><input type="checkbox" class="chk-auto" />
            <span><strong>⚡ Autoregistrierung</strong> für die neuen Klassen – Lehrkräfte übernehmen sie ohne deine Freigabe.</span></label>
          <p class="hint">Schüler, die in der Datei fehlen, bleiben in der Klassenliste. Namen, die sich um höchstens 3 Zeichen
            unterscheiden, werden aus der Datei übernommen.</p>
          <div class="confirm-actions">
            <button class="btn btn-primary btn-ok" ${rows.every((c) => c.action === 'skipped') ? 'disabled' : ''}>Übernehmen</button>
            <button class="btn btn-secondary btn-cancel">Abbrechen</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('.btn-ok').addEventListener('click', () => done({ autoRegister: overlay.querySelector('.chk-auto').checked }));
      overlay.querySelector('.btn-cancel').addEventListener('click', () => done(null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    });
  }

  /**
   * ⏭ Versetzen ins nächste Schuljahr: je Klasse versetzen (mit neuem Namen), löschen oder lassen.
   * Die Lehrkräfte wechseln selbst ins neue Jahr und übernehmen die versetzten Klassen dann.
   */
  async _promote() {
    const data = this._data;
    if (!data?.classes?.length) { this.app.showToast('In diesem Schuljahr gibt es keine Klassen der Schule.', 'info'); return; }
    const next = data.schoolYear.replace(/^SJ(\d{2})-(\d{2})$/, (_, a, b) => `SJ${String((+a + 1) % 100).padStart(2, '0')}-${String((+b + 1) % 100).padStart(2, '0')}`);
    const items = await new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="import-modules-card class-import-preview">
          <h3>⏭ Klassen vom ${escapeHtml(data.schoolYear)} ins ${escapeHtml(next)} versetzen</h3>
          <p class="hint">Versetzt wird eine Kopie mit Schülern, Autoregistrierung und Freigaben – wer die Klasse hatte, übernimmt die
            neue ohne neue Anfrage. Gibt es den neuen Namen im ${escapeHtml(next)} schon, wird diese Klasse ergänzt. Löschen trifft nur die
            Klasse der Schule. Ihre eigenen Klassen versetzen die Lehrkräfte selbst (Schuljahreswechsel).</p>
          <table class="class-students">
            <thead><tr><th>Klasse</th><th></th><th>Neuer Name</th></tr></thead>
            <tbody>${data.classes.map((c) => `<tr data-id="${escapeAttr(c.id)}">
              <td><strong>${escapeHtml(c.name)}</strong> <span class="hint">${c.students.length} Schüler${c.promotedTo?.length ? ' · schon versetzt' : ''}</span></td>
              <td><select class="sel-action">
                <option value="promote" ${c.promotedTo?.length ? '' : 'selected'}>⏭ versetzen</option>
                <option value="delete">🗑 löschen</option>
                <option value="keep" ${c.promotedTo?.length ? 'selected' : ''}>– lassen</option>
              </select></td>
              <td><input class="inp-name" maxlength="40" value="${escapeAttr(c.suggestedNext || c.name)}" /></td>
            </tr>`).join('')}</tbody>
          </table>
          <div class="confirm-actions">
            <button class="btn btn-primary btn-ok">Ausführen</button>
            <button class="btn btn-secondary btn-cancel">Abbrechen</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelectorAll('tr[data-id]').forEach((tr) => {
        const sel = tr.querySelector('.sel-action');
        const sync = () => { tr.querySelector('.inp-name').disabled = sel.value !== 'promote'; };
        sel.addEventListener('change', sync);
        sync();
      });
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('.btn-ok').addEventListener('click', () => done([...overlay.querySelectorAll('tr[data-id]')].map((tr) => ({
        id: tr.dataset.id, action: tr.querySelector('.sel-action').value, name: tr.querySelector('.inp-name').value.trim(),
      }))));
      overlay.querySelector('.btn-cancel').addEventListener('click', () => done(null));
    });
    if (!items) return;
    const del = items.filter((i) => i.action === 'delete').length;
    if (del && !(await this.app.appConfirm(`${plural(del, 'Klasse', 'Klassen')} der Schule löschen? Die Klassen der Lehrkräfte bleiben erhalten.`))) return;
    const res = await this.app.api.promoteSchoolClasses(data.schoolYear, items);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this.app.showToast(`${plural(res.promoted.length, 'Klasse', 'Klassen')} ins ${res.schoolYear} versetzt${res.deleted.length ? `, ${res.deleted.length} gelöscht` : ''}.`, 'success');
    this._year = res.promoted.length ? res.schoolYear : this._year;
    this.refresh();
  }

  /** Am Ende: Welche Klassen übersprungen wurden und warum. */
  _report(skipped) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card class-import-preview">
        <h3>⚠️ ${plural(skipped.length, 'Klasse', 'Klassen')} nicht eingelesen</h3>
        <ul>${skipped.map((c) => `<li><strong>${escapeHtml(c.name)}</strong> (${escapeHtml(c.schoolYear)}): ${escapeHtml(c.reason)}</li>`).join('')}</ul>
        <p class="hint">Mit ✏️ Umbenennen den Namen an die Tabelle angleichen, dann die Datei noch einmal einlesen. Ist es wirklich eine
          andere Klasse, die Schüler in der alten Klasse entfernen.</p>
        <div class="confirm-actions"><button class="btn btn-primary btn-ok">OK</button></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.btn-ok').addEventListener('click', () => overlay.remove());
  }
}
