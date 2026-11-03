/**
 * Bearbeiten-Reiter des Dokument-Editors auf Tiptap (Freischaltung 'docEditorTiptap',
 * Plan lm-editor, Phase 9.4): Leiste und Menüs um die Fläche aus lm-editor/src/editor.
 * Der alte Editor bleibt daneben; Vorschau, Druck und Speichern laufen über denselben
 * Stand (die Spec). Dialoge kommen vom Gastgeber (docspec-editor.js).
 */
import { createPmEditor } from '../lm-editor/src/editor/pm-editor.js';
import { CODE_SIZES, FONT_SIZES } from '../lm-editor/src/doc/docspec.js';
import { groupRow, ungroup } from '../lm-editor/src/doc/image-group.js';
import { htmlToDocSpec, specToEditorHtml } from '../lm-editor/src/doc/docspec-html.js';
import { showContextMenu } from '../lm-editor/src/util/dom.js';
import { openParagraphDialog } from './paragraph-dialog.js';
import { escapeAttr } from './utils.js';

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

const asImg = (block) => Object.assign(new Image(), { src: block.src, alt: block.alt || '' });
const copyImage = async (block) => {
  const tools = window.appImageClipboard;
  if (tools) tools.tell(await tools.copy(asImg(block)));
};
const saveImage = async (block) => {
  const tools = window.appImageClipboard;
  if (tools) tools.tell(await tools.save(asImg(block)));
};

const IMAGE_PLACES = [['', 'wie der Text der Vorlage'], ['float:left', 'neben dem Text, links'], ['float:right', 'neben dem Text, rechts'], ['align:center', 'eigene Zeile, mittig'], ['align:right', 'eigene Zeile, rechts']];

/** Dialog für ein Bild: Breite, Lage, Rahmen, Beschriftung; ersetzen, kopieren, speichern. `done(next | null)`. */
export function openImageDialog(block, { apply, remove }) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  const place = block.float ? `float:${block.float}` : block.align ? `align:${block.align}` : '';
  const cm = /^(\d+(?:\.\d+)?)cm$/.exec(String(block.width ?? ''))?.[1] ?? '';
  overlay.innerHTML = `<form class="import-modules-card ds-para-dialog" role="dialog" aria-modal="true">
      <h3>🖼 Bild</h3>
      <div class="ds-pm-image-preview"></div>
      <div class="ds-para-grid">
        <label>Breite<span class="ds-para-in"><input name="width" inputmode="decimal" value="${String(cm).replace('.', ',')}" placeholder="${escapeAttr(cm ? '' : String(block.width ?? 'wie das Bild'))}"> cm</span></label>
        <label>Lage<select name="place">${IMAGE_PLACES.map(([v, l]) => `<option value="${v}" ${v === place ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="ws-image-check"><input type="checkbox" name="border" ${block.border ? 'checked' : ''}> Rahmen</label>
        <label>Unterschrift<input name="caption" value="${escapeAttr(block.caption ?? '')}"></label>
        <label>Beschreibung (Screenreader)<input name="alt" maxlength="200" value="${escapeAttr(block.alt ?? '')}"></label>
      </div>
      <p class="hint">16,5 cm heißt „ganze Breite“: Im Querformat füllt das Bild die Zeile.</p>
      <p class="hint ds-para-error" hidden>Breite bitte als Zahl in cm, 0,5 bis 25,5.</p>
      <div class="confirm-actions">
        <button type="button" class="btn btn-secondary" data-a="copy" title="Für LibreOffice Draw, Word, OneNote">📋 Kopieren</button>
        <button type="button" class="btn btn-secondary" data-a="save">⬇ Speichern</button>
        <button type="button" class="btn btn-secondary" data-a="replace">🔁 Ersetzen</button>
        <button type="button" class="btn btn-danger" data-a="del">Entfernen</button>
        <button type="button" class="btn btn-secondary" data-a="cancel">Abbrechen</button>
        <button type="submit" class="btn btn-primary">OK</button>
      </div></form>`;
  document.body.appendChild(overlay);
  let src = block.src;
  const preview = overlay.querySelector('.ds-pm-image-preview');
  const show = () => { preview.replaceChildren(Object.assign(new Image(), { src: src || '', alt: '' })); };
  show();
  const close = () => overlay.remove();
  overlay.addEventListener('click', async (e) => {
    const what = e.target.dataset?.a;
    if (what === 'cancel') close();
    else if (what === 'del') { remove(); close(); } else if (what === 'copy') await copyImage({ ...block, src });
    else if (what === 'save') await saveImage({ ...block, src });
    else if (what === 'replace') {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
      input.onchange = async () => {
        const file = input.files?.[0];
        const stored = file && await window.appImageStore?.(file);
        if (stored?.src) { src = stored.src; show(); }
      };
      input.click();
    }
  });
  overlay.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const { width, float, align, border, caption, alt, ...rest } = block;
    const next = { ...rest, src };
    const typed = f.width.value.trim().replace(',', '.');
    if (typed) {
      const n = Number(typed);
      if (!(n >= 0.5 && n <= 25.5)) { overlay.querySelector('.ds-para-error').hidden = false; return; }
      next.width = `${n}cm`;
    } else if (width && !cm) next.width = width; // z. B. 172px bleibt, solange niemand etwas einträgt
    const [field, value] = f.place.value.split(':');
    if (field) next[field] = value;
    if (f.border.checked) next.border = true;
    if (f.caption.value.trim()) next.caption = f.caption.value.trim();
    if (f.alt.value.trim()) next.alt = f.alt.value.trim();
    apply(next);
    close();
  });
}

/**
 * In `box` öffnen. `host`: { spec, onChange(spec), editBlock(block, apply), insertEntries(pm),
 * fullWidthCm(), status(text), tableProps(td), imageFromFile(file) }. Liefert die Fläche (createPmEditor) samt `el`.
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
      <button type="button" class="rt-btn" data-dd="align" title="Ausrichtung">≡<span class="ds-dd-caret">▾</span></button>
      <button type="button" class="rt-btn" data-dd="lh" title="Zeilenabstand">↕≡<span class="ds-dd-caret">▾</span></button>
      <button type="button" class="rt-btn" data-dd="ul" title="Aufzählung: Punkt, Strich, Pfeil, Quadrat, Checkliste">•≡<span class="ds-dd-caret">▾</span></button>
      <button type="button" class="rt-btn" data-dd="ol" title="Nummerierung: 1. / a) / i.">1≡<span class="ds-dd-caret">▾</span></button>
      <button type="button" class="rt-btn" data-do="outdent" title="Einzug verkleinern">⇤|</button>
      <button type="button" class="rt-btn" data-do="indent" title="Einzug vergrößern">|⇥</button>
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
    imageFromFile: (file) => host.imageFromFile(file),
  });
  pm.el = el;

  /**
   * ⚙-Dialog des alten Editors: arbeitet auf einer Kopie der Tabelle im Dokument (unsichtbar);
   * was er ändert, kommt über die Spec zurück. So gibt es Eigenschaften und Lesen nur einmal.
   */
  const tableDialog = () => {
    const at = pm.tableAt();
    if (!at) return;
    const holder = document.createElement('div');
    holder.hidden = true;
    holder.innerHTML = specToEditorHtml({ content: [pm.blockAt(at.pos)] });
    document.body.appendChild(holder);
    const table = holder.querySelector('table');
    const row = table.rows[at.row] || table.rows[0];
    const cell = row?.cells[at.col] || row?.cells[0];
    let timer = null;
    const watch = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        watch.disconnect();
        const next = htmlToDocSpec(holder.innerHTML).spec.content;
        holder.remove();
        if (next.length) pm.replaceAt(at.pos, next);
      }, 0);
    });
    watch.observe(holder, { attributes: true, childList: true, subtree: true });
    host.tableProps(cell);
    // Abgebrochen: Es kam keine Änderung, der Dialog ist zu – dann wird die Kopie nicht mehr gebraucht.
    const overlay = [...document.querySelectorAll('.confirm-overlay')].pop();
    new MutationObserver((_m, self) => {
      if (overlay?.isConnected) return;
      self.disconnect();
      setTimeout(() => { if (!timer) { watch.disconnect(); holder.remove(); } }, 50);
    }).observe(document.body, { childList: true });
  };
  const tableMenu = () => {
    const at = pm.tableAt();
    return [
      { label: '⚙ Tabelleneigenschaften …', onClick: tableDialog }, '-',
      { label: '⬆ Zeile darüber', onClick: () => pm.table.addRowBefore() },
      { label: '⬇ Zeile darunter', onClick: () => pm.table.addRowAfter() },
      { label: '⬅ Spalte links', onClick: () => pm.table.addColumnBefore() },
      { label: '➡ Spalte rechts', onClick: () => pm.table.addColumnAfter() }, '-',
      { label: '⊞ Zellen verbinden', onClick: () => pm.table.mergeCells() },
      { label: '⊟ Zelle teilen', onClick: () => pm.table.splitCell() }, '-',
      { label: '⇔ Spalten gleichmäßig verteilen', onClick: () => pm.distribute(at.pos, 'cols') },
      { label: '⇕ Zeilen ohne feste Höhe', onClick: () => pm.distribute(at.pos, 'rows') }, '-',
      { label: '⬚ Ganze Tabelle auswählen', onClick: () => pm.selectAt(at.pos) },
      { label: '↑ Tabelle nach oben', onClick: () => pm.move(-1) },
      { label: '↓ Tabelle nach unten', onClick: () => pm.move(1) },
      { label: '⧉ Tabelle verdoppeln', onClick: () => pm.duplicate() }, '-',
      { label: '✕ Zeile löschen', onClick: () => pm.table.deleteRow() },
      { label: '✕ Spalte löschen', onClick: () => pm.table.deleteColumn() },
      { label: '🗑 Tabelle löschen', onClick: () => pm.table.deleteTable() },
    ];
  };
  const menus = {
    size: () => [{ label: 'Standard (wie die Vorlage)', onClick: () => pm.setSize(0) }, '-',
      ...FONT_SIZES.map((pt) => ({ label: `${pt} pt`, onClick: () => pm.setSize(pt) }))],
    color: () => [...Object.entries(COLOR_NAMES).map(([k, label]) => ({ label, onClick: () => pm.setColor(k) })),
      '-', { label: '✕ Automatisch (schwarz)', onClick: () => pm.setColor(null) }],
    hl: () => [...Object.entries(HL_NAMES).map(([k, label]) => ({ label, onClick: () => pm.setHighlight(k) })),
      '-', { label: '✕ Keine', onClick: () => pm.setHighlight(null) }],
    table: tableMenu,
    align: () => [['left', '⇤ Linksbündig'], ['center', '↔ Zentriert'], ['right', '⇥ Rechtsbündig'], ['justify', '☰ Blocksatz']].map(([d, label]) => ({ label, onClick: () => pm.setAlign(d) })),
    lh: () => [[1, 'Einfach'], [1.15, '1,15'], [1.5, '1,5'], [2, 'Doppelt']].map(([v, label]) => ({ label, onClick: () => pm.setLineHeight(v) })),
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
    indent: () => pm.indent(1),
    outdent: () => pm.indent(-1),
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
  /** Bilder nebeneinander in einen Zeichenrahmen: Seitenverhältnisse erst messen. */
  const groupImages = async (run) => {
    const measure = (block) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ src: block.src, alt: block.alt, source: block.source, aspect: img.naturalWidth / (img.naturalHeight || 1) });
      img.onerror = () => resolve({ src: block.src, alt: block.alt, source: block.source });
      img.src = block.src;
    });
    const images = await Promise.all(run.images.map(measure));
    pm.replaceRange(run.from, run.to, [{ type: 'group', ...groupRow(images) }]);
  };
  /** Menüeinträge für den gewählten Baustein am Stück. */
  const atomEntries = () => {
    const sel = pm.selectedBlock();
    if (!sel) return [];
    const run = pm.imageRun();
    const image = sel.block.type === 'image';
    return [
      { label: '✏️ Bearbeiten', onClick: () => host.editBlock(sel.block, sel.apply) },
      ...(image ? [
        { label: '📋 Bild kopieren', onClick: () => copyImage(sel.block) },
        { label: '⬇ Bild speichern', onClick: () => saveImage(sel.block) },
      ] : []),
      ...(run ? [{ label: `⊞ Mit den folgenden Bildern gruppieren (${run.images.length})`, onClick: () => { void groupImages(run); } }] : []),
      ...(sel.block.type === 'group' ? [{ label: '⊟ Gruppierung lösen', onClick: () => sel.apply(ungroup(sel.block)) }] : []),
      '-',
    ];
  };
  el.addEventListener('contextmenu', (e) => {
    if (e.shiftKey) return; // Menü des Browsers
    e.preventDefault();
    const atom = e.target.closest?.('[data-pm-atom]');
    if (atom) pm.selectAt(pm.posOfDom(atom));
    else pm.placeAt(e.clientX, e.clientY);
    const fields = fieldEntries();
    const entries = [
      ...atomEntries(),
      ...(pm.inTable() ? [...tableMenu(), '-'] : []),
      ...fields, ...(fields.length ? ['-'] : []),
      ...(pm.paragraphAttrs() ? [{ label: '¶ Absatz …', onClick: paragraphDialog }] : []),
      { label: '↑ Nach oben', onClick: () => pm.move(-1) },
      { label: '↓ Nach unten', onClick: () => pm.move(1) },
      { label: '⧉ Verdoppeln', onClick: () => pm.duplicate() },
      '-', ...host.insertEntries(pm),
    ];
    showContextMenu(e.clientX, e.clientY, entries);
  });
  refresh();
  return pm;
}
