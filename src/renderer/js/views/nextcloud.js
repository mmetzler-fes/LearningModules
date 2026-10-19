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

// ---------- Einstellungen (Home-Menü) ----------

export async function openNextcloudDialog(app) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = '<div class="import-modules-card nc-settings" style="min-width:min(560px,94vw); max-width:720px; max-height:90vh; overflow:auto"><p class="hint">Wird geladen…</p></div>';
  document.body.appendChild(overlay);
  const card = overlay.querySelector('.nc-settings');
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const render = async (msg = null) => {
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
    $('.nc-disconnect')?.addEventListener('click', async () => {
      if (!(await app.appConfirm('Nextcloud trennen?\n\nDie Bilder bleiben in deiner Nextcloud, und die Links in den Modulen funktionieren weiter, solange die Freigabe besteht. Neue Bilder landen danach wieder in der App.'))) return;
      await app.api.disconnectNextcloud();
      await render({ text: 'Getrennt.' });
    });
  };
  await render();
}
