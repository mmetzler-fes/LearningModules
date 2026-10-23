import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Ein Browser-Modul aus src/renderer/js im Server bzw. in den Tests laden –
 * für Logik, die es nur einmal geben soll (z. B. puzzles.js, json-text.js).
 * Dateien aus dem Submodul lm-editor über '../lm-editor/src/…'.
 * Die Datei darf nichts importieren; "export" wird entfernt und die Namen
 * werden eingesammelt.
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
  const source = picked.text.replace(/^export (class|function|const) (\w+)/gm, (_m, kind: string, name: string) => {
    names.push(name);
    return `${kind} ${name}`;
  });
  const sandbox: { __out?: T } = {};
  vm.runInNewContext(`${source}\n;__out = { ${names.join(', ')} };`, sandbox, { filename: picked.file });
  cache.set(file, sandbox.__out);
  return sandbox.__out as T;
}
