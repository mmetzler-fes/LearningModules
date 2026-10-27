// ==================== ABSATZ … (DIALOG) ====================
//
// Wie „Absatz“ in LibreOffice, abgespeckt: Ausrichtung, Einzug links und
// erste Zeile, Abstand vor und nach, Zeilenabstand. Wirkt mit OK auf den
// Absatz (P) bzw. die Liste (UL/OL) der Schreibmarke; docspec-html.js liest
// die data-Attribute zurück (indent, firstLine, spaceBefore, spaceAfter,
// lineHeight, align).

const LINE_HEIGHTS = [[1, 'Einfach'], [1.15, '1,15'], [1.5, '1,5'], [2, 'Doppelt']];
const ALIGNS = [['left', 'Links'], ['center', 'Zentriert'], ['right', 'Rechts'], ['justify', 'Blocksatz']];

const fmt = (v) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? '' : String(v).replace('.', ','));
const parse = (t) => {
  const s = String(t).trim().replace(',', '.').replace(/\s*cm$/i, '');
  if (!s) return '';
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};

/** Absatz-Einstellungen an `el` setzen (data-Attribute und sichtbare Wirkung). */
export function applyParagraph(el, { align, indent, firstLine, spaceBefore, spaceAfter, lineHeight }) {
  const isList = el.tagName === 'UL' || el.tagName === 'OL';
  const set = (key, css, value, unit = 'cm') => {
    if (value === '' || value === null || value === undefined || (key === 'indent' && !value) || (key === 'first' && !value)) {
      delete el.dataset[key];
      if (css) el.style.removeProperty(css);
    } else {
      el.dataset[key] = String(value);
      if (css) el.style.setProperty(css, `${value}${unit}`);
    }
  };
  if (!isList) {
    set('indent', 'margin-left', indent);
    set('first', 'text-indent', firstLine);
    if (align && align !== 'left') el.style.textAlign = align; else el.style.removeProperty('text-align');
  }
  set('sb', 'margin-top', spaceBefore);
  set('sa', 'margin-bottom', spaceAfter);
  if (lineHeight && lineHeight !== 1) { el.dataset.lh = String(lineHeight); el.style.lineHeight = String(Math.round(lineHeight * 140) / 100); } else {
    delete el.dataset.lh;
    el.style.removeProperty('line-height');
  }
  if (!el.getAttribute('style')) el.removeAttribute('style');
}

/** Dialog für den Absatz bzw. die Liste `el` (P, UL, OL); false, wenn es dafür keinen gibt. */
export function openParagraphDialog(el) {
  if (!el || !['P', 'UL', 'OL'].includes(el.tagName) || el.dataset.ds) return false;
  const isList = el.tagName !== 'P';
  const d = el.dataset;
  const curAlign = ['center', 'right', 'justify'].includes(el.style.textAlign) ? el.style.textAlign : 'left';
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  const field = (name, label, value, hint = '') => `<label>${label}<span class="ds-para-in"><input type="text" inputmode="decimal" name="${name}" value="${fmt(value)}" placeholder="0"> cm</span>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
  overlay.innerHTML = `<form class="import-modules-card ds-para-dialog" role="dialog" aria-modal="true">
      <h3>¶ ${isList ? 'Liste' : 'Absatz'}</h3>
      <div class="ds-para-grid">
        ${isList ? '' : `<label>Ausrichtung<select name="align">${ALIGNS.map(([v, l]) => `<option value="${v}" ${v === curAlign ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`}
        <label>Zeilenabstand<select name="lineHeight">${LINE_HEIGHTS.map(([v, l]) => `<option value="${v}" ${Number(d.lh || 1) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <fieldset><legend>Abstand</legend>
          ${field('spaceBefore', 'Vor', d.sb)}
          ${field('spaceAfter', 'Nach', d.sa)}
        </fieldset>
        ${isList ? '' : `<fieldset><legend>Einzug</legend>
          ${field('indent', 'Links', d.indent)}
          ${field('firstLine', 'Erste Zeile', d.first, 'negativ = hängend')}
        </fieldset>`}
      </div>
      <p class="hint ds-para-error" hidden>Bitte Zahlen in cm: Abstand 0–3, Einzug links 0–6, erste Zeile −3 bis 3.</p>
      <div class="confirm-actions">
        <button type="button" class="btn btn-secondary" data-reset>Zurücksetzen</button>
        <button type="button" class="btn btn-secondary" data-x>Abbrechen</button>
        <button type="submit" class="btn btn-primary">OK</button>
      </div>
    </form>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('form');
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-x]').addEventListener('click', close);
  overlay.querySelector('[data-reset]').addEventListener('click', () => {
    form.querySelectorAll('input').forEach((i) => { i.value = ''; });
    form.querySelectorAll('select').forEach((sel) => { sel.selectedIndex = 0; });
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    const v = {
      spaceBefore: parse(f.spaceBefore.value),
      spaceAfter: parse(f.spaceAfter.value),
      indent: isList ? '' : parse(f.indent.value),
      firstLine: isList ? '' : parse(f.firstLine.value),
      lineHeight: Number(f.lineHeight.value),
      align: isList ? null : f.align.value,
    };
    const ok = [v.spaceBefore, v.spaceAfter].every((x) => x === '' || (x !== null && x >= 0 && x <= 3))
      && (v.indent === '' || (v.indent !== null && v.indent >= 0 && v.indent <= 6))
      && (v.firstLine === '' || (v.firstLine !== null && v.firstLine >= -3 && v.firstLine <= 3));
    if (!ok) { overlay.querySelector('.ds-para-error').hidden = false; return; }
    applyParagraph(el, v);
    close();
  });
  form.querySelector('input, select')?.focus();
  return true;
}
