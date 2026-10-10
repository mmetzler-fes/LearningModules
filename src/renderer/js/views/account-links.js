import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== KONTEN AUF ANDEREN SERVERN ====================
//
// Das eigene Konto auf einem verbundenen Server verknüpfen (per Code) und die
// eigenen Inhalte von dort hierher holen – einseitig: Was hier geändert
// wurde, bleibt. Siehe docs/uebergabe.md.

const when = (d) => (d ? new Date(d).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');

/** Ergebnis eines Abgleichs in einem Satz. */
export function syncSummary(r) {
  if (!r) return 'noch nicht abgeglichen';
  if (r.error) return `⚠️ ${r.error}`;
  const parts = [];
  if (r.created) parts.push(`${r.created} neu`);
  if (r.updated) parts.push(`${r.updated} aktualisiert`);
  if (r.unchanged) parts.push(`${r.unchanged} unverändert`);
  if (r.nodes) parts.push(`${r.nodes} Books/Bereiche angelegt`);
  let s = parts.join(', ') || 'nichts zu holen';
  if (r.conflicts?.length) s += ` · nicht überschrieben, weil hier geändert: ${r.conflicts.join(', ')}`;
  if (r.gone?.length) s += ` · drüben nicht mehr vorhanden (bleibt hier): ${r.gone.join(', ')}`;
  return s;
}

export async function openAccountLinksDialog(app) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = '<div class="import-modules-card acc-links" style="min-width:min(520px,94vw); max-width:680px; max-height:90vh; overflow:auto"><p class="hint">Wird geladen…</p></div>';
  document.body.appendChild(overlay);
  const card = overlay.querySelector('.acc-links');
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const render = async () => {
    const data = await app.api.getAccountLinks();
    if (!data || data.statusCode) { card.innerHTML = `<p class="login-error">Fehler: ${escapeHtml(data?.message || '?')}</p>`; return; }
    const peerOptions = data.peers.map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    const linked = new Set(data.links.map((l) => l.peerId));
    card.innerHTML = `
      <h3>🔗 Mein Konto auf anderen Servern <button type="button" class="help-hint" data-help="uebergabe#mein-konto-auf-anderen-servern" title="Hilfe" aria-label="Hilfe">?</button></h3>
      <p class="hint">Unterrichtest du auch an einer Schule mit eigenem LearningModules-Server? Verknüpfe dein Konto dort,
        dann holst du deine eigenen Inhalte von dort hierher – als deine eigenen. Später kommen Änderungen nach;
        was du hier geändert hast, wird nie überschrieben.</p>
      ${!data.peers.length && !data.links.length ? '<p class="login-error">Dieser Server ist mit keinem anderen verbunden. Das richtet der Admin unter 🌐 Vernetzung ein.</p>' : ''}

      ${data.links.length ? `<div class="acc-link-list">${data.links.map((l) => `
        <div class="fed-peer ${l.peerActive ? '' : 'fed-inactive'}" data-id="${escapeAttr(l.id)}">
          <div class="fed-peer-info">
            <strong>${escapeHtml(l.remoteName)} @ ${escapeHtml(l.peerName)}</strong>
            <div class="hint">Zuletzt geholt: ${when(l.lastSyncAt)} – ${escapeHtml(syncSummary(l.lastResult))}</div>
            <label class="share-flag acc-auto"><input type="checkbox" class="acc-auto-cb" ${l.autoSync ? 'checked' : ''} ${l.peerActive ? '' : 'disabled'} />
              <span>stündlich automatisch holen</span></label>
          </div>
          <div class="fed-peer-actions">
            <button class="btn btn-primary btn-sm acc-sync" ${l.peerActive ? '' : 'disabled'}>⬇ Jetzt holen</button>
            <button class="btn btn-danger btn-sm acc-unlink">Lösen</button>
          </div>
        </div>`).join('')}</div>` : ''}

      ${data.peers.some((p) => !linked.has(p.id)) ? `
      <div class="settings-group acc-new">
        <h4>Konto verknüpfen</h4>
        <p class="hint">Die gleiche E-Mail-Adresse genügt dafür nicht – du bestätigst mit einem Code, dass beide Konten dir gehören.
          Den Code erzeugst du auf dem einen Server und gibst ihn auf dem anderen ein (15 Minuten gültig).</p>
        <div class="acc-step">
          <strong>Code hier erzeugen</strong> – für:
          <select class="acc-code-peer">${peerOptions}</select>
          <button class="btn btn-secondary btn-sm acc-code-btn">Code erzeugen</button>
          ${data.code ? `<div class="acc-code">Dein Code: <code>${escapeHtml(data.code.code)}</code>
            <span class="hint">– gib ihn auf ${escapeHtml(data.peers.find((p) => p.id === data.code.peerId)?.name || 'dem anderen Server')} ein
            (🏠 LernModule → 🔗 Andere Server), gültig bis ${new Date(data.code.expiresAt).toLocaleTimeString('de-DE', { timeStyle: 'short' })}</span></div>` : ''}
        </div>
        <div class="acc-step">
          <strong>oder Code von dort eingeben</strong> – von:
          <select class="acc-enter-peer">${peerOptions}</select>
          <input type="text" class="acc-enter-code" maxlength="9" placeholder="ABCD-EF23" autocomplete="off" />
          <button class="btn btn-primary btn-sm acc-enter-btn">Verknüpfen</button>
        </div>
      </div>` : ''}
      <div class="confirm-actions"><button class="btn btn-secondary acc-close">Schließen</button></div>`;

    card.querySelector('.acc-close').addEventListener('click', close);
    card.querySelector('.acc-code-btn')?.addEventListener('click', async () => {
      const res = await app.api.createLinkCode(card.querySelector('.acc-code-peer').value);
      if (!res || !res.code) { app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      render();
    });
    card.querySelector('.acc-enter-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const res = await app.api.enterLinkCode(card.querySelector('.acc-enter-peer').value, card.querySelector('.acc-enter-code').value);
      btn.disabled = false;
      if (!res || !res.success) { app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      app.showToast(`Verknüpft mit ${res.remoteName} @ ${res.peerName}.`, 'success');
      render();
    });
    card.querySelectorAll('[data-id]').forEach((row) => {
      const id = row.dataset.id;
      row.querySelector('.acc-sync').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = '⏳ Wird geholt…';
        const res = await app.api.syncAccountLink(id);
        if (!res || !res.success) app.showToast('Fehler: ' + (res?.message || '?'), 'error');
        else {
          app.showToast(`Geholt: ${syncSummary(res)}`, res.conflicts?.length ? 'info' : 'success');
          app.topicsView?.refresh?.();
        }
        render();
      });
      row.querySelector('.acc-auto-cb').addEventListener('change', async (e) => {
        const res = await app.api.updateAccountLink(id, { autoSync: e.target.checked });
        if (!res || !res.success) app.showToast('Fehler: ' + (res?.message || '?'), 'error');
      });
      row.querySelector('.acc-unlink').addEventListener('click', async () => {
        if (!(await app.appConfirm('Verknüpfung lösen? Was schon geholt wurde, bleibt hier – es wird nur nicht mehr abgeglichen.'))) return;
        const res = await app.api.unlinkAccount(id);
        if (!res || !res.success) { app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
        render();
      });
    });
  };
  await render();
}
