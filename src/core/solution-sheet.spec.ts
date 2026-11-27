import { loadBrowserModule } from './browser-module';

const m = loadBrowserModule<any>('ink/solution-sheet.js');

describe('Lösung als eigenes Blatt', () => {
  const student = { type: 'lab', id: 'L1', lab: 'sps', preset: { io: [{ name: 'SF1' }], init: 'INIT', plant: { v: 2, items: [{ id: 'neu' }] }, steps: [{ name: 'S_1' }] } };
  const solution = { type: 'solution', id: 'X', blocks: [
    { type: 'text', id: 't', text: 'Lehrerlösung' },
    { type: 'lab', id: 'L2', lab: 'sps', preset: { io: [{ name: 'SF1' }, { name: 'tonT9' }], plant: { v: 2, items: [{ id: 'alt' }] }, steps: [{ name: 'S_1' }, { name: 'S_2' }] } },
  ] };
  const spec = { orientation: 'landscape', content: [{ type: 'task', id: 'a', title: 'Ablauf', blocks: [student, solution] }, { type: 'solution', id: 'Y', blocks: [{ type: 'text', id: 'u', text: 'Antwort' }] }] };

  it('öffnet Lösungsblöcke; Kette aus der Lösung, Anlage und Tabelle aus dem Schülerlabor', () => {
    const out = m.solutionSpec(spec);
    expect(out.orientation).toBe('landscape');
    const task = out.content[0];
    expect(task.blocks.map((b: any) => b.type)).toEqual(['text', 'lab']);
    const lab = task.blocks[1];
    expect(lab.preset.steps).toHaveLength(2);
    expect(lab.preset.plant.items[0].id).toBe('neu');
    expect(lab.preset.init).toBe('INIT');
    expect(lab.preset.io.map((r: any) => r.name)).toEqual(['SF1', 'tonT9']);
    expect(out.content[1]).toMatchObject({ type: 'text', text: 'Antwort' });
    expect(JSON.stringify(out)).not.toContain('"solution"');
    expect(spec.content[0].blocks).toHaveLength(2); // Original unverändert
  });

  it('Laborstand der Lehrerlösung (andere Kette) hat Vorrang; unverändert zählt er nicht', () => {
    const mine = { ...student.preset, steps: [{ name: 'S_1' }, { name: 'S_2' }, { name: 'S_3' }] };
    const states = m.labStatesFromForms({ 'lab:mod1:L1': mine, 'x': [1] });
    expect(Object.keys(states)).toEqual(['L1']);
    const lab = m.solutionSpec(spec, states).content[0].blocks.find((b: any) => b.type === 'lab');
    expect(lab.preset.steps).toHaveLength(3);
    const same = m.solutionSpec(spec, { L1: student.preset }).content[0].blocks.find((b: any) => b.type === 'lab');
    expect(same.preset.steps).toHaveLength(2); // aus dem Lösungsblock
  });
});
