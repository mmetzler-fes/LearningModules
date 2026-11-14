#!/usr/bin/env node
// ==================== IMPORT-PRÜFBESTAND ====================
//
// Importiert viele echte Dokumente (.odt, .doc, .docx) mit demselben Weg wie die
// App (lm-editor: odt-core.js → htmlToDocSpec) und bewertet das Ergebnis
// automatisch. So zeigt jede Änderung am Import sofort, ob es insgesamt besser
// wird – und welches Blatt dabei schlechter wird.
//
//   node scripts/import-check.mjs motoren=~/Documents/temp/Test-Motoren-sortiert \
//        generator=../arbeitsblatt-generator/kurse rundreise=data/LehrerBackup/Arbeitsblätter
//   … --save data/import-check/basis.json      Ergebnis als Vergleichsstand sichern
//   … --compare data/import-check/basis.json   mit dem Vergleichsstand vergleichen
//
// .doc/.docx wandelt LibreOffice (soffice) einmal nach .odt; das Ergebnis liegt
// in data/import-check/cache (data/ ist nicht im Git). Nichts verlässt den Rechner.
// Zeichnungen, die der Server zusätzlich mit LibreOffice zeichnen lässt
// (/export-drawings), fehlen hier – bewertet wird der Nachbau.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { DOMParser, parseHTML } from 'linkedom';

const ROOT = resolve(import.meta.dirname, '..');
const LE = join(ROOT, 'src/renderer/lm-editor/src');
const CACHE = join(ROOT, 'data/import-check/cache');

// ---- DOM für htmlToDocSpec (läuft sonst im Browser) ----
const { window } = parseHTML('<!doctype html><html><body></body></html>');
class DP extends DOMParser {
  parseFromString(h, t) { return super.parseFromString(/^\s*<html/i.test(h) ? h : `<html>${/^\s*<body/i.test(h) ? h : `<body>${h}</body>`}</html>`, t); }
}
Object.assign(globalThis, { DOMParser: DP, Node: window.Node, HTMLElement: window.HTMLElement });
globalThis.window ??= window;
globalThis.document ??= window.document;
globalThis.getComputedStyle ??= () => ({});

const { odtToHtml } = await import(join(LE, 'import/odt.js'));
const { importMetrics, rateImport } = await import(join(LE, 'import/quality.js'));
const { htmlToDocSpec } = await import(join(LE, 'doc/docspec-html.js'));
const { validateDocSpec } = await import(join(LE, 'doc/docspec.js'));

// ---- Aufruf ----
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const savePath = opt('--save');
const comparePath = opt('--compare');
const only = opt('--only'); // Teil des Pfads, z. B. „Anlauf“
const groups = args.map((a) => {
  const [name, dir] = a.includes('=') ? a.split(/=(.*)/s) : [basename(a), a];
  return { name, dir: resolve(dir.replace(/^~/, homedir())) };
});
if (!groups.length) {
  console.error('Aufruf: node scripts/import-check.mjs name=ordner … [--save datei] [--compare datei] [--only teil]');
  process.exit(1);
}

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (f.startsWith('.') || f === '_Gesichert' || f === 'alt' || f === 'build') return [];
  return statSync(p).isDirectory() ? walk(p) : [p];
});

/** .doc/.docx → .odt (einmal, dann aus dem Zwischenspeicher). */
function odtBytes(file) {
  if (extname(file).toLowerCase() === '.odt') return readFileSync(file);
  mkdirSync(CACHE, { recursive: true });
  const hash = createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 16);
  const out = join(CACHE, `${hash}.odt`);
  if (!existsSync(out)) {
    const tmp = join(CACHE, hash);
    mkdirSync(tmp, { recursive: true });
    const src = join(tmp, `in${extname(file).toLowerCase()}`);
    writeFileSync(src, readFileSync(file));
    execFileSync('soffice', [`-env:UserInstallation=file://${join(CACHE, 'profil')}`, '--headless', '--convert-to', 'odt', '--outdir', tmp, src], { stdio: 'ignore', timeout: 120000 });
    writeFileSync(out, readFileSync(join(tmp, 'in.odt')));
  }
  return readFileSync(out);
}

// ---- Bewertung: dieselbe wie im Import-Bericht der App (lm-editor/src/import/quality.js) ----
const rate = (spec) => importMetrics(spec);

// ---- Durchlauf ----
const results = {};
const t0 = Date.now();
for (const g of groups) {
  const files = walk(g.dir).filter((f) => /\.(odt|docx?)$/i.test(f) && !/~lock/.test(f) && (!only || f.includes(only)));
  for (const f of files) {
    const key = `${g.name}/${relative(g.dir, f)}`;
    const start = Date.now();
    try {
      const { html, warnings } = odtToHtml(new Uint8Array(odtBytes(f)), basename(f));
      const { spec, warnings: w2 } = htmlToDocSpec(html);
      const errors = validateDocSpec(spec);
      const all = [...warnings, ...w2];
      results[key] = { group: g.name, ok: true, ms: Date.now() - start, errors: errors.length, warnings: all, level: rateImport(spec, all).level, ...rate(spec) };
    } catch (e) {
      results[key] = { group: g.name, ok: false, ms: Date.now() - start, error: String(e.message || e) };
    }
    if (Object.keys(results).length % 50 === 0) process.stderr.write(`${Object.keys(results).length} Dokumente …\n`);
  }
}
process.stderr.write(`\r${Object.keys(results).length} Dokumente in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);

// ---- Bericht ----
const sum = (list, k) => list.reduce((n, r) => n + (r[k] || 0), 0);
const line = (cells) => `| ${cells.join(' | ')} |`;
const report = [];
report.push(line(['Gruppe', 'Dok.', 'Fehler', 'leer', 'ungültig', 'über Rand', 'Text in Bildern', 'Aufgaben', 'unerkannt „Aufgabe“', 'Lösungen', 'Schreibfelder', 'unerk. Schreiblinien', 'Spalten']));
report.push(line(Array(13).fill('---')));
for (const g of [...groups.map((x) => x.name), 'gesamt']) {
  const list = Object.values(results).filter((r) => g === 'gesamt' || r.group === g);
  const ok = list.filter((r) => r.ok);
  const inImg = sum(ok, 'svgChars') / Math.max(1, sum(ok, 'svgChars') + sum(ok, 'textChars'));
  report.push(line([g, list.length, list.length - ok.length, ok.filter((r) => !r.blocks).length, ok.filter((r) => r.errors).length,
    `${sum(ok, 'overflow')} Zeilen in ${ok.filter((r) => r.overflow).length} Dok.`, `${Math.round(inImg * 100)} %`,
    sum(ok, 'tasks'), sum(ok, 'taskLike'), sum(ok, 'solutions'), sum(ok, 'karos'), sum(ok, 'writeLines'), sum(ok, 'columns')]));
}
console.log(report.join('\n'));
const levels = Object.values(results).filter((r) => r.ok).reduce((m, r) => ({ ...m, [r.level]: (m[r.level] || 0) + 1 }), {});
console.log(`\nAmpel im Import-Bericht: 🟢 ${levels.good || 0} · 🟡 ${levels.check || 0} · 🔴 ${levels.weak || 0}`);

const worst = (k, n = 8) => Object.entries(results).filter(([, r]) => r.ok && r[k]).sort((a, b) => b[1][k] - a[1][k]).slice(0, n);
for (const [k, label] of [['overflow', 'Text über den Rand (Zeilen)'], ['taskLike', 'Wie Aufgaben, aber nur Text'], ['textInImages', 'Text in Bildern (%)']]) {
  const top = worst(k);
  if (top.length) console.log(`\n**${label}**\n${top.map(([f, r]) => `- ${r[k]}  ${f}`).join('\n')}`);
}
const failed = Object.entries(results).filter(([, r]) => !r.ok);
if (failed.length) console.log(`\n**Abbrüche**\n${failed.slice(0, 15).map(([f, r]) => `- ${f}: ${r.error}`).join('\n')}`);

if (comparePath) {
  const base = JSON.parse(readFileSync(comparePath, 'utf8'));
  const KEYS = [['overflow', -1], ['textInImages', -1], ['taskLike', -1], ['writeLines', -1], ['tasks', 1], ['solutions', 1], ['karos', 1], ['columns', 1]];
  const better = []; const worse = [];
  for (const [f, r] of Object.entries(results)) {
    const b = base[f];
    if (!b) continue;
    if (b.ok && !r.ok) { worse.push(`${f}: bricht jetzt ab (${r.error})`); continue; }
    if (!r.ok) continue;
    const d = KEYS.map(([k, dir]) => [k, ((r[k] || 0) - (b[k] || 0)) * dir]).filter(([, v]) => v);
    if (b.blocks && !r.blocks) worse.push(`${f}: jetzt leer`);
    if (d.some(([, v]) => v < 0)) worse.push(`${f}: ${d.filter(([, v]) => v < 0).map(([k]) => `${k} ${b[k] || 0}→${r[k] || 0}`).join(', ')}`);
    else if (d.some(([, v]) => v > 0)) better.push(f);
  }
  console.log(`\n**Vergleich mit ${relative(ROOT, comparePath)}:** ${better.length} besser, ${worse.length} schlechter`);
  if (worse.length) console.log(worse.slice(0, 30).map((w) => `- ${w}`).join('\n'));
}
if (savePath) {
  mkdirSync(resolve(savePath, '..'), { recursive: true });
  writeFileSync(savePath, JSON.stringify(results));
  console.log(`\nGesichert: ${relative(ROOT, resolve(savePath))}`);
}
