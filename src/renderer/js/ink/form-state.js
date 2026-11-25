// ==================== EINGABEN IM BLATT ====================
//
// Eingaben in den eingebetteten Quizzen eines Dokuments festhalten und wieder
// einsetzen – für den Stift-Editor (Stand `forms`) und um sie zwischen der
// Ansicht im Durchlauf und dem Stift-Fenster mitzunehmen. Erfasst werden
// Textfelder, Kästchen und Auswahllisten je Quiz in ihrer Reihenfolge;
// Gezogenes (Drag and Drop) nicht.

const CONTROLS = 'input, textarea, select';

/** `{ [Modul-ID]: [Wert je Feld] }` – Kästchen als true/false. */
export function captureForms(root) {
  const out = {};
  root?.querySelectorAll('form.ds-quiz-slot').forEach((slot) => {
    const values = [...slot.querySelectorAll(CONTROLS)].map((c) => {
      if (c.type === 'checkbox' || c.type === 'radio') return !!c.checked;
      if (c.type === 'button' || c.type === 'submit' || c.type === 'file') return null;
      return c.value;
    });
    if (values.some((v) => v !== null && v !== false && v !== '')) out[slot.dataset.module] = values;
  });
  // Labore (lm-editor/src/labs): ihr Stand je Baustein – als „lab:<Schlüssel>“.
  root?.querySelectorAll('.ds-lab.lab-live[data-lab-key]').forEach((el) => {
    try { if (el._lab) out[`lab:${el.dataset.labKey}`] = el._lab.getState(); } catch (_) { /* ohne diesen Stand */ }
  });
  return out;
}

/** Werte wieder einsetzen; nur wo Anzahl und Art der Felder noch passen. */
export function restoreForms(root, forms) {
  if (!root || !forms) return;
  // Labore: über ihre Block-ID (der Schlüssel entsteht erst beim Aufbau, der kann noch laufen).
  root.querySelectorAll('.ds-lab[data-block]').forEach((el) => {
    const bid = el.closest('[data-bid]')?.dataset.bid;
    const key = el.dataset.labKey ? `lab:${el.dataset.labKey}` : bid ? Object.keys(forms).find((k) => k.startsWith('lab:') && k.endsWith(`:${bid}`)) : null;
    const st = key ? forms[key] : null;
    if (!st || typeof st !== 'object') return;
    if (el._lab) el._lab.setState(st);
    else el._labPending = st;
  });
  root.querySelectorAll('form.ds-quiz-slot').forEach((slot) => {
    const values = forms[slot.dataset.module];
    const controls = [...slot.querySelectorAll(CONTROLS)];
    if (!Array.isArray(values) || values.length !== controls.length) return;
    controls.forEach((c, i) => {
      const v = values[i];
      if (v === null) return;
      if (c.type === 'checkbox' || c.type === 'radio') {
        if (c.checked !== !!v) { c.checked = !!v; c.dispatchEvent(new Event('change', { bubbles: true })); }
      } else if (c.value !== v) {
        c.value = v;
        c.dispatchEvent(new Event('input', { bubbles: true }));
        c.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });
}
