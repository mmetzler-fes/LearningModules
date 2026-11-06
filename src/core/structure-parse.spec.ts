import { loadBrowserModule } from './browser-module';

/** Struktur-Import: src/renderer/js/structure-parse.js */
const p = loadBrowserModule<any>('structure-parse.js');
const shape = (list: any[]): any[] => list.map((n) => [n.title, n.kind, ...(n.children.length ? [shape(n.children)] : [])]);

describe('Struktur-Import (structure-parse.js)', () => {
  it('Tabelle: A Book, B–H Bereiche, I Abschnitt; leere Zellen vorne erben, Kopfzeile fällt weg', () => {
    const rows = [
      ['Book', 'Bereich', '', '', '', '', '', '', 'Abschnitt'],
      ['Elektrotechnik', 'Grundlagen', '', '', '', '', '', '', 'Strom'],
      ['', '', '', '', '', '', '', '', 'Spannung'],
      ['', 'Steuerungstechnik', 'SPS', '', '', '', '', '', 'Bausteine'],
      ['Mathematik'],
    ];
    expect(shape(p.buildTree(p.pathsFromRows(rows)))).toEqual([
      ['Elektrotechnik', 'top', [
        ['Grundlagen', 'area', [['Strom', 'section'], ['Spannung', 'section']]],
        ['Steuerungstechnik', 'area', [['SPS', 'area', [['Bausteine', 'section']]]]],
      ]],
      ['Mathematik', 'top'],
    ]);
  });

  it('Gliederung: Einrückung, Aufzählungszeichen, Nummern und Überschriften', () => {
    const text = '# Mechatroniker\n- LF 1 Funktionen\n  - 1.1 Signale\n  - Energie\n- LF 2\n\tFertigung\n# Elektroniker\n';
    expect(shape(p.buildTree(p.pathsFromOutline(text)))).toEqual([
      ['Mechatroniker', 'top', [
        ['LF 1 Funktionen', 'area', [['Signale', 'section'], ['Energie', 'section']]],
        ['LF 2', 'area', [['Fertigung', 'section']]],
      ]],
      ['Elektroniker', 'top'],
    ]);
  });

  it('Ordner: ohne Dateien, ohne versteckte Ordner, gewählter Ordner wahlweise mit', () => {
    const files = ['Unterricht/Elektro/LF1/a.pdf', 'Unterricht/Elektro/LF1/b.pdf', 'Unterricht/Elektro/LF2/Teil A/c.odt', 'Unterricht/.git/x', 'Unterricht/Mathe/m.pdf'];
    expect(shape(p.buildTree(p.pathsFromFolders(files)))).toEqual([
      ['Elektro', 'top', [['LF1', 'section'], ['LF2', 'area', [['Teil A', 'section']]]]],
      ['Mathe', 'top'],
    ]);
    expect(shape(p.buildTree(p.pathsFromFolders(files, { includeRoot: true })))[0][0]).toBe('Unterricht');
  });

  it('Gleichnamiges wird zusammengeführt, zu Tiefes abgeschnitten', () => {
    const tree = p.buildTree([[{ title: 'A', kind: 'top' }, { title: 'x', kind: 'auto' }], [{ title: 'a', kind: 'top' }, { title: 'X', kind: 'auto' }, { title: 'tief', kind: 'auto' }]]);
    expect(shape(tree)).toEqual([['A', 'top', [['x', 'area', [['tief', 'section']]]]]]);
    const { tree: cut, dropped } = p.limitDepth(tree, 2);
    expect(shape(cut)).toEqual([['A', 'top', [['x', 'section']]]]);
    expect(dropped).toBe(1);
  });
});
