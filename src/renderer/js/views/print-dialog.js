// ==================== DRUCKEN ====================
//
// Ein Dialog statt vieler Menüpunkte: Fassung (Arbeitsblatt/Lösung), Format
// (PDF/.odt) und wie Quizze erscheinen – mit Druckfassung unter dem QR-Code
// (Vorgabe) oder nur QR-Code und Adresse (src/worksheets/quiz-print.ts).
// Die Wahl merkt sich das Gerät.

import { escapeHtml } from '../utils.js';

const PREFS_KEY = 'lm_print_opts';

/** Zuletzt gewählte Einstellungen: `{ solution, format, quizzes }`. */
export function printPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (_) { p = {}; }
  return {
    solution: !!p.solution,
    format: p.format === 'odt' ? 'odt' : 'pdf',
    quizzes: p.quizzes === 'qr' ? 'qr' : 'print',
  };
}

function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (_) { /* ohne Speicher */ }
}

/** Ausgabe für /api/worksheets/render bzw. /script. */
export function outputOf({ solution, format }) {
  if (format === 'odt') return solution ? 'loesung' : 'odt';
  return solution ? 'loesung_pdf' : 'pdf';
}

/**
 * Druckdialog. `extras`: weitere Knöpfe `{ label, title, run }` (z. B. .zlm).
 * Ergebnis `{ solution, format, quizzes, output }` oder null.
 */
export function openPrintDialog({ heading = '🖨 Drucken', intro = '', solution = true, extras = [] } = {}) {
  const p = printPrefs();
  const radio = (name, value, checked, label, hint = '') => `<label class="nb-check"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}>
      <strong>${label}</strong>${hint ? ` <span class="hint">– ${hint}</span>` : ''}</label>`;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <form class="import-modules-card nb-dialog print-dialog">
        <h3>${escapeHtml(heading)}</h3>
        ${intro ? `<p class="hint">${escapeHtml(intro)}</p>` : ''}
        ${solution ? `<fieldset><legend>Fassung</legend>
          ${radio('solution', '0', !p.solution, 'Arbeitsblatt')}
          ${radio('solution', '1', p.solution, 'Lösung', 'mit den Antworten in Rot')}</fieldset>` : ''}
        <fieldset><legend>Format</legend>
          ${radio('format', 'pdf', p.format === 'pdf', 'PDF', 'zum Drucken, für GoodNotes und OneNote')}
          ${radio('format', 'odt', p.format === 'odt', '.odt', 'zum Weiterbearbeiten in LibreOffice Writer')}</fieldset>
        <fieldset><legend>Quizze</legend>
          ${radio('quizzes', 'print', p.quizzes === 'print', 'QR-Code und Quiz zum Ausfüllen', 'Kästchen, Lücken, Wortkasten – zum Ausprobieren oben der QR-Code')}
          ${radio('quizzes', 'qr', p.quizzes === 'qr', 'Nur QR-Code und Adresse', 'kürzer, das Quiz gibt es nur online')}</fieldset>
        <div class="confirm-actions">
          ${extras.map((x, i) => `<button type="button" class="btn btn-secondary print-extra" data-i="${i}" title="${escapeHtml(x.title || '')}">${escapeHtml(x.label)}</button>`).join('')}
          <span class="print-spacer"></span>
          <button type="button" class="btn btn-secondary print-cancel">Abbrechen</button>
          <button type="submit" class="btn btn-primary">🖨 Erzeugen</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const done = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', onKey, true);
    overlay.querySelector('.print-cancel').addEventListener('click', () => done(null));
    overlay.querySelectorAll('.print-extra').forEach((b) => b.addEventListener('click', () => { done(null); extras[Number(b.dataset.i)].run(); }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const choice = { solution: f.get('solution') === '1', format: f.get('format') === 'odt' ? 'odt' : 'pdf', quizzes: f.get('quizzes') === 'qr' ? 'qr' : 'print' };
      savePrefs(choice);
      done({ ...choice, output: outputOf(choice) });
    });
    form.querySelector('button[type="submit"]').focus();
  });
}
