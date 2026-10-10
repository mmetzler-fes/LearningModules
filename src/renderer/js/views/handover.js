import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== INHALTE ÜBERGEBEN ====================
//
// Alle eigenen Inhalte an eine andere Lehrkraft übergeben – etwa beim
// Ausscheiden an die Nachfolge. Wer übernimmt, muss annehmen. Siehe
// docs/uebergabe.md.

const STATUS = {
  pending: '⏳ wartet auf Annahme',
  accepted: '✅ angenommen',
  declined: '✖ abgelehnt',
  withdrawn: '↩ zurückgezogen',
};

const when = (d) => (d ? new Date(d).toLocaleDateString('de-DE') : '');

/** Hinweis für die empfangende Lehrkraft, oben in der Themenliste. */
export async function renderIncomingHandovers(app, container) {
  if (!container) return;
  let data;
  try {
    data = await app.api.getHandovers();
  } catch (_) {
    data = null;
  }
  const list = Array.isArray(data?.incoming) ? data.incoming : [];
  container.innerHTML = list.map((h) => `
    <div class="share-hint handover-incoming" data-id="${escapeAttr(h.id)}">
      <span class="share-hint-icon">🎁</span>
      <div>
        <strong>${escapeHtml(h.from.name)} möchte dir ${h.topicCount} Lernthem${h.topicCount === 1 ? 'a' : 'en'} übergeben</strong>${h.withCreator ? ' – samt Urheberschaft' : ''}.
        ${h.note ? `<div class="hint">„${escapeHtml(h.note)}“</div>` : ''}
        <div class="hint">Dazu kommen Notebook-Struktur, Tags und Angebote im Shop. Ergebnisse, Klassen und Links bleiben bei ${escapeHtml(h.from.name)}.</div>
        <div class="share-hint-actions">
          <button class="btn btn-primary btn-sm" data-act="accept">✅ Annehmen</button>
          <button class="btn btn-secondary btn-sm" data-act="decline">Ablehnen</button>
        </div>
      </div>
    </div>`).join('');
  container.querySelectorAll('.handover-incoming').forEach((box) => {
    box.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
      const h = list.find((x) => x.id === box.dataset.id);
      const accept = btn.dataset.act === 'accept';
      if (accept && !(await app.appConfirm(`${h.topicCount} Lernthemen von ${h.from.name} übernehmen?\n\nSie gehören danach dir; Books stehen mit „(von ${h.from.name})“ in deinen Notebooks.`))) return;
      btn.disabled = true;
      const res = accept ? await app.api.acceptHandover(h.id) : await app.api.declineHandover(h.id);
      if (!res || !res.success) { app.showToast('Fehler: ' + (res?.message || '?'), 'error'); btn.disabled = false; return; }
      app.showToast(accept ? `Übernommen: ${res.summary.topics} Lernthemen, ${res.summary.modules} Module.` : 'Abgelehnt', 'success');
      if (accept) await app.topicsView.refresh();
      else box.remove();
    }));
  });
}

/** Dialog für den Absender. */
export async function openHandoverDialog(app) {
  const data = await app.api.getHandovers();
  if (!data || data.statusCode) { app.showToast('Fehler: ' + (data?.message || '?'), 'error'); return; }
  const pending = (data.outgoing || []).find((h) => h.status === 'pending');
  const history = (data.outgoing || []).filter((h) => h.status !== 'pending').slice(0, 5);

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="import-modules-card" style="min-width:min(480px,94vw); max-width:620px; max-height:90vh; overflow:auto">
      <h3>🎁 Inhalte übergeben <button type="button" class="help-hint" data-help="uebergabe" title="Hilfe: Inhalte übergeben" aria-label="Hilfe">?</button></h3>
      ${pending ? `
        <p><strong>Offen:</strong> Übergabe an ${escapeHtml(pending.to.name)} (${escapeHtml(pending.to.email)}) seit ${when(pending.createdAt)} – ${STATUS.pending}.</p>
        <div class="confirm-actions">
          <button class="btn btn-danger" id="hoWithdraw">↩ Zurückziehen</button>
          <button class="btn btn-secondary" id="hoClose">Schließen</button>
        </div>` : `
        <p class="hint">Alle deine Inhalte gehen an eine andere Lehrkraft dieses Servers – z. B. an deine Nachfolge.
          Für deine eigene neue Adresse nimm stattdessen <strong>✉️ E-Mail ändern</strong>.</p>
        <table class="handover-what">
          <tr><td>✅ geht mit</td><td>deine ${data.ownTopics} Lernthemen mit allen Modulen, deine Notebooks, die dabei verwendeten Tags (als Kopie) und deine Angebote im Shop – wer etwas nutzt, behält es</td></tr>
          <tr><td>🔒 bleibt bei dir</td><td>Ergebnisse, Klassen, Themen- und Quick-Links (sie hängen an Schülerdaten), deine Tags und was du selbst aus dem Shop nutzt</td></tr>
        </table>
        <div class="form-group">
          <label for="hoEmail">E-Mail-Adresse der Lehrkraft, die übernimmt</label>
          <input type="email" id="hoEmail" placeholder="kollegin@schule.de" autocomplete="off" />
        </div>
        <label class="share-flag"><input type="checkbox" id="hoCreator" />
          <span><strong>Auch die Urheberschaft übergeben</strong> – die übernehmende Lehrkraft wird Creator deiner
            Module: Sie lassen sich dann von ihr zum Kopieren anbieten und offen exportieren, und unter „Geteilt &amp; genutzt“
            zählt es für sie. Ohne Häkchen bleibst du Creator; die Module lassen sich dann nur zur Nutzung anbieten.</span></label>
        <div class="form-group">
          <label for="hoNote">Ein Satz dazu (optional)</label>
          <input type="text" id="hoNote" maxlength="500" placeholder="z. B. Viel Freude mit dem Material!" />
        </div>
        <p class="hint">Es geht erst etwas über, wenn die Übergabe angenommen ist. Bis dahin kannst du die Anfrage zurückziehen.</p>
        <div class="confirm-actions">
          <button class="btn btn-primary" id="hoSend">Übergabe anfragen</button>
          <button class="btn btn-secondary" id="hoClose">Abbrechen</button>
        </div>`}
      ${history.length ? `<details class="shop-modules"><summary>Frühere Übergaben</summary><ul>
        ${history.map((h) => `<li>${when(h.createdAt)} an ${escapeHtml(h.to.name)} – ${STATUS[h.status] || h.status}${h.summary ? ` (${h.summary.topics} Lernthemen)` : ''}</li>`).join('')}
      </ul></details>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#hoClose').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#hoWithdraw')?.addEventListener('click', async () => {
    const res = await app.api.withdrawHandover(pending.id);
    if (!res || !res.success) { app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    app.showToast('Übergabe zurückgezogen', 'info');
    close();
  });

  overlay.querySelector('#hoSend')?.addEventListener('click', async () => {
    const email = overlay.querySelector('#hoEmail').value.trim();
    if (!email) { app.showToast('Bitte die E-Mail-Adresse eingeben.', 'error'); return; }
    const withCreator = overlay.querySelector('#hoCreator').checked;
    if (!(await app.appConfirm(`Alle ${data.ownTopics} Lernthemen an ${email} übergeben${withCreator ? ' – samt Urheberschaft' : ''}?\n\nSobald die Übergabe angenommen ist, gehören sie der anderen Lehrkraft und verschwinden aus deiner Liste.`))) return;
    const res = await app.api.requestHandover({ email, withCreator, note: overlay.querySelector('#hoNote').value.trim() });
    if (!res || !res.success) { app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    app.showToast(`Anfrage an ${res.to} gesendet – sie erscheint dort beim nächsten Öffnen von 🏠 LernModule.`, 'success');
    close();
  });
}
