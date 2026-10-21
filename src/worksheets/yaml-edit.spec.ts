import { load as yamlLoad } from 'js-yaml';
import { loadBrowserModule } from '../core/browser-module';

const y = loadBrowserModule<{
  newlineIndent(line: string): string;
  shiftLines(text: string, start: number, end: number, dir: number): { text: string; start: number; end: number };
  reindentPaste(pasted: string, col: number): string;
  insertAfterItem(text: string, pos: number, item: string): { text: string; pos: number } | null;
}>('yaml-edit.js');

const DOC = `content:
  - type: section
    text: Grundlagen
  - type: task
    title: Erste Aufgabe
    blocks:
      - type: karo
        lines: 4
      - type: solution
        blocks:
          - type: text
            text: Lösung
  - type: text
    text: Ende
`;

describe('YAML-Einrückhilfe', () => {
  it('Enter: Einrückung der Zeile, nach "- " und ":" tiefer', () => {
    expect(y.newlineIndent('    text: Grundlagen')).toBe('    ');
    expect(y.newlineIndent('  - type: task')).toBe('    ');
    expect(y.newlineIndent('    blocks:')).toBe('      ');
    expect(y.newlineIndent('  - blocks:')).toBe('      ');
    expect(y.newlineIndent('    text: |')).toBe('      ');
    expect(y.newlineIndent('  - Punkt eins')).toBe('    ');
  });

  it('Tab / Umschalt+Tab rücken markierte Zeilen', () => {
    const text = 'a:\n  - b\n  - c\n';
    const start = text.indexOf('- b');
    const end = text.indexOf('- c') + 3;
    const inn = y.shiftLines(text, start, end, 1);
    expect(inn.text).toBe('a:\n    - b\n    - c\n');
    expect(y.shiftLines(inn.text, inn.start, inn.end, -1).text).toBe(text);
  });

  it('Einfügen: Block rückt an die Schreibmarke, innen bleibt alles', () => {
    expect(y.reindentPaste('- type: karo\n  lines: 4', 6)).toBe('- type: karo\n        lines: 4');
    // Ganze Zeilen aus tieferer Ebene kopiert
    expect(y.reindentPaste('        - type: karo\n          lines: 4\n', 2)).toBe('- type: karo\n    lines: 4\n  ');
    // Ab "- type" aus der Mitte einer Zeile kopiert
    expect(y.reindentPaste('- type: karo\n          lines: 4', 4)).toBe('- type: karo\n      lines: 4');
    expect(y.reindentPaste('nur eine Zeile', 8)).toBe('nur eine Zeile');
  });

  it('Einfügen-Menü: neuer Block hinter dem Block der Schreibmarke', () => {
    const item = '- type: quiz\n  module: m1\n  title: Kurzquiz\n';
    // Schreibmarke in "lines: 4" des Karos → Quiz zwischen Karo und Lösung
    const res = y.insertAfterItem(DOC, DOC.indexOf('lines: 4'), item)!;
    const task = (yamlLoad(res.text) as any).content[1];
    expect(task.blocks.map((b: any) => b.type)).toEqual(['karo', 'quiz', 'solution']);
    expect(res.text.slice(res.pos, res.pos + 12)).toBe('- type: quiz');
    // Schreibmarke im Abschnitt → Quiz als zweiter Block des Blatts
    const top = y.insertAfterItem(DOC, DOC.indexOf('Grundlagen'), item)!;
    expect((yamlLoad(top.text) as any).content.map((b: any) => b.type)).toEqual(['section', 'quiz', 'task', 'text']);
    // Am letzten Block
    const last = y.insertAfterItem(DOC, DOC.indexOf('Ende'), item)!;
    expect((yamlLoad(last.text) as any).content.map((b: any) => b.type)).toEqual(['section', 'task', 'text', 'quiz']);
    expect(y.insertAfterItem('content:\n', 3, item)).toBeNull();
  });
});
