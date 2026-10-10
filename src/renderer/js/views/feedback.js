import { escapeHtml } from '../utils.js';

// ==================== BEWERTUNG ====================
//
// Rückmeldung zu einem Lernthema, das man nutzt oder kopiert hat: Nützlichkeit
// in Sternen, ein Danke und auf Wunsch ein Satz an die Creator. Bewertet wird
// immer das Original – auch über die eigene Kopie. Siehe
// docs/nutzung-und-bewertung.md.

/** Sterne und Danke kompakt, z. B. für Shop-Karten. Leer, wenn es nichts gibt. */
export function ratingBadge(r) {
  if (!r || (!r.count && !r.thanks)) return '';
  const stars = r.count
    ? `<span class="rating-stars" title="Nützlichkeit: ⌀ ${String(r.avg).replace('.', ',')} von 5 aus ${r.count} Bewertung${r.count === 1 ? '' : 'en'}">★ ${String(r.avg).replace('.', ',')} <span class="hint">(${r.count})</span></span>`
    : '';
  const thanks = r.thanks ? `<span class="rating-thanks" title="So oft wurde Danke gesagt">👍 ${r.thanks}</span>` : '';
  return `<span class="topic-shared-badge rating-badge">${stars}${stars && thanks ? ' ' : ''}${thanks}</span>`;
}

/**
 * Dialog zum Bewerten. `topicId` darf auch die eigene Kopie sein – der Server
 * bewertet dann das Original. Liefert true, wenn gespeichert wurde.
 */
export async function openFeedbackDialog(app, topicId) {
  let state;
  try {
    state = await app.api.getFeedback(topicId);
  } catch (err) {
    app.showToast('Fehler: ' + err.message, 'error');
    return false;
  }
  if (!state || !state.topicId) {
    app.showToast(state?.message || 'Bewerten geht hier nicht.', 'error');
    return false;
  }
  const mine = state.mine || { stars: null, thanks: false, comment: '' };
  let stars = mine.stars || 0;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card feedback-card" style="min-width:min(420px,92vw); max-width:560px">
        <h3>⭐ Bewerten: <em>${escapeHtml(state.title)}</em></h3>
        <p class="hint">von ${escapeHtml(state.ownerName)}${state.summary.count ? ` · bisher ⌀ ${String(state.summary.avg).replace('.', ',')} aus ${state.summary.count}` : ''}</p>
        <div class="form-group">
          <label>Wie nützlich ist es für deinen Unterricht?</label>
          <div class="star-input" role="radiogroup" aria-label="Nützlichkeit">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-btn" data-n="${n}" role="radio" aria-label="${n} von 5">★</button>`).join('')}
            <button type="button" class="btn btn-secondary btn-sm star-clear" title="Sterne entfernen">✕</button>
          </div>
          <p class="hint star-label"></p>
        </div>
        <label class="share-flag"><input type="checkbox" id="fbThanks" ${mine.thanks ? 'checked' : ''} />
          <span><strong>👍 Danke sagen</strong> – die Creator sehen, wie oft gedankt wurde.</span></label>
        <div class="form-group">
          <label for="fbComment">Rückmeldung an die Creator (optional)</label>
          <textarea id="fbComment" rows="3" maxlength="1000" placeholder="z. B. Hat in der 10. Klasse gut funktioniert, Aufgabe 3 war zu schwer.">${escapeHtml(mine.comment || '')}</textarea>
          <p class="hint">Sterne und Danke erscheinen nur zusammengezählt. Den Text sehen die Creator und der Anbieter mit deinem Namen.</p>
        </div>
        <div class="confirm-actions">
          <button class="btn btn-primary" id="fbSave">Speichern</button>
          ${state.mine ? '<button class="btn btn-danger" id="fbDelete">Bewertung löschen</button>' : ''}
          <button class="btn btn-secondary" id="fbClose">Abbrechen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const LABELS = ['', 'kaum nützlich', 'wenig nützlich', 'brauchbar', 'sehr nützlich', 'hervorragend'];
    const paint = () => {
      overlay.querySelectorAll('.star-btn').forEach((b) => {
        const on = Number(b.dataset.n) <= stars;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(Number(b.dataset.n) === stars));
      });
      overlay.querySelector('.star-label').textContent = stars ? `${stars} von 5 – ${LABELS[stars]}` : 'noch keine Sterne';
    };
    overlay.querySelectorAll('.star-btn').forEach((b) => b.addEventListener('click', () => { stars = Number(b.dataset.n); paint(); }));
    overlay.querySelector('.star-clear').addEventListener('click', () => { stars = 0; paint(); });
    paint();

    const close = (saved) => { overlay.remove(); resolve(saved); };
    overlay.querySelector('#fbClose').addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

    const send = async (body, msg) => {
      const res = await app.api.saveFeedback(state.topicId, body);
      if (res && res.success) {
        app.showToast(msg, 'success');
        close(true);
      } else app.showToast('Fehler: ' + (res?.message || '?'), 'error');
    };
    overlay.querySelector('#fbSave').addEventListener('click', () => send({
      stars: stars || null,
      thanks: overlay.querySelector('#fbThanks').checked,
      comment: overlay.querySelector('#fbComment').value.trim(),
    }, 'Danke für deine Rückmeldung!'));
    overlay.querySelector('#fbDelete')?.addEventListener('click', () => send({ stars: null, thanks: false, comment: '' }, 'Bewertung gelöscht'));
  });
}
