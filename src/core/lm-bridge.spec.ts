import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/** lm-bridge.js in einer nachgebauten Seite laden; `hosted`: im iframe oder allein geöffnet. */
function load(hosted: boolean) {
  const sent: any[] = [];
  const listeners: Record<string, (e: any) => void> = {};
  const parent: any = { postMessage: (m: any, origin: string) => sent.push({ ...m, origin }) };
  const win: any = { addEventListener: (t: string, f: any) => { listeners[t] = f; }, console: { warn() {} } };
  win.parent = hosted ? parent : win;
  win.window = win;
  const body = { innerText: 'Inhalt', appendChild() {} };
  const document = {
    readyState: 'complete', body,
    querySelector: () => ({ textContent: JSON.stringify({ units: [{ id: 'u', steps: [{ id: 's1', title: 'S', kind: 'task' }] }] }) }),
    createElement: () => ({ style: {}, append() {}, addEventListener() {} }),
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../renderer/lm-bridge.js'), 'utf8'), {
    window: win, document, console: win.console, location: { hash: '' }, JSON, Math, String, Object,
  });
  const receive = (type: string, data?: any) => listeners.message({ source: win.parent, data: { lm: 2, type, data } });
  return { LM: win.LM, sent, receive, listeners, win };
}

describe('lm-bridge.js', () => {
  it('meldet sich, startet erst mit lm.init und sagt dann Bescheid', () => {
    const { LM, sent, receive } = load(true);
    const seen: any[] = [];
    LM.start((init: any) => seen.push(init.step.id));
    expect(sent[0]).toMatchObject({ lm: 2, type: 'lm.ready' });
    expect(seen).toEqual([]);
    receive('lm.init', { step: { id: 's1' } });
    expect(seen).toEqual(['s1']);
    expect(sent[1]).toMatchObject({ type: 'lm.shown', data: { text: 6 } });
  });

  it('schickt Antwort und Stand sofort', () => {
    const { LM, sent } = load(true);
    LM.answer({ isCorrect: true });
    LM.saveState({ a: 1 });
    expect(sent.map((m) => m.type)).toEqual(['lm.answer', 'lm.state']);
    expect(sent[1].data).toEqual({ data: { a: 1 } });
  });

  it('reicht Sperre, Lösung, Prüfen und Fehler weiter', () => {
    const { LM, receive } = load(true);
    const seen: any[] = [];
    LM.onLock((l: boolean) => seen.push(['lock', l]));
    LM.onReveal(() => seen.push(['reveal']));
    LM.onCheck(() => seen.push(['check']));
    LM.onError((e: any) => seen.push(['error', e.code]));
    receive('lm.lock', { locked: true });
    receive('lm.reveal');
    receive('lm.check');
    receive('lm.error', { code: 'x', message: 'y' });
    expect(seen).toEqual([['lock', true], ['reveal'], ['check'], ['error', 'x']]);
  });

  it('holt beim Flush offene Eingaben ab und bestätigt danach', () => {
    const { LM, sent, receive } = load(true);
    LM.onFlush(() => LM.answer({ isCorrect: true }));
    receive('lm.flush');
    expect(sent.map((m) => m.type)).toEqual(['lm.answer', 'lm.flushed']);
  });

  it('nimmt nur Nachrichten vom Gastgeber', () => {
    const { LM, listeners } = load(true);
    const seen: any[] = [];
    LM.onReveal(() => seen.push(1));
    listeners.message({ source: {}, data: { lm: 2, type: 'lm.reveal' } });
    expect(seen).toEqual([]);
  });

  it('läuft allein mit dem ersten Schritt und sendet nichts', () => {
    const { LM, sent } = load(false);
    const seen: any[] = [];
    LM.start((init: any) => seen.push([init.mode, init.step.id]));
    LM.answer({ isCorrect: true });
    expect(LM.hosted).toBe(false);
    expect(seen).toEqual([['standalone', 's1']]);
    expect(sent).toEqual([]);
  });

  it('lässt sich nicht überschreiben', () => {
    const { win } = load(true);
    expect(Object.isFrozen(win.LM)).toBe(true);
    expect(() => { 'use strict'; win.LM = {}; }).toThrow();
  });
});
