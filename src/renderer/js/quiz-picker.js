import { escapeHtml } from './utils.js';

/**
 * Quiz einfügen: ein Modul desselben Lernthemas wählen – für den
 * Dokument-Editor (docspec-editor.js) und das ⊕ im Stift-Editor
 * (ink/ink-open.js). Dokumente, Infoseiten-Kinder und das Dokument selbst
 * (`own`) fehlen in der Liste – sie sind kein Quiz. Ergebnis: ein Baustein
 * `{ type: 'quiz', module, title }` oder null.
 */
export function pickQuiz(modules, own = null) {
  const mods = (modules || []).filter((m) => m && m.id && m.id !== own && !m.parentId && m.type !== 'document');
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<div class="import-modules-card ds-quiz-picker">
        <h3>🧩 Quiz einfügen</h3>
        <p class="hint">${mods.length
          ? 'Ein Modul aus diesem Lernthema. Im Durchlauf bearbeiten Schüler es direkt im Blatt; im Druck stehen QR-Code und Adresse (über deinen Quick-Link).'
          : 'In diesem Lernthema gibt es noch kein anderes Modul. Lege das Quiz zuerst als Modul im Lernthema an und füge es dann hier ein.'}</p>
        <div class="ds-quiz-choices">${mods.map((m) => `<button type="button" class="btn btn-secondary ds-quiz-choice" data-id="${escapeHtml(m.id)}">${escapeHtml(m.title || m.type)}</button>`).join('')}</div>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary ds-q-cancel">Abbrechen</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('.ds-q-cancel').addEventListener('click', () => done(null));
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) done(null); });
    overlay.querySelectorAll('.ds-quiz-choice').forEach((btn) => btn.addEventListener('click', () => {
      const m = mods.find((x) => x.id === btn.dataset.id);
      done({ type: 'quiz', module: m.id, title: m.title || 'Quiz' });
    }));
  });
}
