import { showContextMenu } from '../lm-editor/src/util/dom.js';
import { TEXT_COLORS, HIGHLIGHTS, FONT_SIZES, BASE_FONT_PT } from '../lm-editor/src/doc/docspec.js';

// ==================== FORMATLEISTE (WIE IN GOOGLE DOCS) ====================
//
// Klappmenüs der Editorleiste: Schriftgröße, Textfarbe, Hervorhebung, Ausrichtung (mit
// Blocksatz), Zeilenabstand, Aufzählungs- und Nummerierungsart, dazu Einzug
// und „Formatierung löschen“. Alles ändert nur das HTML der Schreibfläche –
// docspec-html.js liest es zurück: Farben und Größen als [Text]{blau,hl-gelb,14pt}, Absätze
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

  /**
   * Liste in einer Tabellenzelle selbst bauen: Der Befehl des Browsers setzt
   * bei losem Text in der Zelle den Punkt vor die Tabelle. Jede Zeile der
   * Auswahl (Absatz oder Text bis zum Zeilenumbruch) wird ein Listenpunkt.
   */
  const cellList = (ordered) => {
    const sel = document.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const start = range.startContainer.nodeType === 3 ? range.startContainer.parentNode : range.startContainer;
    const td = start?.closest?.('td, th');
    if (!td || !surface.contains(td) || td.closest('table').classList.contains('ws-columns')) return null;
    const lines = [];
    let line = null;
    for (const n of [...td.childNodes]) {
      // Absatz – auch ein schlichtes <div>, wie es Enter in manchen Browsern setzt.
      if (n.nodeType === 1 && (/^(P|H[1-6])$/.test(n.tagName) || (n.tagName === 'DIV' && !n.attributes.length))) { lines.push({ nodes: [n], block: n }); line = null; continue; }
      if (n.nodeType === 1 && /^(UL|OL|TABLE|DIV|PRE)$/.test(n.tagName)) { lines.push({ nodes: [n], fixed: true }); line = null; continue; }
      if (!line) { line = { nodes: [] }; lines.push(line); }
      line.nodes.push(n);
      if (n.nodeType === 1 && n.tagName === 'BR') line = null;
    }
    const hit = (l) => !l.fixed && l.nodes.some((n) => range.intersectsNode(n)) && l.nodes.some((n) => n.textContent.trim() || n.nodeName === 'IMG');
    const chosen = lines.filter(hit);
    if (!chosen.length) return null;
    const list = document.createElement(ordered ? 'ol' : 'ul');
    chosen[0].nodes[0].before(list);
    for (const l of chosen) {
      const li = document.createElement('li');
      if (l.block) { li.append(...l.block.childNodes); l.block.remove(); } else {
        li.append(...l.nodes.filter((n) => n.nodeName !== 'BR'));
        l.nodes.filter((n) => n.nodeName === 'BR').forEach((n) => n.remove());
      }
      list.append(li);
    }
    // Leere Zeilen zwischen den gewählten fallen weg.
    for (const l of lines.slice(lines.indexOf(chosen[0]), lines.indexOf(chosen[chosen.length - 1]) + 1)) {
      if (!chosen.includes(l) && !l.fixed) l.nodes.forEach((n) => n.remove());
    }
    const last = list.lastElementChild;
    sel.collapse(last, last.childNodes.length);
    return list;
  };

  /**
   * Chrome legt die Liste in den Absatz (<p><ul>…</ul></p>) – ungültig, und ein
   * späteres Umwandeln nähme den ganzen Absatz mit. Die Liste kommt heraus;
   * Text davor und danach bleibt je ein eigener Absatz.
   */
  const unnest = (list) => {
    const p = list.parentElement;
    if (p?.tagName !== 'P' || !surface.contains(p)) return;
    const sel = document.getSelection();
    const { anchorNode, anchorOffset, focusNode, focusOffset } = sel;
    const rest = p.cloneNode(false);
    rest.removeAttribute('data-id');
    while (list.nextSibling) rest.appendChild(list.nextSibling);
    p.after(list);
    if (rest.textContent.trim() || rest.querySelector('img')) list.after(rest);
    if (!p.textContent.trim() && !p.querySelector('img')) p.remove();
    // Verschieben hebt die Auswahl auf – sie bleibt auf denselben Listenpunkten.
    if (anchorNode?.isConnected && focusNode?.isConnected) sel.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
  };

  /**
   * Listenpunkte der Auswahl wieder zu Absätzen (der Rest der Liste bleibt
   * davor bzw. danach eine Liste). Gibt die neuen Absätze zurück.
   */
  const unlist = () => {
    const sel = document.getSelection();
    const list = listOfSelection();
    if (!list || !sel.rangeCount) return [];
    const range = sel.getRangeAt(0);
    const items = [...list.children].filter((li) => li.tagName === 'LI');
    const hits = items.filter((li) => range.intersectsNode(li));
    if (!hits.length) return [];
    const from = items.indexOf(hits[0]);
    const to = items.indexOf(hits[hits.length - 1]);
    const after = list.cloneNode(false);
    after.removeAttribute('data-id');
    items.slice(to + 1).forEach((li) => after.append(li));
    const nodes = [];
    const paras = items.slice(from, to + 1).map((li) => {
      const p = document.createElement('p');
      // Unterpunkte bleiben eine Liste hinter dem Absatz.
      const sub = [...li.childNodes].filter((n) => n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName));
      p.append(...[...li.childNodes].filter((n) => !sub.includes(n)));
      if (!p.childNodes.length) p.innerHTML = '<br>';
      nodes.push(p, ...sub);
      li.remove();
      return p;
    });
    list.after(...nodes);
    if (after.children.length) nodes[nodes.length - 1].after(after);
    if (!list.children.length) list.remove();
    return paras;
  };

  const setList = (ordered, kind) => {
    let list = listOfSelection();
    if (!list) list = cellList(ordered);
    if (!list || (list.tagName === 'OL') !== ordered) {
      exec(ordered ? 'insertOrderedList' : 'insertUnorderedList');
      list = listOfSelection();
      if (list) unnest(list);
    }
    if (!list) return;
    const key = ordered ? 'numbering' : 'marker';
    if (kind) list.dataset[key] = kind; else delete list.dataset[key];
  };

  /**
   * Schriftgröße der Auswahl (pt aus FONT_SIZES, 0 = wie die Vorlage). Der Browser
   * kennt nur die alten Größen 1–7: Er setzt <font size="7">, das hier zur Spanne
   * mit data-size wird; innere Größen fallen dabei weg.
   */
  const setSize = (pt) => {
    const sel = document.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed || !surface.contains(sel.anchorNode)) return;
    try { document.execCommand('styleWithCSS', false, false); } catch (_) { /* älterer Browser */ }
    document.execCommand('fontSize', false, '7');
    const marks = [...surface.querySelectorAll('font[size="7"]')];
    let first = null;
    let last = null;
    for (const f of marks) {
      // Deckt die Auswahl eine schon gesetzte Größe ganz ab, wird diese geändert (bzw. entfernt).
      const host = f.parentElement?.closest('[data-size]');
      if (host && surface.contains(host) && host.textContent.trim() === f.textContent.trim()) {
        const nodes = [...f.childNodes];
        f.replaceWith(...nodes);
        if (pt) {
          host.dataset.size = String(pt);
          host.style.fontSize = `${Math.round((pt / BASE_FONT_PT) * 1000) / 1000}em`;
        } else {
          delete host.dataset.size;
          host.style.removeProperty('font-size');
          if (!host.dataset.color && !host.dataset.hl && !host.getAttribute('style')?.trim()) host.replaceWith(...host.childNodes);
        }
        first ||= nodes[0];
        last = nodes[nodes.length - 1] || last;
        continue;
      }
      f.querySelectorAll('[data-size], [style*="font-size"]').forEach((x) => {
        delete x.dataset.size;
        x.style.removeProperty('font-size');
        if (!x.getAttribute('style')) x.removeAttribute('style');
        if (x.tagName === 'SPAN' && !x.attributes.length) x.replaceWith(...x.childNodes);
      });
      const nodes = [...f.childNodes];
      if (pt) {
        const span = document.createElement('span');
        span.className = 'ds-color';
        span.dataset.size = String(pt);
        span.style.fontSize = `${Math.round((pt / BASE_FONT_PT) * 1000) / 1000}em`;
        span.append(...nodes);
        f.replaceWith(span);
        first ||= span;
        last = span;
      } else {
        f.replaceWith(...nodes);
        first ||= nodes[0];
        last = nodes[nodes.length - 1] || last;
      }
    }
    // Die Auswahl bleibt auf dem Text – so lässt sich gleich weiter ändern.
    if (first && last && first.isConnected && last.isConnected) {
      const r = document.createRange();
      r.setStartBefore(first);
      r.setEndAfter(last);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  };

  const align = (dir) => {
    if (dir !== 'justify' && tableTools.align(dir)) return;
    exec({ left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[dir]);
  };

  const menus = {
    size: () => [
      { label: 'Standard (wie die Vorlage)', onClick: () => setSize(0) }, '-',
      ...FONT_SIZES.map((pt) => ({ label: `${pt} pt`, onClick: () => setSize(pt) })),
    ],
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
  return {
    /** Aufzählung bzw. Nummerierung für die Auswahl – wie •≡ / 1≡ (auch in Tabellenzellen). */
    setList: (ordered) => setList(ordered, ''),
    /** Liste der Auswahl – oder null. */
    listOfSelection,
    unlist,
  };
}
