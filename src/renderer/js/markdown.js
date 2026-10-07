// Kleiner Markdown-Darsteller für die Hilfe (docs/*.md). Kann, was die
// Dokumente nutzen: Überschriften mit Anker, Absätze, Listen (auch
// verschachtelt), Tabellen, Codeblöcke, `Code`, **fett**, *kursiv*, Links.
// Alles wird zuerst maskiert – eingebettetes HTML erscheint als Text.

import { escapeHtml } from './utils.js';

/** Anker – wie slug() in src/help/help-docs.ts. */
export function slug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c])
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Inline-Formatierung. Verweise auf andere .md-Dateien werden Hilfe-Links (data-doc). */
function inline(text) {
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });
  s = escapeHtml(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
      const doc = /^(?:\.\/)?([a-z0-9-]+)\.md(?:#([\w-]+))?$/.exec(href);
      if (doc) return `<a href="#" data-doc="${doc[1]}"${doc[2] ? ` data-anchor="${doc[2]}"` : ''}>${label}</a>`;
      if (/^https?:\/\//.test(href)) return `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
      if (href.startsWith('#')) return `<a href="#" data-anchor="${href.slice(1)}">${label}</a>`;
      return label; // Pfade ins Projekt führen in der App ins Leere
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(„"])\*([^*\s][^*]*?)\*(?=[\s.,;:!?)“"-]|$)/g, '$1<em>$2</em>');
  return s.replace(/\uE000(\d+)\uE000/g, (_m, i) => codes[Number(i)]);
}

const LIST_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

/** Liste ab Zeile i; liefert [html, nächste Zeile]. */
function parseList(lines, i, indent) {
  const ordered = /\d/.test(LIST_RE.exec(lines[i])[2]);
  const items = [];
  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]);
    if (!m || m[1].length < indent) break;
    if (m[1].length > indent) {
      // tiefer eingerückt: Unterliste des letzten Punkts
      const [sub, next] = parseList(lines, i, m[1].length);
      if (items.length) items[items.length - 1].children += sub;
      i = next;
      continue;
    }
    const item = { text: m[3], children: '' };
    i++;
    // Fortsetzungszeilen (eingerückt, kein neuer Listenpunkt)
    while (i < lines.length && lines[i].trim() && !LIST_RE.test(lines[i]) && /^\s+/.test(lines[i])) {
      item.text += ' ' + lines[i].trim();
      i++;
    }
    items.push(item);
    // Leerzeile innerhalb der Liste überspringen, wenn es weitergeht
    if (i < lines.length && !lines[i].trim() && i + 1 < lines.length && LIST_RE.test(lines[i + 1])
      && LIST_RE.exec(lines[i + 1])[1].length >= indent) i++;
  }
  const tag = ordered ? 'ol' : 'ul';
  return [`<${tag}>${items.map((it) => `<li>${inline(it.text)}${it.children}</li>`).join('')}</${tag}>`, i];
}

function parseTable(rows) {
  const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  return `<div class="help-table-wrap"><table class="help-table"><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`
    + `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = /^\s*```/.exec(line);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre class="help-code"><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level} id="help-${slug(h[2])}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      out.push(parseTable(rows));
      continue;
    }

    if (LIST_RE.test(line)) {
      const [html, next] = parseList(lines, i, LIST_RE.exec(line)[1].length);
      out.push(html);
      i = next;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      continue;
    }

    // Absatz bis zur Leerzeile oder bis zu einem anderen Block
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s/.test(lines[i]) && !/^\s*```/.test(lines[i])
      && !LIST_RE.test(lines[i]) && !lines[i].trim().startsWith('|')) para.push(lines[i++].trim());
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    else i++;
  }
  return out.join('\n');
}

/**
 * Nur ein Abschnitt: von der Überschrift mit diesem Anker bis zur nächsten
 * Überschrift derselben oder einer höheren Ebene. Ohne Treffer null.
 */
export function sectionOf(md, anchor) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  let start = -1;
  let level = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) inFence = !inFence;
    const h = !inFence && /^(#{1,4})\s+(.*)$/.exec(lines[i]);
    if (!h) continue;
    if (start < 0 && slug(h[2]) === anchor) { start = i; level = h[1].length; continue; }
    if (start >= 0 && h[1].length <= level) return lines.slice(start, i).join('\n');
  }
  return start >= 0 ? lines.slice(start).join('\n') : null;
}
