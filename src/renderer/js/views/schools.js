import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== SCHULEN ====================

const WHITELIST_HINT =
  'Eine Adresse oder ein Muster pro Zeile, z. B. <code>*@fes-es.de</code>, <code>*.fes-es.de</code> ' +
  '(auch Subdomains) oder <code>name@example.com</code>. Wer noch keiner Schule angehört und auf genau ' +
  'eine Schule passt, wird beim nächsten Login automatisch zugeordnet.';

const parseLines = (text) => String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);

/** Name, Adresse und Hinweise zu einer Lehrkraft. */
function teacherInfo(t) {
  return `
    <strong>${escapeHtml(t.displayName || t.email)}</strong>
    <span style="color:var(--text-secondary);font-size:0.9em">${escapeHtml(t.email)}</span>
    ${t.isSchoolAdmin ? '<span class="user-role-badge admin">Schuladmin</span>' : ''}
    ${t.role === 'admin' ? '<span class="user-role-badge admin">Hauptadmin</span>' : ''}
    ${t.active === false ? '<span class="topic-status inactive">⏸ deaktiviert</span>' : ''}
    ${t.mustChangePassword ? '<span class="hint">🔑 Initialpasswort noch nicht geändert</span>' : ''}`;
}

/** Ein API-Ergebnis mit Fehler erkennen (Nest liefert dann statusCode + message). */
const failed = (res) => !res || res.statusCode >= 400 || res.success === false;

/**
 * Vorschau und Übernahme der Whitelist: erst zeigen, wen es trifft, dann
 * zuordnen. Konflikte (Adresse passt auch auf eine andere Schule) bleiben
 * stehen und landen beim Hauptadmin.
 */
async function confirmApplyWhitelist(app, preview, apply) {
  const res = await preview();
  if (failed(res)) { app.showToast('Fehler: ' + (res?.message || 'Vorschau fehlgeschlagen'), 'error'); return false; }
  const names = (list) => list.slice(0, 15).map((t) => `• ${t.displayName} (${t.email})`).join('\n') +
    (list.length > 15 ? `\n… und ${list.length - 15} weitere` : '');
  const conflictText = res.conflicts.length
    ? `\n\nNicht eindeutig – passt auch auf eine andere Schule, entscheidet der Hauptadmin:\n${names(res.conflicts)}`
    : '';
  if (res.assignable.length === 0) {
    app.showToast(res.conflicts.length
      ? `Niemand eindeutig zuzuordnen – ${res.conflicts.length} Konflikt(e) liegen beim Hauptadmin.`
      : 'Niemand ohne Schule passt auf diese Whitelist.', 'info');
    return false;
  }
  const ok = await app.appConfirm(
    `${res.assignable.length} Lehrkraft/Lehrkräfte jetzt dieser Schule zuordnen?\n\n${names(res.assignable)}${conflictText}`,
  );
  if (!ok) return false;
  const done = await apply();
  if (failed(done)) { app.showToast('Fehler: ' + (done?.message || 'Zuordnung fehlgeschlagen'), 'error'); return false; }
  app.showToast(`${done.assigned} Lehrkraft/Lehrkräfte zugeordnet.`, 'success');
  return true;
}

// ==================== HAUPTADMIN: SCHULEN ====================

/**
 * Schulen anlegen, Whitelists pflegen, Schuladmins bestimmen und deren
 * Rechte begrenzen. Dazu zwei Sammelstellen: Konflikte (Adresse passt auf
 * mehrere Schulen) und Lehrkräfte ohne Schule.
 */
export class SchoolsAdminView {
  constructor(app) {
    this.app = app;
    this._box = document.getElementById('adminSchoolsContainer');
    this._open = new Set();

    const input = document.getElementById('newSchoolName');
    const create = () => this._create(input);
    document.getElementById('btnNewSchool')?.addEventListener('click', create);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
  }

  async _create(input) {
    const name = (input?.value || '').trim();
    if (!name) { this.app.showToast('Bitte einen Namen für die Schule eingeben.', 'error'); return; }
    const res = await this.app.api.createSchool({ name });
    if (failed(res) || !res.id) { this.app.showToast('Fehler: ' + (res?.message || 'Anlegen fehlgeschlagen'), 'error'); return; }
    input.value = '';
    this._open.add(res.id);
    this.app.showToast(`Schule „${res.name}“ angelegt – jetzt die Whitelist eintragen.`, 'success');
    await this.refresh();
  }

  async refresh() {
    if (!this._box) return;
    let data;
    try {
      data = await this.app.api.getSchools();
    } catch (err) {
      this._box.innerHTML = `<p class="hint">Fehler: ${escapeHtml(err.message)}</p>`;
      return;
    }
    if (failed(data)) { this._box.innerHTML = `<p class="hint">Fehler: ${escapeHtml(data?.message || '?')}</p>`; return; }
    this._data = data;
    this._box.innerHTML = '';

    if (data.conflicts.length) this._box.appendChild(this._renderConflicts(data));
    if (data.schools.length === 0) {
      this._box.insertAdjacentHTML('beforeend', `
        <div class="empty-state"><span class="empty-icon">🏫</span>
          <p>Noch keine Schulen. Lege oben eine an und trage ihre Whitelist ein, z. B. <code>*@fes-es.de</code>.</p>
        </div>`);
    }
    for (const school of data.schools) this._box.appendChild(this._renderSchool(school));
    if (data.unassigned.length) this._box.appendChild(this._renderUnassigned(data));
  }

  /** Aufklappbarer Abschnitt, der sich seinen Zustand über ein Neuladen merkt. */
  _section(key, summaryHtml, { open = false, extraClass = '' } = {}) {
    const details = document.createElement('details');
    details.className = `area-group school-section ${extraClass}`;
    details.open = open || this._open.has(key);
    details.innerHTML = `<summary class="area-group-head">${summaryHtml}</summary><div class="area-group-body"></div>`;
    details.addEventListener('toggle', () => { if (details.open) this._open.add(key); else this._open.delete(key); });
    return details;
  }

  _renderConflicts(data) {
    const sec = this._section('__conflicts', `
      <span class="area-group-title">⚠️ <strong>Nicht eindeutig zuzuordnen</strong></span>
      <span class="area-group-count">${data.conflicts.length} Konto/Konten – Adresse passt auf mehrere Whitelists</span>`,
    { open: true, extraClass: 'school-conflicts' });
    const body = sec.querySelector('.area-group-body');
    for (const u of data.conflicts) {
      const row = document.createElement('div');
      row.className = 'admin-list-item';
      row.innerHTML = `
        <div class="admin-list-item-info">${teacherInfo(u)}</div>
        <div class="admin-list-item-actions">
          <select class="conflict-school">
            ${u.schoolIds.map((id) => {
              const s = data.schools.find((x) => x.id === id);
              return `<option value="${escapeAttr(id)}">🏫 ${escapeHtml(s?.name || id)}</option>`;
            }).join('')}
          </select>
          <button class="btn btn-primary btn-sm">Zuordnen</button>
        </div>`;
      row.querySelector('button').addEventListener('click', () =>
        this._assign(u.id, { schoolId: row.querySelector('.conflict-school').value }));
      body.appendChild(row);
    }
    return sec;
  }

  _renderSchool(school) {
    const admins = school.teachers.filter((t) => t.isSchoolAdmin);
    const sec = this._section(school.id, `
      <span class="area-group-title">🏫 <strong>${escapeHtml(school.name)}</strong></span>
      <span class="area-group-count">${school.teachers.length} Lehrkraft/Lehrkräfte ·
        ${admins.length ? `Schuladmin: ${admins.map((a) => escapeHtml(a.displayName)).join(', ')}` : 'noch kein Schuladmin'}</span>`);
    const body = sec.querySelector('.area-group-body');

    body.innerHTML = `
      <div class="school-row">
        <input type="text" class="school-name" value="${escapeAttr(school.name)}" maxlength="120" aria-label="Name der Schule" />
        <button class="btn btn-secondary btn-sm btn-rename">Umbenennen</button>
        <button class="btn btn-danger btn-sm btn-delete-school">🗑 Schule löschen</button>
      </div>

      <div class="school-block">
        <h4>Rechte der Schuladmins</h4>
        <label class="share-flag"><input type="checkbox" class="perm-whitelist" ${school.adminsMayEditWhitelist ? 'checked' : ''} />
          <span>dürfen die Whitelist pflegen</span></label>
        <label class="share-flag"><input type="checkbox" class="perm-teachers" ${school.adminsMayManageTeachers ? 'checked' : ''} />
          <span>dürfen Lehrkräfte aus der Schule entfernen und deaktivieren</span></label>
      </div>

      <div class="school-block">
        <h4>Whitelist</h4>
        <textarea class="school-whitelist" rows="4" placeholder="*@fes-es.de">${escapeHtml(school.whitelist.join('\n'))}</textarea>
        <p class="hint">${WHITELIST_HINT}</p>
        <div class="school-row">
          <button class="btn btn-primary btn-sm btn-save-whitelist">💾 Whitelist speichern</button>
          <button class="btn btn-secondary btn-sm btn-apply-whitelist"
            title="Lehrkräfte ohne Schule, die auf die Whitelist passen, sofort zuordnen">👥 Jetzt zuordnen</button>
        </div>
      </div>

      <div class="school-block">
        <h4>Lehrkräfte</h4>
        <div class="school-teachers"></div>
      </div>`;

    body.querySelector('.btn-rename').addEventListener('click', () =>
      this._update(school.id, { name: body.querySelector('.school-name').value }, 'Schule umbenannt'));
    body.querySelector('.btn-delete-school').addEventListener('click', () => this._delete(school));
    body.querySelector('.perm-whitelist').addEventListener('change', (e) =>
      this._update(school.id, { adminsMayEditWhitelist: e.target.checked }, 'Recht gespeichert'));
    body.querySelector('.perm-teachers').addEventListener('change', (e) =>
      this._update(school.id, { adminsMayManageTeachers: e.target.checked }, 'Recht gespeichert'));
    body.querySelector('.btn-save-whitelist').addEventListener('click', () =>
      this._update(school.id, { whitelist: parseLines(body.querySelector('.school-whitelist').value) }, 'Whitelist gespeichert'));
    body.querySelector('.btn-apply-whitelist').addEventListener('click', async () => {
      // Erst speichern, damit die Vorschau mit dem sichtbaren Stand rechnet.
      const saved = await this.app.api.updateSchool(school.id, { whitelist: parseLines(body.querySelector('.school-whitelist').value) });
      if (failed(saved)) { this.app.showToast('Fehler: ' + (saved?.message || '?'), 'error'); return; }
      const ok = await confirmApplyWhitelist(this.app,
        () => this.app.api.previewSchoolWhitelist(school.id),
        () => this.app.api.applySchoolWhitelist(school.id));
      if (ok) await this.refresh();
    });

    const list = body.querySelector('.school-teachers');
    if (school.teachers.length === 0) {
      list.innerHTML = '<p class="hint">Noch niemand zugeordnet. Whitelist eintragen und „Jetzt zuordnen“ – oder in der Benutzerverwaltung von Hand.</p>';
    }
    for (const t of school.teachers) {
      const row = document.createElement('div');
      row.className = 'admin-list-item';
      row.innerHTML = `
        <div class="admin-list-item-info">${teacherInfo(t)}</div>
        <div class="admin-list-item-actions">
          <label class="share-flag" title="Verwaltet die Schule: Whitelist, Lehrkräfte, Gruppen">
            <input type="checkbox" class="sa" ${t.isSchoolAdmin ? 'checked' : ''} /><span>Schuladmin</span></label>
          <button class="btn btn-secondary btn-sm btn-unassign" title="Aus der Schule nehmen – die Whitelist ordnet danach nicht wieder zu">Aus Schule entfernen</button>
        </div>`;
      row.querySelector('.sa').addEventListener('change', (e) => this._assign(t.id, { isSchoolAdmin: e.target.checked }));
      row.querySelector('.btn-unassign').addEventListener('click', async () => {
        if (!(await this.app.appConfirm(`${t.displayName} aus „${school.name}“ entfernen?\n\nDie Whitelist ordnet das Konto danach nicht wieder automatisch zu.`))) return;
        this._assign(t.id, { schoolId: null });
      });
      list.appendChild(row);
    }
    return sec;
  }

  _renderUnassigned(data) {
    const sec = this._section('__unassigned', `
      <span class="area-group-title"><span class="area-group-none">Ohne Schule</span></span>
      <span class="area-group-count">${data.unassigned.length} Konto/Konten</span>`);
    const body = sec.querySelector('.area-group-body');
    for (const u of data.unassigned) {
      const row = document.createElement('div');
      row.className = 'admin-list-item';
      row.innerHTML = `
        <div class="admin-list-item-info">${teacherInfo(u)}
          ${u.schoolManual ? '<span class="hint" title="Wird nicht automatisch zugeordnet">✋ von Hand entfernt</span>' : ''}</div>
        <div class="admin-list-item-actions">
          <select class="assign-school">
            <option value="">Schule zuordnen …</option>
            ${data.schools.map((s) => `<option value="${escapeAttr(s.id)}">🏫 ${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>`;
      row.querySelector('.assign-school').addEventListener('change', (e) => {
        if (e.target.value) this._assign(u.id, { schoolId: e.target.value });
      });
      body.appendChild(row);
    }
    return sec;
  }

  async _update(id, body, okText) {
    const res = await this.app.api.updateSchool(id, body);
    if (failed(res)) this.app.showToast('Fehler: ' + (res?.message || 'Speichern fehlgeschlagen'), 'error');
    else this.app.showToast(okText, 'success');
    await this.refresh();
  }

  async _assign(userId, body) {
    const res = await this.app.api.assignSchool(userId, body);
    if (failed(res)) this.app.showToast('Fehler: ' + (res?.message || 'Zuordnung fehlgeschlagen'), 'error');
    else this.app.showToast('Zuordnung gespeichert', 'success');
    await this.refresh();
  }

  async _delete(school) {
    const ok = await this.app.appConfirm(
      `Schule „${school.name}“ löschen?\n\n` +
      `${school.teachers.length} Lehrkraft/Lehrkräfte stehen danach ohne Schule da; ihre Konten und Inhalte bleiben. ` +
      'Gruppen der Schule werden schulübergreifend.',
    );
    if (!ok) return;
    const res = await this.app.api.deleteSchool(school.id);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Löschen fehlgeschlagen'), 'error'); return; }
    this.app.showToast('Schule gelöscht.', 'info');
    await this.refresh();
  }
}

// ==================== SCHULADMIN: MEINE SCHULE ====================

/**
 * Verwaltung der eigenen Schule: Lehrkräfte, Whitelist, Gruppen. Was der
 * Hauptadmin nicht freigegeben hat, steht nur zum Ansehen da – geprüft wird
 * es ohnehin auf dem Server.
 */
export class MySchoolView {
  constructor(app) {
    this.app = app;
    this._title     = document.getElementById('mySchoolTitle');
    this._teachers  = document.getElementById('mySchoolTeachers');
    this._whitelist = document.getElementById('mySchoolWhitelist');
    this._wlHint    = document.getElementById('mySchoolWhitelistHint');
    this._btnSaveWl = document.getElementById('btnSaveMySchoolWhitelist');
    this._btnApply  = document.getElementById('btnApplyMySchoolWhitelist');
    this._groups    = document.getElementById('mySchoolGroups');

    this._btnSaveWl?.addEventListener('click', () => this._saveWhitelist());
    this._btnApply?.addEventListener('click', async () => {
      if (!(await this._saveWhitelist(true))) return;
      const ok = await confirmApplyWhitelist(this.app,
        () => this.app.api.previewMySchoolWhitelist(),
        () => this.app.api.applyMySchoolWhitelist());
      if (ok) await this.refresh();
    });
    document.getElementById('btnNewSchoolGroup')?.addEventListener('click', () =>
      this.app.adminView.openGroupEditor(null, this._data?.teachers || [], { onChanged: () => this.refresh() }));
  }

  async refresh() {
    let data;
    let groups;
    try {
      [data, groups] = await Promise.all([this.app.api.getMySchool(), this.app.api.getGroups()]);
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
      return;
    }
    if (failed(data)) { this.app.showToast('Fehler: ' + (data?.message || '?'), 'error'); return; }
    this._data = data;

    if (this._title) this._title.textContent = `🏫 ${data.name}`;
    this._renderTeachers(data);
    this._renderWhitelist(data);

    const own = (Array.isArray(groups) ? groups : []).filter((g) => g.schoolId === data.id);
    if (this._groups) this.app.adminView.renderGroupList(this._groups, own, data.teachers, { onChanged: () => this.refresh() });
  }

  _renderWhitelist(data) {
    if (!this._whitelist) return;
    this._whitelist.value = data.whitelist.join('\n');
    const may = data.adminsMayEditWhitelist;
    this._whitelist.readOnly = !may;
    this._btnSaveWl?.classList.toggle('hidden', !may);
    this._btnApply?.classList.toggle('hidden', !may);
    if (this._wlHint) {
      this._wlHint.innerHTML = may ? WHITELIST_HINT : '🔒 Die Whitelist pflegt bei eurer Schule der Hauptadmin.';
    }
  }

  async _saveWhitelist(silent = false) {
    const res = await this.app.api.saveMySchoolWhitelist(parseLines(this._whitelist?.value));
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Speichern fehlgeschlagen'), 'error'); return false; }
    if (!silent) this.app.showToast('Whitelist gespeichert', 'success');
    return true;
  }

  _renderTeachers(data) {
    if (!this._teachers) return;
    const me = this.app.state.currentUser?.id;
    const may = data.adminsMayManageTeachers;
    this._teachers.innerHTML = may
      ? ''
      : '<p class="hint">🔒 Lehrkräfte entfernen und deaktivieren kann bei eurer Schule nur der Hauptadmin.</p>';

    for (const t of data.teachers) {
      const editable = may && t.id !== me && t.role !== 'admin';
      const row = document.createElement('div');
      row.className = 'admin-list-item';
      row.innerHTML = `
        <div class="admin-list-item-info">${teacherInfo(t)}${t.id === me ? '<span class="hint">(du)</span>' : ''}</div>
        <div class="admin-list-item-actions">${editable ? `
          ${t.active === false
            ? '<button class="btn btn-primary btn-sm btn-reactivate">▶ Reaktivieren</button>'
            : '<button class="btn btn-secondary btn-sm btn-deactivate">⏸ Deaktivieren</button>'}
          <button class="btn btn-danger btn-sm btn-remove">Aus Schule entfernen</button>` : ''}
        </div>`;
      row.querySelector('.btn-remove')?.addEventListener('click', () => this._action(t, 'remove',
        `${t.displayName} aus „${data.name}“ entfernen?\n\nDas Konto bleibt bestehen, gehört aber keiner Schule mehr an ` +
        'und verlässt eure Gruppen. Die Whitelist ordnet es danach nicht wieder automatisch zu.'));
      row.querySelector('.btn-deactivate')?.addEventListener('click', () => this._action(t, 'deactivate',
        `${t.displayName} deaktivieren?\n\nDas Konto kann sich nicht mehr anmelden, seine Schülerfreigaben sind gesperrt. ` +
        'Selbst verfasste Inhalte stehen dann allen kostenlos im Shop – genauso wie bei einer Deaktivierung durch den ' +
        'Hauptadmin. „Reaktivieren“ macht das rückgängig.'));
      row.querySelector('.btn-reactivate')?.addEventListener('click', () => this._action(t, 'reactivate',
        `${t.displayName} wieder freischalten?`));
      this._teachers.appendChild(row);
    }
  }

  async _action(teacher, action, question) {
    if (!(await this.app.appConfirm(question))) return;
    const res = await this.app.api.mySchoolTeacherAction(teacher.id, action);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Aktion fehlgeschlagen'), 'error'); return; }
    const done = { remove: 'aus der Schule entfernt', deactivate: 'deaktiviert', reactivate: 'wieder aktiv' }[action];
    this.app.showToast(`${teacher.displayName}: ${done}.`, 'success');
    await this.refresh();
  }
}
