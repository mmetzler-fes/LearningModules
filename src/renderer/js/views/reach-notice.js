import { escapeHtml } from '../utils.js';

/**
 * Einmaliger Hinweis zum Hauptschalter: Inhalte, die im Lernnotizbuch aus sind, wurden
 * bisher trotzdem Schülern gezeigt und sind jetzt gesperrt. Siehe docs/klassennotizbuch.md.
 */
export async function showReachNotice(app) {
  const res = await app.api.getReachNotice().catch(() => null);
  if (!res?.pending || !res.items?.length) return;
  const n = res.items.length;
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay reach-notice';
  overlay.innerHTML = `
    <div class="import-modules-card" role="dialog" aria-modal="true" aria-labelledby="reachNoticeTitle">
      <h3 id="reachNoticeTitle">🚫 ${n} Inhalt${n === 1 ? ' ist' : 'e sind'} jetzt für Schüler gesperrt</h3>
      <p>${n === 1 ? 'Dieser Inhalt ist' : 'Diese Inhalte sind'} im Lernnotizbuch aus, ${n === 1 ? 'wurde' : 'wurden'} bisher aber trotzdem Schülern gezeigt.
        Aus im Lernnotizbuch heißt jetzt: nirgends erreichbar. Die Klassenarbeit ist davon nicht betroffen.</p>
      <ul class="reach-notice-list">${res.items.map((i) => `<li><strong>${escapeHtml(i.title)}</strong> <span class="hint">– ${escapeHtml(i.where.join(', '))}</span></li>`).join('')}</ul>
      <div class="confirm-actions">
        <button type="button" class="btn btn-primary" data-do="enable">✅ Alle wieder einschalten</button>
        <button type="button" class="btn btn-secondary" data-do="review">🔍 Einzeln prüfen</button>
        <button type="button" class="btn btn-secondary" data-do="keep">So lassen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-do]')?.dataset.do;
    if (!action) return;
    overlay.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const done = await app.api.ackReachNotice(action === 'enable').catch(() => null);
    overlay.remove();
    if (!done || done.message) { app.showToast('Fehler: ' + (done?.message || 'Nicht gespeichert'), 'error'); return; }
    if (action === 'enable') app.showToast(`${done.enabled} wieder eingeschaltet.`, 'success');
    if (action === 'review') await app.navigateToView('teacher-notebooks');
    else if (document.getElementById('view-teacher-notebooks')?.classList.contains('active')) await app.notebooksView.refresh();
  });
}
