import { escapeHtml, escapeAttr } from '../utils.js';

// ============ ANMELDUNG MIT MICROSOFT (Schuladmin) ============
//
// Mandant, App-Registrierung und Geheimnis eintragen, für Lehrkräfte und/oder Schüler einschalten.
// Die bisherige Anmeldung (Passwort, Name und PIN) bleibt immer daneben. Siehe docs/sso.md.

const call = async (app, method, body) => {
  const res = await fetch('/api/my-school/sso' + (method === 'TEST' ? '/test' : ''), {
    method: method === 'TEST' ? 'POST' : method,
    headers: app.authStore.getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
};

/** Bereich „🔐 Anmeldung mit Microsoft“ in `box` zeichnen. */
export async function renderSchoolSso(app, box, msg = null) {
  if (!box) return;
  let c;
  try { c = await call(app, 'GET'); } catch (e) { box.innerHTML = `<p class="login-error">${escapeHtml(e.message)}</p>`; return; }
  const on = c.forTeachers || c.forStudents;
  box.innerHTML = `
    <p class="hint">Lehrkräfte und Schüler melden sich mit ihrem <strong>Microsoft-Schulkonto</strong> an – ohne eigenes Passwort bzw. ohne PIN.
      Die bisherige Anmeldung bleibt immer daneben möglich. ${on ? `<strong>✅ eingeschaltet</strong>${c.lastLoginAt ? ` · zuletzt genutzt ${escapeHtml(new Date(c.lastLoginAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))}` : ''}` : '<strong>aus</strong>'}</p>
    <details ${c.clientId ? '' : 'open'}>
      <summary>So richtest du es ein (Microsoft Entra ID)</summary>
      <ol class="hint">
        <li>Im <strong>Microsoft Entra Admin Center</strong> → <em>Anwendungen → App-Registrierungen → Neue Registrierung</em>, Name z. B. „LearningModules“,
          <em>Nur Konten in diesem Organisationsverzeichnis</em>.</li>
        <li>Umleitungs-URI, Plattform <strong>Web</strong>: <code class="sso-uri">${escapeHtml(c.redirectUri)}</code></li>
        <li><em>Zertifikate &amp; Geheimnisse → Neuer geheimer Clientschlüssel</em> – den <strong>Wert</strong> unten eintragen.</li>
        <li>Von der Übersicht: <strong>Verzeichnis-ID (Mandant)</strong> und <strong>Anwendungs-ID (Client)</strong> übernehmen.</li>
      </ol>
    </details>
    <div class="form-group"><label for="ssoTenant">Mandant (Verzeichnis-ID oder Domäne)</label>
      <input type="text" id="ssoTenant" value="${escapeAttr(c.tenant)}" placeholder="z. B. 1a2b3c… oder schule.de" autocomplete="off"></div>
    <div class="form-group"><label for="ssoClient">Anwendungs-ID (Client)</label>
      <input type="text" id="ssoClient" value="${escapeAttr(c.clientId)}" autocomplete="off"></div>
    <div class="form-group"><label for="ssoSecret">Geheimer Clientschlüssel</label>
      <input type="password" id="ssoSecret" placeholder="${c.hasSecret ? '•••••• gespeichert – leer lassen, um ihn zu behalten' : 'Wert des Schlüssels'}" autocomplete="new-password"></div>
    <label class="login-remember"><input type="checkbox" id="ssoTeachers" ${c.forTeachers ? 'checked' : ''}> Für <strong>Lehrkräfte</strong> (Anmeldeseite; zugeordnet über die E-Mail-Adresse)</label>
    <label class="login-remember"><input type="checkbox" id="ssoStudents" ${c.forStudents ? 'checked' : ''}> Für <strong>Schüler</strong> im Klassennotizbuch (beim ersten Mal über den Namen der Klassenliste zugeordnet)</label>
    <div class="form-actions">
      <button type="button" class="btn btn-primary" id="ssoSave">💾 Speichern</button>
      <button type="button" class="btn btn-secondary" id="ssoTest">🔎 Mandant prüfen</button>
    </div>
    <p class="${msg?.error ? 'login-error' : 'hint'}" id="ssoMsg">${msg ? escapeHtml(msg.text) : ''}</p>`;
  const again = (m) => renderSchoolSso(app, box, m);
  box.querySelector('#ssoSave').addEventListener('click', async () => {
    try {
      await call(app, 'PUT', {
        tenant: box.querySelector('#ssoTenant').value,
        clientId: box.querySelector('#ssoClient').value,
        secret: box.querySelector('#ssoSecret').value,
        forTeachers: box.querySelector('#ssoTeachers').checked,
        forStudents: box.querySelector('#ssoStudents').checked,
      });
      again({ text: '✅ Gespeichert. Am besten gleich in einem privaten Fenster „Mit Microsoft anmelden“ ausprobieren.' });
    } catch (e) { again({ error: true, text: '❌ ' + e.message }); }
  });
  box.querySelector('#ssoTest').addEventListener('click', async () => {
    try {
      const r = await call(app, 'TEST');
      again({ text: `✅ Microsoft kennt den Mandanten (${r.issuer}). Client-ID und Schlüssel prüft erst eine echte Anmeldung.` });
    } catch (e) { again({ error: true, text: '❌ ' + e.message }); }
  });
}
