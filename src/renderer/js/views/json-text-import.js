import { escapeHtml, showImportReport } from '../utils.js';
import { extractJson, looksLikeXml, summarizeImport } from '../json-text.js';

/**
 * Dialog „📋 JSON-Text importieren“: Text mit Strg+V einfügen (z. B. die
 * Antwort einer KI), sofort prüfen lassen, dann importieren – ohne den Umweg
 * über eine gespeicherte Datei.
 *
 * Geprüft wird mit derselben Logik wie im Server (json-text.js); importiert
 * wird über denselben Weg wie eine hochgeladene Datei, so gelten auch
 * Moodle-XML und die Angleichungen des Imports.
 *
 * @param app       App (api, authStore, showToast)
 * @param topicId   Ziel-Thema; ohne entsteht ein neues Thema
 * @param onDone    nach erfolgreichem Import, mit der Antwort des Servers
 */
export function openJsonTextImport(app, { topicId = null, onDone } = {}) {
  const typeNames = Object.fromEntries(Object.values(typeof H5P_TYPES !== 'undefined' ? H5P_TYPES : {})
    .map((t) => [t.id, `${t.icon || ''} ${t.name}`.trim()]));
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="import-modules-card json-text-card" role="dialog" aria-modal="true" aria-labelledby="jsonTextTitle">
      <h3 id="jsonTextTitle">📋 JSON-Text importieren</h3>
      <p class="import-modules-hint">${topicId
        ? 'Die Module kommen in das geöffnete Thema.'
        : 'Daraus entsteht ein neues Lernthema.'}
        Text hier mit <kbd>Strg</kbd>+<kbd>V</kbd> einfügen, z. B. die Antwort einer KI – ein Rahmen mit <code>\`\`\`json</code> und Text davor oder danach stört nicht.</p>
      <textarea class="json-text-input" rows="14" spellcheck="false" autocomplete="off"
        placeholder='{ "topic": { "title": "…", "modules": [ … ] } }'></textarea>
      <div class="json-text-status" aria-live="polite"></div>
      <div class="confirm-actions">
        <button type="button" class="btn btn-secondary btn-paste" title="Text aus der Zwischenablage einfügen">📋 Einfügen</button>
        <button type="button" class="btn btn-primary btn-import" disabled>✅ Importieren</button>
        <button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.json-text-input');
  const status = overlay.querySelector('.json-text-status');
  const btnImport = overlay.querySelector('.btn-import');
  const btnPaste = overlay.querySelector('.btn-paste');
  // Kein Einfügen-Knopf, wo der Browser die Zwischenablage nicht lesen lässt (z. B. Firefox).
  if (!navigator.clipboard?.readText) btnPaste.hidden = true;

  const list = (items) => `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  let state = 'empty'; // empty | invalid | valid

  const check = () => {
    const text = input.value;
    if (!text.trim()) {
      state = 'empty';
      status.className = 'json-text-status';
      status.innerHTML = '';
    } else if (looksLikeXml(text)) {
      state = 'valid';
      status.className = 'json-text-status is-ok';
      status.innerHTML = '✅ Moodle-XML erkannt – wird beim Import in Module umgewandelt.';
    } else {
      const parsed = extractJson(text);
      if (!parsed.ok) {
        state = 'invalid';
        status.className = 'json-text-status is-error';
        if (parsed.truncated) {
          status.innerHTML = '❌ <strong>Unvollständig</strong> – der Text endet mitten im JSON. Vermutlich wurde die KI-Antwort abgeschnitten:'
            + ' den Rest nachfordern („weiter“) oder den Prompt mit weniger Modulen erzeugen.';
        } else {
          const where = parsed.line ? ` in <strong>Zeile ${parsed.line}, Spalte ${parsed.column}</strong>` : '';
          const excerpt = parsed.line
            ? `<pre class="json-text-excerpt">${escapeHtml(parsed.excerpt)}\n${' '.repeat(Math.max(0, parsed.column - 1))}^</pre>`
            : '';
          status.innerHTML = `❌ Kein gültiges JSON${where}: ${escapeHtml(parsed.message)}${excerpt}`;
        }
      } else {
        const s = summarizeImport(parsed.data, typeNames);
        state = s.problems.length ? 'invalid' : 'valid';
        status.className = `json-text-status ${s.problems.length ? 'is-error' : s.warnings.length ? 'is-warn' : 'is-ok'}`;
        const kinds = s.types.map((t) => `${t.n}× ${escapeHtml(t.name)}`).join(', ');
        status.innerHTML = s.problems.length
          ? `❌ Gültiges JSON, aber so nicht importierbar:${list(s.problems)}`
          : `✅ ${s.title && !topicId ? `Thema „${escapeHtml(s.title)}“ – ` : ''}${s.count} Modul${s.count === 1 ? '' : 'e'}: ${kinds}`
            + (s.warnings.length ? `<p>⚠️ Hinweise:</p>${list(s.warnings)}` : '');
      }
    }
    btnImport.disabled = state !== 'valid';
  };

  let timer = null;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 250); });
  // Nach dem Einfügen sofort prüfen, nicht erst nach der Pause.
  input.addEventListener('paste', () => setTimeout(check, 0));
  btnPaste.addEventListener('click', async () => {
    try {
      input.value = await navigator.clipboard.readText();
      check();
    } catch (_) {
      app.showToast('Kein Zugriff auf die Zwischenablage – bitte mit Strg+V ins Feld einfügen.', 'info');
    }
    input.focus();
  });

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.btn-cancel').addEventListener('click', close);
  // Kein Schließen per Klick daneben: Eingefügtes ginge sonst verloren.

  btnImport.addEventListener('click', async () => {
    check();
    if (state !== 'valid') return;
    btnImport.disabled = true;
    btnImport.textContent = '⏳ Importiere …';
    // Als Datei über den bestehenden Import – der Server erkennt JSON und Moodle-XML selbst.
    const xml = looksLikeXml(input.value);
    const form = new FormData();
    form.append('file', new Blob([input.value], { type: xml ? 'application/xml' : 'application/json' }), xml ? 'eingefuegt.xml' : 'eingefuegt.json');
    if (topicId) form.append('topicId', topicId);
    const token = app.authStore.getToken();
    try {
      const res = await fetch('/api/interchange/import-json', {
        method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Unbekannter Fehler');
      close();
      app.showToast(topicId
        ? `${data.importedCount} Modul(e) importiert.`
        : `Thema „${data.topicTitle || 'Thema'}“ mit ${data.importedCount} Modul(en) importiert.`, 'success');
      showImportReport(data);
      if (onDone) await onDone(data);
    } catch (err) {
      btnImport.disabled = false;
      btnImport.textContent = '✅ Importieren';
      status.className = 'json-text-status is-error';
      status.innerHTML = `❌ Import fehlgeschlagen: ${escapeHtml(err.message)}`;
    }
  });

  input.focus();
}
