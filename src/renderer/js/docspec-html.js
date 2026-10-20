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
 */

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
  if (width > 0) block.width = `${Math.round(width)}px`;
  const cls = img.getAttribute('class') || '';
  if (/\bws-float-left\b/.test(cls)) block.float = 'left';
  else if (/\bws-float-right\b/.test(cls)) block.float = 'right';
  else if (/\bws-img-center\b/.test(cls)) block.float = 'center';
  if (/\bws-img-border\b/.test(cls)) block.border = true;
  const alt = img.getAttribute('alt');
  if (alt && alt !== 'Zeichnung') block.alt = alt;
  return block;
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
    const text = cleanText(inline(td, lost, warnings));
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
    if (/^H[1-6]$/.test(tag)) {
      const level = Math.min(3, Math.max(1, Number(tag[1]) - 1));
      const text = cleanText(inline(el, [], warnings));
      if (text) out.push({ type: 'heading', level, text });
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
      if (inner.length) out.push({ type: 'box', blocks: inner });
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
