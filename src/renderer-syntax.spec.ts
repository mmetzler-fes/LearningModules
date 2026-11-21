import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

/**
 * Syntax aller Oberflächen-Skripte als ES-Module prüfen. Ein Fehler darin (z. B. ein String, der mit
 * ' beginnt und mit ` endet) bricht im Browser das ganze Modul und alle, die es importieren – ohne
 * dass ein anderer Test es merkt.
 */
function jsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'vendor' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (/\.(m?js)$/.test(name) && !/\.min\.js$/.test(name)) out.push(p);
  }
  return out;
}

describe('Oberflächen-Skripte', () => {
  const root = join(__dirname, 'renderer');
  const files = [...jsFiles(join(root, 'js')), ...jsFiles(join(root, 'lm-editor', 'src'))];

  it('findet die Skripte', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('sind gültige ES-Module (keine Syntaxfehler)', () => {
    const errors: string[] = [];
    for (const f of files) {
      const src = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
      for (const d of (src as any).parseDiagnostics || []) {
        const { line } = src.getLineAndCharacterOfPosition(d.start || 0);
        errors.push(`${f.slice(root.length + 1)}:${line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
      }
    }
    expect(errors).toEqual([]);
  });
});
