// Modultyp „Dokument“: Spec prüfen, als HTML anzeigen, Formeln setzen.
//
// Eine Datei für Browser UND Server (der Server lädt sie über
// src/core/browser-module.ts) – deshalb ohne import, ohne DOM, und
// "export" nur vor class/function/const am Zeilenanfang.
//
// Das Format ist das des Generators (worksheet-renderer/SPEC.md); daraus
// entstehen auch .odt und .pdf. Die Web-Ansicht folgt seinen Regeln:
// Gliederungsnummern 1. / 1.1 / 1.1.1, gewollte Zeilenumbrüche im Fließtext,
// `n_S` mit tiefgestelltem S, Lösungen zunächst ausgeblendet.

export const DOC_BLOCK_TYPES = ['section', 'task', 'subtask', 'text', 'list', 'code', 'image', 'table',
  'formula', 'note', 'solution', 'karo', 'spacer', 'pagebreak'];

const HEADING_TYPES = ['section', 'task', 'subtask'];
const WITH_BLOCKS = ['section', 'task', 'subtask', 'solution'];
// Bildquellen, die in der App angezeigt werden dürfen. Verweise per `file:`
// gibt es nur im Kurs-Projekt des Generators.
const IMAGE_SRC_RE = /^(data:image\/(png|jpeg|gif|webp|svg\+xml);base64,|https:\/\/|\/api\/)/i;
const CSS_LENGTH_RE = /^\d+(\.\d+)?(cm|mm|px|%)$/;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isText(v) {
  return typeof v === 'string' || typeof v === 'number';
}

// ==================== Prüfen ====================

/**
 * Prüft eine Spec. Liefert die Fehler als lesbare Sätze mit Fundstelle
 * („content[2] (task): title fehlt“). Leere Liste = in Ordnung.
 */
export function validateDocSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return ['Die Spec muss ein Objekt mit content: [ … ] sein.'];
  }
  if (!Array.isArray(spec.content)) return ['content: Die Liste der Blöcke fehlt.'];
  const errors = [];
  checkBlocks(spec.content, 'content', errors, false);
  return errors;
}

function checkBlocks(blocks, path, errors, inSolution) {
  blocks.forEach((block, i) => checkBlock(block, `${path}[${i}]`, errors, inSolution));
}

function checkBlock(block, path, errors, inSolution) {
  if (isText(block)) return; // Ein einfacher Text ist ein Textblock.
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    errors.push(`${path}: Block muss ein Objekt mit type sein.`);
    return;
  }
  const type = block.type || 'text';
  const at = `${path} (${type})`;
  const need = (ok, msg) => { if (!ok) errors.push(`${at}: ${msg}`); };
  if (!DOC_BLOCK_TYPES.includes(type)) {
    errors.push(`${path}: Unbekannter Blocktyp „${type}“ – erlaubt: ${DOC_BLOCK_TYPES.join(', ')}.`);
    return;
  }
  switch (type) {
    case 'section':
      need(isText(block.title) || isText(block.text), 'text (Überschrift) fehlt.');
      break;
    case 'task':
    case 'subtask':
      need(isText(block.title) || isText(block.text), 'title fehlt.');
      break;
    case 'text':
    case 'note':
      need(isText(block.text), 'text fehlt.');
      break;
    case 'list':
      need(Array.isArray(block.items) && block.items.length > 0, 'items: Liste mit mindestens einem Punkt fehlt.');
      if (Array.isArray(block.items)) need(block.items.every(isText), 'items: Jeder Punkt muss ein Text sein.');
      break;
    case 'code':
      need(isText(block.code) || isText(block.file), 'code fehlt.');
      break;
    case 'image':
      need(isText(block.src) || isText(block.file), 'src (Bild) fehlt.');
      if (isText(block.src)) need(IMAGE_SRC_RE.test(String(block.src)), 'src: nur Bilder als data:image/… oder https://.');
      if (block.width !== undefined) need(CSS_LENGTH_RE.test(String(block.width)), 'width: z. B. 9cm.');
      break;
    case 'table':
      need(Array.isArray(block.rows) && block.rows.length > 0, 'rows: Liste der Zeilen fehlt.');
      if (Array.isArray(block.rows)) need(block.rows.every((r) => Array.isArray(r)), 'rows: Jede Zeile muss eine Liste sein, z. B. ["a", "b"].');
      if (block.header !== undefined) need(Array.isArray(block.header), 'header muss eine Liste sein.');
      break;
    case 'formula':
      need(isText(block.math) && String(block.math).trim() !== '', 'math (Formel) fehlt.');
      if (isText(block.math)) {
        try { starmathToMathml(String(block.math)); } catch (e) { errors.push(`${at}: Formel – ${e.message}`); }
      }
      break;
    case 'solution':
      need(!inSolution, 'Lösung in einer Lösung ist nicht möglich.');
      need(Array.isArray(block.blocks) || isText(block.text), 'blocks oder text fehlt.');
      break;
    case 'karo':
    case 'spacer':
      if (block.lines !== undefined) {
        need(Number.isInteger(block.lines) && block.lines >= 1 && block.lines <= 60, 'lines: ganze Zahl von 1 bis 60.');
      }
      break;
    default:
      break;
  }
  if (block.blocks !== undefined) {
    if (!WITH_BLOCKS.includes(type)) errors.push(`${at}: blocks gibt es nur bei ${WITH_BLOCKS.join(', ')}.`);
    else if (!Array.isArray(block.blocks)) errors.push(`${at}: blocks muss eine Liste sein.`);
    else checkBlocks(block.blocks, `${path}.blocks`, errors, inSolution || type === 'solution');
  }
}

// ==================== Fließtext ====================

// Wie im Generator (make_worksheet.py): Ein einfacher Umbruch der Quelle ist
// meist nur Satzspiegel – außer bei Aufzählungen, Rechenzeilen, Lücken und
// kurzen Zeilen.
const HARD_BREAK_BELOW = 70;
const LIST_START_RE = /^\s*(?:\(?[a-z]\)|\d+[.)]|[–•-])\s/;
const GAP_RE = /\S {2,}\S/;
const ASSIGN_START_RE = /^\s*[^\s=:]+(?: \([^)]*\))? ?:?= /;
// `n_S`, `P_{Schlupf}` → tiefgestellt; Bezeichner wie `to_line` bleiben.
const SUBSCRIPT_RE = /(?<![0-9A-Za-zÄÖÜäöüß_\\])([A-Za-zΑ-Ωα-ω])_(?:\{([^}]{1,24})\}|([A-Za-z0-9ÄÖÜäöü]{1,8}))/g;

/** Zeilen, die einzeln stehen sollen (text_lines im Generator). */
export function textLines(text) {
  const lines = String(text).split('\n');
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const line = lines[i];
    const hard = LIST_START_RE.test(line)
      || (ASSIGN_START_RE.test(prev) && ASSIGN_START_RE.test(line))
      || (prev.trimEnd().endsWith(':') && line.startsWith(' '))
      || GAP_RE.test(prev) || GAP_RE.test(line)
      || prev.trimEnd().length < HARD_BREAK_BELOW;
    if (hard) out.push(line);
    else out[out.length - 1] = `${out[out.length - 1].trimEnd()} ${line.trimStart()}`;
  }
  return out;
}

/** Text → HTML: gewollte Umbrüche als <br>, Indizes tiefgestellt. */
export function richText(text) {
  return textLines(text).map((line) => {
    let html = '';
    let pos = 0;
    for (const m of line.matchAll(SUBSCRIPT_RE)) {
      html += esc((line.slice(pos, m.index) + m[1]).replace(/\\_/g, '_'));
      html += `<sub>${esc(m[2] || m[3])}</sub>`;
      pos = m.index + m[0].length;
    }
    return html + esc(line.slice(pos).replace(/\\_/g, '_'));
  }).join('<br>');
}

// ==================== Formeln (StarMath → MathML) ====================

export class StarMathError extends Error {}

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  omicron: 'ο', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ',
  upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
};
const RELATIONS = { '=': '=', '<>': '≠', '<': '<', '>': '>', '<=': '≤', '>=': '≥', '->': '→',
  approx: '≈', ne: '≠', le: '≤', ge: '≥', leslant: '⩽', geslant: '⩾', sim: '∼', simeq: '≃',
  equiv: '≡', prop: '∝', toward: '→', def: '≝' };
const PRODUCTS = { cdot: '·', times: '×', div: '÷', '/': '/', '*': '∗' };
const SUMS = { '+': '+', '-': '−', '+-': '±', '-+': '∓', plusminus: '±', minusplus: '∓' };
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lg', 'exp', 'lim', 'min', 'max']);
const SYMBOLS = { infinity: '∞', infty: '∞', partial: '∂', nabla: '∇', dlarrow: '⇐', drarrow: '⇒',
  dlrarrow: '⇔', degree: '°', dotsaxis: '⋯', dotslow: '…', percent: '%' };
const BRACKETS = { '(': '(', ')': ')', '[': '[', ']': ']', lbrace: '{', rbrace: '}', langle: '⟨',
  rangle: '⟩', lline: '|', rline: '|', ldline: '‖', rdline: '‖', lfloor: '⌊', rfloor: '⌋',
  lceil: '⌈', rceil: '⌉', none: '' };
const STOP = new Set(['}', ')', ']', 'right']);
const COLOR_RE = /^(black|blue|green|red|cyan|magenta|yellow|gray|grey|white|lime|maroon|navy|olive|purple|silver|teal|orange)$/;

function tokenize(src) {
  const tokens = [];
  const re = /\s+|"([^"]*)"|%([A-Za-z]+)|(\d+(?:[.,]\d+)?)|([A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß]*)|(<=|>=|<>|->|\+-|-\+|[{}()[\]^_~`=<>+\-*/,;:!'|.])/y;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new StarMathError(`unbekanntes Zeichen „${src[pos]}“ an Stelle ${pos + 1}`);
    pos = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ kind: 'text', value: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: 'greek', value: m[2] });
    else if (m[3] !== undefined) tokens.push({ kind: 'num', value: m[3] });
    else if (m[4] !== undefined) tokens.push({ kind: 'id', value: m[4] });
    else if (m[5] !== undefined) tokens.push({ kind: 'op', value: m[5] });
  }
  return tokens;
}

class StarMathParser {
  constructor(src) {
    this.tokens = tokenize(src);
    this.i = 0;
  }

  peek() { return this.tokens[this.i]; }
  next() { return this.tokens[this.i++]; }
  is(value) { const t = this.peek(); return !!t && (t.kind === 'op' || t.kind === 'id') && t.value === value; }

  expect(value) {
    if (!this.is(value)) throw new StarMathError(`„${value}“ erwartet${this.peek() ? `, gefunden „${this.peek().value}“` : ' am Ende'}`);
    this.next();
  }

  atStop() {
    const t = this.peek();
    return !t || ((t.kind === 'op' || t.kind === 'id') && STOP.has(t.value));
  }

  parse() {
    const out = this.expression();
    if (this.peek()) throw new StarMathError(`„${this.peek().value}“ ohne passende öffnende Klammer`);
    return out;
  }

  /** Relationen: a = b approx c */
  expression() {
    let out = this.sum();
    for (;;) {
      const t = this.peek();
      if (t && (t.kind === 'op' || t.kind === 'id') && Object.prototype.hasOwnProperty.call(RELATIONS, t.value)) {
        this.next();
        out += `<mo>${RELATIONS[t.value]}</mo>` + this.sum();
      } else return out;
    }
  }

  sum() {
    let out = '';
    const sign = this.peek();
    if (sign && sign.kind === 'op' && SUMS[sign.value]) { this.next(); out += `<mo form="prefix">${SUMS[sign.value]}</mo>`; }
    if (this.atStop()) return out;
    out += this.product();
    for (;;) {
      const t = this.peek();
      if (t && (t.kind === 'op' || t.kind === 'id') && SUMS[t.value]) {
        this.next();
        out += `<mo>${SUMS[t.value]}</mo>` + this.product();
      } else return out;
    }
  }

  /** Produkt, Bruch (`over`) und Nebeneinanderstellen (`2 x`, `"Text" ~ x`). */
  product() {
    let out = this.power();
    for (;;) {
      const t = this.peek();
      if (!t || this.atStop()) return out;
      if (t.kind === 'id' && t.value === 'over') {
        this.next();
        out = `<mfrac><mrow>${out}</mrow><mrow>${this.power()}</mrow></mfrac>`;
      } else if ((t.kind === 'op' || t.kind === 'id') && PRODUCTS[t.value]) {
        this.next();
        out += `<mo>${PRODUCTS[t.value]}</mo>` + this.power();
      } else if (this.startsTerm(t)) {
        out += this.power();
      } else return out;
    }
  }

  startsTerm(t) {
    if (t.kind !== 'op' && t.kind !== 'id') return true;
    if (t.kind === 'id') {
      return !['over', 'sub', 'sup', 'right'].includes(t.value)
        && !Object.prototype.hasOwnProperty.call(RELATIONS, t.value)
        && !PRODUCTS[t.value] && !SUMS[t.value];
    }
    return ['{', '(', '[', '~', '`', ',', ';', ':', '!', "'", '|', '.'].includes(t.value);
  }

  /** Hoch- und Tiefstellung: X_C^2 */
  power() {
    const base = this.term();
    let sub = null;
    let sup = null;
    for (;;) {
      if (this.is('_') || this.is('sub')) { this.next(); sub = this.term(); }
      else if (this.is('^') || this.is('sup')) { this.next(); sup = this.term(); }
      else break;
    }
    if (sub !== null && sup !== null) return `<msubsup><mrow>${base}</mrow><mrow>${sub}</mrow><mrow>${sup}</mrow></msubsup>`;
    if (sub !== null) return `<msub><mrow>${base}</mrow><mrow>${sub}</mrow></msub>`;
    if (sup !== null) return `<msup><mrow>${base}</mrow><mrow>${sup}</mrow></msup>`;
    return base;
  }

  group(close) {
    const inner = this.expression();
    this.expect(close);
    return inner;
  }

  bracket() {
    const t = this.next();
    if (!t || !Object.prototype.hasOwnProperty.call(BRACKETS, t.value)) {
      throw new StarMathError(`Klammer nach left/right erwartet${t ? `, gefunden „${t.value}“` : ''}`);
    }
    return BRACKETS[t.value];
  }

  term() {
    const t = this.next();
    if (!t) throw new StarMathError('Formel endet unerwartet');
    if (t.kind === 'num') return `<mn>${esc(t.value)}</mn>`;
    if (t.kind === 'text') return `<mtext>${esc(t.value)}</mtext>`;
    if (t.kind === 'greek') {
      // %pi steil, %ipi kursiv (wie im Formeleditor); %iota ist ein Buchstabe.
      let name = t.value;
      const italic = !GREEK[name.toLowerCase()] && name[0] === 'i' && !!GREEK[name.slice(1).toLowerCase()];
      if (italic) name = name.slice(1);
      const lower = name.toLowerCase();
      if (!GREEK[lower]) throw new StarMathError(`unbekanntes Symbol %${t.value}`);
      const ch = name[0] === name[0].toUpperCase() ? GREEK[lower].toUpperCase() : GREEK[lower];
      return italic ? `<mi>${ch}</mi>` : `<mi mathvariant="normal">${ch}</mi>`;
    }
    if (t.kind === 'op') {
      switch (t.value) {
        case '{': return `<mrow>${this.group('}')}</mrow>`;
        case '(': return `<mrow><mo>(</mo>${this.group(')')}<mo>)</mo></mrow>`;
        case '[': return `<mrow><mo>[</mo>${this.group(']')}<mo>]</mo></mrow>`;
        case '~': return '<mspace width="0.5em"></mspace>';
        case '`': return '<mspace width="0.17em"></mspace>';
        default:
          if (STOP.has(t.value) || t.value === '^' || t.value === '_') throw new StarMathError(`„${t.value}“ an unerwarteter Stelle`);
          return `<mo>${esc(t.value)}</mo>`;
      }
    }
    // Wörter
    switch (t.value) {
      case 'sqrt': return `<msqrt>${this.power()}</msqrt>`;
      case 'nroot': {
        const n = this.term();
        return `<mroot><mrow>${this.power()}</mrow><mrow>${n}</mrow></mroot>`;
      }
      case 'abs': return `<mrow><mo>|</mo>${this.power()}<mo>|</mo></mrow>`;
      case 'left': {
        const open = this.bracket();
        const inner = this.expression();
        this.expect('right');
        const close = this.bracket();
        return `<mrow><mo stretchy="true">${esc(open)}</mo>${inner}<mo stretchy="true">${esc(close)}</mo></mrow>`;
      }
      case 'func': {
        const name = this.next();
        if (!name || name.kind !== 'id') throw new StarMathError('Name nach func erwartet');
        return `<mi mathvariant="normal">${esc(name.value)}</mi>`;
      }
      case 'color': {
        const c = this.next();
        if (!c || !COLOR_RE.test(c.value)) throw new StarMathError('Farbe nach color erwartet');
        return `<mstyle mathcolor="${c.value}">${this.power()}</mstyle>`;
      }
      case 'bold': return `<mstyle mathvariant="bold">${this.power()}</mstyle>`;
      case 'ital': case 'nitalic': case 'nbold': case 'italic': return this.power();
      default: break;
    }
    if (FUNCTIONS.has(t.value)) return `<mi>${t.value}</mi>`;
    if (SYMBOLS[t.value]) return `<mi mathvariant="normal">${SYMBOLS[t.value]}</mi>`;
    if (['over', 'sub', 'sup', 'right'].includes(t.value)) throw new StarMathError(`„${t.value}“ an unerwarteter Stelle`);
    // Variablen kursiv wie im Formeleditor – auch mehrbuchstabige.
    return t.value.length === 1 ? `<mi>${esc(t.value)}</mi>` : `<mi style="font-style:italic">${esc(t.value)}</mi>`;
  }
}

/** StarMath (Formeleditor von LibreOffice) → MathML. Wirft StarMathError. */
export function starmathToMathml(src) {
  const body = new StarMathParser(String(src)).parse();
  return `<math display="block"><mrow>${body}</mrow></math>`;
}

// ==================== HTML ====================

/**
 * Spec → HTML für die Anzeige in der App. Lösungen stehen im HTML, sind aber
 * ausgeblendet, solange der Container die Klasse `ds-hide-solutions` trägt
 * (options.showSolutions = true lässt sie weg).
 * options.showPageBreaks zeigt Seitenumbrüche als Linie (Editor-Vorschau).
 */
export function renderDocSpecHtml(spec, options = {}) {
  const ctx = { counters: [0, 0, 0], options };
  const body = Array.isArray(spec?.content) ? renderBlocksHtml(spec.content, ctx) : '';
  return `<div class="docspec${options.showSolutions ? '' : ' ds-hide-solutions'}">${body}</div>`;
}

function renderBlocksHtml(blocks, ctx) {
  return (blocks || []).map((b) => renderBlockHtml(b, ctx)).join('');
}

function headingNumber(type, c) {
  if (type === 'section') { c[0]++; c[1] = 0; c[2] = 0; return `${c[0]}.`; }
  if (type === 'task') { c[1]++; c[2] = 0; return `${c[0]}.${c[1]}`; }
  c[2]++;
  return `${c[0]}.${c[1]}.${c[2]}`;
}

function paragraphs(text, cls = 'ds-text') {
  return String(text).split('\n\n').map((p) => `<p class="${cls}">${richText(p.trim())}</p>`).join('');
}

function renderBlockHtml(block, ctx) {
  if (isText(block)) block = { type: 'text', text: block };
  if (!block || typeof block !== 'object') return '';
  const type = block.type || 'text';
  switch (type) {
    case 'section':
    case 'task':
    case 'subtask': {
      const level = HEADING_TYPES.indexOf(type) + 2; // h2 … h4 (h1 ist der Modultitel)
      const title = block.title !== undefined ? block.title : block.text;
      let html = `<h${level} class="ds-heading ds-${type}"><span class="ds-num">${headingNumber(type, ctx.counters)}</span> ${richText(title ?? '')}</h${level}>`;
      if (block.title !== undefined && isText(block.text)) html += paragraphs(block.text);
      return html + renderBlocksHtml(block.blocks, ctx);
    }
    case 'text':
      return isText(block.text) ? paragraphs(block.text) : '';
    case 'note':
      return isText(block.text) ? `<p class="ds-note"><em>${richText(block.text)}</em></p>` : '';
    case 'list':
      return `<ul class="ds-list">${(block.items || []).map((it) => `<li>${richText(it)}</li>`).join('')}</ul>`;
    case 'code': {
      const caption = isText(block.caption) ? `<p class="ds-caption"><em>${esc(block.caption)}</em></p>` : '';
      const code = isText(block.code)
        ? esc(block.code)
        : `<span class="ds-missing">Code aus Datei ${esc(block.file ?? '')}</span>`;
      return `${caption}<pre class="ds-code"><code>${code}</code></pre>`;
    }
    case 'image': {
      const width = CSS_LENGTH_RE.test(String(block.width ?? '')) ? ` style="width:${block.width}"` : '';
      const img = isText(block.src) && IMAGE_SRC_RE.test(String(block.src))
        ? `<img src="${esc(block.src)}" alt="${esc(block.alt ?? block.caption ?? '')}"${width}>`
        : `<span class="ds-missing">Bild ${esc(block.file ?? '')}</span>`;
      const caption = isText(block.caption) ? `<figcaption>${richText(block.caption)}</figcaption>` : '';
      return `<figure class="ds-image">${img}${caption}</figure>`;
    }
    case 'table': {
      const caption = isText(block.caption) ? `<p class="ds-caption"><em>${esc(block.caption)}</em></p>` : '';
      const head = Array.isArray(block.header)
        ? `<thead><tr>${block.header.map((c) => `<th>${richText(c ?? '')}</th>`).join('')}</tr></thead>` : '';
      const rows = (block.rows || []).filter(Array.isArray)
        .map((r) => `<tr>${r.map((c) => `<td>${richText(c ?? '')}</td>`).join('')}</tr>`).join('');
      return `${caption}<div class="ds-table-wrap"><table class="ds-table">${head}<tbody>${rows}</tbody></table></div>`;
    }
    case 'formula': {
      const align = block.align === 'left' ? ' ds-formula-left' : '';
      let math;
      try { math = starmathToMathml(block.math ?? ''); } catch (e) { math = `<code class="ds-missing">${esc(block.math ?? '')}</code>`; }
      return `<div class="ds-formula${align}">${math}</div>`;
    }
    case 'solution': {
      const label = isText(block.title) ? block.title : 'Lösung:';
      return `<div class="ds-solution"><p class="ds-solution-label">${esc(label)}</p>` +
        (isText(block.text) ? paragraphs(block.text) : '') + renderBlocksHtml(block.blocks, ctx) + '</div>';
    }
    case 'karo': {
      const lines = Number.isInteger(block.lines) ? block.lines : 4;
      return `<div class="ds-karo" style="height:${lines * 0.5}cm" aria-hidden="true"></div>`;
    }
    case 'spacer': {
      const lines = Number.isInteger(block.lines) ? block.lines : 3;
      return `<div class="ds-spacer" style="height:${lines * 1.4}em"></div>`;
    }
    case 'pagebreak':
      return ctx.options.showPageBreaks ? '<div class="ds-pagebreak"><span>Seitenumbruch</span></div>' : '';
    default:
      return '';
  }
}
