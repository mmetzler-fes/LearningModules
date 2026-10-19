import { inlineRemoteImages } from './remote-images';

/** Antwortet je Adresse mit Typ und Inhalt; zählt die Abrufe. */
function fakeFetch(map: Record<string, { type: string; body: string; status?: number }>) {
  const calls: string[] = [];
  const impl: any = async (url: string, init: any) => {
    calls.push(url);
    expect(init.redirect).toBe('manual');
    const r = map[url];
    if (!r) return { ok: false, status: 404, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: (r.status || 200) < 300, status: r.status || 200, headers: new Map([['content-type', r.type]]), arrayBuffer: async () => Buffer.from(r.body) };
  };
  return { impl, calls };
}

describe('Verlinkte Bilder für den Export einbetten', () => {
  const PUB = 'https://93.184.216.34';

  it('holt Bilder aus Bildfeldern einmal je Adresse und lässt anderes in Ruhe', async () => {
    const { impl, calls } = fakeFetch({ [`${PUB}/a.png`]: { type: 'image/png', body: 'PNG' } });
    const modules = [{ id: 'm', content: { imageUrl: `${PUB}/a.png`, items: [{ text: `${PUB}/a.png`, imageUrl: `${PUB}/a.png` }] } }];
    const { modules: out, failed } = await inlineRemoteImages(modules, impl);
    expect(out[0].content.imageUrl).toBe(`data:image/png;base64,${Buffer.from('PNG').toString('base64')}`);
    expect(out[0].content.items[0].imageUrl).toBe(out[0].content.imageUrl);
    expect(out[0].content.items[0].text).toBe(`${PUB}/a.png`); // kein Bildfeld
    expect(calls).toHaveLength(1);
    expect(failed).toEqual([]);
    expect(modules[0].content.imageUrl).toBe(`${PUB}/a.png`); // Original unverändert
  });

  it('lässt interne Adressen, Nicht-Bilder und Fehler als Link stehen', async () => {
    const { impl, calls } = fakeFetch({ [`${PUB}/seite.html`]: { type: 'text/html', body: '<html>' } });
    const content = { imageUrl: 'https://127.0.0.1/x.png', backgroundImage: `${PUB}/seite.html`, aImage: `${PUB}/fehlt.png` };
    const { modules: out, failed } = await inlineRemoteImages([{ content }], impl);
    expect(out[0].content).toEqual(content);
    expect(failed.sort()).toEqual([`${PUB}/fehlt.png`, `${PUB}/seite.html`, 'https://127.0.0.1/x.png'].sort());
    expect(calls).not.toContain('https://127.0.0.1/x.png');
  });
});
