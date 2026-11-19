import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { static as serveStatic } from 'express';

/**
 * Python im Browser (Pyodide) vom eigenen Server statt von einem CDN – geht auch in Schulnetzen, die
 * fremde Seiten sperren, und kein Schüler-Browser fragt bei fremden Diensten an. Unter /vendor/pyodide/
 * stehen Python selbst (npm-Paket „pyodide“) und die Pakete dazu (numpy, matplotlib …, geholt mit
 * scripts/fetch-pyodide-packages.mjs nach vendor/pyodide-packages). Fehlt eine Datei im ersten Ordner,
 * sucht express im zweiten; der Browser fragt mit ETag nach (304, wenn unverändert).
 */
export function pyodideStatic(): Array<(req: any, res: any, next: any) => void> {
  const roots: string[] = [];
  try {
    roots.push(dirname(require.resolve('pyodide/package.json')));
  } catch {
    return [];
  }
  const packages = join(__dirname, '..', 'vendor', 'pyodide-packages');
  if (existsSync(packages)) roots.push(packages);
  return roots.map((root) => serveStatic(root, { index: false, fallthrough: true }));
}
