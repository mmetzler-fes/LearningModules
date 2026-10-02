import AdmZip from 'adm-zip';
import * as path from 'path';

/**
 * Wandelt ein Writer-Dokument (.odt) in HTML für das Modul
 * "Text / Arbeitsblatt".
 *
 * Bewusst ohne Fremdbibliothek, wie beim .ods-Leser: Eine .odt-Datei ist
 * ein ZIP mit content.xml und styles.xml, adm-zip liegt ohnehin bei.
 *
 * Übernommen werden Inhalt und Grundformatierung – Überschriften, Absätze,
 * fett/kursiv/unterstrichen, Listen, Tabellen, Bilder, Textrahmen. Das
 * Seitenlayout bleibt zurück: Ein einzelnes frei verankertes Bild wird vom
 * Text umflossen (links oder rechts wie im Dokument), Zeichnungen samt ihrer
 * Rahmen werden zu einem SVG-Bild. Grafiken in Fremdformaten (SVM, WMF, EMF)
 * gehen nur mit, wenn das Dokument ein PNG-Ersatzbild enthält. Was fehlt,
 * steht in `warnings`, damit niemand eine Lücke erst vor der Klasse bemerkt.
 */

// ---- Minimaler XML-Leser ----

interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: Array<XNode | string>;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? '';
  });

function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [] };
  const stack: XNode[] = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.children.push(m[1]);
    } else if (m[3]) {
      if (m[2] === '/') {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(m[4] || ''))) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
      const node: XNode = { name: m[3], attrs, children: [] };
      top.children.push(node);
      if (m[5] !== '/') stack.push(node);
    } else if (m[6] !== undefined) {
      top.children.push(decode(m[6]));
    }
  }
  return root;
}

const elements = (n: XNode) => n.children.filter((c): c is XNode => typeof c !== 'string');
const find = (n: XNode, name: string): XNode | undefined => {
  for (const c of elements(n)) {
    if (c.name === name) return c;
    const deep = find(c, name);
    if (deep) return deep;
  }
  return undefined;
};
const textOf = (n: XNode | string): string =>
  typeof n === 'string' ? n : n.children.map(textOf).join('');

// ---- Formatvorlagen ----

interface StyleInfo {
  parent?: string;
  displayName?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  position?: 'sub' | 'super';
  align?: 'left' | 'center' | 'right' | 'justify';
  listStyle?: string;
  // Zeichnungen
  stroke?: string;
  strokeColor?: string;
  strokeWidth?: string;
  fill?: string;
  fillColor?: string;
  markerStart?: string;
  markerEnd?: string;
  fontColor?: string;
  fontSize?: string;
  /** Bildfüllung: Name des draw:fill-image (siehe Styles.fillImage). */
  fillImage?: string;
  /** Rahmen eines Textrahmens, z. B. "0.06pt solid #000000". */
  border?: string;
  background?: string;
  textVAlign?: string;
  textHAlign?: string;
  padding?: string;
  /** Umfluss: none, left, right, parallel, dynamic, run-through … */
  wrap?: string;
}

/** Name, unter dem die Standardvorlage für Zeichnungen geführt wird. */
const DEFAULT_GRAPHIC = '#default-graphic';

class Styles {
  private readonly styles = new Map<string, StyleInfo>();
  /** Listenvorlage → je Ebene nummeriert (ol) oder mit Aufzählungszeichen (ul). */
  private readonly lists = new Map<string, Map<number, 'ol' | 'ul'>>();
  /** Bildfüllungen: Name → Pfad im Archiv (aus styles.xml). */
  private readonly fillImages = new Map<string, string>();

  read(root: XNode | undefined) {
    if (!root) return;
    const visit = (n: XNode) => {
      if (n.name === 'style:style') this.readStyle(n);
      else if (n.name === 'style:default-style' && n.attrs['style:family'] === 'graphic') {
        this.readStyle({ ...n, attrs: { ...n.attrs, 'style:name': DEFAULT_GRAPHIC } });
      }
      else if (n.name === 'text:list-style') this.readList(n);
      else if (n.name === 'draw:fill-image') {
        if (n.attrs['draw:name'] && n.attrs['xlink:href']) this.fillImages.set(n.attrs['draw:name'], n.attrs['xlink:href']);
      }
      else for (const c of elements(n)) visit(c);
    };
    visit(root);
  }

  private readStyle(n: XNode) {
    const name = n.attrs['style:name'];
    if (!name) return;
    const info: StyleInfo = {
      parent: n.attrs['style:parent-style-name'],
      displayName: n.attrs['style:display-name'] || name,
      listStyle: n.attrs['style:list-style-name'],
    };
    const tp = elements(n).find((c) => c.name === 'style:text-properties');
    if (tp) {
      const weight = tp.attrs['fo:font-weight'];
      if (weight) info.bold = weight === 'bold' || Number(weight) >= 600;
      const fstyle = tp.attrs['fo:font-style'];
      if (fstyle) info.italic = fstyle === 'italic' || fstyle === 'oblique';
      const ul = tp.attrs['style:text-underline-style'];
      if (ul) info.underline = ul !== 'none';
      const lt = tp.attrs['style:text-line-through-style'];
      if (lt) info.strike = lt !== 'none';
      const pos = tp.attrs['style:text-position'] || '';
      if (/^(super|\d)/.test(pos) && !/^0/.test(pos)) info.position = 'super';
      if (/^(sub|-)/.test(pos)) info.position = 'sub';
    }
    const gp = elements(n).find((c) => c.name === 'style:graphic-properties');
    if (gp) {
      const g = gp.attrs;
      if (g['draw:stroke']) info.stroke = g['draw:stroke'];
      if (g['svg:stroke-color']) info.strokeColor = g['svg:stroke-color'];
      if (g['svg:stroke-width']) info.strokeWidth = g['svg:stroke-width'];
      if (g['draw:fill']) info.fill = g['draw:fill'];
      if (g['draw:fill-color']) info.fillColor = g['draw:fill-color'];
      if (g['draw:marker-start'] !== undefined) info.markerStart = g['draw:marker-start'];
      if (g['draw:marker-end'] !== undefined) info.markerEnd = g['draw:marker-end'];
      if (g['draw:fill-image-name']) info.fillImage = g['draw:fill-image-name'];
      if (g['fo:border']) info.border = g['fo:border'];
      if (g['fo:background-color']) info.background = g['fo:background-color'];
      if (g['draw:textarea-vertical-align']) info.textVAlign = g['draw:textarea-vertical-align'];
      if (g['draw:textarea-horizontal-align']) info.textHAlign = g['draw:textarea-horizontal-align'];
      const pad = g['fo:padding-left'] || g['fo:padding'];
      if (pad) info.padding = pad;
      if (g['style:wrap']) info.wrap = g['style:wrap'];
    }
    if (tp?.attrs['fo:color']) info.fontColor = tp.attrs['fo:color'];
    if (tp?.attrs['fo:font-size'] && !/%$/.test(tp.attrs['fo:font-size'])) info.fontSize = tp.attrs['fo:font-size'];
    const pp = elements(n).find((c) => c.name === 'style:paragraph-properties');
    const align = pp?.attrs['fo:text-align'];
    if (align) {
      info.align = align === 'center' ? 'center' : align === 'end' || align === 'right' ? 'right'
        : align === 'justify' ? 'justify' : 'left';
    }
    this.styles.set(name, { ...this.styles.get(name), ...info });
  }

  private readList(n: XNode) {
    const name = n.attrs['style:name'];
    if (!name) return;
    const levels = new Map<number, 'ol' | 'ul'>();
    for (const c of elements(n)) {
      const level = Number(c.attrs['text:level'] || 1);
      if (c.name === 'text:list-level-style-number') {
        // Ohne Zahlenformat ist die "Nummerierung" leer – dann eher eine Liste ohne Zeichen.
        levels.set(level, c.attrs['style:num-format'] ? 'ol' : 'ul');
      } else levels.set(level, 'ul');
    }
    this.lists.set(name, levels);
  }

  /** Eigenschaft mit Vererbung über die Elternvorlagen. */
  prop<K extends keyof StyleInfo>(name: string | undefined, key: K): StyleInfo[K] | undefined {
    const seen = new Set<string>();
    while (name && !seen.has(name)) {
      seen.add(name);
      const s = this.styles.get(name);
      if (!s) return undefined;
      if (s[key] !== undefined) return s[key];
      name = s.parent;
    }
    return undefined;
  }

  /** Eigenschaft einer Zeichnung, notfalls aus der Standardvorlage für Grafiken. */
  graphic<K extends keyof StyleInfo>(name: string | undefined, key: K): StyleInfo[K] | undefined {
    return this.prop(name, key) ?? this.prop(DEFAULT_GRAPHIC, key);
  }

  /** Heißt die Vorlage (oder eine Elternvorlage) so? */
  inherits(name: string | undefined, pattern: RegExp): boolean {
    const seen = new Set<string>();
    while (name && !seen.has(name)) {
      seen.add(name);
      if (pattern.test(name) || pattern.test(this.styles.get(name)?.displayName || '')) return true;
      name = this.styles.get(name)?.parent;
    }
    return false;
  }

  /** Pfad des Bildes einer Bildfüllung. */
  fillImage(name: string | undefined): string | undefined {
    return name ? this.fillImages.get(name) : undefined;
  }

  listType(listStyle: string | undefined, level: number): 'ol' | 'ul' {
    return this.lists.get(listStyle || '')?.get(level) || 'ul';
  }
}

// ---- Umwandlung ----

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

/** Länge wie "8.5cm", "3in" oder "120pt" in CSS-Pixel. */
function toPx(value: string | undefined): number | null {
  const m = /^([\d.]+)\s*(cm|mm|in|pt|pc|px)?$/.exec(String(value || '').trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  const factor = { cm: 37.8, mm: 3.78, in: 96, pt: 96 / 72, pc: 16, px: 1 }[m[2] || 'px'] ?? 1;
  return Math.round(n * factor);
}

const SKIP = new Set([
  'text:sequence-decls', 'text:variable-decls', 'text:user-field-decls', 'office:forms',
  'text:tracked-changes', 'text:soft-page-break', 'text:bookmark', 'text:bookmark-start',
  'text:bookmark-end', 'text:reference-mark', 'text:reference-mark-start', 'text:reference-mark-end',
  'office:annotation', 'office:annotation-end', 'text:note', 'text:table-of-content',
  'text:alphabetical-index', 'text:illustration-index', 'text:table-index', 'text:bibliography',
  'table:table-column', 'table:table-columns', 'table:table-column-group', 'svg:title', 'svg:desc',
]);

const DRAWINGS = new Set([
  'draw:g', 'draw:custom-shape', 'draw:line', 'draw:polygon', 'draw:polyline', 'draw:rect',
  'draw:ellipse', 'draw:circle', 'draw:path', 'draw:connector', 'draw:measure', 'draw:control',
]);

// ---- Zeichnungen als SVG ----

/**
 * Wandelt Zeichnungselemente (Linien, Rechtecke, Ellipsen, Polygone,
 * Pfade, Verbinder, einfache Formen, Gruppen) in ein SVG-Bild.
 *
 * Alle Zeichnungen eines Absatzes landen in einem gemeinsamen Bild, damit
 * ihre Lage zueinander erhalten bleibt – zusammen mit den frei verankerten
 * Bildern und Textrahmen desselben Absatzes (Beschriftungen auf einem Foto,
 * Schrittkästen in einem Ablaufplan). Bildfüllungen werden als Bild unter
 * die Form gelegt, Textrahmen behalten Rand, Hintergrund und Ausrichtung.
 *
 * Formen aus der Formen-Palette (Sterne, Sprechblasen …) werden nur
 * übernommen, wenn ihr Umriss ohne Formeln beschrieben ist; sonst
 * erscheinen sie als Rechteck bzw. Ellipse mit ihrem Text.
 */
class DrawingSvg {
  private readonly parts: string[] = [];
  private readonly markers = new Map<string, string>();
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  shapes = 0;

  constructor(
    private readonly styles: Styles,
    private readonly imageData: (href: string) => string | null,
  ) {}

  private grow(x: number, y: number) {
    this.minX = Math.min(this.minX, x);
    this.minY = Math.min(this.minY, y);
    this.maxX = Math.max(this.maxX, x);
    this.maxY = Math.max(this.maxY, y);
  }

  /** ODF-Transformation ("rotate (0.5) translate (2cm 1cm)") als SVG-Attribut. */
  private transform(n: XNode): { attr: string; dx: number; dy: number } {
    const t = n.attrs['draw:transform'];
    if (!t) return { attr: '', dx: 0, dy: 0 };
    const ops: string[] = [];
    let dx = 0;
    let dy = 0;
    for (const m of t.matchAll(/(rotate|translate|scale|skewX|skewY)\s*\(([^)]*)\)/g)) {
      const args = m[2].trim().split(/[\s,]+/);
      if (m[1] === 'rotate') ops.push(`rotate(${(-parseFloat(args[0]) * 180) / Math.PI})`);
      else if (m[1] === 'translate') {
        const x = toPx(args[0]) ?? 0;
        const y = toPx(args[1] ?? '0') ?? 0;
        dx += x;
        dy += y;
        ops.push(`translate(${x} ${y})`);
      } else if (m[1] === 'scale') ops.push(`scale(${parseFloat(args[0])} ${parseFloat(args[1] ?? args[0])})`);
    }
    // ODF wendet die Schritte in Leserichtung an, SVG von rechts nach links.
    return { attr: ops.length ? ` transform="${ops.reverse().join(' ')}"` : '', dx, dy };
  }

  private paint(n: XNode, closed: boolean) {
    const style = n.attrs['draw:style-name'];
    const g = <K extends keyof StyleInfo>(k: K) => this.styles.graphic(style, k);
    const stroke = g('stroke') === 'none' ? 'none' : g('strokeColor') || '#3465a4';
    const width = Math.max(1, toPx(g('strokeWidth') || '0') || 1);
    const dash = g('stroke') === 'dash' ? ' stroke-dasharray="6 4"' : '';
    const fill = !closed || g('fill') === 'none' || g('fill') === 'bitmap' || g('fill') === 'gradient' && !g('fillColor') ? 'none'
      : g('fillColor') || '#729fcf';
    let markers = '';
    if (stroke !== 'none') {
      if (g('markerEnd')) markers += ` marker-end="url(#${this.marker(stroke)})"`;
      if (g('markerStart')) markers += ` marker-start="url(#${this.marker(stroke)})"`;
    }
    return `stroke="${esc(stroke)}" stroke-width="${width}" fill="${esc(fill)}"${dash}${markers}`;
  }

  private marker(color: string) {
    let id = this.markers.get(color);
    if (!id) {
      id = `a${this.markers.size}`;
      this.markers.set(color, id);
    }
    return id;
  }

  private box(n: XNode) {
    return {
      x: toPx(n.attrs['svg:x']) ?? 0,
      y: toPx(n.attrs['svg:y']) ?? 0,
      // Mitwachsende Textrahmen haben oft nur eine Mindestgröße.
      w: toPx(n.attrs['svg:width']) ?? toPx(n.attrs['fo:min-width']) ?? 0,
      h: toPx(n.attrs['svg:height']) ?? toPx(n.attrs['fo:min-height']) ?? 0,
    };
  }

  /**
   * Bildfüllung einer Form: das Bild in ihrem Rahmen, darüber zeichnet die
   * Form selbst nur noch ihren Umriss. Für nicht rechteckige Formen ist das
   * eine Näherung – in Arbeitsblättern sind es praktisch immer Rechtecke.
   */
  private bitmap(n: XNode, b: { x: number; y: number; w: number; h: number }, tr: string) {
    const style = n.attrs['draw:style-name'];
    if (this.styles.graphic(style, 'fill') !== 'bitmap') return '';
    const href = this.styles.fillImage(this.styles.graphic(style, 'fillImage'));
    const data = href ? this.imageData(href) : null;
    return data
      ? `<image href="${data}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="none"${tr}/>`
      : '';
  }

  /** Zeilen eines Absatzes: Zeilenumbrüche, Tabs und Leerzeichen wie im Dokument. */
  private lineText(p: XNode): string[] {
    const walk = (n: XNode | string): string => {
      if (typeof n === 'string') return n.replace(/\s+/g, ' ');
      if (n.name === 'text:line-break') return '\n';
      if (n.name === 'text:tab') return '    ';
      if (n.name === 'text:s') return ' '.repeat(Math.min(Number(n.attrs['text:c'] || 1), 20));
      if (DRAWINGS.has(n.name) || n.name === 'draw:frame') return '';
      return n.children.map(walk).join('');
    };
    return walk(p).split('\n');
  }

  /** Schriftgröße eines Absatzes (oder seines ersten Abschnitts) in px. */
  private fontSize(p: XNode, fallback: number): number {
    const own = toPx(this.styles.prop(p.attrs['text:style-name'], 'fontSize'));
    if (own) return own;
    const span = elements(p).find((c) => c.name === 'text:span' && this.styles.prop(c.attrs['text:style-name'], 'fontSize'));
    return toPx(this.styles.prop(span?.attrs['text:style-name'], 'fontSize')) || fallback;
  }

  /**
   * Text in einer Form oder einem Textrahmen. Ausrichtung, Schriftgröße,
   * Fettdruck und Farbe kommen aus den Absatzvorlagen; ohne Angabe gelten
   * die Vorgaben des Aufrufers (Formen: mittig, Textrahmen: oben links).
   */
  private textBlock(
    container: XNode,
    b: { x: number; y: number; w: number; h: number },
    tr: string,
    opts: { h: string; v: string; pad: number; color?: string },
  ) {
    const paras = elements(container).filter((c) => c.name === 'text:p' || c.name === 'text:h');
    const lines: Array<{ text: string; size: number; align: string; bold: boolean; color: string }> = [];
    for (const p of paras) {
      const style = p.attrs['text:style-name'];
      const size = this.fontSize(p, 14.7);
      const align = this.styles.prop(style, 'align') || opts.h;
      const span = elements(p).find((c) => c.name === 'text:span');
      const bold = !!(this.styles.prop(style, 'bold') || this.styles.prop(span?.attrs['text:style-name'], 'bold'));
      const color = this.styles.prop(style, 'fontColor') || this.styles.prop(span?.attrs['text:style-name'], 'fontColor') || opts.color || '#000000';
      for (const text of this.lineText(p)) lines.push({ text: text.replace(/\s+$/, ''), size, align, bold, color });
    }
    // Leerzeilen am Ende fallen weg; die am Anfang sind oft gewollter Abstand.
    while (lines.length && !lines[lines.length - 1].text.trim()) lines.pop();
    if (!lines.length) return '';

    const total = lines.reduce((sum, l) => sum + l.size * 1.2, 0);
    let y = opts.v === 'bottom' ? b.y + b.h - opts.pad - total
      : opts.v === 'top' ? b.y + opts.pad
        : b.y + b.h / 2 - total / 2;
    let out = '';
    for (const l of lines) {
      y += l.size * 1.2;
      if (!l.text.trim()) continue;
      const x = l.align === 'center' ? b.x + b.w / 2 : l.align === 'right' ? b.x + b.w - opts.pad : b.x + opts.pad;
      const anchor = l.align === 'center' ? 'middle' : l.align === 'right' ? 'end' : 'start';
      out += `<text x="${x.toFixed(1)}" y="${(y - l.size * 0.28).toFixed(1)}" font-family="Arial, Helvetica, sans-serif"` +
        ` font-size="${l.size.toFixed(1)}"${l.bold ? ' font-weight="bold"' : ''} fill="${esc(l.color)}"` +
        ` text-anchor="${anchor}" xml:space="preserve"${tr}>${esc(l.text)}</text>`;
    }
    return out;
  }

  /** Text in einer Form – standardmäßig mittig, sofern die Form nichts anderes sagt. */
  private label(n: XNode, b: { x: number; y: number; w: number; h: number }, tr: string) {
    const style = n.attrs['draw:style-name'];
    const h = this.styles.graphic(style, 'textHAlign');
    return this.textBlock(n, b, tr, {
      h: h === 'left' ? 'left' : h === 'right' ? 'right' : 'center',
      v: this.styles.graphic(style, 'textVAlign') || 'middle',
      pad: toPx(this.styles.graphic(style, 'padding')) ?? 5,
      color: this.styles.graphic(n.attrs['draw:text-style-name'], 'fontColor'),
    });
  }

  /** Textrahmen: Rand und Hintergrund wie im Dokument, Text oben links. */
  private textFrame(n: XNode, box: XNode, b: { x: number; y: number; w: number; h: number }, tr: string) {
    const style = n.attrs['draw:style-name'];
    const g = <K extends keyof StyleInfo>(k: K) => this.styles.graphic(style, k);
    const border = /([\d.]+\s*(?:pt|cm|mm|in|px))\s+(solid|dashed|dotted|double)\s+(#[0-9a-f]{6})/i.exec(g('border') || '');
    const bg = g('fill') === 'solid' ? g('fillColor') : g('background') && g('background') !== 'transparent' ? g('background') : '';
    let out = this.bitmap(n, b, tr);
    if (border || bg) {
      const sw = border ? Math.max(1, toPx(border[1]) || 1) : 0;
      out += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${esc(bg || 'none')}"` +
        `${border ? ` stroke="${esc(border[3])}" stroke-width="${sw}"${border[2] === 'dashed' ? ' stroke-dasharray="6 4"' : ''}` : ''}${tr}/>`;
    }
    return out + this.textBlock(box, b, tr, {
      h: 'left',
      v: g('textVAlign') || 'top',
      pad: toPx(g('padding')) ?? 2,
    });
  }

  /** Punkte einer viewBox auf den Rahmen der Form umrechnen. */
  private fit(n: XNode, b: { x: number; y: number; w: number; h: number }) {
    const vb = (n.attrs['svg:viewBox'] || '').trim().split(/[\s,]+/).map(Number);
    const [vx, vy, vw, vh] = vb.length === 4 && vb[2] && vb[3] ? vb : [0, 0, b.w || 1, b.h || 1];
    return { sx: (b.w || vw) / vw, sy: (b.h || vh) / vh, vx, vy };
  }

  add(n: XNode): boolean {
    const t = this.transform(n);
    const b = this.box(n);
    // Für den Rahmen des Bildes zählt die verschobene Lage; die Drehung
    // wird dabei nicht nachgerechnet – etwas Rand fängt das auf.
    const ox = b.x + t.dx;
    const oy = b.y + t.dy;
    switch (n.name) {
      case 'draw:g': {
        let any = false;
        for (const c of elements(n)) any = this.add(c) || any;
        return any;
      }
      case 'draw:line':
      case 'draw:connector': {
        const x1 = toPx(n.attrs['svg:x1']) ?? 0;
        const y1 = toPx(n.attrs['svg:y1']) ?? 0;
        const x2 = toPx(n.attrs['svg:x2']) ?? 0;
        const y2 = toPx(n.attrs['svg:y2']) ?? 0;
        this.grow(x1 + t.dx, y1 + t.dy);
        this.grow(x2 + t.dx, y2 + t.dy);
        this.parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${this.paint(n, false)}${t.attr}/>`);
        this.parts.push(this.label(n, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }, t.attr));
        break;
      }
      case 'draw:rect': {
        const r = toPx(n.attrs['draw:corner-radius']) ?? 0;
        this.parts.push(this.bitmap(n, b, t.attr));
        this.parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"${r ? ` rx="${r}"` : ''} ${this.paint(n, true)}${t.attr}/>`);
        this.parts.push(this.label(n, b, t.attr));
        break;
      }
      case 'draw:ellipse':
      case 'draw:circle':
        this.parts.push(this.bitmap(n, b, t.attr));
        this.parts.push(`<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${b.w / 2}" ry="${b.h / 2}" ${this.paint(n, true)}${t.attr}/>`);
        this.parts.push(this.label(n, b, t.attr));
        break;
      case 'draw:polygon':
      case 'draw:polyline': {
        const f = this.fit(n, b);
        const pts = (n.attrs['draw:points'] || '').trim().split(/\s+/).map((p) => p.split(',').map(Number))
          .filter((p) => p.length === 2 && p.every(Number.isFinite))
          .map(([px, py]) => `${b.x + (px - f.vx) * f.sx},${b.y + (py - f.vy) * f.sy}`)
          .join(' ');
        const closed = n.name === 'draw:polygon';
        if (closed) this.parts.push(this.bitmap(n, b, t.attr));
        this.parts.push(`<${closed ? 'polygon' : 'polyline'} points="${pts}" ${this.paint(n, closed)}${t.attr}/>`);
        break;
      }
      case 'draw:path': {
        const f = this.fit(n, b);
        const d = n.attrs['svg:d'] || '';
        const closed = /z\s*$/i.test(d.trim());
        if (closed) this.parts.push(this.bitmap(n, b, t.attr));
        this.parts.push(`<path d="${esc(d)}" vector-effect="non-scaling-stroke" ${this.paint(n, closed)}` +
          ` transform="${t.attr ? t.attr.slice(12, -1) + ' ' : ''}translate(${b.x} ${b.y}) scale(${f.sx} ${f.sy}) translate(${-f.vx} ${-f.vy})"/>`);
        break;
      }
      case 'draw:custom-shape': {
        const geo = elements(n).find((c) => c.name === 'draw:enhanced-geometry');
        const type = geo?.attrs['draw:type'] || '';
        const path = geo?.attrs['draw:enhanced-path'] || '';
        this.parts.push(this.bitmap(n, b, t.attr));
        // Umriss ohne Formeln ($, ?) und nur mit einfachen Befehlen: direkt übernehmen.
        if (geo && path && !/[?$]/.test(path) && /^[\sMLCZNFS\d.,-]+$/.test(path)) {
          const f = this.fit(geo, b);
          const noFill = /F/.test(path);
          const d = path.replace(/[NFS]/g, ' ').trim();
          this.parts.push(`<path d="${esc(d)}" vector-effect="non-scaling-stroke" ${this.paint(n, !noFill)}` +
            ` transform="${t.attr ? t.attr.slice(12, -1) + ' ' : ''}translate(${b.x} ${b.y}) scale(${f.sx} ${f.sy}) translate(${-f.vx} ${-f.vy})"/>`);
        } else if (/ellipse|circle|ring/i.test(type)) {
          this.parts.push(`<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${b.w / 2}" ry="${b.h / 2}" ${this.paint(n, true)}${t.attr}/>`);
        } else {
          const r = /round/i.test(type) ? Math.min(b.w, b.h) / 6 : 0;
          this.parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"${r ? ` rx="${r}"` : ''} ${this.paint(n, true)}${t.attr}/>`);
        }
        this.parts.push(this.label(n, b, t.attr));
        break;
      }
      case 'draw:frame': {
        // Mehrere draw:image: das erste lesbare (z. B. PNG-Ersatz für eine SVM-Grafik).
        let data: string | null = null;
        for (const img of elements(n).filter((c) => c.name === 'draw:image')) {
          data = this.imageData(img.attrs['xlink:href'] || '');
          if (data) break;
        }
        if (data) {
          this.parts.push(`<image href="${data}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="none"${t.attr}/>`);
        } else {
          const box = elements(n).find((c) => c.name === 'draw:text-box');
          if (!box) return false;
          this.parts.push(this.textFrame(n, box, b, t.attr));
        }
        break;
      }
      default:
        return false;
    }
    if (n.name !== 'draw:line' && n.name !== 'draw:connector') {
      this.grow(ox, oy);
      this.grow(ox + b.w, oy + b.h);
    }
    this.shapes++;
    return true;
  }

  /** Das fertige Bild als <img>, oder '' wenn nichts darzustellen war. */
  toImg(): string {
    if (!this.shapes || !Number.isFinite(this.minX)) return '';
    const pad = 12;
    const x = Math.floor(this.minX - pad);
    const y = Math.floor(this.minY - pad);
    const w = Math.ceil(this.maxX - this.minX + 2 * pad);
    const h = Math.ceil(this.maxY - this.minY + 2 * pad);
    const defs = [...this.markers].map(([color, id]) =>
      `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
      `<path d="M0,0L10,5L0,10z" fill="${esc(color)}"/></marker>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">` +
      (defs ? `<defs>${defs}</defs>` : '') + this.parts.join('') + '</svg>';
    return `<img src="data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}" alt="Zeichnung" width="${w}">`;
  }
}

/** Inline-Text, eigener Block, oder ein umflossenes Bild am Anfang des Absatzes. */
type Seg = { inline: string } | { block: string } | { float: string };

export interface OdtResult {
  title: string;
  html: string;
  warnings: string[];
  stats: { headings: number; paragraphs: number; tables: number; images: number; drawings: number };
}

export function odtToHtml(buffer: Buffer, fileName = ''): OdtResult {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('Die Datei ist kein gültiges OpenDocument (.odt).');
  }
  const read = (entry: string) => zip.getEntry(entry)?.getData().toString('utf8');
  const mimetype = (read('mimetype') || '').trim();
  if (mimetype && !mimetype.startsWith('application/vnd.oasis.opendocument.text')) {
    throw new Error('Das ist kein Writer-Dokument (.odt).');
  }
  const contentXml = read('content.xml');
  if (!contentXml) throw new Error('content.xml fehlt – die Datei ist beschädigt.');

  const content = parseXml(contentXml);
  const styles = new Styles();
  const stylesXml = read('styles.xml');
  if (stylesXml) styles.read(parseXml(stylesXml));
  styles.read(find(content, 'office:automatic-styles'));

  const body = find(content, 'office:text');
  if (!body) throw new Error('Das Dokument enthält keinen Text.');

  const stats = { headings: 0, paragraphs: 0, tables: 0, images: 0, drawings: 0 };
  let skippedDrawings = 0;
  let skippedImages = 0;
  let skippedLarge = 0;
  let linkedImages = 0;
  let imageBytes = 0;

  // ---- Bilder ----

  const image = (frame: XNode): string | null => {
    for (const img of elements(frame).filter((c) => c.name === 'draw:image')) {
      const href = img.attrs['xlink:href'] || '';
      const type = IMAGE_TYPES[path.extname(href).slice(1).toLowerCase()];
      if (/^[a-z]+:/i.test(href) || href.startsWith('../') || href.startsWith('/')) {
        // Nur verknüpft, nicht im Dokument eingebettet.
        linkedImages++;
        return '';
      }
      if (!type) continue;
      const data = zip.getEntry(href.replace(/^\.\//, ''))?.getData();
      if (!data) {
        linkedImages++;
        return '';
      }
      if (data.length > MAX_IMAGE_BYTES || imageBytes + data.length > MAX_TOTAL_IMAGE_BYTES) {
        skippedLarge++;
        return '';
      }
      imageBytes += data.length;
      stats.images++;
      const width = toPx(frame.attrs['svg:width']);
      const alt = textOf(elements(frame).find((c) => c.name === 'svg:title') || '') || frame.attrs['draw:name'] || '';
      return `<img src="data:${type};base64,${data.toString('base64')}" alt="${esc(alt)}"${width ? ` width="${width}"` : ''}>`;
    }
    return null;
  };

  /** Bilddaten für eine Zeichnung (als data:-URL), sofern eingebettet und lesbar. */
  const imageData = (href: string): string | null => {
    const type = IMAGE_TYPES[path.extname(href).slice(1).toLowerCase()];
    if (!type || /^[a-z]+:/i.test(href)) return null;
    const data = zip.getEntry(href.replace(/^\.\//, ''))?.getData();
    if (!data || data.length > MAX_IMAGE_BYTES || imageBytes + data.length > MAX_TOTAL_IMAGE_BYTES) return null;
    imageBytes += data.length;
    return `data:${type};base64,${data.toString('base64')}`;
  };

  /** Mehrere Zeichnungselemente zu einem Bild; zählt, was nicht ging. */
  const drawing = (nodes: XNode[]): string => {
    const svg = new DrawingSvg(styles, imageData);
    // Stapelreihenfolge wie im Dokument: Bilder unten, Beschriftungen oben.
    const z = (n: XNode) => Number(n.attrs['draw:z-index'] ?? 0);
    for (const n of [...nodes].sort((a, b) => z(a) - z(b))) if (!svg.add(n)) skippedDrawings++;
    const img = svg.toImg();
    if (img) {
      stats.images++;
      stats.drawings++;
    }
    return img;
  };

  // ---- Inline-Inhalt ----

  const wrap = (html: string, styleName: string | undefined, skipBold = false) => {
    if (!html) return html;
    if (!skipBold && styles.prop(styleName, 'bold')) html = `<strong>${html}</strong>`;
    if (styles.prop(styleName, 'italic')) html = `<em>${html}</em>`;
    if (styles.prop(styleName, 'underline')) html = `<u>${html}</u>`;
    if (styles.prop(styleName, 'strike')) html = `<s>${html}</s>`;
    const pos = styles.prop(styleName, 'position');
    if (pos === 'sub') html = `<sub>${html}</sub>`;
    if (pos === 'super') html = `<sup>${html}</sup>`;
    return html;
  };

  /** Frei verankert (am Absatz, Zeichen, Seite) statt wie ein Buchstabe im Text. */
  const anchored = (c: XNode) => !!c.attrs['text:anchor-type'] && c.attrs['text:anchor-type'] !== 'as-char';
  const isImageFrame = (f: XNode) => elements(f).some((c) => c.name === 'draw:image');
  const isTextFrame = (f: XNode) => elements(f).some((c) => c.name === 'draw:text-box');

  /**
   * Seite, an der ein einzelnes verankertes Bild stehen soll, damit der Text
   * es umfließt wie im Dokument – oder null für eine eigene Zeile (kein
   * Umfluss eingestellt oder breiter als gut die Hälfte des Satzspiegels).
   */
  const floatSide = (f: XNode): 'left' | 'right' | null => {
    const wrap = styles.graphic(f.attrs['draw:style-name'], 'wrap');
    if (wrap === 'none' || wrap === 'run-through') return null;
    const x = toPx(f.attrs['svg:x']) ?? 0;
    const w = toPx(f.attrs['svg:width']) ?? 0;
    if (!w || w > 380) return null;
    // Satzspiegel einer A4-Seite mit üblichen Rändern: rund 17 cm.
    return x + w / 2 > 320 ? 'right' : 'left';
  };

  const inline = (n: XNode): Seg[] => {
    const out: Seg[] = [];
    // Zeichnungen eines Absatzes werden gesammelt und am Ende als ein Bild
    // ausgegeben – so bleibt ihre Lage zueinander erhalten. Frei verankerte
    // Rahmen (Bilder, Textrahmen) desselben Absatzes kommen mit hinein, wenn
    // sie zusammengehören: Beschriftungen auf einem Foto, Schrittkästen in
    // einem Ablaufplan, Bilder nebeneinander.
    const shapes: XNode[] = [];
    const frames: XNode[] = [];
    for (const c of n.children) {
      if (typeof c === 'string') {
        out.push({ inline: esc(c.replace(/\s+/g, ' ')) });
        continue;
      }
      if (SKIP.has(c.name)) continue;
      switch (c.name) {
        case 'text:s': {
          const count = Math.min(Number(c.attrs['text:c'] || 1), 40);
          out.push({ inline: '&nbsp;'.repeat(count) });
          break;
        }
        case 'text:tab':
          out.push({ inline: '&emsp;' });
          break;
        case 'text:line-break':
          out.push({ inline: '<br>' });
          break;
        case 'text:span': {
          const inner = inline(c);
          for (const seg of inner) {
            out.push('inline' in seg ? { inline: wrap(seg.inline, c.attrs['text:style-name']) } : seg);
          }
          break;
        }
        case 'text:a': {
          const href = c.attrs['xlink:href'] || '';
          const inner = inline(c);
          const text = inner.map((s) => ('inline' in s ? s.inline : '')).join('');
          out.push({ inline: /^(https?:|mailto:)/i.test(href) ? `<a href="${esc(href)}">${text}</a>` : text });
          inner.filter((s) => 'block' in s).forEach((s) => out.push(s));
          break;
        }
        case 'draw:frame': {
          if (anchored(c)) {
            frames.push(c);
            break;
          }
          const img = image(c);
          if (img !== null) {
            if (img) out.push({ inline: img });
            break;
          }
          const box = elements(c).find((x) => x.name === 'draw:text-box');
          if (box) {
            const inner = blocks(box);
            if (inner.trim()) out.push({ block: `<div class="ws-box">${inner}</div>` });
            break;
          }
          if (elements(c).some((x) => x.name === 'draw:image' || x.name === 'draw:object' || x.name === 'draw:object-ole')) {
            skippedImages++;
          }
          break;
        }
        case 'draw:a':
          inline(c).forEach((s) => out.push(s));
          break;
        default:
          if (DRAWINGS.has(c.name)) {
            shapes.push(c);
            break;
          }
          // Unbekanntes Inline-Element (Feld, Querverweis, Nummer): Text übernehmen.
          inline(c).forEach((s) => out.push(s));
      }
    }
    // Zusammensetzen, wenn es Formen gibt oder Text auf/neben Bildern steht.
    const compose = shapes.length > 0 ||
      (frames.length > 1 && frames.some(isTextFrame) && frames.some(isImageFrame));
    if (compose) {
      const img = drawing([...frames, ...shapes]);
      if (img) out.push({ block: `<p>${img}</p>` });
      return out;
    }
    for (const f of frames) {
      const img = image(f);
      if (img !== null) {
        if (!img) continue;
        const side = floatSide(f);
        if (side) out.push({ float: img.replace('<img ', `<img class="ws-float-${side}" `) });
        else out.push({ block: `<p>${img.replace('<img ', '<img class="ws-img-center" ')}</p>` });
        continue;
      }
      const box = elements(f).find((x) => x.name === 'draw:text-box');
      if (box) {
        const inner = blocks(box);
        if (inner.trim()) out.push({ block: `<div class="ws-box">${inner}</div>` });
        continue;
      }
      if (elements(f).some((x) => x.name === 'draw:image' || x.name === 'draw:object' || x.name === 'draw:object-ole')) {
        skippedImages++;
      }
    }
    return out;
  };

  // ---- Blöcke ----

  /** Absatz oder Überschrift; Textrahmen darin brechen ihn auf. */
  const paragraph = (n: XNode, tag: string): string => {
    const styleName = n.attrs['text:style-name'];
    const align = styles.prop(styleName, 'align');
    const alignAttr = align && align !== 'left' ? ` style="text-align:${align}"` : '';
    const isHeading = tag !== 'p';
    const parts: string[] = [];
    let buffer = '';
    const flush = () => {
      const html = buffer.replace(/^(\s|&nbsp;)+|(\s|&nbsp;)+$/g, '');
      const visible = html.replace(/<br>|&nbsp;|&emsp;|\s/g, '');
      if (visible) {
        parts.push(`<${tag}${alignAttr}>${wrap(html, styleName, isHeading)}</${tag}>`);
        if (isHeading) stats.headings++; else stats.paragraphs++;
      } else if (/<img/.test(html)) {
        parts.push(`<p${alignAttr}>${html}</p>`);
      }
      buffer = '';
    };
    for (const seg of inline(n)) {
      if ('inline' in seg) buffer += seg.inline;
      // Am Anfang des Absatzes, damit der ganze Absatz das Bild umfließt.
      else if ('float' in seg) buffer = seg.float + buffer;
      else {
        flush();
        parts.push(seg.block);
      }
    }
    flush();
    // Leere Absätze sind in Arbeitsblättern Platz zum Schreiben. Einer reicht
    // als Abstand; mehr fasst `blocks` ohnehin zusammen.
    return parts.length ? parts.join('') : '<p data-empty="1"><br></p>';
  };

  const headingTag = (n: XNode) => {
    const level = Number(n.attrs['text:outline-level'] || 1);
    return `h${Math.min(4, Math.max(2, level + 1))}`;
  };

  const list = (n: XNode, listStyle: string | undefined, depth: number): string => {
    const styleName = n.attrs['text:style-name'] || listStyle;
    const tag = styles.listType(styleName, depth);
    const items = elements(n)
      .filter((c) => c.name === 'text:list-item' || c.name === 'text:list-header')
      .map((item) => {
        const inner = elements(item)
          .map((c) =>
            c.name === 'text:list' ? list(c, styleName, depth + 1)
              : c.name === 'text:p' ? paragraph(c, 'p').replace(/^<p data-empty="1"><br><\/p>$/, '')
                : c.name === 'text:h' ? paragraph(c, headingTag(c))
                  : blocks({ name: '#', attrs: {}, children: [c] }),
          )
          .join('');
        return `<li>${inner}</li>`;
      })
      .join('');
    return items ? `<${tag}>${items}</${tag}>` : '';
  };

  const table = (n: XNode): string => {
    stats.tables++;
    const rowsHtml = (container: XNode, cellTag: string): string => {
      let html = '';
      for (const c of elements(container)) {
        if (c.name === 'table:table-row') {
          const repeat = Math.min(Number(c.attrs['table:number-rows-repeated'] || 1), 50);
          const cells = elements(c)
            .filter((cell) => cell.name === 'table:table-cell')
            .map((cell) => {
              const colspan = Number(cell.attrs['table:number-columns-spanned'] || 1);
              const rowspan = Number(cell.attrs['table:number-rows-spanned'] || 1);
              const repeatCols = Math.min(Number(cell.attrs['table:number-columns-repeated'] || 1), 50);
              const inner = blocks(cell).replace(/^<p data-empty="1"><br><\/p>$/, '');
              const attrs = `${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}`;
              return `<${cellTag}${attrs}>${inner}</${cellTag}>`.repeat(repeatCols);
            })
            .join('');
          html += `<tr>${cells}</tr>`.repeat(repeat);
        } else if (c.name === 'table:table-rows' || c.name === 'table:table-row-group') {
          html += rowsHtml(c, cellTag);
        }
      }
      return html;
    };
    const header = elements(n).find((c) => c.name === 'table:table-header-rows');
    const head = header ? `<thead>${rowsHtml(header, 'th')}</thead>` : '';
    return `<table>${head}<tbody>${rowsHtml(n, 'td')}</tbody></table>`;
  };

  function blocks(n: XNode): string {
    const parts: string[] = [];
    for (const c of elements(n)) {
      if (SKIP.has(c.name)) continue;
      if (c.name === 'text:p') {
        const tag = styles.inherits(c.attrs['text:style-name'], /^Title$/i) ? 'h2'
          : styles.inherits(c.attrs['text:style-name'], /^Subtitle$/i) ? 'h3' : 'p';
        parts.push(paragraph(c, tag));
      } else if (c.name === 'text:h') parts.push(paragraph(c, headingTag(c)));
      else if (c.name === 'text:list') parts.push(list(c, undefined, 1));
      else if (c.name === 'table:table') parts.push(table(c));
      else if (c.name === 'text:section' || c.name === 'text:index-body') parts.push(blocks(c));
      else if (c.name === 'draw:frame' || c.name === 'draw:a') {
        for (const seg of inline({ name: '#', attrs: {}, children: [c] })) {
          parts.push('inline' in seg ? `<p>${seg.inline}</p>` : 'float' in seg ? `<p>${seg.float}</p>` : seg.block);
        }
      } else if (DRAWINGS.has(c.name)) {
        const img = drawing([c]);
        if (img) parts.push(`<p>${img}</p>`);
      }
    }
    // Mehrere Leerabsätze hintereinander: einer genügt; am Anfang und Ende keiner.
    return parts
      .join('')
      .replace(/(<p data-empty="1"><br><\/p>)+/g, '<p><br></p>')
      .replace(/^(<p><br><\/p>)+|(<p><br><\/p>)+$/g, '');
  }

  const html = blocks(body);

  const meta = read('meta.xml');
  const metaTitle = meta ? textOf(find(parseXml(meta), 'dc:title') || '').trim() : '';
  const firstHeading = /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/.exec(html)?.[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  const fromFile = path.basename(fileName || '', path.extname(fileName || '')).replace(/[_-]+/g, ' ').trim();
  const title = metaTitle || (firstHeading ? decodeHtml(firstHeading) : '') || fromFile || 'Arbeitsblatt';

  const warnings: string[] = [];
  if (stats.drawings) {
    warnings.push(`${stats.drawings} Zeichnung${stats.drawings === 1 ? '' : 'en'} als Bild übernommen – bitte kurz prüfen: Komplexe Formen werden vereinfacht, Schriften durch Arial ersetzt.`);
  }
  if (skippedDrawings) {
    warnings.push(`${skippedDrawings} Zeichnungselement${skippedDrawings === 1 ? '' : 'e'} nicht übernommen (z. B. Steuerelemente oder Maßlinien).`);
  }
  if (skippedImages) {
    warnings.push(`${skippedImages} Grafik${skippedImages === 1 ? '' : 'en'} in einem Fremdformat (z. B. SVM, WMF, eingebettetes Objekt) nicht übernommen – in LibreOffice als PNG einfügen, dann klappt es.`);
  }
  if (linkedImages) {
    warnings.push(`${linkedImages} Bild${linkedImages === 1 ? ' ist' : 'er sind'} nur verknüpft statt eingebettet – in LibreOffice unter Bearbeiten → Verknüpfungen „Lösen“, dann neu importieren.`);
  }
  if (skippedLarge) {
    warnings.push(`${skippedLarge} Bild${skippedLarge === 1 ? '' : 'er'} zu groß (über 4 MB je Bild bzw. 20 MB insgesamt) – bitte verkleinern.`);
  }
  if (!html.trim()) warnings.push('Im Dokument wurde kein übertragbarer Inhalt gefunden.');

  return { title, html, warnings, stats };
}

function decodeHtml(s: string) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
