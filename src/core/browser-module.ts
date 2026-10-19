import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Ein Browser-Modul aus src/renderer/js im Server bzw. in den Tests laden –
 * für Logik, die es nur einmal geben soll (z. B. puzzles.js, json-text.js).
 * Die Datei darf nichts importieren; "export" wird entfernt und die Namen
 * werden eingesammelt. Wie formula-engine.ts, nur allgemein.
 */
const cache = new Map<string, unknown>();

export function loadBrowserModule<T>(file: string): T {
  if (cache.has(file)) return cache.get(file) as T;
  const candidates = [
    path.resolve(__dirname, '../renderer/js', file), // src/core (Tests)
    path.resolve(__dirname, '../../src/renderer/js', file), // dist/core
    path.resolve(process.cwd(), 'src/renderer/js', file),
  ];
  const found = candidates.find((f) => fs.existsSync(f));
  if (!found) throw new Error(`src/renderer/js/${file} fehlt.`);
  const names: string[] = [];
  const source = fs.readFileSync(found, 'utf-8').replace(/^export (class|function|const) (\w+)/gm, (_m, kind: string, name: string) => {
    names.push(name);
    return `${kind} ${name}`;
  });
  const sandbox: { __out?: T } = {};
  vm.runInNewContext(`${source}\n;__out = { ${names.join(', ')} };`, sandbox, { filename: found });
  cache.set(file, sandbox.__out);
  return sandbox.__out as T;
}
