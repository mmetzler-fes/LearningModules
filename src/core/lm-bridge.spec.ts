import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/** lm-bridge.js in einer nachgebauten Seite laden; `hosted`: im iframe oder allein geöffnet. */
function load(hosted: boolean) {
  const sent: any[] = [];
  const listeners: Record<string, Array<(e: any) => void>> = {};
  const parent = { postMessage: (m: any) => sent.push(m) };
  const win: any = { addEventListener: (t: string, fn: any) => { (listeners[t] = listeners[t] || []).push(fn); } };
  win.parent = hosted ? parent : win;
  const doc = { visibilityState: 'visible', addEventListener: (t: string, fn: any) => { (listeners[t] = listeners[t] || []).push(fn); } };
  const timers: Array<() => void> = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../renderer/lm-bridge.js'), 'utf8'), {
    window: win, document: doc, console, setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; }, clearTimeout: () => undefined,
  });
  const receive = (data: any, source: any = parent) => listeners.message.forEach((fn) => fn({ data, source }));
  return { LM: win.LM, sent, receive, listeners, parent };
}
const types = (sent: any[]) => sent.map((m) => m.type);

describe('lm-bridge.js', () => {
  it('allein geöffnet: startet sofort, sendet nichts', () => {
    const { LM, sent } = load(false);
    let init: any;
    LM.start((i: any) => { init = i; });
    LM.result('a', { score: 1, max: 2 });
    LM.flush();
    expect(LM.hosted).toBe(false);
    expect(init.mode).toBe('standalone');
    expect(sent).toEqual([]);
  });

  it('im Rahmen: wartet auf lm.init und übergibt den Stand', () => {
    const { LM, sent, receive } = load(true);
    let init: any = null;
    LM.start((i: any) => { init = i; });
    expect(init).toBe(null);
    expect(types(sent)).toEqual(['lm.ready']);
    receive({ lm: 1, type: 'lm.init', data: { mode: 'practice', state: { n: 1 } } });
    expect(init.state.n).toBe(1);
  });

  it('nimmt nur Nachrichten des Rahmens in der eigenen Fassung an', () => {
    const { LM, receive } = load(true);
    let init: any = null;
    LM.start((i: any) => { init = i; });
    receive({ lm: 1, type: 'lm.init', data: {} }, {});
    receive({ lm: 2, type: 'lm.init', data: {} });
    expect(init).toBe(null);
  });

  it('bündelt: nur der letzte Gesamtstand je Abschnitt wird gesendet', () => {
    const { LM, sent } = load(true);
    LM.result('a', { score: 1, max: 2 });
    LM.result('a', { score: 2, max: 2 });
    LM.result('b', { score: 1, max: 1 });
    expect(sent).toEqual([]);
    LM.flush();
    expect(sent.map((m) => [m.type, m.data.unit, m.data.score])).toEqual([['lm.result', 'a', 2], ['lm.result', 'b', 1]]);
  });

  it('enter geht sofort, Offenes wird beim Verlassen der Seite gesendet', () => {
    const { LM, sent, listeners } = load(true);
    LM.enter('a');
    expect(sent[0].data).toEqual({ unit: 'a', active: true });
    LM.saveState({ x: 1 });
    listeners.pagehide.forEach((fn) => fn({}));
    expect(sent[1].type).toBe('lm.state');
  });

  it('lm.open und lm.error erreichen die App', () => {
    const { LM, receive } = load(true);
    const seen: any[] = [];
    LM.onOpen((u: string) => seen.push(u));
    LM.onError((e: any) => seen.push(e.code));
    receive({ lm: 1, type: 'lm.open', data: { unit: 'b' } });
    receive({ lm: 1, type: 'lm.error', data: { code: 'unit', message: 'x' } });
    expect(seen).toEqual(['b', 'unit']);
  });
});
