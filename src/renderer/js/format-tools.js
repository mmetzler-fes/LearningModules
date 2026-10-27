import { showContextMenu } from '../lm-editor/src/util/dom.js';
import { TEXT_COLORS, HIGHLIGHTS } from '../lm-editor/src/doc/docspec.js';

// ==================== FORMATLEISTE (WIE IN GOOGLE DOCS) ====================
//
// Klappmenüs der Editorleiste: Textfarbe, Hervorhebung, Ausrichtung (mit
// Blocksatz), Zeilenabstand, Aufzählungs- und Nummerierungsart, dazu Einzug
// und „Formatierung löschen“. Alles ändert nur das HTML der Schreibfläche –
// docspec-html.js liest es zurück: Farben als [Text]{blau,hl-gelb}, Absätze
// mit data-indent / data-lh, Listen mit data-marker / data-numbering.

const COLOR_NAMES = { blau: '🟦 Blau', gruen: '🟩 Grün', orange: '🟧 Orange', lila: '🟪 Lila', grau: '⬜ Grau' };
const HL_NAMES = { gelb: '🟨 Gelb', gruen: '🟩 Grün', blau: '🟦 Blau', rosa: '🩷 Rosa' };
const LINE_HEIGHTS = [[1, 'Einfach'], [1.15, '1,15'], [1.5, '1,5'], [2, 'Doppelt']];
const MARKERS = [['', '• Punkt'], ['dash', '– Strich'], ['arrow', '➤ Pfeil'], ['square', '■ Quadrat'], ['check', '☐ Checkliste']];
const NUMBERINGS = [['', '1. 2. 3.'], ['a', 'a) b) c)'], ['i', 'i. ii. iii.']];

/**
 * An die Leiste `toolbar` hängen. `currentBlock()`: Block der Schreibmarke
 * (Absatz, Liste …), `tableTools`: Ausrichtung in Tabellenzellen.
 */
export function attachFormatTools(toolbar, surface, { tableTools, currentBlock }) {
  const exec = (cmd, value = null) => {
    try { document.execCommand('styleWithCSS', false, true); } catch (_) { /* älterer Browser */ }
    document.execCommand(cmd, false, value);
  };
  const listOfSelection = () => {
    const node = document.getSelection()?.anchorNode;
    const el = node && surface.contains(node) ? (node.nodeType === 3 ? node.parentNode : node) : null;
    return el?.closest?.('ul, ol') || null;
  };
  /** Absatz der Schreibmarke (P) – oder null (Überschrift, Baustein …). */
  const paragraph = () => {
    const b = currentBlock();
    return b && b.tagName === 'P' && !b.dataset.ds ? b : null;
  };

  const setLineHeight = (lh) => {
    const target = listOfSelection() || paragraph();
    if (!target) return;
    if (lh === 1) { delete target.dataset.lh; target.style.removeProperty('line-height'); } else {
      target.dataset.lh = String(lh);
      target.style.lineHeight = String(Math.round(lh * 140) / 100);
    }
    if (!target.getAttribute('style')) target.removeAttribute('style');
  };

  const setIndent = (delta) => {
    // In Listen: Unterpunkte wie gewohnt.
    if (listOfSelection()) { exec(delta > 0 ? 'indent' : 'outdent'); return; }
    const p = paragraph();
    if (!p) return;
    const next = Math.max(0, Math.min(6, (Number(p.dataset.indent) || 0) + delta));
    if (next) { p.dataset.indent = String(next); p.style.marginLeft = `${next}cm`; } else {
      delete p.dataset.indent;
      p.style.removeProperty('margin-left');
    }
    if (!p.getAttribute('style')) p.removeAttribute('style');
  };

  const setList = (ordered, kind) => {
    let list = listOfSelection();
    if (!list || (list.tagName === 'OL') !== ordered) {
      exec(ordered ? 'insertOrderedList' : 'insertUnorderedList');
      list = listOfSelection();
    }
    if (!list) return;
    const key = ordered ? 'numbering' : 'marker';
    if (kind) list.dataset[key] = kind; else delete list.dataset[key];
  };

  const align = (dir) => {
    if (dir !== 'justify' && tableTools.align(dir)) return;
    exec({ left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[dir]);
  };

  const menus = {
    color: () => [
      ...Object.entries(COLOR_NAMES).map(([k, label]) => ({ label, onClick: () => exec('foreColor', TEXT_COLORS[k]) })),
      '-', { label: '✕ Automatisch (schwarz)', onClick: () => exec('foreColor', '#000000') },
    ],
    hl: () => [
      ...Object.entries(HL_NAMES).map(([k, label]) => ({ label, onClick: () => exec('hiliteColor', HIGHLIGHTS[k]) })),
      '-', { label: '✕ Keine', onClick: () => exec('hiliteColor', 'transparent') },
    ],
    align: () => [['left', '⇤ Linksbündig'], ['center', '↔ Zentriert'], ['right', '⇥ Rechtsbündig'], ['justify', '☰ Blocksatz']]
      .map(([d, label]) => ({ label, onClick: () => align(d) })),
    lh: () => LINE_HEIGHTS.map(([v, label]) => ({ label, onClick: () => setLineHeight(v) })),
    ul: () => MARKERS.map(([k, label]) => ({ label, onClick: () => setList(false, k) })),
    ol: () => NUMBERINGS.map(([k, label]) => ({ label, onClick: () => setList(true, k) })),
  };

  toolbar.querySelectorAll('[data-dd], [data-fmt]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // Auswahl in der Fläche behalten
    btn.addEventListener('click', () => {
      if (btn.dataset.fmt === 'indent') setIndent(1);
      else if (btn.dataset.fmt === 'outdent') setIndent(-1);
      else if (btn.dataset.fmt === 'clear') exec('removeFormat');
      else {
        const r = btn.getBoundingClientRect();
        showContextMenu(r.left, r.bottom + 4, menus[btn.dataset.dd]());
      }
    });
  });
}
