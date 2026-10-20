import { escapeHtml, escapeAttr } from '../utils.js';
import { loadQuota, quotaHtml, refreshQuotaBadge, shrinkImage } from './image-store.js';

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
  void refreshQuotaBadge(app).catch(() => undefined);
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

function backupHtml(b, open = false) {
  if (!b) return '';
  const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === b.hour ? 'selected' : ''}>${String(h).padStart(2, '0')}:00 Uhr</option>`).join('');
  const last = b.lastStatus === 'ok'
    ? `Letztes Backup: ${when(b.lastSuccessAt)} (${escapeHtml(backupSummary(b.lastResult))}).`
    : b.lastStatus === 'error'
      ? `<span class="login-error" style="display:inline">❌ Letzter Versuch ${when(b.lastAttemptAt)} fehlgeschlagen: ${escapeHtml(b.lastError || '')}</span>`
      : '';
  const state = !b.enabled ? 'aus'
    : b.lastStatus === 'error' ? '❌ fehlgeschlagen'
      : `täglich ${String(b.hour).padStart(2, '0')}:00${b.lastSuccessAt ? ` · zuletzt ${when(b.lastSuccessAt)}` : ''}`;
  return `
    <details class="nc-section nc-backup" ${b.lastStatus === 'error' || open ? 'open' : ''}>
      <summary>💾 Backup deiner Inhalte <span class="nc-sum-state">${escapeHtml(state)}</span></summary>
      <div class="nc-section-body">
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
      </div>
    </details>`;
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
    void refreshQuotaBadge(app).catch(() => undefined);
    const themen = (n) => `${n} ${n === 1 ? 'Thema' : 'Themen'}`;
    body.querySelector('.nc-migrate-result').textContent = failed
      ? `${themen(done)} ausgelagert, ${failed} mit Fehler – „Bilder in der App suchen“ zeigt, was noch fehlt.`
      : `✅ ${themen(done)} ausgelagert.`;
  });
}

// ---------- Bilder aus dem früheren Ordner der Schule ----------

/**
 * Früher konnten Bilder im Nextcloud-Ordner des Admin-Backups liegen. Die
 * App übernimmt sie in die eigene Freigabe, sobald die verbunden ist.
 */
function legacyHtml(legacy, own, school) {
  if (!legacy) return '';
  // Erledigtes nur noch zwei Wochen lang zeigen.
  if (!legacy.pending && Date.now() - new Date(legacy.movedAt).getTime() > 14 * 24 * 3600 * 1000) return '';
  // Mit Schul-Nextcloud wandern verwendete Bilder von selbst dorthin.
  if (legacy.pending && school && !own) return '';
  const r = legacy.result || {};
  const counts = () => {
    const parts = [`${r.copied || 0} kopiert`];
    if (r.reused) parts.push(`${r.reused} schon vorhanden`);
    if (r.missing) parts.push(`${r.missing} nicht lesbar`);
    parts.push(`${r.modules || 0} Module umgestellt`);
    return parts.join(', ');
  };
  let text;
  if (!legacy.pending) text = `✅ Deine Bilder aus dem früheren Ordner der Schule sind übernommen (${when(legacy.movedAt)}: ${escapeHtml(counts())}).`;
  else if (legacy.running) text = '⏳ Deine Bilder aus dem früheren Ordner der Schule werden gerade in deine Freigabe übernommen …';
  else if (own && r.error) text = `<span class="login-error" style="display:inline">❌ Übernahme der Bilder aus dem früheren Ordner der Schule fehlgeschlagen: ${escapeHtml(r.error)}</span> Die App versucht es später erneut; „Verbinden“ startet sofort einen neuen Versuch.`;
  else if (own) text = '⏳ Deine Bilder aus dem früheren Ordner der Schule werden in deine Freigabe übernommen …';
  else text = '📦 Deine bisherigen Bilder liegen noch im früheren Ordner der Schule und bleiben in den Modulen sichtbar. Sobald du unten eine Freigabe verbindest, übernimmt die App sie dorthin.';
  return `<p class="hint nc-status">${text}</p>`;
}

// ---------- Freigabe trennen: Überblick, zurückholen, umziehen ----------

const BATCH_BYTES = 8 * 1024 * 1024;   // je Anfrage höchstens so viele Bilddaten

/**
 * Vor dem Trennen: was hängt an der Freigabe? Dann zurückholen (verkleinert,
 * nur unter der Grenze), umziehen oder ausdrücklich trotzdem trennen.
 * `done(msg)` zeichnet den Dialog neu.
 */
async function disconnectFlow(app, box, openMove, done) {
  box.innerHTML = '<p class="hint">Prüfe, welche Bilder an der Freigabe hängen …</p>';
  const u = await app.api.getNextcloudUsage();
  if (!u || u.statusCode) { box.innerHTML = `<p class="login-error">${escapeHtml(u?.message || 'Fehler')}</p>`; return; }
  if (!u.count) {
    if (!(await app.appConfirm('Freigabe trennen?\n\nIn den Modulen stecken keine Bilder aus dieser Freigabe. Neue Bilder landen danach wieder in der App.'))) { box.innerHTML = ''; return; }
    await app.api.disconnectNextcloud();
    await done({ text: 'Getrennt.' });
    return;
  }
  const others = u.topics.filter((t) => !t.mine);
  const room = u.limitBytes ? Math.max(0, u.limitBytes - u.appUsedBytes) : null;
  box.innerHTML = `
    <div class="nc-disconnect-panel">
      <p><strong>An dieser Freigabe hängen ${u.count} Bild${u.count === 1 ? '' : 'er'} (${mb(u.bytes)})</strong> in
        ${u.topics.length} Thema/Themen${others.length ? `, davon ${others.length} bei anderen Lehrkräften (Kopien aus dem Shop)` : ''}${u.drafts ? ` und ${u.drafts} Entwurf/Entwürfen` : ''}.
        Nach dem Trennen fehlen sie dort.</p>
      <ul class="nc-migrate-list">${u.topics.map((t) => `<li>${escapeHtml(t.title)}${t.mine ? '' : ' <span class="hint">(andere Lehrkraft)</span>'}</li>`).join('')}</ul>
      <p class="hint">${room === null ? 'Für Bilder in der App gibt es keine Grenze.'
        : `In der App ist noch Platz für ${mb(room)} (Grenze ${mb(u.limitBytes)}). Beim Zurückholen werden die Bilder verkleinert – ob es passt, zeigt sich danach.`}</p>
      <div class="form-actions">
        ${u.school ? '<button class="btn btn-primary nc-hand-over">🏫 In die Nextcloud der Schule übernehmen und trennen</button>' : ''}
        <button class="btn ${u.school ? 'btn-secondary' : 'btn-primary'} nc-return">⬇ Zurück in die App holen und trennen</button>
        <button class="btn btn-secondary nc-to-move">🚚 Zu einer anderen Nextcloud umziehen</button>
        <button class="btn btn-danger nc-force">Trotzdem trennen</button>
        <button class="btn btn-secondary nc-cancel-disconnect">Abbrechen</button>
      </div>
      <p class="nc-return-state hint"></p>
    </div>`;
  const state = box.querySelector('.nc-return-state');
  box.querySelector('.nc-cancel-disconnect').addEventListener('click', () => { box.innerHTML = ''; });
  box.querySelector('.nc-hand-over')?.addEventListener('click', async () => {
    box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    state.className = 'nc-return-state hint';
    state.textContent = `⏳ Kopiere ${u.count} Bilder in die Nextcloud der Schule …`;
    const res = await app.api.handOverNextcloud();
    if (!res?.success) {
      state.className = 'nc-return-state login-error';
      state.textContent = `❌ ${res?.message || 'Übernehmen fehlgeschlagen'} – die Freigabe ist noch verbunden.`;
      box.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      return;
    }
    await done({ text: `✅ ${res.images} Bilder liegen jetzt in der Nextcloud der Schule${res.missing ? ` (${res.missing} ließen sich nicht holen)` : ''}, die eigene Freigabe ist getrennt.` });
  });
  box.querySelector('.nc-to-move').addEventListener('click', () => { box.innerHTML = ''; openMove(); });
  box.querySelector('.nc-force').addEventListener('click', async () => {
    const list = u.topics.slice(0, 15).map((t) => `• ${t.title}`).join('\n') + (u.topics.length > 15 ? `\n… und ${u.topics.length - 15} weitere` : '');
    if (!(await app.appConfirm(`Wirklich trennen?\n\nIn diesen Themen fehlen danach ${u.count} Bilder:\n${list}\n\nDie Dateien bleiben in deiner Nextcloud. Wer später dieselbe Freigabe wieder verbindet, hat sie zurück.`))) return;
    await app.api.disconnectNextcloud(true);
    await done({ text: 'Getrennt – die Bilder aus der Freigabe fehlen jetzt in den Modulen.' });
  });
  box.querySelector('.nc-return').addEventListener('click', async (e) => {
    const buttons = box.querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });
    const fail = (text) => { state.className = 'nc-return-state login-error'; state.textContent = text; buttons.forEach((b) => { b.disabled = false; }); };
    // 1. Alle holen und verkleinern – erst dann ist klar, ob es unter die Grenze passt.
    const items = [];
    let i = 0;
    let missing = 0;
    for (const img of u.images) {
      state.textContent = `⏳ Hole und verkleinere ${++i} von ${u.images.length} …`;
      try {
        const res = await fetch(img.fetchUrl);
        if (!res.ok) { missing++; continue; }
        const dataUrl = await shrinkImage(await res.blob());
        items.push({ sub: img.sub, name: img.name, dataUrl, size: Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4) });
      } catch (_) { missing++; }
    }
    const total = items.reduce((a, x) => a + x.size, 0);
    if (room !== null && total > room) {
      fail(`Verkleinert sind es ${mb(total)} – in der App ist nur noch Platz für ${mb(room)}. Zurückholen geht nicht; bitte umziehen.`);
      return;
    }
    // 2. In Paketen zurückschicken; der Server prüft die Grenze strikt.
    let sent = 0;
    for (let k = 0; k < items.length;) {
      const batch = [];
      let bytes = 0;
      while (k < items.length && (!batch.length || bytes + items[k].size <= BATCH_BYTES)) { bytes += items[k].size; batch.push(items[k++]); }
      state.textContent = `⏳ Speichere in der App … ${sent} von ${items.length}`;
      const res = await app.api.returnNextcloudImages(batch.map(({ sub, name, dataUrl }) => ({ sub, name, dataUrl })));
      if (!res || res.statusCode) { fail(`❌ ${res?.message || 'Zurückholen fehlgeschlagen'} – ${sent} Bilder sind schon zurück, die Freigabe ist noch verbunden.`); return; }
      sent += batch.length;
    }
    if (missing && !(await app.appConfirm(`${sent} Bilder sind zurück in der App. ${missing} ließen sich nicht holen (nicht mehr in der Nextcloud?) und fehlen nach dem Trennen.\n\nTrotzdem trennen?`))) {
      fail(`${sent} Bilder sind zurück; die Freigabe bleibt verbunden.`);
      return;
    }
    await app.api.disconnectNextcloud(true);
    void refreshQuotaBadge(app).catch(() => undefined);
    await done({ text: `✅ ${sent} Bilder sind zurück in der App (${mb(total)}), die Freigabe ist getrennt.` });
  });
}

/** Stand eines Umzugs für den Dialog. */
function moveHtml(m) {
  if (!m) return '';
  if (m.running) return `<p class="hint nc-status">🚚 Umzug läuft: ${m.copied} von ${m.total || '…'} Bildern kopiert. Erst danach schaltet die App auf die neue Freigabe um.</p>`;
  if (m.error) return `<p class="hint nc-status"><span class="login-error" style="display:inline">❌ Umzug am ${when(m.at)} abgebrochen: ${escapeHtml(m.error)}</span> Die bisherige Freigabe ist weiter verbunden – nichts fehlt.</p>`;
  return `<p class="hint nc-status">✅ Umgezogen am ${when(m.at)} (${m.copied} Bilder kopiert). Die alte Freigabe (${escapeHtml(m.from || '')}) wird nicht mehr gebraucht und kann gelöscht werden.</p>`;
}

/** Verlinkte Bilder, die in der Freigabe fehlen bzw. aus einer früheren zurückgeholt wurden. */
function imageCheckHtml(c) {
  if (!c) return '';
  const out = [];
  if (c.restored) out.push(`<p class="hint nc-status">♻️ ${c.restored} Bild${c.restored === 1 ? '' : 'er'} aus deiner früheren Freigabe in die jetzige kopiert (${when(c.at)}).</p>`);
  if (c.count) {
    const list = c.missing.map((m) => `<li><code>Bilder/${escapeHtml(m.sub)}/${escapeHtml(m.name)}</code></li>`).join('');
    out.push(`<details class="hint nc-status" open><summary><span class="login-error" style="display:inline">⚠️ ${c.count} Bild${c.count === 1 ? '' : 'er'} aus deinen Modulen
      ${c.count === 1 ? 'fehlt' : 'fehlen'} in deiner Freigabe</span> (Stand ${when(c.at)})</summary>
      <p>Lege die Dateien wieder genau so in deiner Nextcloud ab – die Links in den Modulen funktionieren dann sofort wieder.
      Die App prüft stündlich; „Speichern und prüfen“ stößt sofort eine neue Prüfung an (Dialog danach neu öffnen).</p>
      <ul class="nc-migrate-list">${list}</ul>${c.count > c.missing.length ? `<p>… und ${c.count - c.missing.length} weitere.</p>` : ''}</details>`);
  }
  return out.join('');
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
    const quota = data?.ready ? null : await loadQuota(app, true);
    if (!data || data.statusCode) { card.innerHTML = `<p class="login-error">Fehler: ${escapeHtml(data?.message || '?')}</p>`; return; }
    const c = data.config;
    const own = data.mode === 'own';
    const schoolMode = data.mode === 'school';
    const host = (() => { try { return new URL(c.shareUrl).host; } catch (_) { return ''; } })();
    const open = (url) => (url ? ` · <a href="${escapeAttr(url)}" target="_blank" rel="noopener">Ordner öffnen ↗</a>` : '');

    // Oben: wohin die Bilder gerade gehen – auf einen Blick.
    const hero = own && data.insecure
      ? { cls: 'warn', title: '⚠️ Deine Freigabe lässt sich <strong>ohne Passwort öffnen</strong>',
        sub: 'Jeder, der den Freigabelink kennt, kann deinen Ordner lesen und ändern. Bitte in der Nextcloud beim Teilen ein Passwort setzen und es unter „Verbindung“ eintragen. Deine Bilder funktionieren bis dahin weiter.' }
      : own
      ? { cls: 'ok', title: `Deine Bilder landen in <strong>deiner Nextcloud</strong>${host ? ` <span class="hint">(${escapeHtml(host)})</span>` : ''}`,
        sub: `Ordner <code>Bilder/&lt;Thema&gt;</code> · geschützt durch das Passwort · kommen über diesen Server zu den Schülern${open(data.openUrl)}` }
      : schoolMode
        ? { cls: 'ok', title: 'Deine Bilder landen in der <strong>Nextcloud deiner Schule</strong>',
          sub: `Ordner <code>${escapeHtml(data.school.folder)}/&lt;Thema&gt;</code> · du musst nichts einrichten · der Schuladmin kann den Ordner sehen` }
        : data.configured
          ? { cls: 'warn', title: '⚠️ Freigabe gespeichert, aber <strong>nicht verbunden</strong>', sub: 'Bitte unter „Verbindung“ erneut verbinden.' }
          : { cls: 'none', title: 'Deine Bilder landen <strong>in der App</strong> (auf dem Server, verkleinert)',
            sub: 'Mit einer Nextcloud-Freigabe liegen sie stattdessen in deiner Cloud – je Thema ein Ordner, im Modul steht nur der Link, und im Bildfeld kommt <strong>☁️ Aus Nextcloud</strong> dazu.' };

    const notices = [
      quotaHtml(quota),
      data.readShareLostAt && Date.now() - new Date(data.readShareLostAt).getTime() < 30 * 24 * 3600 * 1000
        ? `<p class="hint nc-status">ℹ️ Die frühere Lesefreigabe für <code>Bilder</code> (ohne Passwort) wird nicht mehr verwendet – die Bilder
          kommen seit ${when(data.readShareLostAt)} über diesen Server, in den Modulen fehlt nichts. Du kannst sie in der Nextcloud löschen.</p>` : '',
      legacyHtml(data.legacy, own, schoolMode),
      moveHtml(data.move),
      own ? imageCheckHtml(data.imageCheck) : '',
    ].filter(Boolean).join('');

    const howTo = `<p class="hint">So legst du die Freigabe an: In der Nextcloud einen Ordner anlegen (z. B. <code>LearningModules</code>) →
          <strong>Teilen → Link teilen</strong> → <strong>„Hochladen und Bearbeiten erlauben“</strong> → ein
          <strong>Passwort</strong> setzen → Link kopieren. Die App sieht dann nur diesen Ordner – kein Konto, kein App-Passwort.
          Freigaben ohne Passwort nimmt sie nicht an.</p>`;
    const connState = own && data.insecure ? '⚠️ ohne Passwort' : own ? '✅ verbunden' : data.configured ? '⚠️ nicht verbunden' : schoolMode ? 'optional – geht vor' : 'nicht eingerichtet';
    const connOpen = (!own && (!schoolMode || data.configured || msg?.text)) || (own && data.insecure);
    const connection = `
      <details class="nc-section nc-own" ${connOpen ? 'open' : ''}>
        <summary>🔗 ${schoolMode ? 'Eigene Freigabe' : 'Verbindung'} <span class="nc-sum-state">${connState}</span></summary>
        <div class="nc-section-body">
        ${own ? `<details class="nc-howto"><summary>Wie lege ich eine Freigabe an?</summary>${howTo}</details>` : howTo}
        <div class="form-group">
          <label for="ncShare">Freigabelink des Ordners</label>
          <input type="url" id="ncShare" value="${escapeAttr(c.shareUrl)}" autocomplete="off"
            placeholder="${escapeAttr(data.suggestedBase ? `${data.suggestedBase}/s/…` : 'https://cloud.meine-schule.de/s/…')}" />
        </div>
        <div class="form-group">
          <label for="ncPass">Passwort der Freigabe (Pflicht)</label>
          <input type="password" id="ncPass" autocomplete="new-password"
            placeholder="${c.hasPassword ? 'gespeichert – leer lassen = unverändert' : 'Passwort, das du beim Teilen gesetzt hast'}" />
        </div>
        <div class="form-actions">
          <button class="btn btn-primary nc-connect">🔌 ${own ? 'Speichern und prüfen' : 'Verbinden'}</button>
          ${data.configured ? '<button class="btn btn-danger nc-disconnect">Freigabe trennen</button>' : ''}
        </div>
        <div class="nc-disconnect-box"></div>
        <p class="nc-message" style="margin-top:10px"></p>
        </div>
      </details>`;

    const move = own ? `
      <details class="nc-section nc-move">
        <summary>🚚 Zu einer anderen Nextcloud umziehen <span class="nc-sum-state">${data.move?.running ? '⏳ läuft' : ''}</span></summary>
        <div class="nc-section-body">
          <p class="hint">Etwa bei einem Schulwechsel oder einer neuen Cloud: Neue Ordnerfreigabe anlegen (Hochladen und Bearbeiten
            erlaubt, mit Passwort) und hier eintragen. Die App prüft sie, kopiert den Ordner <code>Bilder</code> hinüber und schaltet
            erst danach um – in den Modulen bleibt alles sichtbar. Die alte Freigabe wird nicht verändert.</p>
          <div class="form-group"><label for="ncMoveShare">Neuer Freigabelink</label>
            <input type="url" id="ncMoveShare" autocomplete="off" placeholder="https://…/s/…" /></div>
          <div class="form-group"><label for="ncMovePass">Passwort der neuen Freigabe (Pflicht)</label>
            <input type="password" id="ncMovePass" autocomplete="new-password" /></div>
          <button class="btn btn-primary nc-move-run" ${data.move?.running ? 'disabled' : ''}>🚚 Umziehen</button>
        </div>
      </details>` : '';

    const migrate = data.ready ? `
      <details class="nc-section nc-migrate">
        <summary>📤 Bilder aus der App auslagern <span class="nc-sum-state">läuft automatisch stündlich</span></summary>
        <div class="nc-section-body">
          <p class="hint">Bilder, die noch in der App liegen, wandern von selbst in die Ordner deiner Themen – auch aus gekauften und
            übernommenen Modulen; im Modul steht danach der Link. Hier geht es für deine eigenen Module sofort.</p>
          <button class="btn btn-secondary nc-migrate-scan">🔍 Bilder in der App suchen</button>
          <div class="nc-migrate-body"></div>
        </div>
      </details>` : '';

    card.innerHTML = `
      <h3>☁️ Nextcloud <button type="button" class="help-hint" data-help="nextcloud" title="Hilfe" aria-label="Hilfe">?</button></h3>
      <div class="nc-hero nc-hero-${hero.cls}">
        <div class="nc-hero-title">${hero.title}</div>
        <div class="nc-hero-sub hint">${hero.sub}</div>
      </div>
      ${notices ? `<div class="nc-notices">${notices}</div>` : ''}
      ${connection}
      ${move}
      ${own ? backupHtml(data.backup, !!backupMsg) : ''}
      ${migrate}
      <div class="confirm-actions"><button class="btn btn-secondary nc-close">Schließen</button></div>`;

    const $ = (sel) => card.querySelector(sel);
    const say = (m) => {
      const el = $('.nc-message');
      el.className = `${m?.error ? 'login-error' : 'hint'} nc-message`;
      el.textContent = m?.text || '';
    };
    say(msg);
    // Meldung zur eigenen Freigabe sichtbar halten, auch wenn ihr Formular eingeklappt ist.
    if (msg?.text) $('.nc-own')?.setAttribute('open', '');
    // Übernahme läuft im Hintergrund – Stand nachladen, solange der Dialog offen ist.
    if (data.legacy?.running || data.move?.running) setTimeout(() => { if (overlay.isConnected) render(); }, 4000);
    $('.nc-close').addEventListener('click', close);
    $('.nc-connect').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '⏳ Verbinde …';
      const res = await app.api.saveNextcloud({
        shareUrl: $('#ncShare').value, password: $('#ncPass').value || undefined,
      });
      if (!res || res.statusCode || res.mode !== 'own') {
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
    const openMove = () => { const d = $('.nc-move'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#ncMoveShare')?.focus(); } };
    $('.nc-disconnect')?.addEventListener('click', () => {
      if (!own) {
        // Nie verbunden gewesen (nur gespeichert): einfach vergessen.
        void app.api.disconnectNextcloud(true).then(() => render({ text: 'Getrennt.' }));
        return;
      }
      void disconnectFlow(app, $('.nc-disconnect-box'), openMove, (m) => render(m));
    });
    $('.nc-move-run')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '⏳ Prüfe neue Freigabe …';
      const res = await app.api.moveNextcloud({ shareUrl: $('#ncMoveShare').value, password: $('#ncMovePass').value });
      if (!res?.success) {
        btn.disabled = false;
        btn.textContent = '🚚 Umziehen';
        say({ error: true, text: `❌ ${res?.message || 'Umziehen fehlgeschlagen'}` });
        return;
      }
      await render({ text: `✅ ${res.message}` });
    });
  };
  await render();
}
