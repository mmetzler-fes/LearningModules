import { showImportReport, escapeHtml } from '../utils.js';
import { checkAnswer, documentsInAnswer, importAnswer } from './import-check.js';

/**
 * Text kopieren, der noch entsteht. Safari erlaubt das nur, wenn der Auftrag
 * direkt beim Klick startet; deshalb bekommt die Zwischenablage das Versprechen.
 * Ergebnis: true, wenn der Text in der Zwischenablage liegt.
 */
export async function copyWhenReady(job) {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': job.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      return true;
    }
    await navigator.clipboard.writeText(await job);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Antwort der KI einfügen, prüfen, übernehmen: Bleibt offen für den nächsten
 * Teil („weiter“). `getTopicId()` nennt das Ziel, `onImported(data, docs)` meldet
 * das Ergebnis.
 */
export function mountAnswerBox(app, box, { heading, getTopicId, docsOn, onImported }) {
  box.innerHTML = `
    <div class="ai-answer-box">
      <label class="ai-answer-label">${escapeHtml(heading)}
        <textarea class="json-text-input" rows="8" spellcheck="false" autocomplete="off"
          placeholder="Antwort der KI hier einfügen (Strg+V), am besten über den Kopier-Knopf am Codeblock."></textarea></label>
      <div class="json-text-status" aria-live="polite"></div>
      <div class="import-fix" hidden>
        <button type="button" class="btn btn-secondary btn-fix">🔁 Korrektur-Prompt kopieren</button>
        <span class="hint">im selben KI-Chat einfügen, die neue Antwort kommt dann hierher</span>
        <details class="import-fix-details"><summary>Text ansehen</summary><textarea readonly rows="5" class="import-fix-text"></textarea></details>
      </div>
      <div class="confirm-actions"><button type="button" class="btn btn-primary btn-take" disabled>✅ Übernehmen</button></div>
    </div>`;
  const input = box.querySelector('.json-text-input');
  const status = box.querySelector('.json-text-status');
  const fixBox = box.querySelector('.import-fix');
  const fixText = box.querySelector('.import-fix-text');
  const btn = box.querySelector('.btn-take');
  const show = (kind, html) => { status.className = `json-text-status${kind ? ` is-${kind}` : ''}`; status.innerHTML = html; };
  const check = () => {
    const r = checkAnswer(input.value, { docsOn, topicId: getTopicId() });
    show(r.kind, r.html);
    fixBox.hidden = !r.fix;
    fixText.value = r.fix || '';
    btn.disabled = !r.valid;
    return r.valid;
  };
  let timer = null;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 250); });
  input.addEventListener('paste', () => setTimeout(check, 0));
  box.querySelector('.btn-fix').addEventListener('click', async () => {
    if (await copyWhenReady(Promise.resolve(fixText.value))) { app.showToast('Korrektur-Prompt kopiert – im selben KI-Chat einfügen.', 'success'); return; }
    fixText.closest('details').open = true;
    fixText.select();
    app.showToast('Bitte mit Strg+C kopieren', 'info');
  });
  btn.addEventListener('click', async () => {
    if (!check()) return;
    btn.disabled = true;
    btn.textContent = '⏳ Übernehme …';
    const text = input.value;
    try {
      const data = await importAnswer(app, text, { docsOn, topicId: getTopicId() });
      const docs = documentsInAnswer(text, { docsOn });
      await onImported(data, docs);
      input.value = '';
      fixBox.hidden = true;
      show('ok', `✅ ${data.importedCount} Modul${data.importedCount === 1 ? '' : 'e'} übernommen. Gibt es weitere Teile: im Chat „weiter“ schreiben und die nächste Antwort hier einfügen.`);
      showImportReport(data);
    } catch (err) {
      show('error', `❌ Übernehmen fehlgeschlagen: ${escapeHtml(err.message)}`);
      btn.disabled = false;
    }
    btn.textContent = '✅ Übernehmen';
  });
}
