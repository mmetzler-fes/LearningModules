#!/usr/bin/env node
// Python-Pakete für den Python-Block (numpy, matplotlib …) einmal holen und vom eigenen Server ausliefern.
//
// Das npm-Paket „pyodide“ bringt nur Python selbst mit. Die Pakete stehen in seiner pyodide-lock.json
// (Dateiname, Prüfsumme, Abhängigkeiten); dieses Skript lädt sie aus der Veröffentlichung derselben
// Version und prüft jede Datei gegen die Prüfsumme. Danach fragt kein Browser mehr bei fremden Diensten an:
// Der Server liefert vendor/pyodide-packages/ unter /vendor/pyodide/ aus (app.module.ts).
//
//   node scripts/fetch-pyodide-packages.mjs            # Standard-Pakete
//   node scripts/fetch-pyodide-packages.mjs sympy      # zusätzlich weitere
//
// Läuft beim Bau des Docker-Images (Dockerfile); lokal einmal nach bun install.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT = ['numpy', 'matplotlib'];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pyodideDir = dirname(require.resolve('pyodide/package.json'));
const version = JSON.parse(readFileSync(join(pyodideDir, 'package.json'), 'utf8')).version;
const lock = JSON.parse(readFileSync(join(pyodideDir, 'pyodide-lock.json'), 'utf8'));
const out = join(root, 'vendor', 'pyodide-packages');
const base = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

const wanted = new Set();
const add = (name) => {
  const key = name.toLowerCase();
  if (wanted.has(key)) return;
  const pkg = lock.packages[key];
  if (!pkg) throw new Error(`Paket „${name}“ gibt es in Pyodide ${version} nicht.`);
  wanted.add(key);
  for (const dep of pkg.depends || []) add(dep);
};
for (const name of [...DEFAULT, ...process.argv.slice(2)]) add(name);

mkdirSync(out, { recursive: true });
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
let fetched = 0;
for (const key of wanted) {
  const { file_name: file, sha256: sum } = lock.packages[key];
  const target = join(out, file);
  if (existsSync(target) && sha256(readFileSync(target)) === sum) continue;
  const res = await fetch(base + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== sum) throw new Error(`${file}: Prüfsumme stimmt nicht – Datei verworfen.`);
  writeFileSync(target, buf);
  fetched++;
  console.log(`✓ ${file} (${(buf.length / 1e6).toFixed(1)} MB)`);
}
console.log(`Pyodide ${version}: ${wanted.size} Pakete in vendor/pyodide-packages (${fetched} neu geladen).`);
