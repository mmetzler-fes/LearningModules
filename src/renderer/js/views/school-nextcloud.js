import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== NEXTCLOUD DER SCHULE (Schuladmin) ====================
//
// Ein Freigabelink für die Bilder aller Lehrkräfte der Schule: Wer keine
// eigene Freigabe hat, legt Bilder dort ab (Bilder/<Lehrkraft>/<Thema>/).
// Dazu Umziehen, Trennen und die Ordner-Übersicht zum Aufräumen.
// Siehe docs/nextcloud.md.

const mb = (bytes) => `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
const when = (d) => (d ? new Date(d).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');

function moveHtml(m) {
  if (!m) return '';
  if (m.running) return `<p class="hint">🚚 Umzug läuft: ${m.copied} von ${m.total || '…'} Bildern kopiert. Erst danach schaltet die App um.</p>`;
  if (m.error) return `<p class="hint"><span class="login-error" style="display:inline">❌ Umzug am ${when(m.at)} abgebrochen: ${escapeHtml(m.error)}</span> Die bisherige Freigabe ist weiter verbunden.</p>`;
  return `<p class="hint">✅ Umgezogen am ${when(m.at)} (${m.copied} Bilder). Die alte Freigabe (${escapeHtml(m.from || '')}) kann gelöscht werden.</p>`;
}

/** Bereich „☁️ Nextcloud der Schule“ in `box` zeichnen. */
export async function renderSchoolNextcloud(app, box, msg = null) {
  if (!box) return;
  const data = await app.api.getSchoolNextcloud().catch(() => null);
  if (!data || data.statusCode) { box.innerHTML = `<p class="login-error">${escapeHtml(data?.message || 'Fehler')}</p>`; return; }
  const ok = data.configured && data.verified;
  box.innerHTML = `
    <p class="hint">Lehrkräfte ohne eigene Nextcloud-Freigabe legen ihre Bilder hier ab – jede in einem eigenen Ordner
      <code>Bilder/&lt;Name&gt;/&lt;Thema&gt;</code>. Die Bilder kommen über diesen Server zu den Schülern; in der Nextcloud ist
      nichts öffentlich. Wer die Freigabe kennt, sieht alle Bilder – also keine Fotos von Schülerinnen und Schülern.
      Eine eigene Freigabe einer Lehrkraft geht vor.</p>
    ${ok ? `<p class="hint">✅ Verbunden: <a href="${escapeAttr(data.shareUrl)}" target="_blank" rel="noopener">${escapeHtml(data.shareUrl)}</a>
      · Bilder daraus stecken in ${data.references} Modul(en).</p>` : data.configured ? '<p class="hint">⚠️ Gespeichert, aber nicht verbunden – bitte „Verbinden“ wählen.</p>' : ''}
    ${moveHtml(data.move)}
    <p class="hint">So legst du die Freigabe an: In der Nextcloud der Schule einen Ordner anlegen (z. B. <code>LearningModules-Bilder</code>)
      → <strong>Teilen → Link teilen</strong> → <strong>„Hochladen und Bearbeiten erlauben“</strong> → <strong>Passwort</strong> setzen → Link kopieren.</p>
    <div class="form-group"><label for="sncShare">Freigabelink des Ordners</label>
      <input type="url" id="sncShare" value="${escapeAttr(data.shareUrl || '')}" autocomplete="off" placeholder="https://cloud.meine-schule.de/s/…" /></div>
    <div class="form-group"><label for="sncPass">Passwort der Freigabe</label>
      <input type="password" id="sncPass" autocomplete="new-password" placeholder="${data.hasPassword ? 'gespeichert – leer lassen = unverändert' : 'Passwort, das beim Teilen gesetzt wurde'}" /></div>
    <div class="form-actions">
      <button class="btn btn-primary snc-connect">🔌 Verbinden</button>
      ${data.configured ? '<button class="btn btn-danger snc-disconnect">Trennen</button>' : ''}
    </div>
    <p class="snc-message hint"></p>
    ${ok ? `
    <details class="snc-move"><summary>🚚 Zu einer anderen Nextcloud umziehen</summary>
      <p class="hint">Neue Ordnerfreigabe (Hochladen und Bearbeiten, mit Passwort) eintragen. Die App prüft sie, kopiert alle Bilder
        hinüber und schaltet erst danach um – in den Modulen bleibt alles sichtbar.</p>
      <div class="form-group"><label for="sncMoveShare">Neuer Freigabelink</label><input type="url" id="sncMoveShare" autocomplete="off" /></div>
      <div class="form-group"><label for="sncMovePass">Passwort</label><input type="password" id="sncMovePass" autocomplete="new-password" /></div>
      <button class="btn btn-primary snc-move-run" ${data.move?.running ? 'disabled' : ''}>🚚 Umziehen</button>
    </details>
    <details class="snc-folders"><summary>🗂 Ordner der Lehrkräfte – aufräumen</summary>
      <p class="hint">Hat eine Lehrkraft die Schule verlassen, wandern ihre Bilder mit, sobald sie eine neue Ablage hat (Nextcloud der
        neuen Schule oder eigene Freigabe). Erst wenn ein Ordner in keinem Modul mehr verwendet wird, lässt er sich löschen.</p>
      <div class="snc-folder-list"><p class="hint">Wird geladen …</p></div>
    </details>` : ''}`;

  const $ = (sel) => box.querySelector(sel);
  const say = (m) => { const el = $('.snc-message'); el.className = `${m?.error ? 'login-error' : 'hint'} snc-message`; el.textContent = m?.text || ''; };
  say(msg);
  if (data.move?.running) setTimeout(() => { if (box.isConnected) renderSchoolNextcloud(app, box); }, 4000);

  $('.snc-connect').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = '⏳ Verbinde …';
    const res = await app.api.connectSchoolNextcloud({ shareUrl: $('#sncShare').value, password: $('#sncPass').value || undefined });
    if (!res || res.statusCode || !res.verified) { await renderSchoolNextcloud(app, box, { error: true, text: `❌ ${res?.message || 'Verbindung fehlgeschlagen.'}` }); return; }
    await renderSchoolNextcloud(app, box, { text: `✅ ${res.message}` });
  });

  $('.snc-disconnect')?.addEventListener('click', async () => {
    let force = false;
    if (data.references > 0) {
      if (!(await app.appConfirm(`Trennen?\n\nBilder aus der Nextcloud der Schule stecken in ${data.references} Modul(en). Nach dem Trennen fehlen sie dort – bei allen Lehrkräften ohne eigene Freigabe.\n\nBesser: „Zu einer anderen Nextcloud umziehen“. Trotzdem trennen?`))) return;
      force = true;
    } else if (!(await app.appConfirm('Nextcloud der Schule trennen? Neue Bilder landen danach wieder in der App (oder in eigenen Freigaben).'))) return;
    const res = await app.api.disconnectSchoolNextcloud(force);
    await renderSchoolNextcloud(app, box, res?.success ? { text: 'Getrennt.' } : { error: true, text: `❌ ${res?.message || 'Fehler'}` });
  });

  $('.snc-move-run')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = '⏳ Prüfe neue Freigabe …';
    const res = await app.api.moveSchoolNextcloud({ shareUrl: $('#sncMoveShare').value, password: $('#sncMovePass').value });
    await renderSchoolNextcloud(app, box, res?.success ? { text: `✅ ${res.message}` } : { error: true, text: `❌ ${res?.message || 'Umziehen fehlgeschlagen'}` });
  });

  $('.snc-folders')?.addEventListener('toggle', async (e) => {
    if (!e.currentTarget.open) return;
    const list = $('.snc-folder-list');
    const res = await app.api.getSchoolNextcloudFolders();
    if (!res?.folders) { list.innerHTML = `<p class="login-error">${escapeHtml(res?.message || 'Fehler')}</p>`; return; }
    if (!res.folders.length) { list.innerHTML = '<p class="hint">Noch keine Ordner.</p>'; return; }
    list.innerHTML = `<table class="class-students"><thead><tr><th>Ordner</th><th>Lehrkraft</th><th>Bilder</th><th>verwendet in</th><th></th></tr></thead><tbody>
      ${res.folders.map((f) => `<tr>
        <td>${escapeHtml(f.folder)}</td>
        <td>${f.teacher ? escapeHtml(f.teacher) : '<span class="hint">unbekannt</span>'}${f.atSchool ? '' : ' <span class="hint">(nicht mehr an der Schule)</span>'}</td>
        <td>${f.images} · ${mb(f.bytes)}</td>
        <td>${f.references ? `${f.references} Modul(en)` : '<span class="hint">nirgends</span>'}</td>
        <td>${f.references ? '' : `<button class="btn btn-danger btn-sm snc-rm" data-folder="${escapeAttr(f.folder)}">🗑 Löschen</button>`}</td>
      </tr>`).join('')}</tbody></table>`;
    list.querySelectorAll('.snc-rm').forEach((b) => b.addEventListener('click', async () => {
      if (!(await app.appConfirm(`Ordner „${b.dataset.folder}“ in der Nextcloud der Schule löschen? Kein Modul verwendet ihn mehr.`))) return;
      const r = await app.api.removeSchoolNextcloudFolder(b.dataset.folder);
      if (!r?.success) { app.showToast(`Fehler: ${r?.message || '?'}`, 'error'); return; }
      app.showToast('Ordner gelöscht.', 'success');
      b.closest('tr').remove();
    }));
  });
}
