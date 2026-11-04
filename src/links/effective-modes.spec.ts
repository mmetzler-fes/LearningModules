import { effectiveModes, onlyHtmlApps } from './links.service';

const link = (modes: string[]) => ({ modes }) as any;
const of = (...types: string[]) => [{ modules: types.map((type) => ({ type })) }];

describe('Links nur mit HTML-Apps', () => {
  it('erkennt reine App-Inhalte, auch mit Untermodulen', () => {
    expect(onlyHtmlApps(of('htmlApp', 'htmlAppUnit'))).toBe(true);
    expect(onlyHtmlApps(of('htmlApp', 'multipleChoice'))).toBe(false);
    expect(onlyHtmlApps([])).toBe(false);
  });

  it('nur HTML-Apps: immer nur Quiz, auch bei schon ausgeteilten Links', () => {
    expect(effectiveModes(link(['quiz', 'companion', 'contest']), 'practice', of('htmlApp'))).toEqual(['quiz']);
    expect(effectiveModes(link(['companion']), 'practice', of('htmlApp'))).toEqual(['quiz']);
    expect(effectiveModes(link(['contest']), 'practice', of('htmlApp'))).toEqual(['quiz']);
  });

  it('gemischter Inhalt behält die Wahl', () => {
    expect(effectiveModes(link(['quiz', 'companion']), 'practice', of('htmlApp', 'memory'))).toEqual(['quiz', 'companion']);
  });

  it('die Klassenarbeit bleibt', () => {
    expect(effectiveModes(link(['exam']), 'exam', of('htmlApp'))).toEqual(['exam']);
    expect(effectiveModes(link(['exam']), 'practice', of('htmlApp'))).toEqual(['exam']);
  });
});
