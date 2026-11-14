// ==================== IMPORT-BERICHT MIT AMPEL ====================
//
// Nach dem Übernehmen von Dateien (Importieren, Anhang umwandeln, Datei erneut
// übernehmen): je Dokument eine Ampel – 🟢 gut, 🟡 bitte durchsehen, 🔴 schwach –
// mit den Gründen in Klartext. Bei 🟡/🔴 führt „Mit KI neu aufbereiten“ direkt
// weiter. Die Bewertung selbst steht in lm-editor/src/import/quality.js; der
// Prüfbestand (scripts/import-check.mjs) misst mit derselben.

import { escapeHtml } from '../utils.js';
import { rateImport, LEVEL_ICON, LEVEL_TEXT } from '../../lm-editor/src/import/quality.js';

/** Bewertung eines übernommenen Dokuments – für Listen, die nur eine Zeile zeigen. */
export function rateLine(spec, warnings = []) {
  const r = rateImport(spec, warnings);
  return { ...r, icon: LEVEL_ICON[r.level], text: LEVEL_TEXT[r.level] };
}

/**
 * Bericht anzeigen. `entries`: [{ id, title, spec, warnings }] (übernommene Dokumente),
 * `failed`: Texte zu Dateien, die nicht übernommen wurden, `notes`: weitere Hinweise.
 * `onDone()` nach „Mit KI neu aufbereiten“ (Baum neu laden).
 */
export function showImportQuality(app, entries, { heading = '📋 Import-Bericht', failed = [], notes = [], onDone = null } = {}) {
  const rated = entries.map((e) => ({ ...e, ...rateImport(e.spec, e.warnings || []) }));
  if (!rated.length && !failed.length) return;
  const count = (lv) => rated.filter((r) => r.level === lv).length;
  const improvable = rated.filter((r) => r.level !== 'good');
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="import-modules-card import-report iq-card">
      <h3>${escapeHtml(heading)}</h3>
      ${rated.length ? `<p class="iq-sum">${rated.length} Dokument${rated.length === 1 ? '' : 'e'} übernommen:
        <span>${LEVEL_ICON.good} ${count('good')} gut</span>
        <span>${LEVEL_ICON.check} ${count('check')} durchsehen</span>
        <span>${LEVEL_ICON.weak} ${count('weak')} schwach</span></p>` : ''}
      <ul class="import-report-list iq-list">${rated.map((r, i) => `
        <li class="iq-${r.level}">
          <div class="iq-row"><span class="iq-icon" title="${escapeHtml(LEVEL_TEXT[r.level])}">${LEVEL_ICON[r.level]}</span>
            <strong>${escapeHtml(r.title || 'Dokument')}</strong>
            ${r.level !== 'good' && r.id ? `<button type="button" class="btn btn-secondary btn-sm iq-ai" data-i="${i}" title="Anleitung und Zugang für deine eigene KI: Sie überträgt das Original sauber in dieses Dokument">🤖 Mit KI neu aufbereiten</button>` : ''}</div>
          ${r.reasons.length ? `<ul class="iq-reasons">${r.reasons.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
        </li>`).join('')}</ul>
      ${failed.length ? `<p><strong>❌ Nicht übernommen (${failed.length})</strong></p><ul class="import-report-list">${failed.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''}
      ${notes.length ? `<details><summary>ℹ️ Weitere Hinweise (${notes.length})</summary><ul class="import-report-list">${notes.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul></details>` : ''}
      <p class="hint">${improvable.length
        ? `🟡 und 🔴 lassen sich oft schon im Editor richten; wo viel Text in Bildern steckt, hilft „Mit KI neu aufbereiten“ mit dem Original als Anhang.`
        : 'Alles sieht gut aus – bitte die Blätter trotzdem kurz im Editor durchsehen.'}</p>
      <div class="confirm-actions">
        ${improvable.length > 1 && improvable.every((r) => r.id) ? `<button type="button" class="btn btn-secondary iq-ai-all">🤖 Alle ${improvable.length} mit KI neu aufbereiten</button>` : ''}
        <button type="button" class="btn btn-primary iq-ok">OK</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const regenerate = (docs) => {
    close();
    import('./ai-bridge-dialog.js').then((m) => m.openAiBridgeDialog(app, {
      regenerate: docs.map((d) => ({ id: d.id, title: d.title || 'Dokument' })),
      onDone,
    }));
  };
  overlay.querySelector('.iq-ok').addEventListener('click', close);
  overlay.querySelector('.iq-ai-all')?.addEventListener('click', () => regenerate(improvable));
  overlay.querySelectorAll('.iq-ai').forEach((b) => b.addEventListener('click', () => regenerate([rated[Number(b.dataset.i)]])));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}
