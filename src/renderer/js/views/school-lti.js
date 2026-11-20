import { escapeHtml, escapeAttr } from '../utils.js';

// ============ MOODLE (LTI 1.3) – Schuladmin ============
// Adressen für Moodle anzeigen, Werte aus Moodle eintragen. Siehe docs/lti.md.

const call = async (app, method, body) => {
  const res = await fetch('/api/my-school/lti', { method, headers: app.api.getHeaders(), body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
};

export async function renderSchoolLti(app, box, msg = null) {
  if (!box) return;
  let c;
  try { c = await call(app, 'GET'); } catch (e) { box.innerHTML = `<p class="login-error">${escapeHtml(e.message)}</p>`; return; }
  const p = c.platform || {};
  const t = c.tool;
  const row = (label, v) => `<tr><td>${label}</td><td><code class="sso-uri">${escapeHtml(v)}</code></td></tr>`;
  const field = (id, label, value, ph = '') => `<div class="form-group"><label for="${id}">${label}</label><input type="text" id="${id}" value="${escapeAttr(value || '')}" placeholder="${escapeAttr(ph)}" autocomplete="off"></div>`;
  box.innerHTML = `
    <p class="hint">Lehrkräfte legen in Moodle eine Aktivität „Externes Tool“ an und wählen darin ein Lernthema. Schüler öffnen es aus Moodle
      <strong>ohne Name und PIN</strong>; das beste Ergebnis geht ins <strong>Moodle-Notenbuch</strong>.
      ${c.platform ? `<strong>${p.active ? '✅ eingerichtet' : '⏸ ausgeschaltet'}</strong>${p.lastLaunchAt ? ` · zuletzt genutzt ${escapeHtml(new Date(p.lastLaunchAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))}` : ''}` : '<strong>noch nicht eingerichtet</strong>'}</p>
    <details ${c.platform ? '' : 'open'}>
      <summary>1. In Moodle eintragen (Website-Administration → Plugins → Externes Tool → Tools verwalten → Tool manuell konfigurieren)</summary>
      <table class="sso-table">
        ${row('Tool-URL', t.toolUrl)}
        ${row('LTI-Version', 'LTI 1.3')}
        ${row('Public-Key-Typ', 'Schlüsselsatz-URL (Keyset URL)')}
        ${row('Schlüsselsatz-URL', t.jwksUrl)}
        ${row('URL für Login-Initiierung', t.loginUrl)}
        ${row('Weiterleitungs-URI(s)', t.redirectUrl)}
      </table>
      <p class="hint">Außerdem: <em>Unterstützt Deep Linking</em> anhaken (Inhaltsauswahl-URL: ${escapeHtml(t.deepLinkUrl)}),
        bei <em>Dienste</em> „IMS LTI Assignment and Grade Services“ auf <em>Nur für Bewertungsübergabe</em>,
        bei <em>Datenschutz</em> Name und E-Mail <em>immer</em> weitergeben. Tool-Konfiguration: „Im Aktivitätsauswahl-Menü anzeigen“.</p>
    </details>
    <p><strong>2. Werte aus Moodle</strong> <span class="hint">(nach dem Speichern dort unter „Konfigurationsdetails“ des Tools)</span></p>
    ${field('ltiIssuer', 'Plattform-ID', p.issuer, 'https://moodle.schule.de')}
    ${field('ltiClient', 'Client-ID', p.clientId)}
    ${field('ltiDeploy', 'Deployment-ID', (p.deploymentIds || []).join(', '), 'z. B. 1')}
    ${field('ltiAuth', 'Authentifizierungsanfrage-URL', p.authLoginUrl, 'https://moodle.schule.de/mod/lti/auth.php')}
    ${field('ltiToken', 'Zugriffstoken-URL', p.tokenUrl, 'https://moodle.schule.de/mod/lti/token.php')}
    ${field('ltiJwks', 'Öffentlicher Schlüsselsatz-URL', p.jwksUrl, 'https://moodle.schule.de/mod/lti/certs.php')}
    <label class="login-remember"><input type="checkbox" id="ltiActive" ${c.platform ? (p.active ? 'checked' : '') : 'checked'}> eingeschaltet</label>
    <div class="form-actions"><button type="button" class="btn btn-primary" id="ltiSave">💾 Speichern</button></div>
    <p class="${msg?.error ? 'login-error' : 'hint'}">${msg ? escapeHtml(msg.text) : ''}</p>`;
  box.querySelector('#ltiSave').addEventListener('click', async () => {
    const v = (id) => box.querySelector(id).value;
    try {
      await call(app, 'PUT', { issuer: v('#ltiIssuer'), clientId: v('#ltiClient'), deploymentIds: v('#ltiDeploy'), authLoginUrl: v('#ltiAuth'), tokenUrl: v('#ltiToken'), jwksUrl: v('#ltiJwks'), active: box.querySelector('#ltiActive').checked });
      renderSchoolLti(app, box, { text: '✅ Gespeichert. In Moodle eine Aktivität „Externes Tool“ anlegen und „Inhalt auswählen“ probieren.' });
    } catch (e) { renderSchoolLti(app, box, { error: true, text: '❌ ' + e.message }); }
  });
}
