import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== ZEICHNUNGEN MIT QUELLE ====================
//
// Zeichnungen aus einer .odt liegen als .odg (LibreOffice Draw) und .svg in
// der Nextcloud im Ordner des Lernthemas. Bearbeitet wird die .odg – am
// bequemsten im Sync-Ordner des Nextcloud-Clients am PC; die App zeichnet das
// SVG neu, sobald sie die Änderung sieht. Siehe docs/zeichnungen.md.

const failed = (res) => !res || res.success === false || (res.statusCode && res.statusCode >= 400);
const lastSync = new Map(); // Lernthema → Zeitpunkt; der Server bremst zusätzlich

/**
 * Geänderte Zeichnungen eines Lernthemas neu zeichnen lassen. Ergebnis: Zahl
 * der aktualisierten (0 auch bei Fehlern – der Abgleich ist eine Zugabe).
 */
export async function syncDrawings(app, topicId, { force = false, quiet = false } = {}) {
  if (!topicId) return 0;
  if (!force && Date.now() - (lastSync.get(topicId) || 0) < 20_000) return 0;
  lastSync.set(topicId, Date.now());
  const res = await app.api.syncDrawings(topicId, force).catch(() => null);
  if (failed(res)) {
    if (!quiet) app.showToast(`Zeichnungen: ${res?.message || 'Abgleich nicht möglich.'}`, 'error');
    return 0;
  }
  const n = res.updated?.length || 0;
  if (n) app.showToast(`🖍 ${n} Zeichnung${n === 1 ? '' : 'en'} aus der Nextcloud neu gezeichnet: ${res.updated.join(', ')}`, 'success');
  if (res.failed?.length && !quiet) app.showToast(`Zeichnungen nicht neu gezeichnet: ${res.failed.join(' · ')}`, 'error');
  return n;
}

/** Übersicht der Zeichnungen eines Lernthemas: wo die .odg liegt, herunter- und hochladen. */
export async function openDrawingsDialog(app, topic, { onChanged } = {}) {
  const list = await app.api.listDrawings(topic.id).catch(() => null);
  if (failed(list)) { app.showToast(`Zeichnungen: ${list?.message || 'nicht abrufbar'}`, 'error'); return; }
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  const rows = () => list.map((d) => `
    <li data-id="${escapeAttr(d.id)}">
      <img src="${escapeAttr(`${d.svgUrl}?v=${d.version}`)}" alt="" class="drawings-thumb">
      <div class="drawings-info">
        <strong>${escapeHtml(d.odgName)}</strong>
        <span class="hint">Nextcloud: <code>…/Bilder/${escapeHtml(d.folder)}/${escapeHtml(d.odgName)}</code> · Fassung ${d.version}</span>
        <span class="drawings-actions">
          <a class="btn btn-secondary btn-sm" href="${escapeAttr(d.odgUrl)}" download="${escapeAttr(d.odgName)}">⬇ .odg</a>
          <button type="button" class="btn btn-secondary btn-sm drawings-upload">⬆ Geänderte .odg hochladen</button>
        </span>
      </div>
    </li>`).join('');
  overlay.innerHTML = `
    <div class="import-modules-card drawings-card" role="dialog" aria-modal="true">
      <h3>🖍 Zeichnungen in „${escapeHtml(topic.title)}“</h3>
      <p class="hint">Jede Zeichnung liegt in deiner Nextcloud als <strong>.odg</strong> (LibreOffice Draw) neben dem Bild, das die
        Dokumente zeigen. Am PC mit dem <strong>Nextcloud-Sync-Client</strong>: die .odg im Sync-Ordner öffnen, in Draw ändern,
        speichern – beim nächsten Öffnen des Dokuments (oder mit „Jetzt abgleichen“) zeichnet die App das Bild neu, auch für die
        Schüler. Ohne Sync-Client: herunterladen, ändern, wieder hochladen.</p>
      ${list.length ? `<ul class="drawings-list">${rows()}</ul>` : '<p class="hint">In diesem Lernthema gibt es noch keine Zeichnungen mit Quelle. Sie entstehen beim Übernehmen einer .odt mit Zeichnungen (mit Renderer und Nextcloud).</p>'}
      <div class="confirm-actions">
        ${list.length ? '<button type="button" class="btn btn-primary drawings-sync">🔄 Jetzt abgleichen</button>' : ''}
        <button type="button" class="btn btn-secondary drawings-close">Schließen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.drawings-close').addEventListener('click', close);
  overlay.querySelector('.drawings-sync')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const n = await syncDrawings(app, topic.id, { force: true });
    if (!n) app.showToast('Keine geänderten Zeichnungen gefunden.', 'info');
    else { close(); await onChanged?.(); }
  });
  overlay.querySelectorAll('.drawings-upload').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.closest('li').dataset.id;
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.odg,application/vnd.oasis.opendocument.graphics';
    picker.onchange = async () => {
      const file = picker.files[0];
      if (!file) return;
      btn.disabled = true;
      btn.textContent = '⏳ Wird gezeichnet …';
      const res = await app.api.uploadDrawingOdg(id, file);
      if (failed(res)) {
        app.showToast(`Hochladen: ${res?.message || 'fehlgeschlagen'}`, 'error');
        btn.disabled = false;
        btn.textContent = '⬆ Geänderte .odg hochladen';
        return;
      }
      app.showToast('🖍 Zeichnung neu gezeichnet.', 'success');
      close();
      await onChanged?.();
    };
    picker.click();
  }));
}
