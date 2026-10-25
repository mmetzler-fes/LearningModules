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

/**
 * Übersicht der Zeichnungen eines Lernthemas: wo die .odg liegt, herunter- und
 * hochladen. `only`: nur die Zeichnung mit diesem Link der .odg (aus dem Editor);
 * `onChanged(list)` bekommt danach den neuen Stand.
 */
export async function openDrawingsDialog(app, topic, { onChanged, only = null } = {}) {
  const all = await app.api.listDrawings(topic.id).catch(() => null);
  if (failed(all)) { app.showToast(`Zeichnungen: ${all?.message || 'nicht abrufbar'}`, 'error'); return; }
  const list = only ? all.filter((d) => d.odgUrl === only || only.endsWith(d.odgUrl)) : all;
  if (only && !list.length) { app.showToast('Zu diesem Bild gibt es keine Zeichnung mit Quelle in diesem Lernthema.', 'info'); return; }
  const changed = async () => {
    const fresh = await app.api.listDrawings(topic.id).catch(() => null);
    await onChanged?.(failed(fresh) ? [] : fresh);
  };
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
      <h3>🖍 ${only ? 'Zeichnung bearbeiten' : `Zeichnungen in „${escapeHtml(topic.title)}“`}</h3>
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
    else { close(); await changed(); }
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
      await changed();
    };
    picker.click();
  }));
}

/**
 * Aus dem Dokument-Editor: die Zeichnung zu einem Bild (Link der .odg). Nach
 * einer Änderung bekommt `onSrc` den neuen Link des Bildes (mit Fassung).
 */
export async function openDrawingForImage(app, topic, odgUrl, onSrc) {
  if (!topic?.id) { app.showToast('Zeichnungen lassen sich nur in einem Lernthema bearbeiten.', 'info'); return; }
  await openDrawingsDialog(app, topic, {
    only: odgUrl,
    onChanged: (list) => {
      const d = list.find((x) => x.odgUrl === odgUrl || odgUrl.endsWith(x.odgUrl));
      if (d) onSrc?.(`${d.svgUrl}?v=${d.version}`);
    },
  });
}
