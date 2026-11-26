import { loadBrowserModule } from './browser-module';

type Cell = { text: string; imageUrl: string; hideText: boolean };
type Table = { head: string; rows: string[]; cols: string[]; cells: Cell[][]; extras: Cell[] };
type DndTable = {
  contentFromTable: (t: Partial<Table>) => { tableHead: string; dropZones: any[]; draggables: any[] };
  tableFromContent: (c: any) => Table;
};
const dt = loadBrowserModule<DndTable>('dnd-table.js');
const cell = (text: string, imageUrl = '', hideText = false): Cell => ({ text, imageUrl, hideText });

describe('dnd-table (Drag and Drop als Tabelle)', () => {
  const table: Table = {
    head: 'Anlaufmethode',
    rows: ['Direktanlauf', 'Softstarter'],
    cols: ['Stromverlauf', 'relativer Anlaufstrom'],
    cells: [
      [cell('', 'https://x.de/d-i.jpg', true), cell('6–8')],
      [cell('', 'https://x.de/s-i.jpg', true), cell('2–4')],
    ],
    extras: [cell('10')],
  };

  it('legt je Zelle eine Zone mit Zeile und Spalte an, Bilder bekommen einen verborgenen Text', () => {
    const c = dt.contentFromTable(table);
    expect(c.tableHead).toBe('Anlaufmethode');
    expect(c.dropZones.map((z) => [z.label, z.row, z.col])).toEqual([
      ['Direktanlauf – Stromverlauf', 'Direktanlauf', 'Stromverlauf'],
      ['Direktanlauf – relativer Anlaufstrom', 'Direktanlauf', 'relativer Anlaufstrom'],
      ['Softstarter – Stromverlauf', 'Softstarter', 'Stromverlauf'],
      ['Softstarter – relativer Anlaufstrom', 'Softstarter', 'relativer Anlaufstrom'],
    ]);
    expect(c.draggables[0]).toEqual({ text: 'Direktanlauf: Stromverlauf', correctZone: 'Direktanlauf – Stromverlauf',
      multiple: false, imageUrl: 'https://x.de/d-i.jpg', hideText: true });
    expect(c.dropZones[0].correctDraggable).toBe('Direktanlauf: Stromverlauf');
    expect(c.draggables.at(-1)).toMatchObject({ text: '10', correctZone: '' });
  });

  it('liest dieselbe Tabelle zurück (Hin und Rück)', () => {
    const back = dt.tableFromContent(dt.contentFromTable(table));
    expect(back.head).toBe('Anlaufmethode');
    expect(back.rows).toEqual(table.rows);
    expect(back.cols).toEqual(table.cols);
    expect(back.cells[1][1].text).toBe('2–4');
    expect(back.cells[0][0]).toEqual(cell('Direktanlauf: Stromverlauf', 'https://x.de/d-i.jpg', true));
    expect(back.extras).toEqual([cell('10')]);
  });

  it('leere und doppelte Zeilen/Spalten fallen weg, leere Zellen ergeben eine Zone ohne Element', () => {
    const c = dt.contentFromTable({ rows: ['A', '', 'A', 'B'], cols: ['X'], cells: [[cell('a')], [cell('z')], [cell('dup')], [cell('')]] });
    expect(c.dropZones.map((z) => z.label)).toEqual(['A – X', 'B – X']);
    expect(c.draggables.map((d) => d.text)).toEqual(['a']);
  });

  it('„Zeile – Spalte“ in der Bezeichnung ohne row/col (nach einem Umweg über Paare) wird wieder Zeile und Spalte', () => {
    const t = dt.tableFromContent({ dropZones: [{ label: 'Hund – Englisch', correctDraggable: 'dog' }], draggables: [{ text: 'dog', correctZone: 'Hund – Englisch' }] });
    expect([t.rows, t.cols, t.cells[0][0].text]).toEqual([['Hund'], ['Englisch'], 'dog']);
  });

  it('Zonen ohne Zeile/Spalte (z. B. Paare) werden Zeilen mit einer Spalte „Antwort“', () => {
    const t = dt.tableFromContent({ dropZones: [{ label: 'Hund', correctDraggable: 'dog' }, { label: 'Katze' }],
      draggables: [{ text: 'cat', correctZone: 'Katze' }, { text: 'dog', correctZone: 'Hund' }] });
    expect(t.rows).toEqual(['Hund', 'Katze']);
    expect(t.cols).toEqual(['Antwort']);
    expect(t.cells.map((r) => r[0].text)).toEqual(['dog', 'cat']);
  });
});
