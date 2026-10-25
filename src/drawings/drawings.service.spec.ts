import { DrawingsService } from './drawings.service';
import { repo } from '../work/test-repo';

const SVG_URL = 'http://intern:3000/api/nextcloud/files/l1/Physik/Blatt-Zeichnung-1.svg';
const PATH = '/api/nextcloud/files/l1/Physik/Blatt-Zeichnung-1.svg';

function setup() {
  const sources = repo();
  const topics = repo([{ id: 't1', ownerId: 'u1' }, { id: 't2', ownerId: 'fremd' }]);
  const modules = repo([
    { id: 'm1', topicId: 't1', content: { spec: { content: [{ type: 'image', src: PATH, source: 'x.odg' }] } } },
    { id: 'm2', topicId: 't1', content: { html: `<img src="${PATH}?v=1">` } },
    { id: 'm3', topicId: 't2', content: { spec: { content: [{ type: 'image', src: PATH }] } } },
  ]);
  (modules as any).find = async ({ where }: any) => modules.rows.filter((m) => (where.topicId?._value || [where.topicId]).includes(m.topicId));
  (topics as any).find = async ({ where }: any) => topics.rows.filter((t) => t.ownerId === where.ownerId);
  const files: Record<string, Buffer> = {};
  let etag = 'e1';
  const nextcloud: any = {
    isReady: async () => true,
    storeDrawings: async (_u: any, _t: any, items: any[]) => items.map((it) => ({ folder: 'Physik', odgName: `${it.stem}.odg`, svgName: `${it.stem}.svg`, odgUrl: SVG_URL.replace('.svg', '.odg'), svgUrl: SVG_URL, etag })),
    drawingFolder: async () => [{ name: 'Blatt-Zeichnung-1.odg', etag, modified: '' }],
    readOwnFile: async () => ({ type: 'application/vnd.oasis.opendocument.graphics', data: Buffer.from('PK-odg') }),
    writeOwnFile: async (_u: string, _f: string, name: string, data: Buffer) => { files[name] = data; return 'e-up'; },
  };
  const renderer: any = { renderDrawing: async () => ({ svg: Buffer.from('<svg>neu</svg>'), widthMm: 50 }) };
  const svc = new DrawingsService(sources as any, topics as any, modules as any, nextcloud, renderer);
  return { svc, sources, modules, files, setEtag: (e: string) => { etag = e; } };
}

const user = { userId: 'u1' };

describe('Zeichnungen mit Quelle', () => {
  it('legt beim Import .odg und .svg ab und merkt sie sich', async () => {
    const { svc, sources } = setup();
    const stored = await svc.storeImported(user, 't1', 'Blatt.odt', new Map([
      ['lmdraw-1', { svg: Buffer.from('<svg/>'), odg: Buffer.from('PK'), widthMm: 40 }],
      ['lmdraw-2', { svg: Buffer.from('<svg/>'), widthMm: 40 }], // ohne .odg: bleibt im Dokument
    ]));
    expect([...stored.keys()]).toEqual(['lmdraw-1']);
    // Als Pfad auf diesem Server – unabhängig davon, unter welcher Adresse er sich kennt.
    expect(stored.get('lmdraw-1')).toEqual({ url: PATH, source: PATH.replace('.svg', '.odg') });
    expect(sources.rows[0]).toMatchObject({ folder: 'Physik', odgName: 'Blatt-Zeichnung-1.odg', etag: 'e1', version: 1 });
  });

  it('zeichnet nach einer Änderung der .odg neu und hebt die Fassung in den eigenen Modulen', async () => {
    const { svc, modules, files, setEtag } = setup();
    await svc.storeImported(user, 't1', 'Blatt.odt', new Map([['lmdraw-1', { svg: Buffer.from('<svg/>'), odg: Buffer.from('PK'), widthMm: 40 }]]));
    expect((await svc.sync(user, 't1', true)).updated).toEqual([]); // unverändert
    setEtag('e2');
    const res = await svc.sync(user, 't1', true);
    expect(res.updated).toEqual(['Blatt-Zeichnung-1.odg']);
    expect(files['Blatt-Zeichnung-1.svg'].toString()).toBe('<svg>neu</svg>');
    expect(modules.rows[0].content.spec.content[0].src).toBe(`${PATH}?v=2`);
    expect(modules.rows[1].content.html).toBe(`<img src="${PATH}?v=2">`);
    expect(modules.rows[2].content.spec.content[0].src).toBe(PATH); // fremdes Thema bleibt
    // Gleich noch einmal ohne force: der Server bremst.
    setEtag('e3');
    expect((await svc.sync(user, 't1')).checked).toBe(0);
  });

  it('zwei gleichzeitige Importe in dasselbe Lernthema laufen nacheinander – keine doppelten Namen', async () => {
    const { svc } = setup();
    const order: string[] = [];
    const taken = new Set<string>();
    (svc as any).nextcloud.storeDrawings = async (_u: any, _t: any, items: any[]) => {
      // Freie Namen wählen, dann (verzögert) „hochladen“ – wie gegen eine echte Nextcloud.
      const names = items.map((it) => { let n = it.stem; for (let k = 2; taken.has(n); k++) n = `${it.stem}-${k}`; return n; });
      order.push(`start ${names.join(',')}`);
      await new Promise((r) => setTimeout(r, 20));
      names.forEach((n) => taken.add(n));
      order.push(`ende ${names.join(',')}`);
      return names.map((n) => ({ folder: 'Physik', odgName: `${n}.odg`, svgName: `${n}.svg`, odgUrl: `/api/x/${n}.odg`, svgUrl: `/api/x/${n}.svg`, etag: 'e' }));
    };
    const one = () => new Map([['lmdraw-1', { svg: Buffer.from('<svg/>'), odg: Buffer.from('PK'), widthMm: 40 }]]);
    const [a, b] = await Promise.all([svc.storeImported(user, 't1', 'Blatt.odt', one()), svc.storeImported(user, 't1', 'Blatt.odt', one())]);
    expect(order).toEqual(['start Blatt-Zeichnung-1', 'ende Blatt-Zeichnung-1', 'start Blatt-Zeichnung-1-2', 'ende Blatt-Zeichnung-1-2']);
    expect(a.get('lmdraw-1')!.url).not.toBe(b.get('lmdraw-1')!.url);
  });

  it('Hochladen ersetzt die .odg und zeichnet gleich neu; nur .odg (ZIP) wird angenommen', async () => {
    const { svc, sources, files } = setup();
    await svc.storeImported(user, 't1', 'Blatt.odt', new Map([['lmdraw-1', { svg: Buffer.from('<svg/>'), odg: Buffer.from('PK'), widthMm: 40 }]]));
    await expect(svc.upload(user, sources.rows[0].id, Buffer.from('kein zip'))).rejects.toThrow(/keine .odg/);
    expect(await svc.upload(user, sources.rows[0].id, Buffer.from('PK neu'))).toMatchObject({ version: 2 });
    expect(files['Blatt-Zeichnung-1.odg'].toString()).toBe('PK neu');
    await expect(svc.upload({ userId: 'fremd' }, sources.rows[0].id, Buffer.from('PK'))).rejects.toThrow(/nicht gefunden/);
  });
});
