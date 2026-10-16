import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== GITHUB-BACKUP ====================
//
// Die eigenen Inhalte regelmäßig in ein (privates) GitHub-Repository sichern
// und einzelne Module daraus wiederherstellen – auch aus älteren Ständen.
// Siehe docs/github-backup.md.

const when = (d) => (d ? new Date(d).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
const WEEKDAYS = [[1, 'Montag'], [2, 'Dienstag'], [3, 'Mittwoch'], [4, 'Donnerstag'], [5, 'Freitag'], [6, 'Samstag'], [0, 'Sonntag']];

/** Ergebnis eines Laufs in einem Satz. */
function runSummary(r) {
  if (!r) return '';
  const parts = [];
  if (r.created) parts.push(`${r.created} neu`);
  if (r.updated) parts.push(`${r.updated} geändert`);
  parts.push(`${r.unchanged || 0} unverändert`);
  return parts.join(', ');
}

function statusHtml(data) {
  const c = data.config;
  const st = data.state || {};
  const parts = [];
  if (!c.enabled) parts.push('Automatisches Backup ausgeschaltet.');
  else if (data.nextRunAt) parts.push(`Nächstes Backup: <strong>${when(data.nextRunAt)}</strong>.`);
  if (st.lastStatus === 'ok') parts.push(`Letztes Backup: ${when(st.lastSuccessAt)} (${escapeHtml(runSummary(st.lastResult))}).`);
  if (st.lastStatus === 'error') {
    parts.push(`<span class="login-error" style="display:inline">❌ Letzter Versuch ${when(st.lastAttemptAt)} fehlgeschlagen:
      ${escapeHtml(st.lastError || '')}</span>`);
    if (c.enabled) parts.push('Es wird stündlich erneut versucht.');
  }
  if (st.tokenExpiresAt) {
    const days = Math.floor((new Date(st.tokenExpiresAt) - Date.now()) / 86400000);
    const text = `Token gültig bis ${new Date(st.tokenExpiresAt).toLocaleDateString('de-DE')}.`;
    parts.push(days <= 14 ? `<span class="login-error" style="display:inline">⚠️ ${text}</span>` : text);
  }
  return parts.join(' ');
}

export async function openGithubBackupDialog(app) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = '<div class="import-modules-card gh-backup" style="min-width:min(560px,94vw); max-width:720px; max-height:90vh; overflow:auto"><p class="hint">Wird geladen…</p></div>';
  document.body.appendChild(overlay);
  const card = overlay.querySelector('.gh-backup');
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Ergebnis der letzten Aktion – bleibt im Dialog stehen, anders als ein Toast.
  let message = null;
  const render = async (msg = null) => {
    message = msg;
    const data = await app.api.getGithubBackup();
    if (!data || data.statusCode) { card.innerHTML = `<p class="login-error">Fehler: ${escapeHtml(data?.message || '?')}</p>`; return; }
    const head = `<h3>💾 GitHub-Backup <button type="button" class="help-hint" data-help="github-backup" title="Hilfe" aria-label="Hilfe">?</button></h3>`;
    if (!data.allowed) {
      card.innerHTML = `${head}<p class="login-error">Das GitHub-Backup ist auf diesem Server vom Admin abgeschaltet.</p>
        <div class="confirm-actions"><button class="btn btn-secondary gh-close">Schließen</button></div>`;
      card.querySelector('.gh-close').addEventListener('click', close);
      return;
    }
    const c = data.config;
    const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === c.hour ? 'selected' : ''}>${String(h).padStart(2, '0')}:00 Uhr</option>`).join('');
    const days = WEEKDAYS.map(([d, n]) => `<option value="${d}" ${d === c.weekday ? 'selected' : ''}>${n}</option>`).join('');
    card.innerHTML = `
      ${head}
      <p class="hint">Sichert deine selbst verfassten Module regelmäßig in ein <strong>privates</strong> GitHub-Repository –
        je Lernthema eine JSON-Datei. Gesichert wird nur, was sich geändert hat; ältere Stände bleiben in der
        Versionsgeschichte erhalten. Gekaufte oder übernommene Module werden nicht gesichert.</p>
      ${data.configured ? `<p class="hint gh-status">${statusHtml(data)}</p>` : ''}

      <div class="settings-group">
        <div class="form-group">
          <label for="ghRepo">Repository</label>
          <input type="text" id="ghRepo" value="${escapeAttr(c.repo)}" placeholder="benutzername/lernmodule-backup" autocomplete="off" />
        </div>
        <div class="form-group">
          <label for="ghToken">Fine-grained Personal Access Token <span class="hint">(nur dieses Repository, „Contents: Read and write“)</span></label>
          <input type="password" id="ghToken" autocomplete="new-password"
            placeholder="${c.hasToken ? 'gespeichert – leer lassen = unverändert' : 'github_pat_…'}" />
        </div>
        <div class="form-group">
          <label>Zeitplan</label>
          <div class="shop-mode-row">
            <select id="ghInterval">
              <option value="daily" ${c.interval === 'daily' ? 'selected' : ''}>täglich</option>
              <option value="weekly" ${c.interval === 'weekly' ? 'selected' : ''}>wöchentlich</option>
            </select>
            <select id="ghWeekday" ${c.interval === 'daily' ? 'disabled' : ''}>${days}</select>
            <span>um</span>
            <select id="ghHour">${hours}</select>
          </div>
        </div>
        <label class="share-flag" style="margin-bottom:12px;">
          <input type="checkbox" id="ghEnabled" ${c.enabled ? 'checked' : ''} /> <span>Automatisches Backup eingeschaltet</span>
        </label>
        <div class="form-actions">
          <button class="btn btn-primary gh-save">💾 Speichern</button>
          <button class="btn btn-secondary gh-test" ${data.configured ? '' : 'disabled'}>🔌 Verbindung testen</button>
          <button class="btn btn-secondary gh-run" ${c.hasToken && c.repo ? '' : 'disabled'}>⬆ Jetzt sichern</button>
          ${data.configured ? '<button class="btn btn-danger gh-disconnect">Trennen</button>' : ''}
        </div>
        <p class="gh-message" style="margin-top:10px"></p>
      </div>

      ${c.hasToken && c.repo ? `
      <div class="settings-group gh-restore">
        <h4>Wiederherstellen</h4>
        <p class="hint">Module aus dem Backup zurückholen – aus dem aktuellen oder einem älteren Stand, als neues Thema
          oder in eines deiner Themen. Was jetzt in der App steht, bleibt unverändert.</p>
        <button class="btn btn-secondary gh-load">📋 Gesicherte Themen anzeigen</button>
        <div class="gh-restore-body"></div>
      </div>` : ''}

      <div class="confirm-actions"><button class="btn btn-secondary gh-close">Schließen</button></div>`;

    const $ = (sel) => card.querySelector(sel);
    // Ohne neu zu zeichnen – Eingaben bleiben stehen.
    const say = (msg) => {
      const el = $('.gh-message');
      el.className = `${msg?.error ? 'login-error' : 'hint'} gh-message`;
      el.textContent = msg?.text || '';
    };
    say(message);
    $('.gh-close').addEventListener('click', close);
    $('#ghInterval').addEventListener('change', (e) => { $('#ghWeekday').disabled = e.target.value === 'daily'; });
    const form = () => ({
      repo: $('#ghRepo').value,
      token: $('#ghToken').value || undefined,
      interval: $('#ghInterval').value,
      weekday: Number($('#ghWeekday').value),
      hour: Number($('#ghHour').value),
      enabled: $('#ghEnabled').checked,
    });
    const busy = async (btn, label, fn) => {
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = label;
      try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
    };

    $('.gh-save').addEventListener('click', async (e) => {
      const res = await busy(e.currentTarget, '⏳ Speichert…', () => app.api.saveGithubBackup(form()));
      if (!res || res.statusCode) { say({ error: true, text: '❌ ' + (res?.message || 'Unbekannter Fehler') }); return; }
      app.showToast('Gespeichert.', 'success');
      render({ text: '✅ Gespeichert.' });
    });
    $('.gh-test')?.addEventListener('click', async (e) => {
      // Vor dem ersten await festhalten – danach ist e.currentTarget null.
      const btn = e.currentTarget;
      // Vorher speichern, damit genau das Eingetragene geprüft wird – aber ohne einzuschalten.
      const res = await busy(btn, '⏳ Prüft…', async () => {
        const saved = await app.api.saveGithubBackup({ ...form(), enabled: undefined });
        return !saved || saved.statusCode ? saved : app.api.testGithubBackup();
      });
      if (!res || !res.success) { say({ error: true, text: '❌ ' + (res?.message || 'Unbekannter Fehler') }); return; }
      app.showToast(res.message, 'success');
      render(res.warning ? { error: true, text: `${res.message} ${res.warning}` } : { text: `✅ ${res.message}` });
    });
    $('.gh-run')?.addEventListener('click', async (e) => {
      const res = await busy(e.currentTarget, '⏳ Sichert…', () => app.api.runGithubBackup());
      if (!res || !res.success) { say({ error: true, text: '❌ ' + (res?.message || 'Unbekannter Fehler') }); return; }
      const text = res.commit ? `Gesichert: ${runSummary(res)}.` : 'Nichts geändert – das Backup ist aktuell.';
      app.showToast(text, 'success');
      render({ text: `✅ ${text}` });
    });
    $('.gh-disconnect')?.addEventListener('click', async () => {
      if (!(await app.appConfirm('GitHub-Backup trennen? Token und Einstellungen werden hier gelöscht. Das Repository auf GitHub bleibt, wie es ist.'))) return;
      const res = await app.api.disconnectGithubBackup();
      if (!res || !res.success) { app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      render();
    });
    $('.gh-load')?.addEventListener('click', (e) => showFiles(app, $('.gh-restore-body'), e.currentTarget));
  };
  await render();
}

// ---- Wiederherstellen: Thema → Stand → Module → Ziel ----

async function showFiles(app, box, btn) {
  btn.disabled = true;
  box.innerHTML = '<p class="hint">Wird geladen…</p>';
  const res = await app.api.listGithubBackupFiles();
  btn.disabled = false;
  if (!res || res.statusCode) { box.innerHTML = `<p class="login-error">Fehler: ${escapeHtml(res?.message || '?')}</p>`; return; }
  if (!res.files.length) { box.innerHTML = '<p class="hint">Im Repository liegen noch keine gesicherten Themen.</p>'; return; }
  box.innerHTML = `
    <div class="form-group" style="margin-top:12px">
      <label for="ghFile">Thema</label>
      <select id="ghFile"><option value="">– bitte wählen –</option>${res.files.map((f) =>
        `<option value="${escapeAttr(f.path)}">${escapeHtml(f.title)}${f.modules != null ? ` (${f.modules} Module)` : ''}</option>`).join('')}</select>
    </div>
    <div class="gh-file-body"></div>`;
  box.querySelector('#ghFile').addEventListener('change', (e) => {
    if (e.target.value) showVersions(app, box.querySelector('.gh-file-body'), e.target.value);
    else box.querySelector('.gh-file-body').innerHTML = '';
  });
}

async function showVersions(app, box, path) {
  box.innerHTML = '<p class="hint">Versionen werden geladen…</p>';
  const res = await app.api.getGithubBackupVersions(path);
  if (!res || res.statusCode) { box.innerHTML = `<p class="login-error">Fehler: ${escapeHtml(res?.message || '?')}</p>`; return; }
  const versions = res.versions || [];
  box.innerHTML = `
    <div class="form-group">
      <label for="ghVersion">Stand</label>
      <select id="ghVersion">
        <option value="">Aktueller Stand</option>
        ${versions.slice(1).map((v) => `<option value="${escapeAttr(v.sha)}">${when(v.date)} – ${escapeHtml(v.message)}</option>`).join('')}
      </select>
    </div>
    <div class="gh-version-body"></div>`;
  const sel = box.querySelector('#ghVersion');
  const load = () => showModules(app, box.querySelector('.gh-version-body'), path, sel.value);
  sel.addEventListener('change', load);
  load();
}

async function showModules(app, box, path, ref) {
  box.innerHTML = '<p class="hint">Module werden geladen…</p>';
  const [res, topics] = await Promise.all([app.api.previewGithubBackup(path, ref), app.api.getTopics()]);
  if (!res || res.statusCode) { box.innerHTML = `<p class="login-error">Fehler: ${escapeHtml(res?.message || '?')}</p>`; return; }
  const own = (Array.isArray(topics) ? topics : []).slice().sort((a, b) => String(a.title).localeCompare(String(b.title), 'de'));
  box.innerHTML = `
    <div class="form-group">
      <label>Module <span class="hint">– Untermodule kommen mit ihrem Modul mit</span></label>
      <label class="share-flag"><input type="checkbox" class="gh-all" checked /> <span><em>alle</em></span></label>
      <div class="gh-modules" style="max-height:260px; overflow:auto; padding-left:8px">
        ${res.modules.map((m) => `<label class="share-flag" style="display:flex"><input type="checkbox" class="gh-mod" value="${escapeAttr(m.id)}" checked />
          <span>${escapeHtml(m.title || '(ohne Titel)')} <span class="hint">${escapeHtml(m.type)}${m.subModules ? ` · ${m.subModules} Untermodule` : ''}</span></span></label>`).join('')}
      </div>
    </div>
    <div class="form-group">
      <label for="ghTarget">Wiederherstellen</label>
      <select id="ghTarget">
        <option value="">als neues Thema „${escapeHtml(res.title)} (wiederhergestellt)“</option>
        ${own.map((t) => `<option value="${escapeAttr(t.id)}">in „${escapeHtml(t.title)}“ ergänzen</option>`).join('')}
      </select>
    </div>
    <div class="form-actions"><button class="btn btn-primary gh-do-restore">⬇ Wiederherstellen</button></div>`;

  const boxes = () => [...box.querySelectorAll('.gh-mod')];
  box.querySelector('.gh-all').addEventListener('change', (e) => boxes().forEach((b) => { b.checked = e.target.checked; }));
  box.querySelector('.gh-do-restore').addEventListener('click', async (e) => {
    const moduleIds = boxes().filter((b) => b.checked).map((b) => b.value);
    if (!moduleIds.length) { app.showToast('Bitte mindestens ein Modul auswählen.', 'error'); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '⏳ Wird wiederhergestellt…';
    const r = await app.api.restoreGithubBackup({ path, ref: ref || undefined, moduleIds, targetTopicId: box.querySelector('#ghTarget').value || undefined });
    btn.disabled = false;
    btn.textContent = '⬇ Wiederherstellen';
    if (!r || !r.success) { app.showToast('Fehler: ' + (r?.message || '?'), 'error'); return; }
    app.showToast(`${r.importedCount} Modul${r.importedCount === 1 ? '' : 'e'} in „${r.topicTitle}“ wiederhergestellt.`, 'success');
    app.topicsView?.refresh?.();
  });
}
