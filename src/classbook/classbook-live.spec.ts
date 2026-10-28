import { EventEmitter } from 'events';
import { ClassbookLive } from './classbook-live';

/** Antwort-Attrappe: sammelt die Ereignisse. */
function fakeRes() {
  const res: any = new EventEmitter();
  res.out = '';
  res.writeHead = () => res;
  res.write = (s: string) => { res.out += s; return true; };
  res.events = () => [...res.out.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m: RegExpMatchArray) => [m[1], JSON.parse(m[2])]);
  return res;
}

describe('Live-Verbindung des Klassennotizbuchs', () => {
  let live: ClassbookLive;
  beforeEach(() => { live = new ClassbookLive(); });
  afterEach(() => live.onModuleDestroy());

  const mk = { linkId: 'L', moduleId: 'M', title: 'Blatt 1' };

  it('Senden erreicht alle Geräte der Klasse, nicht die anderer', () => {
    const a = fakeRes(); const b = fakeRes(); const other = fakeRes();
    live.open('c1', a, null); live.open('c1', b, null); live.open('c2', other, null);
    expect(live.sendModule('c1', mk)).toBe(2);
    expect(a.events().at(-1)).toEqual(['send', mk]);
    expect(other.events().some(([e]: [string]) => e === 'send')).toBe(false);
  });

  it('Folgen: Stand beim Verbinden und bei neuem Merker', () => {
    const a = fakeRes();
    live.open('c1', a, mk);
    expect(a.events()[0]).toEqual(['state', { follow: false, marker: null }]);
    live.setFollow('c1', true, mk);
    expect(a.events().at(-1)).toEqual(['state', { follow: true, marker: mk }]);
    const late = fakeRes();
    live.open('c1', late, mk);
    expect(late.events()[0]).toEqual(['state', { follow: true, marker: mk }]);
    live.markerChanged('c1', { ...mk, moduleId: 'M2' });
    expect(a.events().at(-1)[1].marker.moduleId).toBe('M2');
  });

  it('Getrennte Geräte zählen nicht mehr', () => {
    const a = fakeRes();
    live.open('c1', a, null);
    expect(live.online('c1')).toBe(1);
    a.emit('close');
    expect(live.online('c1')).toBe(0);
  });
});
