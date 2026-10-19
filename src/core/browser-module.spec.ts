import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pickSourceFile, loadBrowserModule } from './browser-module';

describe('Browser-Module im Server laden', () => {
  it('überspringt die von nest build übersetzte Fassung (CommonJS)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-bm-'));
    const compiled = path.join(dir, 'compiled.js');
    const source = path.join(dir, 'source.js');
    fs.writeFileSync(compiled, '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.f = f;\nfunction f() { return 1; }\n');
    fs.writeFileSync(source, 'export function f() {\n  return 1;\n}\n');
    expect(pickSourceFile([path.join(dir, 'fehlt.js'), compiled, source])?.file).toBe(source);
    expect(pickSourceFile([compiled])).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lädt die Module, die der Server braucht', () => {
    for (const file of ['json-text.js', 'puzzles.js', 'formula.js']) {
      expect(Object.keys(loadBrowserModule<object>(file)).length).toBeGreaterThan(2);
    }
    expect(Object.keys(loadBrowserModule<object>('dnd-pairs.js'))).toEqual(['contentFromPairs', 'pairsFromContent']);
  });
});
