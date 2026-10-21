/**
 * HTML → Dokument-Spec (Modultyp „Dokument“). Grundlage ist das HTML, das der
 * .odt-Import (src/core/interchange/odt/odt.ts) und der bisherige Typ
 * „Text / Arbeitsblatt“ liefern: Überschriften h2–h4, Absätze mit
 * Ausrichtung, fett/kursiv/…, Listen, Tabellen mit verbundenen Zellen,
 * Bilder mit Lage-Klassen (ws-float-*, ws-img-center, ws-img-border) und
 * Textrahmen (div.ws-box).
 *
 * Läuft im Browser (DOMParser). Auch die Umwandlung alter Module geschieht
 * hier – der Server hat keinen HTML-Parser.
 *
 * Für den visuellen Editor gibt es den Rückweg specToEditorHtml(): Blöcke,
 * die sich als Text bearbeiten lassen, werden HTML (Überschriften tragen
 * data-ds="section|task|subtask|heading"); Karo, Lösung, Formel, Code usw.
 * werden feste Bausteine (div.ds-widget mit dem Block als data-block).
 */
import { richText, renderDocSpecHtml } from './docspec.js';

const MARKUP_CHARS = /[\\*`[\]]/g;

/** Text so schreiben, dass er wörtlich bleibt (keine ungewollte Auszeichnung). */
export function escapeMarkup(text) {
  return String(text)
    .replace(MARKUP_CHARS, '\\$&')
    .replace(/\^\{/g, '\\^{')
    .replace(/~~/g, '\\~\\~')
    .replace(/\+\+/g, '\\+\\+')
    .replace(/_\{/g, '\\_{')
    // `n_S` wäre sonst ein Index – im HTML war es keiner.
    .replace(/(?<![0-9A-Za-zÄÖÜäöüß_\\])([A-Za-zΑ-Ωα-ω])_(?=[A-Za-z0-9ÄÖÜäöü])/g, '$1\\_');
}

/** Auszeichnung um Text legen; Leerraum am Rand bleibt außerhalb der Zeichen. */
function mark(inner, open, close = open) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  return m[2] ? `${m[1]}${open}${m[2]}${close}${m[3]}` : inner;
}

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'DIV', 'FIGURE', 'BLOCKQUOTE', 'PRE', 'HR']);

/** Inline-Inhalt eines Elements → Text mit Auszeichnung. Bilder sammelt `images`. */
function inline(node, images, warnings) {
  let out = '';
  for (const c of node.childNodes) {
    if (c.nodeType === 3) { out += escapeMarkup(c.nodeValue.replace(/\s*\n\s*/g, ' ')); continue; }
    if (c.nodeType !== 1) continue;
    const tag = c.tagName;
    if (tag === 'BR') { out += '\\\n'; continue; }
    if (tag === 'IMG') { images.push(c); continue; }
    if (BLOCK_TAGS.has(tag)) { out += inline(c, images, warnings); continue; }
    const inner = inline(c, images, warnings);
    if (tag === 'STRONG' || tag === 'B') {
      const only = c.childNodes.length === 1 && c.firstChild.nodeType === 1 && ['EM', 'I'].includes(c.firstChild.tagName);
      out += only ? mark(inline(c.firstChild, images, warnings), '***') : mark(inner, '**');
    } else if (tag === 'EM' || tag === 'I') out += mark(inner, '*');
    else if (tag === 'U') out += mark(inner, '++');
    else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') out += mark(inner, '~~');
    else if (tag === 'SUP') out += inner.trim() ? `^{${inner.trim()}}` : '';
    else if (tag === 'SUB') out += inner.trim() ? `_{${inner.trim()}}` : '';
    else if (tag === 'CODE') out += c.textContent ? `\`${c.textContent.replace(/`/g, "'")}\`` : '';
    else if (tag === 'A') {
      const href = c.getAttribute('href') || '';
      out += /^(https?:|mailto:)/i.test(href) && inner.trim() ? `[${inner.trim()}](${href})` : inner;
    } else out += inner;
  }
  return out;
}

function cleanText(text) {
  return text.replace(/[ \t]+\\\n/g, '\\\n').replace(/(\\\n)+$/g, '').replace(/^\s+|\s+$/g, '');
}

function imageBlock(img, warnings) {
  const src = img.getAttribute('src') || '';
  if (!/^(data:image\/(png|jpeg|gif|webp|svg\+xml);base64,|https:\/\/|\/api\/)/i.test(src)) {
    warnings.push('Ein Bild ohne gültige Quelle wurde weggelassen.');
    return null;
  }
  const block = { type: 'image', src };
  const width = Number(img.getAttribute('width'));
  // Aus dem Editor: ursprüngliche Breite (z. B. 9cm), solange sie nicht verändert wurde.
  const orig = img.getAttribute('data-width');
  if (orig && width > 0 && Math.round(cssPx(orig)) === Math.round(width)) block.width = orig;
  else if (width > 0) block.width = `${Math.round(width)}px`;
  else if (orig) block.width = orig;
  const cls = img.getAttribute('class') || '';
  if (/\bws-float-left\b/.test(cls)) block.float = 'left';
  else if (/\bws-float-right\b/.test(cls)) block.float = 'right';
  else if (/\bws-img-center\b/.test(cls)) block.float = 'center';
  if (/\bws-img-border\b/.test(cls)) block.border = true;
  const alt = img.getAttribute('alt');
  if (alt && alt !== 'Zeichnung') block.alt = alt;
  const caption = img.getAttribute('data-caption');
  if (caption) block.caption = caption;
  return block;
}

/** CSS-Länge in Pixel (96 dpi), wie der Browser sie für width nimmt. */
function cssPx(len) {
  const m = /^(\d+(?:\.\d+)?)(cm|mm|px|%)$/.exec(String(len || ''));
  if (!m) return 0;
  const v = parseFloat(m[1]);
  return m[2] === 'cm' ? v * 37.8 : m[2] === 'mm' ? v * 3.78 : m[2] === '%' ? (v / 100) * 624 : v;
}

function listBlock(el, images, warnings) {
  const items = [];
  for (const li of el.children) {
    if (li.tagName !== 'LI') continue;
    const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
    const clone = li.cloneNode(true);
    for (const n of [...clone.querySelectorAll('ul, ol')]) n.remove();
    const text = cleanText(inline(clone, images, warnings));
    const sub = nested.flatMap((n) => listBlock(n, images, warnings).items);
    items.push(sub.length ? { text, items: sub } : text);
  }
  const block = { type: 'list', items };
  if (el.tagName === 'OL') block.ordered = true;
  return block;
}

function tableBlock(el, warnings) {
  const lost = [];
  const cell = (td) => {
    // Führende Leerzeichen bleiben: Sie richten z. B. Programmausgaben aus.
    const text = cleanText(inline(td, lost, warnings)).replace(/^/, (/^ +/.exec(td.textContent) || [''])[0]);
    const cs = Number(td.getAttribute('colspan')) || 1;
    const rs = Number(td.getAttribute('rowspan')) || 1;
    return cs > 1 || rs > 1 ? { text, ...(cs > 1 ? { colspan: Math.min(cs, 20) } : {}), ...(rs > 1 ? { rowspan: Math.min(rs, 20) } : {}) } : text;
  };
  const rowsOf = (section) => [...(section?.children || [])].filter((r) => r.tagName === 'TR')
    .map((tr) => [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH').map(cell));
  const thead = [...el.children].find((c) => c.tagName === 'THEAD');
  const bodies = [...el.children].filter((c) => c.tagName === 'TBODY');
  const rows = bodies.length ? bodies.flatMap(rowsOf) : rowsOf(el);
  const header = thead ? rowsOf(thead)[0] : null;
  if (lost.length) warnings.push(`${lost.length} Bild${lost.length === 1 ? '' : 'er'} in Tabellenzellen weggelassen.`);
  const block = { type: 'table', rows: rows.length ? rows : [['']] };
  if (header) block.header = header;
  if (el.getAttribute('data-caption')) block.caption = el.getAttribute('data-caption');
  return block;
}

/** Blöcke aus den Kindern eines Elements. */
function blocksOf(parent, warnings) {
  const out = [];
  const pushText = (text, align) => {
    if (!text) return;
    const prev = out[out.length - 1];
    // Aufeinanderfolgende einfache Absätze werden ein Textblock (Leerzeile trennt).
    if (!align && prev && prev.type === 'text' && !prev.align && !prev._closed) prev.text += `\n\n${text}`;
    else out.push(align ? { type: 'text', align, text } : { type: 'text', text });
  };
  const close = () => { const prev = out[out.length - 1]; if (prev) prev._closed = true; };
  const spacer = () => {
    const prev = out[out.length - 1];
    if (prev && prev.type === 'spacer') prev.lines += 1;
    else out.push({ type: 'spacer', lines: 1 });
  };

  for (const el of parent.children) {
    const tag = el.tagName;
    const ds = el.getAttribute('data-ds');
    if (tag === 'DIV' && el.hasAttribute('data-block')) {
      try {
        out.push(JSON.parse(decodeURIComponent(el.getAttribute('data-block'))));
      } catch (_) {
        warnings.push('Ein Baustein ließ sich nicht lesen und fehlt.');
      }
    } else if (/^H[1-6]$/.test(tag)) {
      const level = Math.min(3, Math.max(1, Number(tag[1]) - 1));
      const text = cleanText(inline(el, [], warnings));
      if (!text) { /* leere Überschrift */ } else if (ds === 'section') out.push({ type: 'section', text });
      else if (ds === 'task' || ds === 'subtask') out.push({ type: ds, title: text });
      else out.push({ type: 'heading', level, text });
    } else if (tag === 'P' && ds === 'note') {
      const text = cleanText(inline(el, [], warnings)).replace(/^\*([\s\S]*)\*$/, '$1');
      if (text) out.push({ type: 'note', text });
    } else if (tag === 'P' || tag === 'FIGURE' || tag === 'BLOCKQUOTE') {
      const images = [];
      const text = cleanText(inline(el, images, warnings));
      const align = /text-align:\s*(center|right|justify)/.exec(el.getAttribute('style') || '')?.[1];
      for (const img of images) {
        const b = imageBlock(img, warnings);
        if (b) { close(); out.push(b); }
      }
      if (text) {
        if (images.length) close();
        pushText(text, align);
      } else if (!images.length) spacer();
    } else if (tag === 'UL' || tag === 'OL') {
      const images = [];
      out.push(listBlock(el, images, warnings));
      if (images.length) warnings.push(`${images.length} Bild${images.length === 1 ? '' : 'er'} in Listen weggelassen.`);
    } else if (tag === 'TABLE') out.push(tableBlock(el, warnings));
    else if (tag === 'DIV' && /\bws-box\b/.test(el.getAttribute('class') || '')) {
      const inner = blocksOf(el, warnings);
      const box = { type: 'box' };
      if (el.getAttribute('data-title')) box.title = el.getAttribute('data-title');
      if (el.getAttribute('data-shaded') === '1') box.shaded = true;
      if (inner.length || box.title) out.push({ ...box, blocks: inner });
    } else if (tag === 'IMG') {
      const b = imageBlock(el, warnings);
      if (b) out.push(b);
    } else if (tag === 'PRE') out.push({ type: 'code', code: el.textContent.replace(/\n$/, '') });
    else if (tag === 'HR') out.push({ type: 'spacer', lines: 1 });
    else if (el.children.length) out.push(...blocksOf(el, warnings));
    else pushText(cleanText(inline(el, [], warnings)));
    if (out.length && out[out.length - 1].type !== 'text') close();
  }
  // Leerraum am Anfang und Ende ist im Dokument bedeutungslos.
  while (out[0]?.type === 'spacer') out.shift();
  while (out[out.length - 1]?.type === 'spacer') out.pop();
  for (const b of out) delete b._closed;
  return out;
}

/** HTML-Text → { spec, warnings } */
export function htmlToDocSpec(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const warnings = [];
  const content = blocksOf(doc.body, warnings);
  return { spec: { content }, warnings: [...new Set(warnings)] };
}

// ==================== Spec → Editor ====================

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Baustein, der im Editor nicht als Text bearbeitet wird (Doppelklick öffnet ihn). */
export function widgetHtml(block) {
  const preview = renderDocSpecHtml({ content: [block] }, { showSolutions: true, showPageBreaks: true });
  const label = { karo: 'Karo', solution: 'Lösung', formula: 'Formel', code: 'Code', spacer: 'Platz', pagebreak: 'Seitenumbruch' }[block?.type] || block?.type || 'Baustein';
  return `<div class="ds-widget" contenteditable="false" data-block="${encodeURIComponent(JSON.stringify(block))}" title="${esc(label)} – Doppelklick zum Bearbeiten"><span class="ds-widget-label">${esc(label)}</span>${preview}</div>`;
}

function paragraphsHtml(text, align) {
  const style = align && align !== 'left' ? ` style="text-align:${align}"` : '';
  return String(text).split('\n\n').map((p) => `<p${style}>${richText(p.trim()) || '<br>'}</p>`).join('');
}

function listItemsHtml(items, ordered) {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${(items || []).map((it) => (typeof it === 'object' && it
    ? `<li>${richText(it.text ?? '')}${Array.isArray(it.items) ? listItemsHtml(it.items, ordered) : ''}</li>`
    : `<li>${richText(it)}</li>`)).join('')}</${tag}>`;
}

function cellsHtml(tag, row) {
  return row.map((c) => {
    if (c && typeof c === 'object') {
      const span = (n, v) => (Number.isInteger(v) && v > 1 ? ` ${n}="${v}"` : '');
      return `<${tag}${span('colspan', c.colspan)}${span('rowspan', c.rowspan)}>${richText(c.text ?? '')}</${tag}>`;
    }
    return `<${tag}>${richText(c ?? '')}</${tag}>`;
  }).join('');
}

/** Spec → HTML für den visuellen Editor (Rückweg: htmlToDocSpec). */
export function specToEditorHtml(spec) {
  const blocks = (list) => (list || []).map((b) => {
    if (typeof b === 'string' || typeof b === 'number') return paragraphsHtml(b);
    if (!b || typeof b !== 'object') return '';
    switch (b.type || 'text') {
      case 'section':
        return `<h2 data-ds="section">${richText(b.title ?? b.text ?? '')}</h2>${b.title !== undefined && b.text ? paragraphsHtml(b.text) : ''}${blocks(b.blocks)}`;
      case 'task':
      case 'subtask': {
        const tag = b.type === 'task' ? 'h3' : 'h4';
        return `<${tag} data-ds="${b.type}">${richText(b.title ?? b.text ?? '')}</${tag}>${b.title !== undefined && b.text ? paragraphsHtml(b.text) : ''}${blocks(b.blocks)}`;
      }
      case 'heading': {
        const level = [1, 2, 3].includes(b.level) ? b.level + 1 : 2;
        return `<h${level} data-ds="heading">${richText(b.text ?? b.title ?? '')}</h${level}>`;
      }
      case 'text':
        return paragraphsHtml(b.text ?? '', b.align);
      case 'note':
        return `<p data-ds="note"><em>${richText(b.text ?? '')}</em></p>`;
      case 'list':
        return listItemsHtml(b.items, b.ordered);
      case 'table':
        return `<table${b.caption ? ` data-caption="${esc(b.caption)}"` : ''}>${Array.isArray(b.header) ? `<thead><tr>${cellsHtml('th', b.header)}</tr></thead>` : ''}<tbody>${(b.rows || []).filter(Array.isArray).map((r) => `<tr>${cellsHtml('td', r)}</tr>`).join('')}</tbody></table>`;
      case 'image': {
        if (typeof b.src !== 'string') return widgetHtml(b);
        const cls = [b.float === 'left' ? 'ws-float-left' : b.float === 'right' ? 'ws-float-right' : b.float === 'center' ? 'ws-img-center' : '', b.border ? 'ws-img-border' : ''].filter(Boolean).join(' ');
        const px = cssPx(b.width);
        return `<p><img src="${esc(b.src)}"${cls ? ` class="${cls}"` : ''}${px ? ` width="${Math.round(px)}" data-width="${esc(b.width)}"` : ''}${b.alt ? ` alt="${esc(b.alt)}"` : ''}${b.caption ? ` data-caption="${esc(b.caption)}"` : ''}></p>`;
      }
      case 'box':
        return `<div class="ws-box"${b.title ? ` data-title="${esc(b.title)}"` : ''}${b.shaded ? ' data-shaded="1"' : ''}>${b.text ? paragraphsHtml(b.text) : ''}${blocks(b.blocks) || '<p><br></p>'}</div>`;
      default:
        return widgetHtml(b);
    }
  }).join('');
  return blocks(spec?.content) || '<p><br></p>';
}
