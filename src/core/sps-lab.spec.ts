import { loadBrowserModule } from './browser-module';

const core = loadBrowserModule<any>('../lm-editor/src/labs/lab-core.js');

/** Kette aus einem Schritt mit einer Aktion; S_1 aktiv bis E, dann S_2 (ohne Aktion), zurück mit F. */
const chain = (q: string, time = '', cond = '') => ({
  io: [{ id: 'e', kind: 'in', name: 'E' }, { id: 'f', kind: 'in', name: 'F' }, { id: 'c', kind: 'in', name: 'C' }, { id: 'y', kind: 'out', name: 'Y' }],
  steps: [
    { id: 's1', name: 'S_1', initial: true, trans: 'E', actions: [{ id: 'a', q, time, text: 'x', var: 'Y', cond }] },
    { id: 's2', name: 'S_2', trans: 'F', actions: [] },
  ],
  back: true,
});
/** Zyklen à 100 ms; gibt die Werte von Y je Zyklus zurück. */
function run(st: any, plan: Array<[number, Record<string, number>]>) {
  const rt = core.spsInit(st);
  const ys: number[] = [];
  for (const [n, inp] of plan) for (let i = 0; i < n; i++) { core.spsCycle(st, rt, { E: 0, F: 0, C: 0, ...inp }, 100); ys.push(rt.vars.Y); }
  return { rt, ys };
}

describe('SPS-Labor (Ablaufkette IEC 61131-3)', () => {
  it('Zeiten T#…', () => {
    expect(core.spsTime('T#2s')).toBe(2000);
    expect(core.spsTime('T#500ms')).toBe(500);
    expect(core.spsTime('T#1m30s')).toBe(90000);
    expect(core.spsTime('T#1,5s')).toBe(1500);
    expect(core.spsTime('2s')).toBeNaN();
  });

  it('Bedingungen: AND/OR/NOT in Text und Zeichen, Vergleiche, Schrittzeit', () => {
    const v: Record<string, number> = { A: 1, B: 0, C: 1 };
    const ev = (s: string) => core.spsEval(core.spsParse(s), (n: string) => v[n]);
    expect(ev('A AND NOT B')).toBe(1);
    expect(ev('A * /B')).toBe(1);
    expect(ev('B + C')).toBe(1);
    expect(ev('A XOR C')).toBe(0);
    expect(ev('(A OR B) & !C')).toBe(0);
    expect(core.spsEval(core.spsParse('S_2.T >= T#3s'), () => 3000)).toBe(1);
    expect(() => core.spsParse('A AND (B')).toThrow(/Klammer/);
  });

  it('N: nur solange der Schritt aktiv ist', () => {
    const { ys } = run(chain('N'), [[2, {}], [1, { E: 1 }], [2, {}]]);
    expect(ys).toEqual([1, 1, 0, 0, 0]);
  });

  it('S speichert über den Schritt hinaus, R setzt vorrangig zurück', () => {
    const st = chain('S');
    st.steps[1].actions = [{ id: 'r', q: 'R', time: '', text: '', var: 'Y', cond: '' }] as any;
    const { ys } = run(st, [[1, {}], [1, { E: 1 }], [1, {}]]);
    expect(ys).toEqual([1, 0, 0]);
    const keep = run(chain('S'), [[1, {}], [1, { E: 1 }], [2, {}]]);
    expect(keep.ys).toEqual([1, 1, 1, 1]);
  });

  it('L: höchstens T, D: erst nach T, P: ein Zyklus', () => {
    expect(run(chain('L', 'T#300ms'), [[5, {}]]).ys).toEqual([1, 1, 1, 0, 0]);
    expect(run(chain('D', 'T#300ms'), [[5, {}]]).ys).toEqual([0, 0, 0, 1, 1]);
    expect(run(chain('P'), [[3, {}]]).ys).toEqual([1, 0, 0]);
  });

  it('SD läuft weiter, auch wenn der Schritt schon verlassen ist; DS nicht', () => {
    expect(run(chain('SD', 'T#300ms'), [[1, {}], [1, { E: 1 }], [3, {}]]).ys).toEqual([0, 0, 0, 1, 1]);
    expect(run(chain('DS', 'T#300ms'), [[1, {}], [1, { E: 1 }], [3, {}]]).ys).toEqual([0, 0, 0, 0, 0]);
  });

  it('SL: für T, auch nach dem Verlassen', () => {
    expect(run(chain('SL', 'T#300ms'), [[1, {}], [1, { E: 1 }], [3, {}]]).ys).toEqual([1, 1, 1, 0, 0]);
  });

  it('Zuweisungsbedingung (A4) und Rücksprung zum Initialschritt', () => {
    expect(run(chain('N', '', 'C'), [[1, {}], [1, { C: 1 }]]).ys).toEqual([0, 1]);
    const { rt } = run(chain('N'), [[1, {}], [1, { E: 1 }], [1, { F: 1 }]]);
    expect(rt.active).toEqual(['s1']);
  });

  it('Zeitglied wie in der IEC: D T#… auf tonT1, Transition tonT1.Q', () => {
    const st: any = {
      io: [{ id: 't', kind: 'tim', name: 'tonT1' }],
      steps: [
        { id: 's1', name: 'S_1', initial: true, trans: 'tonT1.Q', actions: [{ id: 'a', q: 'D', time: 'T#300ms', text: 'Biegezeit', var: 'tonT1', cond: '' }] },
        { id: 's2', name: 'S_2', trans: 'FALSE', actions: [] },
      ],
      back: true,
    };
    expect(core.spsCheck(st)).toEqual([]);
    const rt = core.spsInit(st);
    const act: string[] = [];
    for (let i = 0; i < 6; i++) { core.spsCycle(st, rt, {}, 100); act.push(rt.active[0]); }
    expect(act).toEqual(['s1', 's1', 's1', 's1', 's2', 's2']);
  });

  it('Grundbeispiel nach IEC: S_3 wartet mit D T#3s auf tonT1, Transition tonT1.Q', () => {
    const st = core.spsDefault();
    expect(core.spsCheck(st)).toEqual([]);
    const s3 = st.steps.find((s: any) => s.name === 'S_3');
    expect(s3.trans).toBe('tonT1.Q');
    expect(s3.actions).toEqual(expect.arrayContaining([expect.objectContaining({ q: 'D', time: 'T#3s', var: 'tonT1' })]));
    const rt = core.spsInit(st);
    const step = (inp: Record<string, number>, n = 1) => { for (let i = 0; i < n; i++) core.spsCycle(st, rt, { S1: 0, B1: 0, B0: 0, ...inp }, 100); };
    step({}, 2);
    step({ S1: 1 });
    step({ B1: 1 });
    expect(rt.active).toEqual(['s3']);
    step({}, 29);
    expect(rt.active).toEqual(['s3']);
    step({}, 3);
    expect(rt.active).toEqual(['s1']);
  });

  it('Prüfen: unbekannte Namen und fehlende Zeit', () => {
    const st = chain('L');
    st.steps[0].trans = 'E AND X9';
    const p = core.spsCheck(st);
    expect(p.join(' ')).toMatch(/X9/);
    expect(p.join(' ')).toMatch(/Zeit/);
  });

  it('Bild: Schritte, Initialschritt doppelt, Aktionsblock', () => {
    const svg = core.labSvg({ lab: 'sps' });
    expect(svg).toContain('S_1');
    expect(svg).toContain('Zylinder ausfahren');
    expect(core.labValidate({ lab: 'sps', preset: core.spsDefault() })).toEqual([]);
  });
});
