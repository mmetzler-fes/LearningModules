// Formelaufgaben: Formeln lesen, rechnen, Zufallswerte, Zahlen prüfen.
//
// Eine Datei für Browser UND Server (der Server lädt sie über
// src/core/formula/formula-engine.ts) – deshalb ohne import, ohne DOM, und
// "export" nur vor class/function/const am Zeilenanfang.
//
// Formeln: + - * / ^, Klammern, Zahlen mit Punkt (1.5, 2e-3), Variablen als
// Name oder {Name} (wie in Moodle), Funktionen wie sqrt(x), sin(x) (Bogenmaß),
// deg2rad(x), pow(a,b), pi oder pi(). Potenz bindet stärker als das
// Vorzeichen: -2^2 = -4.

export class FormulaError extends Error {}

const FUNCS = {
  sqrt: [1, Math.sqrt], abs: [1, Math.abs], exp: [1, Math.exp],
  ln: [1, Math.log], log: [1, Math.log], log10: [1, Math.log10], log2: [1, Math.log2],
  sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan],
  asin: [1, Math.asin], acos: [1, Math.acos], atan: [1, Math.atan], atan2: [2, Math.atan2],
  sinh: [1, Math.sinh], cosh: [1, Math.cosh], tanh: [1, Math.tanh],
  deg2rad: [1, (x) => (x * Math.PI) / 180], rad2deg: [1, (x) => (x * 180) / Math.PI],
  pow: [2, Math.pow], min: [-1, Math.min], max: [-1, Math.max],
  round: [1, Math.round], floor: [1, Math.floor], ceil: [1, Math.ceil],
  fmod: [2, (a, b) => a % b],
  pi: [0, () => Math.PI],
};
const CONSTANTS = { pi: Math.PI, e: Math.E };

/** Zerlegt eine Formel in Teile; wirft FormulaError mit verständlicher Meldung. */
function tokenize(src) {
  const s = String(src ?? '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
    if (num) { out.push({ t: 'num', v: parseFloat(num[0]), at: i }); i += num[0].length; continue; }
    const brace = /^\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/.exec(s.slice(i));
    if (brace) { out.push({ t: 'id', v: brace[1], braced: true, at: i }); i += brace[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[0], at: i }); i += id[0].length; continue; }
    if ('+-*/^(),'.includes(c)) { out.push({ t: c, at: i }); i++; continue; }
    if (c === '·' || c === '×') { out.push({ t: '*', at: i }); i++; continue; }
    if (c === '−') { out.push({ t: '-', at: i }); i++; continue; }
    throw new FormulaError(`Unbekanntes Zeichen „${c}“ an Stelle ${i + 1}`);
  }
  return out;
}

/** Formel → Syntaxbaum. */
export function parseFormula(src) {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const take = (t) => {
    if (peek()?.t !== t) {
      const got = peek() ? `„${peek().t === 'id' || peek().t === 'num' ? peek().v : peek().t}“` : 'das Ende';
      throw new FormulaError(`Erwartet „${t}“, gefunden ${got}`);
    }
    return tokens[p++];
  };
  function expr() {
    let a = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) { const op = tokens[p++].t; a = { t: 'bin', op, a, b: term() }; }
    return a;
  }
  function term() {
    let a = unary();
    while (peek() && (peek().t === '*' || peek().t === '/')) { const op = tokens[p++].t; a = { t: 'bin', op, a, b: unary() }; }
    return a;
  }
  function unary() {
    if (peek()?.t === '-') { p++; return { t: 'neg', a: unary() }; }
    if (peek()?.t === '+') { p++; return unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (peek()?.t === '^') { p++; return { t: 'bin', op: '^', a: base, b: unary() }; }
    return base;
  }
  function primary() {
    const tok = peek();
    if (!tok) throw new FormulaError('Die Formel endet zu früh');
    if (tok.t === 'num') { p++; return { t: 'num', v: tok.v }; }
    if (tok.t === '(') { p++; const e = expr(); take(')'); return e; }
    if (tok.t === 'id') {
      p++;
      if (!tok.braced && peek()?.t === '(') {
        const name = tok.v.toLowerCase();
        if (!FUNCS[name]) throw new FormulaError(`Unbekannte Funktion „${tok.v}“`);
        p++;
        const args = [];
        if (peek()?.t !== ')') {
          args.push(expr());
          while (peek()?.t === ',') { p++; args.push(expr()); }
        }
        take(')');
        const arity = FUNCS[name][0];
        if (arity >= 0 && args.length !== arity) {
          throw new FormulaError(`${name}() braucht ${arity} Argument${arity === 1 ? '' : 'e'}`);
        }
        return { t: 'call', f: name, args };
      }
      return { t: 'var', n: tok.v, braced: !!tok.braced };
    }
    throw new FormulaError(`Unerwartet „${tok.t}“`);
  }
  if (!tokens.length) throw new FormulaError('Die Formel ist leer');
  const tree = expr();
  if (p < tokens.length) {
    const t = tokens[p];
    if (t.t === ',') throw new FormulaError('Dezimalzahlen mit Punkt schreiben (1.5 statt 1,5) – Komma nur zwischen Funktionsargumenten');
    throw new FormulaError(t.t === 'id' || t.t === 'num' || t.t === '('
      ? `Fehlt ein Rechenzeichen vor „${t.t === '(' ? '(' : t.v}“?` : `Unerwartet „${t.t}“`);
  }
  return tree;
}

/** Namen der Variablen in einer Formel (ohne Konstanten pi und e). */
export function variablesOf(src) {
  const names = new Set();
  const walk = (n) => {
    if (n.t === 'var' && (n.braced || !(n.n.toLowerCase() in CONSTANTS))) names.add(n.n);
    if (n.a) walk(n.a);
    if (n.b) walk(n.b);
    if (n.args) n.args.forEach(walk);
  };
  walk(typeof src === 'string' ? parseFormula(src) : src);
  return [...names];
}

/** Rechnet die Formel mit den Werten; unbekannte Variablen sind ein Fehler. */
export function evaluate(src, values = {}) {
  const tree = typeof src === 'string' ? parseFormula(src) : src;
  const run = (n) => {
    switch (n.t) {
      case 'num': return n.v;
      case 'var': {
        if (Object.prototype.hasOwnProperty.call(values, n.n)) return Number(values[n.n]);
        const c = CONSTANTS[n.n.toLowerCase()];
        if (!n.braced && c !== undefined) return c;
        throw new FormulaError(`Unbekannte Variable „${n.n}“`);
      }
      case 'neg': return -run(n.a);
      case 'bin': {
        const a = run(n.a), b = run(n.b);
        if (n.op === '+') return a + b;
        if (n.op === '-') return a - b;
        if (n.op === '*') return a * b;
        if (n.op === '/') return a / b;
        return Math.pow(a, b);
      }
      case 'call': return FUNCS[n.f][1](...n.args.map(run));
      default: throw new FormulaError('Unbekannter Ausdruck');
    }
  };
  return run(tree);
}

// ---- Moodle-Schreibweise ----

const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 };

/** Formel in Moodles Schreibweise: {Variable}, pow() statt ^, pi(), exp(1). */
export function toMoodleFormula(src) {
  const show = (n, parentPrec = 0, right = false) => {
    switch (n.t) {
      case 'num': return String(n.v);
      case 'var': {
        const c = n.n.toLowerCase();
        if (!n.braced && c === 'pi') return 'pi()';
        if (!n.braced && c === 'e') return 'exp(1)';
        return `{${n.n}}`;
      }
      case 'neg': return `-(${show(n.a)})`;
      case 'call': return `${n.f === 'ln' ? 'log' : n.f}(${n.args.map((a) => show(a)).join(', ')})`;
      case 'bin': {
        if (n.op === '^') return `pow(${show(n.a)}, ${show(n.b)})`;
        const prec = PREC[n.op];
        const s = `${show(n.a, prec)} ${n.op} ${show(n.b, prec, true)}`;
        // Klammern, wo die Rangfolge sie verlangt (auch a-(b-c), a/(b*c))
        return prec < parentPrec || (right && prec === parentPrec) ? `(${s})` : s;
      }
      default: return '';
    }
  };
  return show(parseFormula(src));
}

/** Moodle-Formel → unsere Schreibweise ({a} → a; sonst gleich lesbar). */
export function fromMoodleFormula(src) {
  return String(src ?? '').replace(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g, '$1').trim();
}

// ---- Zahlen ----

/** Gerundet auf Nachkommastellen (negativ = Zehnerstellen). */
export function roundTo(v, decimals) {
  const d = Math.max(-10, Math.min(12, Math.trunc(Number(decimals) || 0)));
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

/** Deutsche Schreibweise mit festen Nachkommastellen, sehr große/kleine Zahlen wissenschaftlich. */
export function formatNumber(v, decimals = 2) {
  if (!Number.isFinite(v)) return '–';
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e9 || abs < 1e-6)) return v.toExponential(3).replace('.', ',');
  const d = Math.max(0, Math.min(12, Math.trunc(Number(decimals) || 0)));
  return roundTo(v, d).toFixed(d).replace('.', ',');
}

/** Eingabe eines Schülers → Zahl (Komma oder Punkt, 1,5e-3, Leerzeichen); sonst NaN. */
export function parseUserNumber(text) {
  let s = String(text ?? '').trim().replace(/\s+/g, '').replace(/−/g, '-');
  if (!s) return NaN;
  // 1.234,5 (Tausenderpunkt) → 1234.5; sonst Komma als Dezimalzeichen
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
  return parseFloat(s);
}

/**
 * Liegt die Antwort innerhalb der Toleranz? relative: Prozent vom richtigen
 * Wert, absolute: feste Abweichung. Der auf die angegebenen Stellen
 * gerundete Wert zählt immer als richtig.
 */
export function isWithinTolerance(given, correct, result = {}) {
  if (!Number.isFinite(given) || !Number.isFinite(correct)) return false;
  const tol = Math.abs(Number(result.tolerance ?? 1)) || 0;
  const diff = Math.abs(given - correct);
  const allowed = result.toleranceType === 'absolute' ? tol : (Math.abs(correct) * tol) / 100;
  if (diff <= allowed + 1e-12 * Math.max(1, Math.abs(correct))) return true;
  const rounded = roundTo(correct, result.decimals ?? 2);
  return Math.abs(given - rounded) <= 1e-9 * Math.max(1, Math.abs(rounded));
}

// ---- Zufallswerte ----

/**
 * Zufallswerte für alle Variablen, im Bereich und gerundet. Ergibt ein
 * Ergebnis keine gültige Zahl (z. B. Division durch 0), wird neu gezogen.
 */
export function generateValues(variables = [], results = [], random = Math.random) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const values = {};
    for (const v of variables) {
      if (!v || !v.name) continue;
      const min = Number(v.min), max = Number(v.max);
      const lo = Number.isFinite(min) ? min : 1;
      const hi = Number.isFinite(max) ? Math.max(max, lo) : lo;
      values[v.name] = roundTo(lo + random() * (hi - lo), v.decimals ?? 0);
    }
    try {
      if (results.every((r) => !r?.formula || Number.isFinite(evaluate(r.formula, values)))) return values;
    } catch (_) {
      return values; // Formelfehler meldet die Anzeige, nicht das Würfeln
    }
  }
  return null;
}

/**
 * Platzhalter im Aufgabentext ersetzen: {Name} durch den Wert der Variablen,
 * {=Formel} durch das berechnete Ergebnis.
 */
export function fillPlaceholders(text, values, variables = []) {
  const decimals = Object.fromEntries((variables || []).map((v) => [v.name, v.decimals ?? 0]));
  return String(text ?? '').replace(/\{=([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g, (m, expr, name) => {
    try {
      if (expr !== undefined) {
        const v = evaluate(expr, values);
        return formatNumber(v, Math.abs(v) >= 100 ? 1 : 3).replace(/,?0+$/, '').replace(/,$/, '');
      }
      if (name in values) return formatNumber(values[name], Math.max(0, decimals[name] ?? 0));
    } catch (_) { /* unverändert lassen */ }
    return m;
  });
}

/** Prüft eine Aufgabe für den Editor: Liste verständlicher Fehler (leer = in Ordnung). */
export function checkFormulaTask(content = {}) {
  const errors = [];
  const vars = (content.variables || []).filter((v) => v && String(v.name || '').trim());
  const names = new Set();
  for (const v of vars) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.name)) errors.push(`Variable „${v.name}“: nur Buchstaben, Ziffern und _ (nicht am Anfang eine Ziffer)`);
    if (names.has(v.name)) errors.push(`Variable „${v.name}“ ist doppelt`);
    names.add(v.name);
    if (!(Number(v.max) >= Number(v.min))) errors.push(`Variable „${v.name}“: Maximum kleiner als Minimum`);
  }
  const results = (content.results || []).filter((r) => r && String(r.formula || '').trim());
  if (!results.length) errors.push('Mindestens ein Ergebnis mit Formel angeben');
  for (const r of results) {
    const label = r.label || r.formula;
    try {
      for (const n of variablesOf(r.formula)) if (!names.has(n)) errors.push(`${label}: Variable „${n}“ ist nicht festgelegt`);
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
    }
  }
  return errors;
}
