import { loadBrowserModule } from './browser-module';

/** Regeln der Sende-Warteschlange: src/renderer/js/sync/sync-rules.js */
interface Rules {
  classifyResponse(status: number, body: any): string;
  backoffMs(tries: number): number;
  replaceEntry(old: any, next: any, now: number): any;
  sendOrder(entries: any[]): any[];
  nextSeq(last: number, now: number): number;
}
const r = loadBrowserModule<Rules>('sync/sync-rules.js');

describe('Nachsenden: Regeln (sync-rules.js)', () => {
  it('ordnet Antworten ein', () => {
    expect(r.classifyResponse(0, null)).toBe('retry');
    expect(r.classifyResponse(200, { success: true })).toBe('ok');
    expect(r.classifyResponse(200, { success: false })).toBe('failed');
    expect(r.classifyResponse(502, {})).toBe('retry');
    expect(r.classifyResponse(429, {})).toBe('retry');
    expect(r.classifyResponse(403, { needPin: true })).toBe('pin');
    expect(r.classifyResponse(403, { message: 'abgegeben' })).toBe('failed');
    expect(r.classifyResponse(413, {})).toBe('failed');
  });

  it('wartet immer länger, höchstens eine Minute', () => {
    expect(r.backoffMs(0)).toBe(2000);
    expect(r.backoffMs(1)).toBe(4000);
    expect(r.backoffMs(50)).toBe(60000);
  });

  it('ein neuerer Stand ersetzt den wartenden, behält aber seinen Platz', () => {
    const a = r.replaceEntry(null, { key: 'work|1', body: 1 }, 100);
    const b = r.replaceEntry(null, { key: 'result|1', body: 2 }, 200);
    const a2 = r.replaceEntry({ ...a, tries: 3, state: 'pin' }, { key: 'work|1', body: 3 }, 300);
    expect(a2.order).toBe(100);
    expect(a2.tries).toBe(0);
    expect(a2.state).toBe('wait');
    expect(a2.stamp).not.toBe(a.stamp);
    expect(r.sendOrder([b, a2]).map((e: any) => e.body)).toEqual([3, 2]);
    expect(r.sendOrder([{ ...b, state: 'failed' }, { ...a2, state: 'pin' }])).toEqual([]);
  });

  it('die Nummer des Geräts wächst immer', () => {
    expect(r.nextSeq(0, 1000)).toBe(1000);
    expect(r.nextSeq(1000, 1000)).toBe(1001);
    expect(r.nextSeq(5000, 1000)).toBe(5001);
  });
});
