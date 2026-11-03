#!/usr/bin/env node
/**
 * Dokumente gegen das neue Modell prüfen (Plan lm-editor, Phase 9.2):
 *   node scripts/check-doc-pm.mjs <Ordner mit .json/.yaml, z. B. Lehrer-Backup>
 *
 * Nur lesend. Je Dokument: Spec → ProseMirror-JSON → Spec. Das Blatt muss gleich
 * aussehen, alle Felder müssen erhalten bleiben, das JSON muss zum Schema passen.
 * Dazu Phase 9.3: JSON → Markdown → JSON ergibt genau dieselbe Spec.
 * Die Ausgabe nennt Dateinamen und Stellen – keine ganzen Inhalte.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from '../src/renderer/js/vendor/js-yaml.js';
import { specToPm, pmToSpec } from '../src/renderer/lm-editor/src/doc/pm-convert.js';
import { pmToMarkdown, markdownToPm } from '../src/renderer/lm-editor/src/doc/pm-markdown.js';
import { renderDocSpecHtml, validateDocSpec } from '../src/renderer/lm-editor/src/doc/docspec.js';
import { pmSchema } from '../src/renderer/lm-editor/src/doc/pm-tiptap.js';
import { PmNode } from '../src/renderer/lm-editor/src/vendor/tiptap/tiptap.mjs';

const root = process.argv[2];
if (!root) { console.error('Aufruf: node scripts/check-doc-pm.mjs <Ordner>'); process.exit(2); }

const SPEC_HINT = ['section', 'task', 'text', 'karo', 'heading', 'subtask', 'table', 'list'];
const specs = [];
function collect(o, src) {
  if (Array.isArray(o)) { o.forEach((v) => collect(v, src)); return; }
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o.content) && o.content.some((b) => b && SPEC_HINT.includes(b.type))) { specs.push([src, o]); return; }
  for (const v of Object.values(o)) {
    if (typeof v === 'string' && v[0] === '{' && v.slice(0, 4000).includes('"content"')) {
      try { collect(JSON.parse(v), src); } catch (_) { /* kein JSON */ }
    } else collect(v, src);
  }
}
const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of files(root)) {
  try {
    if (f.endsWith('.json')) collect(JSON.parse(fs.readFileSync(f, 'utf8')), f);
    else if (f.endsWith('.yaml') || f.endsWith('.yml')) collect(yaml.load(fs.readFileSync(f, 'utf8')), f);
  } catch (_) { /* keine lesbare Datei */ }
}

const INLINE = 'strong|em|u|s|sub|sup|code';
/** Gleiches Aussehen: Schachtelung und gestückelte gleiche Auszeichnungen zählen nicht. */
function canon(html) {
  let h = html;
  for (let prev = ''; prev !== h;) {
    prev = h;
    h = h.replace(new RegExp(`</(${INLINE})>(?:<!---->)?<\\1>`, 'g'), '')
      .replace(/(<span class="ds-color"[^>]*>)((?:(?!<\/?span)[\s\S])*)<\/span>\1/g, '$1$2');
  }
  const sorted = (m) => m.match(/<[^>]+>/g).sort().join('');
  return h.replace(new RegExp(`(?:<(?:${INLINE})>){2,}`, 'g'), sorted).replace(new RegExp(`(?:</(?:${INLINE})>){2,}`, 'g'), sorted);
}

const CONTENT_KEYS = new Set(['text', 'title', 'items', 'header', 'rows', 'blocks', 'type', 'level', 'ordered', 'code']);
/** Alle übrigen Felder der Bausteine, flach in Reihenfolge – auch was die Anzeige nicht zeigt (id, source …). */
function fieldsOf(blocks, out = []) {
  for (const b of blocks || []) {
    if (!b || typeof b !== 'object') continue;
    const rest = Object.entries(b).filter(([k, v]) => !CONTENT_KEYS.has(k) && v !== undefined && v !== null);
    out.push(JSON.stringify([b.type || 'text', ...rest.sort(([a], [c]) => a.localeCompare(c))]));
    fieldsOf(b.blocks, out);
    if (b.type === 'table') for (const r of [b.header, ...(b.rows || [])]) if (Array.isArray(r)) for (const c of r) if (c && typeof c === 'object') fieldsOf(c.blocks, out);
  }
  return out;
}
/** Aus { title, text } wird beim Auspacken ein Absatz dahinter – ohne eigene Felder; aus box/solution.text ebenso. */
const withoutPlainTexts = (list) => list.filter((f) => f !== '["text"]');

/** JSON ohne Rücksicht auf die Reihenfolge der Schlüssel. */
const sortedJson = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

const schema = pmSchema();
const opt = { showSolutions: true };
const res = { gleich: 0, anders: [], felder: [], schema: [], stabil: 0, gueltig: 0, fehler: [], md: [], mdStabil: 0, mdSchema: [] };
let blocks = 0;
let mdSize = 0;
let jsonSize = 0;
for (const [src, spec] of specs) {
  const name = path.relative(root, src);
  try {
    const pm = specToPm(spec);
    const back = pmToSpec(pm);
    blocks += fieldsOf(spec.content).length;
    const a = canon(renderDocSpecHtml(spec, opt));
    const b = canon(renderDocSpecHtml(back, opt));
    if (a === b) res.gleich++;
    else {
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      res.anders.push(`${name} @${i}: …${a.slice(Math.max(0, i - 40), i + 40)}… ≠ …${b.slice(Math.max(0, i - 40), i + 40)}…`);
    }
    const fa = withoutPlainTexts(fieldsOf(spec.content));
    const fb = withoutPlainTexts(fieldsOf(back.content));
    if (JSON.stringify(fa) !== JSON.stringify(fb)) {
      const k = fa.findIndex((x, n) => x !== fb[n]);
      res.felder.push(`${name}: ${String(fa[k]).slice(0, 90)} ≠ ${String(fb[k]).slice(0, 90)}`);
    }
    if (JSON.stringify(pmToSpec(specToPm(back))) === JSON.stringify(back)) res.stabil++;
    if (validateDocSpec(back).length <= validateDocSpec(spec).length) res.gueltig++;
    try {
      const node = PmNode.fromJSON(schema, pm);
      node.check();
      // Über das echte Schema und zurück: dasselbe Dokument.
      const viaSchema = sortedJson(pmToSpec(node.toJSON()));
      if (viaSchema !== sortedJson(back)) {
        const want = sortedJson(back);
        let i = 0;
        while (i < want.length && want[i] === viaSchema[i]) i++;
        res.schema.push(`${name}: anders nach dem Schema @${i}: …${want.slice(Math.max(0, i - 50), i + 50)}… ≠ …${viaSchema.slice(Math.max(0, i - 50), i + 50)}…`);
      }
    } catch (e) { res.schema.push(`${name}: ${e.message.slice(0, 160)}`); }
    const text = pmToMarkdown(pm);
    mdSize += text.length;
    jsonSize += JSON.stringify(spec).length;
    const viaMd = markdownToPm(text);
    const want = sortedJson(back);
    const got = sortedJson(pmToSpec(viaMd));
    if (got !== want) {
      let i = 0;
      while (i < want.length && want[i] === got[i]) i++;
      res.md.push(`${name} @${i}: …${want.slice(Math.max(0, i - 50), i + 50)}… ≠ …${got.slice(Math.max(0, i - 50), i + 50)}…`);
    }
    if (pmToMarkdown(viaMd) === text) res.mdStabil++;
    try { PmNode.fromJSON(schema, viaMd).check(); } catch (e) { res.mdSchema.push(`${name}: ${e.message.slice(0, 160)}`); }
  } catch (e) { res.fehler.push(`${name}: ${e.message}`); }
}
const n = specs.length;
console.log(`${n} Dokumente, ${blocks} Bausteine`);
console.log(`  sieht gleich aus:        ${res.gleich}/${n}`);
console.log(`  alle Felder erhalten:    ${n - res.felder.length}/${n}`);
console.log(`  passt zum Schema:        ${n - res.schema.length}/${n}`);
console.log(`  zweiter Durchlauf gleich: ${res.stabil}/${n}`);
console.log(`  keine neuen Spec-Fehler: ${res.gueltig}/${n}`);
console.log(`  Markdown ergibt dasselbe: ${n - res.md.length}/${n}`);
console.log(`  Markdown stabil:          ${res.mdStabil}/${n}`);
console.log(`  Markdown passt zum Schema: ${n - res.mdSchema.length}/${n}`);
console.log(`  Markdown ${Math.round(mdSize / 1024)} KB statt JSON ${Math.round(jsonSize / 1024)} KB`);
console.log(`  Ausnahmen:               ${res.fehler.length}`);
for (const [title, list] of [['Anders', res.anders], ['Felder', res.felder], ['Schema', res.schema], ['Markdown', res.md], ['MD-Schema', res.mdSchema], ['Ausnahme', res.fehler]]) {
  for (const line of list.slice(0, 8)) console.log(`${title}: ${line}`);
}
process.exit(res.anders.length + res.felder.length + res.schema.length + res.md.length + res.mdSchema.length + res.fehler.length || res.mdStabil !== n ? 1 : 0);
