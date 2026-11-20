import { escapeHtml, escapeAttr } from '../utils.js';

// ============ LTI 1.3: Aktivität in Moodle anlegen (Deep Linking) ============
//
// Die Lehrkraft wählt ein Lernthema und die Klasse des Moodle-Kurses (neu oder bestehend);
// danach geht die Auswahl signiert an Moodle zurück. Siehe docs/lti.md.

export async function openLtiDeepLink(app, code, contextTitle) {
  const [topics, classes] = await Promise.all([
    app.api.getTopics().catch(() => []),
    app.api.getClasses().catch(() => []),
  ]);
  const own = (Array.isArray(topics) ? topics : []).filter((t) => t && t.id && t.title).sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const klassen = Array.isArray(classes) ? classes : (classes?.classes || []);
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `<div class="import-modules-card" style="max-width:640px">
    <h3>🎓 Aktivität für Moodle</h3>
    <p class="hint">Kurs: <strong>${escapeHtml(contextTitle || 'Moodle-Kurs')}</strong>. Schüler öffnen das Lernthema aus Moodle ohne Name und PIN; das beste Ergebnis geht ins Moodle-Notenbuch.</p>
    <div class="form-group"><label for="ltiSearch">Lernthema</label>
      <input type="search" id="ltiSearch" placeholder="Suchen …" autocomplete="off">
      <select id="ltiTopic" size="8" style="width:100%; margin-top:6px">${own.map((t) => `<option value="${escapeAttr(t.id)}">${escapeHtml(t.title)}</option>`).join('')}</select></div>
    <div class="form-group"><label>Klasse in LearningModules</label>
      <label class="login-remember"><input type="radio" name="ltiClass" value="new" checked> Neue Klasse für diesen Kurs <span class="hint">(bzw. die schon verbundene)</span></label>
      <label class="login-remember"><input type="radio" name="ltiClass" value="existing" ${klassen.length ? '' : 'disabled'}> Mit bestehender Klasse verbinden – Schüler werden über ihren Namen zugeordnet, vorhandene Ergebnisse bleiben</label>
      <select id="ltiClassId" disabled>${klassen.map((k) => `<option value="${escapeAttr(k.id)}">${escapeHtml(k.name)}${k.schoolYear ? ` (${escapeHtml(k.schoolYear)})` : ''}</option>`).join('')}</select></div>
    <p class="login-error hidden" id="ltiErr"></p>
    <div class="confirm-actions">
      <button type="button" class="btn btn-secondary" id="ltiCancel">Abbrechen</button>
      <button type="button" class="btn btn-primary" id="ltiOk">✅ In Moodle übernehmen</button>
    </div></div>`;
  document.body.appendChild(overlay);
  const $ = (s) => overlay.querySelector(s);
  $('#ltiSearch').addEventListener('input', () => {
    const q = $('#ltiSearch').value.trim().toLowerCase();
    [...$('#ltiTopic').options].forEach((o) => { o.hidden = !!q && !o.textContent.toLowerCase().includes(q); });
  });
  overlay.querySelectorAll('input[name=ltiClass]').forEach((r) => r.addEventListener('change', () => { $('#ltiClassId').disabled = r.value !== 'existing' || !r.checked; }));
  $('#ltiCancel').addEventListener('click', () => overlay.remove());
  $('#ltiOk').addEventListener('click', async () => {
    const topicId = $('#ltiTopic').value;
    const err = $('#ltiErr');
    if (!topicId) { err.textContent = 'Bitte ein Lernthema wählen.'; err.classList.remove('hidden'); return; }
    const classMode = overlay.querySelector('input[name=ltiClass]:checked')?.value || 'new';
    $('#ltiOk').disabled = true;
    const res = await fetch('/api/lti/deep-link', {
      method: 'POST', headers: app.authStore.getHeaders(),
      body: JSON.stringify({ code, topicId, classMode, classId: classMode === 'existing' ? $('#ltiClassId').value : undefined }),
    }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) })).catch(() => null);
    if (!res?.ok || !res.body?.jwt || !res.body?.returnUrl) {
      $('#ltiOk').disabled = false;
      err.textContent = res?.body?.message || 'Das hat nicht geklappt.';
      err.classList.remove('hidden');
      return;
    }
    // Zurück an Moodle: signierte Auswahl als Formular (LTI Deep Linking Response).
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = res.body.returnUrl;
    const field = document.createElement('input');
    field.type = 'hidden';
    field.name = 'JWT';
    field.value = res.body.jwt;
    form.appendChild(field);
    document.body.appendChild(form);
    form.submit();
  });
}
