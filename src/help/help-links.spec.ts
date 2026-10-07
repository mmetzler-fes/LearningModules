import * as fs from 'fs';
import * as path from 'path';
import { forTeachers, slug } from './help-docs';

/**
 * Jedes ❓ in der Oberfläche (data-help="datei#anker" bzw. helpHint('…'))
 * muss auf eine vorhandene Hilfeseite und Überschrift zeigen – auch nachdem
 * die Entwicklerteile ausgeblendet sind. Benennt jemand eine Überschrift um,
 * fällt das hier auf.
 */
const ROOT = path.resolve(__dirname, '../..');
const RENDERER = path.join(ROOT, 'src/renderer');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'vendor' ? [] : files(p);
    return /\.(html|js)$/.test(e.name) ? [p] : [];
  });
}

function refs(): Array<{ file: string; ref: string }> {
  const out: Array<{ file: string; ref: string }> = [];
  for (const f of files(RENDERER)) {
    const text = fs.readFileSync(f, 'utf-8');
    for (const m of text.matchAll(/data-help="([^"$]+)"|helpHint\('([^']+)'/g)) {
      const ref = m[1] || m[2];
      if (ref !== 'datei#anker') out.push({ file: path.relative(ROOT, f), ref }); // Beispiel in Kommentaren
    }
  }
  return out;
}

describe('Hilfeverweise in der Oberfläche', () => {
  const all = refs();

  it('es gibt Verweise', () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it.each(all.map((r) => [r.ref, r.file]))('%s (%s) führt zu einer vorhandenen Stelle', (ref) => {
    const [name, anchor] = String(ref).split('#');
    const file = path.join(ROOT, 'docs', `${name}.md`);
    expect(fs.existsSync(file)).toBe(true);
    if (!anchor) return;
    const md = forTeachers(fs.readFileSync(file, 'utf-8'));
    const anchors = [...md.matchAll(/^#{1,4}\s+(.*)$/gm)].map((m) => slug(m[1]));
    expect(anchors).toContain(anchor);
  });
});
