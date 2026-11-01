#!/usr/bin/env node
// Vor dem Update auf LaTeX-Formeln prüfen: Welche Dokumente enthalten im Text
// schon etwas in der Form $…$? Ab dem Update wird das als Formel gesetzt
// (docs/dokumente.md, „Formel im Text“). Beträge wie „5 $“ oder „$5 bis $10“
// bleiben Text und werden hier nicht gemeldet. Code (`…` und Code-Bausteine)
// zählt nicht mit.
//
// Liest nur, ändert nichts – auch bei laufender App möglich. Im Container:
//
//   docker compose cp scripts/check-inline-math.mjs learningmodules-server:/app/
//   docker compose exec learningmodules-server node check-inline-math.mjs
//
// Oder lokal gegen eine Kopie: node scripts/check-inline-math.mjs --db kopie/database.sqlite
//
// Gemeldete Stellen bei Bedarf vor dem Update ändern: `\$` schreibt ein
// Dollarzeichen, das nie eine Formel beginnt.

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3');

const args = process.argv.slice(2);
const at = args.indexOf('--db');
const dbPath = at >= 0 ? args[at + 1] : 'data/database.sqlite';

// Wie INLINE_MATH_SOURCE in src/renderer/lm-editor/src/doc/docspec.js.
const MATH = /\$(?<math>[^\s$](?:[^$\n]*?[^\s$\\])?)\$(?!\d)/g;
// Felder, in denen $ wörtlich gemeint ist (wie NO_MATH_KEYS in docspec.js).
const SKIP = new Set(['code', 'math', 'latex', 'mathml', 'src', 'file', 'id', 'href']);

/** Treffer in einem Text – ohne `Code` und ohne \$. */
function hits(text) {
  const plain = text.replace(/\\\$/g, '  ').replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
  return [...plain.matchAll(MATH)].map((m) => text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 20).replace(/\n/g, ' '));
}

function walk(value, key, out) {
  if (typeof value === 'string') { if (!SKIP.has(key)) out.push(...hits(value)); }
  else if (Array.isArray(value)) value.forEach((v) => walk(v, key, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k, out);
  return out;
}

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) { console.error(`Datenbank ${dbPath}: ${err.message}`); process.exit(1); }
});
db.all("SELECT id, title, content FROM modules WHERE content LIKE '%\"spec\"%' AND content LIKE '%$%'", (err, rows) => {
  if (err) { console.error(err.message); process.exit(1); }
  let docs = 0;
  let total = 0;
  for (const row of rows) {
    let spec;
    try { spec = JSON.parse(row.content)?.spec; } catch { continue; }
    if (!spec || typeof spec !== 'object') continue;
    const found = walk(spec, '', []);
    if (!found.length) continue;
    docs++;
    total += found.length;
    console.log(`\n${row.title} (${row.id})`);
    for (const f of found) console.log(`  … ${f} …`);
  }
  console.log(docs ? `\n${total} Stelle(n) in ${docs} Dokument(en) würden als Formel gesetzt.` : 'Keine Stellen gefunden – das Update ändert an vorhandenen Texten nichts.');
  db.close();
});
