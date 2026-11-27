import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Ein Browser-Modul aus src/renderer/js im Server bzw. in den Tests laden –
 * für Logik, die es nur einmal geben soll (z. B. puzzles.js, json-text.js).
 * Dateien aus dem Submodul lm-editor über '../lm-editor/src/…'.
 * Importieren darf die Datei nur benannte Exporte aus Geschwisterdateien
 * (`import { a, b as c } from './x.js';` in einer Zeile) – die werden genauso
 * geladen. "export" wird entfernt und die Namen werden eingesammelt.
 *
 * Gelesen wird immer die Quelldatei unter src/renderer/js. `nest build`
 * übersetzt dieselben Dateien zusätzlich nach dist/renderer/js – als
 * CommonJS ("exports.…"), das in der Sandbox mit "exports is not defined"
 * scheitert. Deshalb zählt nur eine Datei mit echten export-Zeilen.
 */
const cache = new Map<string, unknown>();

/** Die erste vorhandene Datei, die noch echte export-Zeilen hat (nicht übersetzt). */
export function pickSourceFile(candidates: string[]): { file: string; text: string } | null {
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf-8');
    if (/^export (class|function|const) /m.test(text)) return { file, text };
  }
  return null;
}

export function loadBrowserModule<T>(file: string): T {
  if (cache.has(file)) return cache.get(file) as T;
  const candidates = [
    path.resolve(__dirname, '../../src/renderer/js', file), // dist/core → src/renderer/js
    path.resolve(process.cwd(), 'src/renderer/js', file),
    path.resolve(__dirname, '../renderer/js', file), // src/core (Tests)
  ];
  const picked = pickSourceFile(candidates);
  if (!picked) throw new Error(`src/renderer/js/${file} fehlt (oder liegt nur übersetzt vor).`);
  const names: string[] = [];
  // Importe aus Geschwisterdateien: vorher laden, die Namen als Konstanten bereitstellen.
  const imports: Record<string, unknown> = {};
  let n = 0;
  const withImports = picked.text.replace(/^import\s*\{([^}]*)\}\s*from\s*'(\.{1,2}\/[^']+)';?[ \t]*$/gm, (_m, list: string, spec: string) => {
    const key = `__imp${n++}`;
    imports[key] = loadBrowserModule(path.posix.join(path.posix.dirname(file), spec));
    const binds = list.split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/^(\w+)\s+as\s+(\w+)$/, '$1: $2'));
    return `const { ${binds.join(', ')} } = ${key};`;
  });
  if (/^import\s/m.test(withImports)) throw new Error(`${file}: nur „import { … } from './…'“ wird unterstützt.`);
  const source = withImports.replace(/^export (class|function|const) (\w+)/gm, (_m, kind: string, name: string) => {
    names.push(name);
    return `${kind} ${name}`;
  });
  // structuredClone fehlt in einem neuen Kontext (ink-print.js braucht es).
  const sandbox: { __out?: T; structuredClone: typeof structuredClone } & Record<string, unknown> = { structuredClone: (v: any) => JSON.parse(JSON.stringify(v)), ...imports };
  vm.runInNewContext(`${source}\n;__out = { ${names.join(', ')} };`, sandbox, { filename: picked.file });
  cache.set(file, sandbox.__out);
  return sandbox.__out as T;
}

/**
 * Eine mitgelieferte Bibliothek mit Default-Export (z. B.
 * '../lm-editor/src/vendor/temml/temml.mjs') – wie loadBrowserModule, aber
 * die Datei endet mit `export { name as default };`.
 */
export function loadVendorDefault<T>(file: string): T {
  if (cache.has(file)) return cache.get(file) as T;
  const candidates = [
    path.resolve(__dirname, '../../src/renderer/js', file),
    path.resolve(process.cwd(), 'src/renderer/js', file),
    path.resolve(__dirname, '../renderer/js', file),
  ];
  const found = candidates.find((f) => fs.existsSync(f));
  if (!found) throw new Error(`src/renderer/js/${file} fehlt.`);
  const text = fs.readFileSync(found, 'utf-8');
  const m = /^export \{ ([\w$]+) as default \};?\s*$/m.exec(text);
  if (!m) throw new Error(`${file} hat keinen Default-Export.`);
  const source = `${text.slice(0, m.index)}\n;__out = ${m[1]};\n${text.slice(m.index + m[0].length)}`;
  const sandbox: { __out?: T; console: Console } = { console };
  vm.runInNewContext(source, sandbox, { filename: found });
  cache.set(file, sandbox.__out);
  return sandbox.__out as T;
}
