/**
 * 🤖 Zeitbeschränkte KI-Schnittstelle („Bring Your Own AI“):
 * Erzeugt ein zeitlich (Standard 60 Minuten) und auf ausgewählte Books/Pläne beschränktes Token
 * samt fertiger KI-Anleitung. Die Lehrkraft gibt diese Anleitung ihrer eigenen
 * KI (Claude, ChatGPT, lokaler Agent …) – es entstehen keine Server-API-Kosten.
 * Alle Änderungen über das Token werden protokolliert und lassen sich mit einem
 * Klick komplett rückgängig machen.
 */
import { escapeHtml, escapeAttr } from '../utils.js';
import { copyWhenReady } from './ai-answer.js';

const ICON = { book: '📕', plan: '📋', folder: '📁', area: '📂', section: '📑' };
const bad = (res) => !res || res.success === false || (res.statusCode && res.statusCode >= 400);

function parseBatchJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1].trim() : text;
  const parsed = JSON.parse(candidate);
  if (Array.isArray(parsed)) return { operations: parsed };
  if (parsed && Array.isArray(parsed.operations)) return parsed;
  throw new Error('Erwartet wird ein JSON-Objekt mit "operations": [ ... ].');
}

/**
 * `regenerate`: `[{ id, title }]` – Dokumente mit der KI neu aufbereiten. Dann gibt es keine
 * Bereichsauswahl: Die KI darf nur diese Dokumente überarbeiten.
 */
export async function openAiBridgeDialog(app, { onDone = null, regenerate = null } = {}) {
  const [nb, plans, sessionsRes] = await Promise.all([
    app.api.getNotebooks(),
    app.api.getPlans(),
    app.api.getAiBridgeSessions().catch(() => ({ sessions: [] })),
  ]);
  if (bad(nb) || bad(plans)) {
    app.showToast((nb && nb.message) || (plans && plans.message) || 'Daten nicht abrufbar.', 'error');
    return;
  }

  const books = (nb.nodes || []).filter((n) => !n.parentId).sort((a, b) => a.orderIndex - b.orderIndex);
  const topPlans = (plans.nodes || []).filter((n) => !n.parentId && n.kind !== 'include').sort((a, b) => a.orderIndex - b.orderIndex);

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay pl-dialog';
  overlay.innerHTML = `<div class="import-modules-card si-card aib-card" role="dialog" aria-modal="true" aria-labelledby="aibTitle">
    <h3 id="aibTitle">🤖 ${regenerate ? `Mit KI neu aufbereiten: ${escapeHtml(regenerate.length === 1 ? `„${regenerate[0].title}“` : `${regenerate.length} Dokumente`)}` : 'KI-Assistent (zeitlich begrenzter Zugriff)'}</h3>
    ${regenerate
      ? `<p class="hint">So geht es: <strong>1.</strong> Anleitung erzeugen (wird kopiert). <strong>2.</strong> In deiner KI einfügen und
          <strong>das Original als PDF/Word/Bild anhängen</strong>. <strong>3.</strong> Hat deine KI Webzugriff (z.&nbsp;B. Claude Code), schreibt sie
          das Dokument selbst; sonst gibt sie einen JSON-Block aus, den du unten einfügst. Die KI darf nur
          ${regenerate.length === 1 ? 'dieses Dokument' : 'diese Dokumente'} überarbeiten; vorher wird jede Fassung gesichert – ⏪ macht alles rückgängig.</p>`
      : `<p class="hint">Erzeuge ein zeitlich beschränktes Token und eine fertige Anleitung für <strong>deine eigene KI</strong>
      (z.&nbsp;B. Claude, ChatGPT, Gemini). Die KI erhält nur Zugriff auf die unten freigegebenen Ordner – niemals auf
      Schülerdaten oder Noten. Alle KI-Änderungen lassen sich hier mit einem Klick rückgängig machen.</p>`}

    <div class="aib-sessions"></div>

    <details class="aib-create-box" open>
      <summary><strong>🔑 Neues KI-Token &amp; Anleitung erzeugen</strong></summary>
      <div class="aib-grid ${regenerate ? 'hidden' : ''}">
        <fieldset class="si-group">
          <legend>📓 Lernnotizbuch-Freigabe</legend>
          <label class="share-flag"><input type="checkbox" class="aib-nb-all" checked /> <span>Alle eigenen Books freigeben</span></label>
          <div class="aib-nb-list hidden">
            ${books.map((b) => `<label class="share-flag"><input type="checkbox" name="aibNb" value="${escapeAttr(b.id)}" checked /> <span>${ICON[b.kind] || '📕'} ${escapeHtml(b.title)}</span></label>`).join('') || '<span class="hint">Noch keine Books vorhanden.</span>'}
          </div>
          <label class="share-flag"><input type="checkbox" class="aib-unsorted" checked /> <span>„Unsortiert“ einschließen</span></label>
        </fieldset>

        <fieldset class="si-group">
          <legend>🗂 Planungs-Freigabe</legend>
          <label class="share-flag"><input type="checkbox" class="aib-pl-all" checked /> <span>Alle Pläne &amp; Ordner freigeben</span></label>
          <div class="aib-pl-list hidden">
            ${topPlans.map((p) => `<label class="share-flag"><input type="checkbox" name="aibPl" value="${escapeAttr(p.id)}" checked /> <span>${ICON[p.kind] || '📋'} ${escapeHtml(p.title)}</span></label>`).join('') || '<span class="hint">Noch keine Pläne vorhanden.</span>'}
          </div>
        </fieldset>
      </div>

      <fieldset class="si-group">
        <legend>⚙️ ${regenerate ? 'Gültigkeitsdauer' : 'Erlaubte Aktionen &amp; Gültigkeitsdauer'}</legend>
        <div class="aib-perms">
          <label class="share-flag ${regenerate ? 'hidden' : ''}"><input type="checkbox" class="aib-perm-org" checked /> <span>Strukturieren &amp; Verplanen (Ordner anlegen, Lernthemen verschieben, in Pläne projizieren)</span></label>
          <label class="share-flag ${regenerate ? 'hidden' : ''}"><input type="checkbox" class="aib-perm-docs" checked /> <span>Inhalte &amp; Dokumente (Lernthemen und editierbare Arbeitsblätter anlegen/überarbeiten)</span></label>
          <label class="aib-ttl-label">Gültigkeit:
            <select class="aib-ttl">
              <option value="30">30 Minuten</option>
              <option value="60" selected>60 Minuten (Empfohlen)</option>
              <option value="120">2 Stunden</option>
              <option value="240">4 Stunden</option>
            </select>
          </label>
        </div>
      </fieldset>

      <div class="confirm-actions">
        <button type="button" class="btn btn-primary aib-btn-generate">🤖 ${regenerate ? 'Anleitung erzeugen &amp; kopieren' : 'Token erzeugen &amp; KI-Anleitung kopieren'}</button>
      </div>
    </details>

    <div class="aib-output hidden">
      <p class="aib-copied-msg"></p>
      <div class="aib-token-bar">
        <span>Aktives Token: <code class="aib-token-code"></code></span>
        <button type="button" class="btn btn-secondary btn-sm aib-btn-copy-token">📋 Nur Token</button>
        <button type="button" class="btn btn-secondary btn-sm aib-btn-copy-prompt">📋 Ganze KI-Anleitung kopieren</button>
      </div>
      <details class="aib-prompt-details">
        <summary>KI-Anleitung ansehen / anpassen</summary>
        <textarea class="aib-prompt-text" rows="10" readonly></textarea>
      </details>

      <div class="aib-manual-box">
        <label><strong>📥 Optional: JSON-Antwort der KI hier einfügen</strong>
          <span class="hint">(falls deine KI keinen direkten Web-Zugriff hat und dir stattdessen einen <code>{"operations": [...]}</code>-Codeblock ausgibt)</span>
          <textarea class="aib-batch-input" rows="5" spellcheck="false" placeholder='{"operations": [ ... ]}'></textarea>
        </label>
        <div class="aib-batch-preview"></div>
        <div class="confirm-actions">
          <button type="button" class="btn btn-secondary aib-btn-dryrun" disabled>🔍 Vorschau prüfen</button>
          <button type="button" class="btn btn-primary aib-btn-apply" disabled>✅ Änderungen ausführen</button>
        </div>
      </div>
    </div>

    <div class="confirm-actions">
      <button type="button" class="btn btn-secondary aib-close">Schließen</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);
  const $ = (s) => overlay.querySelector(s);
  let activeSessionId = null;
  let lastToken = '';
  let changed = false;

  const close = async () => {
    overlay.remove();
    if (changed && onDone) await onDone();
  };
  $('.aib-close').addEventListener('click', close);
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') void close(); });

  $('.aib-nb-all').addEventListener('change', (e) => {
    $('.aib-nb-list').classList.toggle('hidden', e.target.checked);
  });
  $('.aib-pl-all').addEventListener('change', (e) => {
    $('.aib-pl-list').classList.toggle('hidden', e.target.checked);
  });

  const renderSessions = (sessions) => {
    const box = $('.aib-sessions');
    const list = (sessions || []).filter((s) => s.active || s.canRollback);
    if (!list.length) {
      box.innerHTML = '';
      return;
    }
    if (!activeSessionId && list[0]?.active) activeSessionId = list[0].id;
    box.innerHTML = `<div class="aib-session-list">
      <h4>Aktive &amp; kürzliche KI-Sitzungen</h4>
      ${list.map((s) => {
        const mins = Math.ceil((s.remainingSeconds || 0) / 60);
        const statusBadge = s.active
          ? `<span class="pl-in">🟢 aktiv (noch ca. ${mins} Min.)</span>`
          : `<span class="hint">⏹ abgelaufen/beendet</span>`;
        const logs = (s.log || []).slice(-5).map((l) => `<li>${escapeHtml(l.summary)}</li>`).join('');
        return `<div class="aib-session-item" data-id="${escapeAttr(s.id)}">
          <div class="aib-session-head">
            <strong>Token <code>${escapeHtml(s.tokenPreview)}</code></strong> · ${statusBadge}
            · <strong>${s.opsCount || 0}</strong> rückgängig machbare Änderung${s.opsCount === 1 ? '' : 'en'}
            <span class="aib-session-actions">
              ${s.active ? `<button type="button" class="btn btn-secondary btn-sm" data-extend="${escapeAttr(s.id)}" title="Zugriff 30 Minuten länger">⏱ +30 Min.</button>` : ''}
              ${s.canRollback ? `<button type="button" class="btn btn-secondary btn-sm" data-rollback="${escapeAttr(s.id)}">⏪ Rückgängig (${s.opsCount})</button>` : ''}
              ${s.active ? `<button type="button" class="btn btn-secondary btn-sm" data-revoke="${escapeAttr(s.id)}">⏹ Zugriff beenden</button>` : ''}
            </span>
          </div>
          ${logs ? `<ul class="aib-log-list">${logs}</ul>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  };

  renderSessions(sessionsRes?.sessions || []);

  $('.aib-sessions').addEventListener('click', async (e) => {
    const rb = e.target.closest('[data-rollback]');
    if (rb) {
      const id = rb.dataset.rollback;
      rb.disabled = true;
      const res = await app.api.rollbackAiBridgeSession(id);
      if (bad(res)) {
        app.showToast(res?.message || 'Rückgängig fehlgeschlagen.', 'error');
        rb.disabled = false;
        return;
      }
      changed = true;
      app.showToast(`⏪ ${res.reverted} Änderung${res.reverted === 1 ? '' : 'en'} rückgängig gemacht.`, 'success');
      const fresh = await app.api.getAiBridgeSessions().catch(() => ({ sessions: [] }));
      renderSessions(fresh.sessions);
      return;
    }
    const ext = e.target.closest('[data-extend]');
    if (ext) {
      ext.disabled = true;
      const res = await app.api.extendAiBridgeSession(ext.dataset.extend, 30);
      if (bad(res)) app.showToast(res?.message || 'Verlängern ging nicht.', 'error');
      else app.showToast('KI-Zugriff um 30 Minuten verlängert.', 'success');
      const fresh = await app.api.getAiBridgeSessions().catch(() => ({ sessions: [] }));
      renderSessions(fresh.sessions);
      return;
    }
    const rev = e.target.closest('[data-revoke]');
    if (rev) {
      const id = rev.dataset.revoke;
      rev.disabled = true;
      await app.api.revokeAiBridgeSession(id);
      app.showToast('KI-Token wurde sofort gesperrt.', 'info');
      const fresh = await app.api.getAiBridgeSessions().catch(() => ({ sessions: [] }));
      renderSessions(fresh.sessions);
    }
  });

  $('.aib-btn-generate').addEventListener('click', async () => {
    const btn = $('.aib-btn-generate');
    btn.disabled = true;
    const notebookNodeIds = $('.aib-nb-all').checked
      ? ['*']
      : [...overlay.querySelectorAll('input[name="aibNb"]:checked')].map((x) => x.value);
    const planNodeIds = $('.aib-pl-all').checked
      ? ['*']
      : [...overlay.querySelectorAll('input[name="aibPl"]:checked')].map((x) => x.value);

    const job = app.api.createAiBridgeSession(regenerate ? {
      ttlMinutes: Number($('.aib-ttl').value) || 60,
      regenerateModuleIds: regenerate.map((d) => d.id),
    } : {
      ttlMinutes: Number($('.aib-ttl').value) || 60,
      notebookNodeIds,
      planNodeIds,
      includeUnsorted: $('.aib-unsorted').checked,
      permissions: {
        organize: $('.aib-perm-org').checked,
        writeDocs: $('.aib-perm-docs').checked,
      },
    });
    const copied = copyWhenReady(job.then((r) => {
      if (bad(r)) throw new Error(r?.message || 'Fehler');
      return r.prompt;
    }));
    const res = await job;
    btn.disabled = false;
    if (bad(res)) {
      app.showToast(res?.message || 'Token konnte nicht erzeugt werden.', 'error');
      return;
    }
    activeSessionId = res.session.id;
    lastToken = res.token;
    $('.aib-token-code').textContent = res.token;
    $('.aib-prompt-text').value = res.prompt;
    $('.aib-output').classList.remove('hidden');
    $('.aib-create-box').open = false;
    const ok = await copied;
    $('.aib-copied-msg').textContent = ok
      ? (regenerate
        ? '✅ Anleitung kopiert! Jetzt in deiner KI einfügen und das Original als Anhang dazugeben.'
        : '✅ KI-Anleitung samt Token ist in die Zwischenablage kopiert! Jetzt in deiner KI einfügen und deinen Wunsch ergänzen.')
      : '⚠️ Bitte auf „📋 Ganze KI-Anleitung kopieren“ klicken und in deiner KI einfügen.';
    const fresh = await app.api.getAiBridgeSessions().catch(() => ({ sessions: [res.session] }));
    renderSessions(fresh.sessions);
  });

  $('.aib-btn-copy-token').addEventListener('click', async () => {
    if (lastToken && await copyWhenReady(Promise.resolve(lastToken))) {
      app.showToast('Token kopiert.', 'success');
    }
  });
  $('.aib-btn-copy-prompt').addEventListener('click', async () => {
    const text = $('.aib-prompt-text').value;
    if (text && await copyWhenReady(Promise.resolve(text))) {
      app.showToast('KI-Anleitung kopiert – jetzt im KI-Chat einfügen.', 'success');
    }
  });

  const batchInput = $('.aib-batch-input');
  const batchPreview = $('.aib-batch-preview');
  const btnDry = $('.aib-btn-dryrun');
  const btnApply = $('.aib-btn-apply');

  batchInput.addEventListener('input', () => {
    const hasText = !!batchInput.value.trim();
    btnDry.disabled = !hasText || !activeSessionId;
    btnApply.disabled = !hasText || !activeSessionId;
  });

  const runBatch = async (dryRun) => {
    if (!activeSessionId) return;
    let parsed;
    try {
      parsed = parseBatchJson(batchInput.value);
    } catch (err) {
      batchPreview.innerHTML = `<p class="login-error">❌ ${escapeHtml(err.message)}</p>`;
      return;
    }
    btnDry.disabled = true;
    btnApply.disabled = true;
    const res = await app.api.runAiBridgeBatch(activeSessionId, { ...parsed, dryRun });
    btnDry.disabled = false;
    btnApply.disabled = false;
    if (bad(res)) {
      batchPreview.innerHTML = `<p class="login-error">❌ ${escapeHtml(res?.message || 'Ausführung fehlgeschlagen.')}</p>`;
      return;
    }
    const itemsHtml = (res.results || []).map((r) => `<li>${escapeHtml(r.summary)}</li>`).join('');
    batchPreview.innerHTML = `<p><strong>${dryRun ? '🔍 Vorschau gültig' : '✅ Ausgeführt'}: ${res.count} Schritt${res.count === 1 ? '' : 'e'}</strong></p>
      <ul class="si-preview">${itemsHtml}</ul>`;
    if (!dryRun) {
      changed = true;
      batchInput.value = '';
      btnDry.disabled = true;
      btnApply.disabled = true;
      app.showToast(`${res.count} KI-Änderung${res.count === 1 ? '' : 'en'} ausgeführt.`, 'success');
      const fresh = await app.api.getAiBridgeSessions().catch(() => ({ sessions: [] }));
      renderSessions(fresh.sessions);
    }
  };

  btnDry.addEventListener('click', () => void runBatch(true));
  btnApply.addEventListener('click', () => void runBatch(false));
}

