import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== NEXTCLOUD DER LEHRKRAFT ====================
//
// Bilder der Module liegen in der eigenen Nextcloud statt in der Datenbank:
// je Lernthema ein Ordner <Hauptordner>/Bilder/<Thema>/, gelesen über eine
// reine Lesefreigabe. Siehe docs/nextcloud.md.
//
// Die klassischen Skripte (content-editors.js, hotspot-editor.js,
// api-shim.js) erreichen das über window.appNextcloud (app.js).

/** Zustand für die Editoren: verbunden? Wird nach Anmeldung und Änderungen neu geholt. */
export const nextcloudState = { ready: false };

export async function refreshNextcloud(app) {
  const data = await app.api.getNextcloud().catch(() => null);
  nextcloudState.ready = !!data?.ready;
  return data;
}

/** Aktuelles Thema, falls der Editor eines offen hat – bestimmt den Ordner. */
function currentTopicId(app) {
  return app.state.currentTopicId || null;
}

/**
 * Bild in die Nextcloud hochladen. Ergebnis: Lese-URL; null, wenn keine
 * Nextcloud verbunden ist (dann bleibt es beim Bild in der App). Bei einem
 * Fehler fragt der Dialog, ob das Bild stattdessen in der App landen soll.
 */
export async function uploadImageToNextcloud(app, file) {
  if (!nextcloudState.ready) return null;
  const res = await app.api.uploadNextcloudImage(file, currentTopicId(app));
  if (res?.success && res.url) {
    app.showToast(`☁️ In der Nextcloud gespeichert: ${res.folder}/${res.name}`, 'success');
    return res.url;
  }
  const keep = await app.appConfirm(`Hochladen in die Nextcloud fehlgeschlagen:\n${res?.message || 'unbekannter Fehler'}\n\nBild stattdessen in der App speichern?`);
  return keep ? null : false;
}

// ---------- Bild aus der Nextcloud wählen ----------

/** Auswahl aus den Ordnern unter Bilder/; Ergebnis: Lese-URL oder null. */
export function pickNextcloudImage(app) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card nc-picker" role="dialog" aria-modal="true" aria-labelledby="ncPickerTitle">
        <h3 id="ncPickerTitle">☁️ Bild aus der Nextcloud</h3>
        <div class="nc-picker-bar">
          <label>Ordner <select class="nc-picker-folder"></select></label>
          <span class="hint">Neue Bilder einfach in der Nextcloud in einen dieser Ordner legen.</span>
        </div>
        <div class="nc-picker-grid"><p class="hint">Wird geladen …</p></div>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary nc-cancel">Abbrechen</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const grid = overlay.querySelector('.nc-picker-grid');
    const select = overlay.querySelector('.nc-picker-folder');
    const done = (url) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(url); };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.nc-cancel').addEventListener('click', () => done(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });

    const load = async (folder) => {
      grid.innerHTML = '<p class="hint">Wird geladen …</p>';
      const res = await app.api.listNextcloudImages({ folder, topicId: folder ? null : currentTopicId(app) });
      if (!res || res.statusCode || res.message) {
        grid.innerHTML = `<p class="login-error">${escapeHtml(res?.message || 'Die Nextcloud ist nicht erreichbar.')}</p>`;
        return;
      }
      const folders = res.folders.includes(res.current) ? res.folders : [res.current, ...res.folders];
      select.innerHTML = folders.map((f) => `<option value="${escapeAttr(f)}" ${f === res.current ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('');
      if (!res.images.length) {
        grid.innerHTML = `<p class="hint">In „${escapeHtml(res.current)}“ liegen noch keine Bilder. Über „📁 Bild auswählen“ hochgeladene Bilder landen hier.</p>`;
        return;
      }
      grid.innerHTML = res.images.map((img, i) => `
        <button type="button" class="nc-picker-item" data-i="${i}" title="${escapeAttr(img.name)}">
          <img src="${escapeAttr(img.previewUrl)}" data-full="${escapeAttr(img.url)}" alt="" loading="lazy" />
          <span>${escapeHtml(img.name)}</span>
        </button>`).join('');
      // Ohne Vorschaubild (ältere Nextcloud, SVG): das Bild selbst zeigen.
      grid.querySelectorAll('img').forEach((im) => im.addEventListener('error', () => {
        if (im.src !== im.dataset.full) im.src = im.dataset.full;
      }, { once: false }));
      grid.querySelectorAll('.nc-picker-item').forEach((b) => b.addEventListener('click', () => done(res.images[Number(b.dataset.i)].url)));
    };
    select.addEventListener('change', () => load(select.value));
    load(null);
  });
}

// ---------- Backup in die Nextcloud ----------

const when = (d) => (d ? new Date(d).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');

function backupSummary(r) {
  if (!r) return '';
  const parts = [];
  if (r.created) parts.push(`${r.created} neu`);
  if (r.updated) parts.push(`${r.updated} geändert`);
  parts.push(`${r.unchanged || 0} unverändert`);
  return parts.join(', ');
}

function backupHtml(b) {
  if (!b) return '';
  const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === b.hour ? 'selected' : ''}>${String(h).padStart(2, '0')}:00 Uhr</option>`).join('');
  const last = b.lastStatus === 'ok'
    ? `Letztes Backup: ${when(b.lastSuccessAt)} (${escapeHtml(backupSummary(b.lastResult))}).`
    : b.lastStatus === 'error'
      ? `<span class="login-error" style="display:inline">❌ Letzter Versuch ${when(b.lastAttemptAt)} fehlgeschlagen: ${escapeHtml(b.lastError || '')}</span>`
      : '';
  return `
    <div class="settings-group nc-backup">
      <h4>Backup deiner Inhalte</h4>
      <p class="hint">Sichert deine selbst verfassten Module täglich nach <strong>${escapeHtml(b.folder)}</strong> – je Lernthema
        eine JSON-Datei, nur wenn sich etwas geändert hat. Ältere Stände zeigt die Nextcloud bei jeder Datei unter
        „Versionen“. Zurückholen: Datei herunterladen und über 📥 Thema importieren einlesen.
        ${b.openUrl ? `<a href="${escapeAttr(b.openUrl)}" target="_blank" rel="noopener">Ordner öffnen ↗</a>` : ''}</p>
      <div class="shop-mode-row">
        <label class="share-flag"><input type="checkbox" id="ncBackupOn" ${b.enabled ? 'checked' : ''} /> <span>Täglich sichern um</span></label>
        <select id="ncBackupHour">${hours}</select>
        <button class="btn btn-secondary nc-backup-run">⬆ Jetzt sichern</button>
      </div>
      ${last ? `<p class="hint">${last}</p>` : ''}
      <p class="nc-backup-message hint"></p>
    </div>`;
}

// ---------- Vorhandene Bilder auslagern ----------

const mb = (bytes) => `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;

/** Eigene Themen mit Bildern in der App auflisten und auf Wunsch Thema für Thema auslagern. */
async function scanMigration(app, body) {
  body.innerHTML = '<p class="hint">Suche …</p>';
  const plan = await app.api.getNextcloudMigration();
  if (!plan || plan.statusCode || !plan.topics) { body.innerHTML = `<p class="login-error">${escapeHtml(plan?.message || 'Fehler')}</p>`; return; }
  if (!plan.topics.length) { body.innerHTML = '<p class="hint">✅ In deinen Themen liegen keine Bilder mehr in der App.</p>'; return; }
  const total = plan.topics.reduce((a, t) => a + t.bytes, 0);
  body.innerHTML = `
    <ul class="nc-migrate-list">${plan.topics.map((t) => `
      <li><label><input type="checkbox" value="${escapeAttr(t.topicId)}" checked />
        ${escapeHtml(t.title)} <span class="hint">– ${t.images} Bild${t.images === 1 ? '' : 'er'}, ${mb(t.bytes)}</span></label>
        <span class="nc-migrate-state"></span></li>`).join('')}
    </ul>
    <p class="hint">Zusammen ${mb(total)}.</p>
    <button class="btn btn-primary nc-migrate-run">📤 In die Nextcloud auslagern</button>
    <p class="nc-migrate-result hint"></p>`;
  body.querySelector('.nc-migrate-run').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    let done = 0;
    let failed = 0;
    for (const box of body.querySelectorAll('input[type=checkbox]:checked')) {
      const state = box.closest('li').querySelector('.nc-migrate-state');
      state.textContent = '⏳';
      // Thema für Thema – eine einzige lange Anfrage liefe in Zeitüberschreitungen.
      const res = await app.api.migrateNextcloudTopic(box.value);
      if (res?.success) {
        done++;
        state.textContent = `✅ ${res.uploaded} hochgeladen${res.reused ? `, ${res.reused} schon da` : ''} → ${res.folder}`;
      } else {
        failed++;
        state.textContent = `❌ ${res?.message || 'Fehler'}`;
      }
      box.disabled = true;
    }
    const themen = (n) => `${n} ${n === 1 ? 'Thema' : 'Themen'}`;
    body.querySelector('.nc-migrate-result').textContent = failed
      ? `${themen(done)} ausgelagert, ${failed} mit Fehler – „Bilder in der App suchen“ zeigt, was noch fehlt.`
      : `✅ ${themen(done)} ausgelagert.`;
  });
}

// ---------- Einstellungen (Home-Menü) ----------

export async function openNextcloudDialog(app) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = '<div class="import-modules-card nc-settings" style="min-width:min(560px,94vw); max-width:720px; max-height:90vh; overflow:auto"><p class="hint">Wird geladen…</p></div>';
  document.body.appendChild(overlay);
  const card = overlay.querySelector('.nc-settings');
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const render = async (msg = null, backupMsg = null) => {
    const data = await refreshNextcloud(app);
    if (!data || data.statusCode) { card.innerHTML = `<p class="login-error">Fehler: ${escapeHtml(data?.message || '?')}</p>`; return; }
    const c = data.config;
    const status = data.ready
      ? `✅ Verbunden als <strong>${escapeHtml(data.displayName || c.username)}</strong>. Bilder landen in
         <strong>${escapeHtml(data.imagesFolder)}/&lt;Thema&gt;</strong>${data.openUrl ? ` – <a href="${escapeAttr(data.openUrl)}" target="_blank" rel="noopener">Ordner öffnen ↗</a>` : ''}.`
      : data.configured ? '⚠️ Gespeichert, aber noch nicht verbunden – bitte „Verbinden“ wählen.' : '';
    card.innerHTML = `
      <h3>☁️ Nextcloud <button type="button" class="help-hint" data-help="nextcloud" title="Hilfe" aria-label="Hilfe">?</button></h3>
      <p class="hint">Bilder, die du in Module einfügst, speichert die App dann <strong>in deiner Nextcloud</strong> statt auf
        dem Server – je Lernthema in einem eigenen Ordner. Im Modul steht nur der Link; die Schülerinnen und Schüler laden
        das Bild direkt aus deiner Nextcloud. Im Bildfeld kommt <strong>☁️ Aus Nextcloud</strong> dazu: Bilder, die schon in
        diesen Ordnern liegen, mit einem Klick einfügen.</p>
      <p class="hint">⚠️ Die Bilder sind über eine <strong>öffentliche Lesefreigabe</strong> erreichbar – für jeden, der den
        Link kennt. Für Unterrichtsmaterial ist das in Ordnung, <strong>Fotos von Schülerinnen und Schülern gehören nicht
        hinein</strong>.</p>
      ${status ? `<p class="hint nc-status">${status}</p>` : ''}
      <div class="settings-group">
        <div class="form-group">
          <label for="ncBase">Adresse der Nextcloud${data.suggested ? ' <span class="hint">(vorgeschlagen: die Nextcloud des automatischen Backups dieses Servers)</span>' : ''}</label>
          <input type="url" id="ncBase" value="${escapeAttr(c.baseUrl)}" placeholder="https://cloud.meine-schule.de" autocomplete="off" />
        </div>
        <div class="form-group">
          <label for="ncUser">Benutzername</label>
          <input type="text" id="ncUser" value="${escapeAttr(c.username)}" autocomplete="off" />
        </div>
        <div class="form-group">
          <label for="ncPass">App-Passwort <span class="hint">(Nextcloud → Persönliche Einstellungen → Sicherheit → „Neues App-Passwort erstellen“ – nicht dein normales Passwort)</span></label>
          <input type="password" id="ncPass" autocomplete="new-password"
            placeholder="${c.hasPassword ? 'gespeichert – leer lassen = unverändert' : 'xxxxx-xxxxx-xxxxx-xxxxx-xxxxx'}" />
        </div>
        <div class="form-group">
          <label for="ncFolder">Hauptordner in der Nextcloud <span class="hint">(darin legt die App „Bilder/&lt;Thema&gt;“ an)</span></label>
          <input type="text" id="ncFolder" value="${escapeAttr(c.folder)}" autocomplete="off" />
        </div>
        <div class="form-actions">
          <button class="btn btn-primary nc-connect">🔌 Verbinden</button>
          ${data.configured ? '<button class="btn btn-danger nc-disconnect">Trennen</button>' : ''}
        </div>
        <p class="nc-message" style="margin-top:10px"></p>
      </div>
      ${data.ready ? backupHtml(data.backup) : ''}
      ${data.ready ? `
      <div class="settings-group nc-migrate">
        <h4>Vorhandene Bilder auslagern</h4>
        <p class="hint">Bilder, die schon in deinen Modulen stecken, liegen noch in der App. Hier wandern sie in die Ordner
          deiner Themen; in den Modulen steht danach der Link. Gleiche Bilder gehen nur einmal hoch. Gekaufte oder
          übernommene Module bleiben unverändert.</p>
        <button class="btn btn-secondary nc-migrate-scan">🔍 Bilder in der App suchen</button>
        <div class="nc-migrate-body"></div>
      </div>` : ''}
      <div class="confirm-actions"><button class="btn btn-secondary nc-close">Schließen</button></div>`;

    const $ = (sel) => card.querySelector(sel);
    const say = (m) => {
      const el = $('.nc-message');
      el.className = `${m?.error ? 'login-error' : 'hint'} nc-message`;
      el.textContent = m?.text || '';
    };
    say(msg);
    $('.nc-close').addEventListener('click', close);
    $('.nc-connect').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '⏳ Verbinde …';
      const res = await app.api.saveNextcloud({
        baseUrl: $('#ncBase').value, username: $('#ncUser').value,
        password: $('#ncPass').value || undefined, folder: $('#ncFolder').value,
      });
      if (!res || res.statusCode || !res.ready) {
        btn.disabled = false;
        btn.textContent = '🔌 Verbinden';
        await refreshNextcloud(app);
        say({ error: true, text: `❌ ${res?.message || 'Verbindung fehlgeschlagen.'}` });
        return;
      }
      await render({ text: `✅ ${res.message}` });
    });
    $('.nc-migrate-scan')?.addEventListener('click', () => scanMigration(app, $('.nc-migrate-body')));
    // Backup: Einstellungen speichern sich beim Ändern; „Jetzt sichern“ läuft sofort.
    const sayBackup = (m) => {
      const el = $('.nc-backup-message');
      el.className = `${m?.error ? 'login-error' : 'hint'} nc-backup-message`;
      el.textContent = m?.text || '';
    };
    const saveBackup = async () => {
      const res = await app.api.saveNextcloudBackup({ enabled: $('#ncBackupOn').checked, hour: Number($('#ncBackupHour').value) });
      if (!res?.success) sayBackup({ error: true, text: `❌ ${res?.message || 'Speichern fehlgeschlagen'}` });
      else sayBackup({ text: res.enabled ? `Gespeichert – nächstes Backup ${when(res.nextRunAt)}.` : 'Automatisches Backup ausgeschaltet.' });
    };
    if ($('.nc-backup-message')) sayBackup(backupMsg);
    $('#ncBackupOn')?.addEventListener('change', saveBackup);
    $('#ncBackupHour')?.addEventListener('change', saveBackup);
    $('.nc-backup-run')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '⏳ Sichere …';
      const res = await app.api.runNextcloudBackup();
      if (res?.success) await render(null, { text: `✅ Gesichert: ${backupSummary(res)}.` });
      else { btn.disabled = false; btn.textContent = '⬆ Jetzt sichern'; sayBackup({ error: true, text: `❌ ${res?.message || 'Backup fehlgeschlagen'}` }); }
    });
    $('.nc-disconnect')?.addEventListener('click', async () => {
      if (!(await app.appConfirm('Nextcloud trennen?\n\nDie Bilder bleiben in deiner Nextcloud, und die Links in den Modulen funktionieren weiter, solange die Freigabe besteht. Neue Bilder landen danach wieder in der App.'))) return;
      await app.api.disconnectNextcloud();
      await render({ text: 'Getrennt.' });
    });
  };
  await render();
}
