import { escapeHtml, escapeAttr } from '../utils.js';
import { setFoldState } from '../fold.js';

// ============ NEXTCLOUD DER SCHULE (Schuladmin) / DES SERVERS (Admin) ============
//
// Ein Freigabelink für die Bilder aller Lehrkräfte der Schule: Wer keine
// eigene Freigabe hat, legt Bilder dort ab (Bilder/<Lehrkraft>/<Thema>/).
// Die des Servers nimmt die Bilder der Lehrkräfte auf, deren Schule keine hat.
// Dazu Umziehen, Trennen und die Ordner-Übersicht zum Aufräumen.
// Siehe docs/nextcloud.md.

/** Texte, die sich zwischen Schule und Server unterscheiden. */
const TEXT = {
  school: {
    name: 'Nextcloud der Schule',
    insecure: 'Die Freigabe der Schule',
    ok: 'Lehrkräfte ohne eigene Freigabe legen ihre Bilder in der <strong>Nextcloud der Schule</strong> ab',
    none: 'Noch <strong>keine Nextcloud der Schule</strong> – Bilder landen bei den Lehrkräften selbst, in der Nextcloud des Servers oder in der App',
    noneSub: 'Mit einem Freigabelink hier legen alle Lehrkräfte ohne eigene Freigabe ihre Bilder automatisch in der Schul-Nextcloud ab – ohne selbst etwas einzurichten.',
    where: 'In der Nextcloud der Schule einen Ordner anlegen (z. B. <code>LearningModules-Bilder</code>)',
    folders: 'Hat eine Lehrkraft die Schule verlassen, wandern ihre Bilder mit, sobald sie eine neue Ablage hat (Nextcloud der neuen Schule oder eigene Freigabe).',
    gone: 'nicht mehr an der Schule',
    who: 'bei allen Lehrkräften ohne eigene Freigabe',
    after: 'Neue Bilder landen danach in eigenen Freigaben, in der Nextcloud des Servers oder in der App.',
  },
  server: {
    name: 'Nextcloud des Servers',
    insecure: 'Die Freigabe des Servers',
    ok: 'Lehrkräfte ohne eigene Freigabe, deren Schule keine Nextcloud hat, legen ihre Bilder in der <strong>Nextcloud des Servers</strong> ab',
    none: 'Noch <strong>keine Nextcloud des Servers</strong> – ohne eigene oder Schul-Nextcloud landen Bilder in der App',
    noneSub: 'Mit einem Freigabelink hier liegen die Bilder aller Lehrkräfte ohne eigene Freigabe und ohne Schul-Nextcloud in dieser Nextcloud statt auf dem Server. Verbindet eine Schule später ihre eigene, ziehen die Bilder ihrer Lehrkräfte dorthin.',
    where: 'In einer Nextcloud einen eigenen Ordner anlegen (nicht den des Backups, z. B. <code>LearningModules-Bilder</code>)',
    folders: 'Bekommt die Schule einer Lehrkraft eine Nextcloud (oder die Lehrkraft eine eigene Freigabe), wandern ihre Bilder dorthin.',
    gone: 'hat jetzt eine andere Ablage',
    who: 'bei allen Lehrkräften ohne eigene Freigabe und ohne Schul-Nextcloud',
    after: 'Neue Bilder dieser Lehrkräfte landen danach wieder in der App.',
  },
};

const mb = (bytes) => `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
const when = (d) => (d ? new Date(d).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');

function moveHtml(m) {
  if (!m) return '';
  if (m.running) return `<p class="hint nc-status">🚚 Umzug läuft: ${m.copied} von ${m.total || '…'} Bildern kopiert. Erst danach schaltet die App um.</p>`;
  if (m.error) return `<p class="hint nc-status"><span class="login-error" style="display:inline">❌ Umzug am ${when(m.at)} abgebrochen: ${escapeHtml(m.error)}</span> Die bisherige Freigabe ist weiter verbunden.</p>`;
  return `<p class="hint nc-status">✅ Umgezogen am ${when(m.at)} (${m.copied} Bilder). Die alte Freigabe (${escapeHtml(m.from || '')}) kann gelöscht werden.</p>`;
}

/** Bereich „☁️ Nextcloud der Schule“ (`server`: des Servers) in `box` zeichnen. */
export async function renderSchoolNextcloud(app, box, msg = null, server = false) {
  if (!box) return;
  const T = TEXT[server ? 'server' : 'school'];
  const again = (m) => renderSchoolNextcloud(app, box, m, server);
  const data = await app.api.getSchoolNextcloud(server).catch(() => null);
  if (!data || data.statusCode) { box.innerHTML = `<p class="login-error">${escapeHtml(data?.message || 'Fehler')}</p>`; return; }
  const ok = data.configured && data.verified;
  setFoldState(box, ok && data.insecure ? '⚠️ ohne Passwort' : ok ? '✅ verbunden' : data.configured ? '⚠️ nicht verbunden' : 'nicht eingerichtet');
  const host = (() => { try { return new URL(data.shareUrl).host; } catch (_) { return ''; } })();
  const hero = ok && data.insecure
    ? { cls: 'warn', title: `⚠️ ${T.insecure} lässt sich <strong>ohne Passwort öffnen</strong>`,
      sub: 'Jeder, der den Freigabelink kennt, kann die Bilder aller Lehrkräfte lesen und ändern. Bitte in der Nextcloud beim Teilen ein Passwort setzen und unter „Verbindung“ eintragen. Die Bilder funktionieren bis dahin weiter.' }
    : ok
    ? { cls: 'ok', title: `${T.ok}${host ? ` <span class="hint">(${escapeHtml(host)})</span>` : ''}`,
      sub: `Je Lehrkraft ein Ordner <code>Bilder/&lt;Name&gt;/&lt;Thema&gt;</code> · Bilder daraus stecken in ${data.references} Modul(en) · <a href="${escapeAttr(data.shareUrl)}" target="_blank" rel="noopener">Ordner öffnen ↗</a>` }
    : data.configured
      ? { cls: 'warn', title: '⚠️ Freigabe gespeichert, aber <strong>nicht verbunden</strong>', sub: 'Bitte unter „Verbindung“ erneut verbinden.' }
      : { cls: 'none', title: T.none, sub: T.noneSub };

  box.innerHTML = `
    <div class="nc-hero nc-hero-${hero.cls}">
      <div class="nc-hero-title">${hero.title}</div>
      <div class="nc-hero-sub hint">${hero.sub}</div>
    </div>
    ${moveHtml(data.move)}
    <details class="nc-section snc-conn" ${ok && !data.insecure ? '' : 'open'}>
      <summary>🔗 Verbindung <span class="nc-sum-state">${ok && data.insecure ? '⚠️ ohne Passwort' : ok ? '✅ verbunden' : data.configured ? '⚠️ nicht verbunden' : 'nicht eingerichtet'}</span></summary>
      <div class="nc-section-body">
        <p class="hint">Freigabe anlegen: ${T.where}
          → <strong>Teilen → Link teilen</strong> → <strong>„Hochladen und Bearbeiten erlauben“</strong> → <strong>Passwort</strong>
          setzen → Link kopieren. Freigaben ohne Passwort nimmt die App nicht an. Die Bilder kommen über diesen Server zu den
          Schülern; in der Nextcloud ist nichts öffentlich. Wer Link und Passwort kennt, sieht die Bilder aller Lehrkräfte.
          Eine eigene Freigabe einer Lehrkraft geht vor${server ? ', ebenso die Nextcloud ihrer Schule' : ''}. Der Ordner muss ein
          eigener sein – nicht der einer Lehrkraft${server ? ' oder einer Schule' : ', einer anderen Schule oder des Servers'}.</p>
        <div class="form-group"><label for="sncShare">Freigabelink des Ordners</label>
          <input type="url" id="sncShare" value="${escapeAttr(data.shareUrl || '')}" autocomplete="off" placeholder="https://cloud.meine-schule.de/s/…" /></div>
        <div class="form-group"><label for="sncPass">Passwort der Freigabe (Pflicht)</label>
          <input type="password" id="sncPass" autocomplete="new-password" placeholder="${data.hasPassword ? 'gespeichert – leer lassen = unverändert' : 'Passwort, das beim Teilen gesetzt wurde'}" /></div>
        <div class="form-actions">
          <button class="btn btn-primary snc-connect">🔌 ${ok ? 'Speichern und prüfen' : 'Verbinden'}</button>
          ${data.configured ? '<button class="btn btn-danger snc-disconnect">Trennen</button>' : ''}
        </div>
        <p class="snc-message hint"></p>
      </div>
    </details>
    ${ok ? `
    <details class="nc-section snc-move">
      <summary>🚚 Zu einer anderen Nextcloud umziehen <span class="nc-sum-state">${data.move?.running ? '⏳ läuft' : ''}</span></summary>
      <div class="nc-section-body">
        <p class="hint">Neue Ordnerfreigabe (Hochladen und Bearbeiten, mit Passwort) eintragen. Die App prüft sie, kopiert alle Bilder
          hinüber und schaltet erst danach um – in den Modulen bleibt alles sichtbar.</p>
        <div class="form-group"><label for="sncMoveShare">Neuer Freigabelink</label><input type="url" id="sncMoveShare" autocomplete="off" placeholder="https://…/s/…" /></div>
        <div class="form-group"><label for="sncMovePass">Passwort (Pflicht)</label><input type="password" id="sncMovePass" autocomplete="new-password" /></div>
        <button class="btn btn-primary snc-move-run" ${data.move?.running ? 'disabled' : ''}>🚚 Umziehen</button>
      </div>
    </details>
    <details class="nc-section snc-folders">
      <summary>🗂 Ordner der Lehrkräfte <span class="nc-sum-state">aufräumen</span></summary>
      <div class="nc-section-body">
        <p class="hint">${T.folders} Erst wenn ein Ordner in keinem Modul mehr verwendet wird, lässt er sich löschen.</p>
        <div class="snc-folder-list"><p class="hint">Wird geladen …</p></div>
      </div>
    </details>` : ''}`;

  const $ = (sel) => box.querySelector(sel);
  const say = (m) => { const el = $('.snc-message'); el.className = `${m?.error ? 'login-error' : 'hint'} snc-message`; el.textContent = m?.text || ''; };
  say(msg);
  // Meldungen zur Verbindung sichtbar halten, auch wenn der Bereich eingeklappt ist.
  if (msg?.text) $('.snc-conn')?.setAttribute('open', '');
  if (data.move?.running) setTimeout(() => { if (box.isConnected) again(); }, 4000);

  $('.snc-connect').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = '⏳ Verbinde …';
    const res = await app.api.connectSchoolNextcloud({ shareUrl: $('#sncShare').value, password: $('#sncPass').value || undefined }, server);
    if (!res || res.statusCode || !res.verified) { await again({ error: true, text: `❌ ${res?.message || 'Verbindung fehlgeschlagen.'}` }); return; }
    await again({ text: `✅ ${res.message}` });
  });

  $('.snc-disconnect')?.addEventListener('click', async () => {
    let force = false;
    if (data.references > 0) {
      if (!(await app.appConfirm(`Trennen?\n\nBilder aus der ${T.name} stecken in ${data.references} Modul(en). Nach dem Trennen fehlen sie dort – ${T.who}.\n\nBesser: „Zu einer anderen Nextcloud umziehen“. Trotzdem trennen?`))) return;
      force = true;
    } else if (!(await app.appConfirm(`${T.name} trennen? ${T.after}`))) return;
    const res = await app.api.disconnectSchoolNextcloud(force, server);
    await again(res?.success ? { text: 'Getrennt.' } : { error: true, text: `❌ ${res?.message || 'Fehler'}` });
  });

  $('.snc-move-run')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = '⏳ Prüfe neue Freigabe …';
    const res = await app.api.moveSchoolNextcloud({ shareUrl: $('#sncMoveShare').value, password: $('#sncMovePass').value }, server);
    await again(res?.success ? { text: `✅ ${res.message}` } : { error: true, text: `❌ ${res?.message || 'Umziehen fehlgeschlagen'}` });
  });

  $('.snc-folders')?.addEventListener('toggle', async (e) => {
    if (!e.currentTarget.open) return;
    const list = $('.snc-folder-list');
    const res = await app.api.getSchoolNextcloudFolders(server);
    if (!res?.folders) { list.innerHTML = `<p class="login-error">${escapeHtml(res?.message || 'Fehler')}</p>`; return; }
    if (!res.folders.length) { list.innerHTML = '<p class="hint">Noch keine Ordner.</p>'; return; }
    list.innerHTML = `<table class="class-students"><thead><tr><th>Lehrkraft</th><th>Bilder</th><th>verwendet in</th><th></th></tr></thead><tbody>
      ${res.folders.map((f) => `<tr>
        <td>${f.teacher ? escapeHtml(f.teacher) : '<span class="hint">unbekannt</span>'}${f.atSchool ? '' : ` <span class="hint">(${T.gone})</span>`}
          <br><span class="hint" style="font-size:0.85em">📁 ${escapeHtml(f.folder)}</span></td>
        <td>${f.images} · ${mb(f.bytes)}</td>
        <td>${f.references ? `${f.references} Modul(en)` : '<span class="hint">nirgends</span>'}</td>
        <td>${!f.removable ? '<span class="hint" title="Kein Ordner einer Lehrkraft – die App löscht ihn nicht.">kein Lehrkraft-Ordner</span>'
          : f.references ? '' : `<button class="btn btn-danger btn-sm snc-rm" data-folder="${escapeAttr(f.folder)}">🗑 Löschen</button>`}</td>
      </tr>`).join('')}</tbody></table>`;
    list.querySelectorAll('.snc-rm').forEach((b) => b.addEventListener('click', async () => {
      if (!(await app.appConfirm(`Ordner „${b.dataset.folder}“ in der ${T.name} löschen? Kein Modul verwendet ihn mehr.`))) return;
      const r = await app.api.removeSchoolNextcloudFolder(b.dataset.folder, server);
      if (!r?.success) { app.showToast(`Fehler: ${r?.message || '?'}`, 'error'); return; }
      app.showToast('Ordner gelöscht.', 'success');
      b.closest('tr').remove();
    }));
  });
}
