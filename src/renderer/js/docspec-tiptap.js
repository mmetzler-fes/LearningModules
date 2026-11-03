/**
 * Bearbeiten-Reiter des Dokument-Editors auf Tiptap (Freischaltung 'docEditorTiptap',
 * Plan lm-editor, Phase 9.4): Leiste und Menüs um die Fläche aus lm-editor/src/editor.
 * Der alte Editor bleibt daneben; Vorschau, Druck und Speichern laufen über denselben
 * Stand (die Spec). Dialoge kommen vom Gastgeber (docspec-editor.js).
 */
import { createPmEditor } from '../lm-editor/src/editor/pm-editor.js';
import { CODE_SIZES, FONT_SIZES } from '../lm-editor/src/doc/docspec.js';
import { htmlToDocSpec, specToEditorHtml } from '../lm-editor/src/doc/docspec-html.js';
import { showContextMenu } from '../lm-editor/src/util/dom.js';
import { openParagraphDialog } from './paragraph-dialog.js';

const COLOR_NAMES = { blau: '🟦 Blau', gruen: '🟩 Grün', orange: '🟧 Orange', lila: '🟪 Lila', grau: '⬜ Grau' };
const HL_NAMES = { gelb: '🟨 Gelb', gruen: '🟩 Grün', blau: '🟦 Blau', rosa: '🩷 Rosa' };
const MARKS = [['bold', '<b>F</b>', 'Fett (Strg+B)'], ['italic', '<i>K</i>', 'Kursiv (Strg+I)'], ['underline', '<u>U</u>', 'Unterstrichen (Strg+U)'],
  ['strike', '<s>D</s>', 'Durchgestrichen'], ['superscript', 'x²', 'Hochgestellt'], ['subscript', 'x₂', 'Tiefgestellt'], ['code', '&lt;/&gt;', 'Code im Text']];
const MARKERS = [['', '• Punkt'], ['dash', '– Strich'], ['arrow', '➤ Pfeil'], ['square', '■ Quadrat'], ['check', '☐ Checkliste']];
const NUMBERINGS = [['', '1. 2. 3.'], ['a', 'a) b) c)'], ['i', 'i. ii. iii.']];
const KINDS = `<option value="p">Text</option>
  <optgroup label="Mit Nummer"><option value="section">§ Abschnitt (1.)</option><option value="task">Aufgabe (1.1)</option><option value="subtask">Teilaufgabe (1.1.1)</option></optgroup>
  <optgroup label="Ohne Nummer"><option value="heading">Überschrift 1</option><option value="heading2">Überschrift 2</option><option value="heading3">Überschrift 3</option></optgroup>
  <optgroup label="Liste"><option value="ul">• Aufzählung</option><option value="ol">1. Nummerierung</option></optgroup>
  <option value="note">Hinweis</option>`;

/**
 * In `box` öffnen. `host`: { spec, onChange(spec), editBlock(block, apply), insertEntries(pm),
 * fullWidthCm(), status(text) }. Liefert die Fläche (createPmEditor) samt `el`.
 */
export function mountTiptapSurface(box, host) {
  box.innerHTML = `
    <div class="ds-vtoolbar rich-text-toolbar ds-pm-toolbar">
      <button type="button" class="rt-btn ds-pm-plus" title="Einfügen: Quiz, Schreibfeld, Lösung, Formel, Bild …">➕</button>
      <select class="ds-vblock" title="Absatzart">${KINDS}</select>
      ${MARKS.map(([m, label, title]) => `<button type="button" class="rt-btn" data-mark="${m}" title="${title}">${label}</button>`).join('')}
      <span class="ds-tb-sep"></span>
      <button type="button" class="rt-btn" data-dd="size" title="Schriftgröße"><span class="ds-dd-size">pt</span><span class="ds-dd-caret">▾</span></button>
      <button type="button" class="rt-btn" data-dd="color" title="Textfarbe"><span class="ds-dd-a">A</span><span class="ds-dd-caret">▾</span></button>
      <button type="button" class="rt-btn" data-dd="hl" title="Hervorheben">🖍<span class="ds-dd-caret">▾</span></button>
      <button type="button" class="rt-btn" data-dd="ul" title="Aufzählung: Punkt, Strich, Pfeil, Quadrat, Checkliste">•≡<span class="ds-dd-caret">▾</span></button>
      <button type="button" class="rt-btn" data-dd="ol" title="Nummerierung: 1. / a) / i.">1≡<span class="ds-dd-caret">▾</span></button>
      <span class="ds-tb-sep"></span>
      <button type="button" class="rt-btn" data-do="link" title="Link">🔗</button>
      <button type="button" class="rt-btn" data-do="clear" title="Formatierung löschen">T̸</button>
      <button type="button" class="rt-btn" data-do="para" title="Absatz: Abstand vor/nach, Einzug, Zeilenabstand, Ausrichtung">¶ Absatz …</button>
      <button type="button" class="rt-btn" data-dd="table" title="Zeile, Spalte, Zelle, Tabelle" hidden>▤ Tabelle<span class="ds-dd-caret">▾</span></button>
      <span class="ds-tb-sep"></span>
      <button type="button" class="rt-btn" data-do="undo" title="Rückgängig (Strg+Z)">↶</button>
      <button type="button" class="rt-btn" data-do="redo" title="Wiederholen (Strg+Y)">↷</button>
    </div>
    <div class="ds-surface ds-pm-surface worksheet-content"></div>
    <p class="hint">Neuer Editor (Tiptap). ➕ oder Rechtsklick fügt ein. Bausteine (grau) anklicken zum Verschieben, Doppelklick zum Bearbeiten; Strg+Z macht auch das rückgängig.</p>`;
  const toolbar = box.querySelector('.ds-pm-toolbar');
  const select = toolbar.querySelector('.ds-vblock');
  const refresh = () => {
    select.value = pm.blockKind();
    toolbar.querySelectorAll('[data-mark]').forEach((b) => b.classList.toggle('active', pm.isActive(b.dataset.mark)));
    toolbar.querySelector('[data-dd="table"]').hidden = !pm.inTable();
  };
  const el = box.querySelector('.ds-pm-surface');
  const pm = createPmEditor(el, host.spec, {
    onChange: (spec) => { refresh(); host.onChange(spec); },
    onSelection: () => refresh(),
    editBlock: host.editBlock,
    fullWidthCm: host.fullWidthCm,
    onWarnings: (list) => host.status(`⚠️ ${list.join(' · ')}`),
  });
  pm.el = el;

  const tableMenu = () => [
    { label: '⬆ Zeile darüber', onClick: () => pm.table.addRowBefore() },
    { label: '⬇ Zeile darunter', onClick: () => pm.table.addRowAfter() },
    { label: '⬅ Spalte links', onClick: () => pm.table.addColumnBefore() },
    { label: '➡ Spalte rechts', onClick: () => pm.table.addColumnAfter() }, '-',
    { label: '⊞ Zellen verbinden', onClick: () => pm.table.mergeCells() },
    { label: '⊟ Zelle teilen', onClick: () => pm.table.splitCell() }, '-',
    { label: '✕ Zeile löschen', onClick: () => pm.table.deleteRow() },
    { label: '✕ Spalte löschen', onClick: () => pm.table.deleteColumn() },
    { label: '🗑 Tabelle löschen', onClick: () => pm.table.deleteTable() },
  ];
  const menus = {
    size: () => [{ label: 'Standard (wie die Vorlage)', onClick: () => pm.setSize(0) }, '-',
      ...FONT_SIZES.map((pt) => ({ label: `${pt} pt`, onClick: () => pm.setSize(pt) }))],
    color: () => [...Object.entries(COLOR_NAMES).map(([k, label]) => ({ label, onClick: () => pm.setColor(k) })),
      '-', { label: '✕ Automatisch (schwarz)', onClick: () => pm.setColor(null) }],
    hl: () => [...Object.entries(HL_NAMES).map(([k, label]) => ({ label, onClick: () => pm.setHighlight(k) })),
      '-', { label: '✕ Keine', onClick: () => pm.setHighlight(null) }],
    table: tableMenu,
    ul: () => MARKERS.map(([k, label]) => ({ label, onClick: () => listKind('bulletList', 'marker', k) })),
    ol: () => NUMBERINGS.map(([k, label]) => ({ label, onClick: () => listKind('orderedList', 'numbering', k) })),
  };
  /** Liste anlegen, falls die Auswahl in keiner steht, dann ihre Art setzen. */
  const listKind = (type, field, value) => {
    if (!pm.enclosing(type)) pm.setBlockKind(type === 'bulletList' ? 'ul' : 'ol');
    const list = pm.enclosing(type);
    if (list) pm.updateAttrsAt(list.pos, { [field]: value || null });
  };
  /** Was Kasten und Code über den Text hinaus haben: Titel und Rahmenfarbe, Beschriftung und Größe. */
  const fieldEntries = () => {
    const box = pm.enclosing('box');
    const code = pm.enclosing('codeBlock');
    const ask = (at, field, label) => () => {
      const value = window.prompt(label, at.node.attrs[field] ?? '');
      if (value !== null) pm.updateAttrsAt(at.pos, { [field]: value.trim() || null });
    };
    return [
      ...(box ? [{ label: '▢ Titel des Kastens …', onClick: ask(box, 'title', 'Titel des Kastens') },
        { label: box.node.attrs.shaded ? '▢ Kasten ohne Hintergrund' : '▢ Kasten mit Hintergrund', onClick: () => pm.updateAttrsAt(box.pos, { shaded: box.node.attrs.shaded ? null : true }) }] : []),
      ...(code ? [{ label: '⌨ Beschriftung des Codes …', onClick: ask(code, 'caption', 'Beschriftung, z. B. datei.ino') },
        { label: '⌨ Schriftgröße des Codes', onClick: () => {
          const value = Number(window.prompt(`Schriftgröße in pt (${CODE_SIZES.join(', ')}; leer: Standard)`, code.node.attrs.size ?? ''));
          pm.updateAttrsAt(code.pos, { size: CODE_SIZES.includes(value) ? value : null });
        } }] : []),
    ];
  };

  /** ¶-Dialog aus dem alten Editor: arbeitet auf einem Element, das danach wieder zu Feldern wird. */
  const paragraphDialog = () => {
    const at = pm.paragraphAttrs();
    if (!at) { host.status('¶ gilt für Absätze und Listen.'); return; }
    const isList = at.node.type.name !== 'paragraph';
    const { id, joined, extra, ...fields } = at.node.attrs;
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null));
    const block = isList ? { type: 'list', ordered: at.node.type.name === 'orderedList', items: ['x'], ...clean } : { type: 'text', text: 'x', ...clean };
    const tmp = document.createElement('div');
    tmp.innerHTML = specToEditorHtml({ content: [block] });
    const target = tmp.firstElementChild;
    const watch = new MutationObserver(() => {
      watch.disconnect();
      const next = htmlToDocSpec(tmp.innerHTML).spec.content[0] || {};
      const attrs = Object.fromEntries(Object.keys(clean).map((k) => [k, null]));
      for (const k of ['align', 'indent', 'firstLine', 'spaceBefore', 'spaceAfter', 'lineHeight']) if (next[k] !== undefined) attrs[k] = next[k];
      for (const k of ['align', 'indent', 'firstLine', 'spaceBefore', 'spaceAfter', 'lineHeight']) if (next[k] === undefined) attrs[k] = null;
      pm.updateAttrsAt(at.pos, attrs);
    });
    watch.observe(target, { attributes: true });
    openParagraphDialog(target);
  };
  const actions = {
    undo: () => pm.undo(),
    redo: () => pm.redo(),
    clear: () => pm.clearMarks(),
    para: paragraphDialog,
    link: () => {
      const href = window.prompt('Adresse des Links (leer: Link entfernen)', pm.linkHref() || 'https://');
      if (href !== null) pm.setLink(href.trim() && href.trim() !== 'https://' ? href.trim() : null);
    },
  };

  toolbar.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  select.addEventListener('change', () => pm.setBlockKind(select.value));
  toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mark) { pm.toggleMark(b.dataset.mark); refresh(); }
    else if (b.dataset.do) actions[b.dataset.do]();
    else if (b.dataset.dd) {
      const r = b.getBoundingClientRect();
      showContextMenu(r.left, r.bottom + 4, menus[b.dataset.dd]());
    } else if (b.classList.contains('ds-pm-plus')) {
      const r = b.getBoundingClientRect();
      showContextMenu(r.left, r.bottom + 4, host.insertEntries(pm));
    }
  });
  el.addEventListener('contextmenu', (e) => {
    if (e.shiftKey) return; // Menü des Browsers
    e.preventDefault();
    const fields = fieldEntries();
    const entries = [...(pm.inTable() ? [...tableMenu(), '-'] : []), ...fields, ...(fields.length ? ['-'] : []), { label: '¶ Absatz …', onClick: paragraphDialog }, '-', ...host.insertEntries(pm)];
    showContextMenu(e.clientX, e.clientY, entries);
  });
  refresh();
  return pm;
}
