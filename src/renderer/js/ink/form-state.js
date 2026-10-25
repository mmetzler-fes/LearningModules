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
  return out;
}

/** Werte wieder einsetzen; nur wo Anzahl und Art der Felder noch passen. */
export function restoreForms(root, forms) {
  if (!root || !forms) return;
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
