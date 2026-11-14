import { escapeHtml } from '../utils.js';

// ==================== 📓 FÜR GOODNOTES ====================
//
// Ein PDF je Lernthema (src/worksheets/goodnotes.service.ts): Titelseite,
// verlinktes Inhaltsverzeichnis, Lesezeichen, nach jedem Blatt eine
// Karo-Seite, Quizze zum Ausfüllen. Schülerheft ohne, Lösungsheft mit
// Lösungen. Unveränderte Inhalte kommen aus dem Zwischenspeicher.

const failed = (r) => !r || r.success === false || r.statusCode >= 400;

export function openGoodnotesDialog(app, topic) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `<div class="import-modules-card nb-dialog" style="max-width:620px">
    <h3>📓 Für GoodNotes – ${escapeHtml(topic.title)}</h3>
    <p class="hint">Ein PDF für das ganze Lernthema: Titelseite, antippbares Inhaltsverzeichnis und Lesezeichen,
      nach jedem Blatt eine Karo-Seite, Quizze zum Ausfüllen. Im Dateinamen steht der Stand (jüngste Änderung).
      Ist nichts geändert, wird nicht neu erzeugt.</p>
    <p class="hint">Schüler finden am Dokument den Knopf <strong>📓 Heft für GoodNotes</strong> (ohne Lösungen).</p>
    <div class="gn-actions">
      <button type="button" class="btn btn-secondary" data-act="student">⬇ Schülerheft</button>
      <button type="button" class="btn btn-secondary" data-act="teacher">⬇ Lösungsheft</button>
      <button type="button" class="btn btn-primary" data-act="nextcloud" title="Beide Hefte nach GoodNotes/ in deiner Nextcloud – ältere Stände desselben Lernthemas werden ersetzt">☁️ In die Nextcloud (GoodNotes/)</button>
    </div>
    <p class="gn-status hint" aria-live="polite"></p>
    <div class="confirm-actions"><button type="button" class="btn btn-secondary gn-close">Schließen</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const status = overlay.querySelector('.gn-status');
  const close = () => overlay.remove();
  overlay.querySelector('.gn-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const buttons = [...overlay.querySelectorAll('[data-act]')];
  const busy = (on, text = '') => {
    buttons.forEach((b) => { b.disabled = on; });
    status.textContent = text;
  };

  overlay.querySelector('.gn-actions').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    busy(true, '⏳ Heft wird erstellt – beim ersten Mal kann das etwas dauern …');
    try {
      if (act === 'nextcloud') {
        const res = await app.api.goodnotesToNextcloud(topic.id);
        if (failed(res)) throw new Error(res?.message || 'Das ging nicht.');
        if (res.nextcloud) {
          status.innerHTML = `✅ In der Nextcloud unter <code>${escapeHtml(res.nextcloud.folder)}/</code>: ${res.nextcloud.files.map((f) => `<code>${escapeHtml(f)}</code>`).join(', ')}`;
        } else {
          status.textContent = res.nextcloudError ? `⚠️ Erstellt, aber nicht abgelegt: ${res.nextcloudError}` : '⚠️ Erstellt, aber es ist keine Nextcloud verbunden (Home-Menü → ☁️ Nextcloud).';
        }
        const warnings = [...(res.student?.warnings || []), ...(res.teacher?.warnings || [])];
        if (warnings.length) status.innerHTML += `<br>⚠️ ${warnings.slice(0, 3).map(escapeHtml).join('<br>⚠️ ')}`;
        buttons.forEach((b) => { b.disabled = false; });
        return;
      }
      const res = await app.api.downloadGoodnotes(topic.id, act === 'teacher');
      if (failed(res)) throw new Error(res?.error || res?.message || 'Das ging nicht.');
      busy(false, '✅ Heruntergeladen.');
    } catch (err) {
      busy(false, `❌ ${err.message}`);
    }
  });
}
