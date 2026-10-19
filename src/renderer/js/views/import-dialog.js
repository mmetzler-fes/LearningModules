import { escapeHtml, showImportReport } from '../utils.js';
import { extractJson, looksLikeXml, summarizeImport } from '../json-text.js';

/**
 * Ein Dialog für jeden Import: Datei wählen bzw. hineinziehen oder Text mit
 * Strg+V einfügen (z. B. die Antwort einer KI). JSON und Moodle-XML werden
 * vor dem Import geprüft – mit derselben Logik wie im Server (json-text.js);
 * binäre Dateien (verschlüsselter Export, H5P, Notebook-ZIP) gehen ohne
 * Vorschau durch. Importiert wird über die bestehenden Endpunkte.
 *
 * @param app        App (authStore, showToast)
 * @param topicId    Ziel-Thema für die Module; ohne entsteht ein neues Thema
 * @param h5p        H5P-Dateien annehmen (nur ohne topicId: H5P wird ein neues Thema)
 * @param extraFile  weiterer Dateityp mit eigener Verarbeitung, z. B. die
 *                   Notebook-ZIP: { ext: 'zip', label, run(file) → Promise<bool> }
 * @param onDone     nach erfolgreichem Import mit der Antwort des Servers
 *                   (topicId, topicTitle, importedCount …)
 */
export function openImportDialog(app, { topicId = null, h5p = false, extraFile = null, onDone } = {}) {
  const typeNames = Object.fromEntries(Object.values(typeof H5P_TYPES !== 'undefined' ? H5P_TYPES : {})
    .map((t) => [t.id, `${t.icon || ''} ${t.name}`.trim()]));
  const exts = ['json', 'xml', 'lmenc', ...(h5p && !topicId ? ['h5p'] : []), ...(extraFile ? [extraFile.ext] : [])];
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="import-modules-card import-dialog-card" role="dialog" aria-modal="true" aria-labelledby="importDialogTitle">
      <h3 id="importDialogTitle">📥 ${topicId ? 'Module importieren' : 'Importieren'}</h3>
      <p class="import-modules-hint">${topicId ? 'Die Module kommen in das geöffnete Thema.' : 'Daraus entsteht ein neues Lernthema.'}</p>
      <div class="import-dialog-file">
        <button type="button" class="btn btn-secondary btn-file">📄 Datei wählen …</button>
        <span class="hint">oder hierher ziehen – ${exts.map((e) => `.${e}`).join(', ')}</span>
        <span class="import-dialog-chip" hidden><span class="import-dialog-chip-name"></span>
          <button type="button" class="import-dialog-chip-x" title="Datei wieder entfernen" aria-label="Datei entfernen">✕</button></span>
      </div>
      <textarea class="json-text-input" rows="12" spellcheck="false" autocomplete="off"
        placeholder="… oder Text mit Strg+V einfügen, z. B. die Antwort einer KI (JSON oder Moodle-XML). Ein Rahmen mit \`\`\`json und Text davor oder danach stört nicht."></textarea>
      <div class="json-text-status" aria-live="polite"></div>
      <div class="confirm-actions">
        <button type="button" class="btn btn-secondary btn-paste" title="Text aus der Zwischenablage einfügen">📋 Einfügen</button>
        <button type="button" class="btn btn-primary btn-import" disabled>✅ Importieren</button>
        <button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const card = overlay.querySelector('.import-dialog-card');
  const input = overlay.querySelector('.json-text-input');
  const status = overlay.querySelector('.json-text-status');
  const btnImport = overlay.querySelector('.btn-import');
  const btnPaste = overlay.querySelector('.btn-paste');
  const chip = overlay.querySelector('.import-dialog-chip');
  // Kein Einfügen-Knopf, wo der Browser die Zwischenablage nicht lesen lässt (z. B. Firefox).
  if (!navigator.clipboard?.readText) btnPaste.hidden = true;

  const list = (items) => `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  let valid = false;
  let file = null; // gewählte Datei; dann zählt sie statt des Textfelds
  let fileText = null; // Inhalt einer JSON-/XML-Datei für die Prüfung

  const show = (kind, html) => {
    status.className = `json-text-status${kind ? ` is-${kind}` : ''}`;
    status.innerHTML = html;
  };

  /** Text (eingefügt oder aus einer Datei) prüfen und das Ergebnis anzeigen. */
  const checkText = (text) => {
    if (!text.trim()) { show('', ''); return false; }
    if (looksLikeXml(text)) { show('ok', '✅ Moodle-XML erkannt – wird beim Import in Module umgewandelt.'); return true; }
    const parsed = extractJson(text);
    if (!parsed.ok) {
      if (parsed.truncated) {
        show('error', '❌ <strong>Unvollständig</strong> – der Text endet mitten im JSON. Vermutlich wurde die KI-Antwort abgeschnitten:'
          + ' den Rest nachfordern („weiter“) oder den Prompt mit weniger Modulen erzeugen.');
      } else {
        const where = parsed.line ? ` in <strong>Zeile ${parsed.line}, Spalte ${parsed.column}</strong>` : '';
        const excerpt = parsed.line
          ? `<pre class="json-text-excerpt">${escapeHtml(parsed.excerpt)}\n${' '.repeat(Math.max(0, parsed.column - 1))}^</pre>`
          : '';
        show('error', `❌ Kein gültiges JSON${where}: ${escapeHtml(parsed.message)}${excerpt}`);
      }
      return false;
    }
    const s = summarizeImport(parsed.data, typeNames);
    if (s.problems.length) { show('error', `❌ Gültiges JSON, aber so nicht importierbar:${list(s.problems)}`); return false; }
    const kinds = s.types.map((t) => `${t.n}× ${escapeHtml(t.name)}`).join(', ');
    show(s.warnings.length ? 'warn' : 'ok',
      `✅ ${s.title && !topicId ? `Thema „${escapeHtml(s.title)}“ – ` : ''}${s.count} Modul${s.count === 1 ? '' : 'e'}: ${kinds}`
      + (s.warnings.length ? `<p>⚠️ Hinweise:</p>${list(s.warnings)}` : ''));
    return true;
  };

  const extOf = (f) => (/\.([a-z0-9]+)$/i.exec(f.name)?.[1] || '').toLowerCase();

  const check = () => {
    if (file) {
      const ext = extOf(file);
      if (fileText !== null) valid = checkText(fileText);
      else if (ext === 'lmenc') { show('ok', '🔒 Verschlüsselter Export – wird beim Import entschlüsselt.'); valid = true; }
      else if (ext === 'h5p') { show('ok', '📦 H5P-Datei – wird als neues Lernthema übernommen.'); valid = true; }
      else if (extraFile && ext === extraFile.ext) { show('ok', escapeHtml(extraFile.label)); valid = true; }
      else { show('error', `❌ Dieser Dateityp lässt sich hier nicht importieren. Möglich: ${exts.map((e) => `.${e}`).join(', ')}`); valid = false; }
    } else {
      valid = checkText(input.value);
    }
    btnImport.disabled = !valid;
  };

  const setFile = async (f) => {
    file = f;
    fileText = null;
    chip.hidden = !f;
    if (f) {
      chip.querySelector('.import-dialog-chip-name').textContent = `📄 ${f.name}`;
      input.value = '';
      if (['json', 'xml', 'txt'].includes(extOf(f))) {
        try { fileText = await f.text(); } catch (_) { fileText = ''; }
      }
    }
    check();
  };

  overlay.querySelector('.btn-file').addEventListener('click', () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = exts.map((e) => `.${e}`).join(',');
    picker.onchange = () => { if (picker.files[0]) setFile(picker.files[0]); };
    picker.click();
  });
  chip.querySelector('.import-dialog-chip-x').addEventListener('click', () => { setFile(null); input.focus(); });
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('is-dragover'); });
  card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove('is-dragover'); });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('is-dragover');
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  });

  // Wer tippt oder einfügt, meint den Text – eine gewählte Datei tritt zurück.
  let timer = null;
  input.addEventListener('input', () => {
    if (file) { file = null; fileText = null; chip.hidden = true; }
    clearTimeout(timer);
    timer = setTimeout(check, 250);
  });
  input.addEventListener('paste', () => setTimeout(check, 0));
  btnPaste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      await setFile(null);
      input.value = text;
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

  const post = async (url, form, headers = {}) => {
    const token = app.authStore.getToken();
    const res = await fetch(url, { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: form });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || data.error || 'Unbekannter Fehler');
    return data;
  };

  btnImport.addEventListener('click', async () => {
    check();
    if (!valid) return;
    btnImport.disabled = true;
    btnImport.textContent = '⏳ Importiere …';
    try {
      const ext = file ? extOf(file) : '';
      if (file && extraFile && ext === extraFile.ext) {
        if (await extraFile.run(file)) close();
        else { btnImport.disabled = false; btnImport.textContent = '✅ Importieren'; }
        return;
      }
      const form = new FormData();
      let data;
      if (file && ext === 'h5p') {
        form.append('file', file);
        data = await post('/api/interchange/h5p/upload', form, { 'X-Import-Mode': 'native' });
      } else {
        // Eingefügter Text geht als Datei über denselben Import – der Server
        // erkennt JSON, Moodle-XML und verschlüsselte Exporte selbst.
        const xml = !file && looksLikeXml(input.value);
        form.append('file', file || new Blob([input.value], { type: xml ? 'application/xml' : 'application/json' }),
          file ? file.name : xml ? 'eingefuegt.xml' : 'eingefuegt.json');
        if (topicId) form.append('topicId', topicId);
        data = await post('/api/interchange/import-json', form);
      }
      close();
      app.showToast(topicId
        ? `${data.importedCount} Modul(e) importiert.`
        : `Thema „${data.topicTitle || 'Thema'}“ mit ${data.importedCount} Modul(en) importiert.`, 'success');
      showImportReport(data);
      if (onDone) await onDone(data);
    } catch (err) {
      btnImport.disabled = false;
      btnImport.textContent = '✅ Importieren';
      show('error', `❌ Import fehlgeschlagen: ${escapeHtml(err.message)}`);
    }
  });

  input.focus();
}
