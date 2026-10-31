import AdmZip from 'adm-zip';
import { buildZlm, teacherLayer, zlmId, zlmKind, ZLM_MIME } from './zlm-export';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const dataUrl = `data:image/png;base64,${PNG.toString('base64')}`;

const source = () => ({
  doc: {
    id: '3f2a9c1e-0b7d-4e55-9a10-2c3d4e5f6a7b',
    title: 'Ohmsches Gesetz',
    createdAt: new Date('2026-10-01T08:00:00Z'),
    updatedAt: new Date('2026-10-20T08:00:00Z'),
    content: {
      kind: 'arbeitsblatt',
      spec: {
        titel: 'Ohmsches Gesetz',
        content: [
          { id: 'b1', type: 'image', src: dataUrl },
          { id: 'b2', type: 'group', items: [{ src: dataUrl }, { src: 'https://cloud.example.org/bild.png' }] },
          { id: 'b3', type: 'quiz', module: 'q1' },
        ],
      },
    },
  },
  modules: [
    { id: 'q1', type: 'multipleChoice', title: 'Kurzquiz', content: { question: 'U = ?' } },
    { id: 'q1a', parentId: 'q1', type: 'text', title: 'Teil', content: {} },
    { id: 'x9', type: 'multipleChoice', title: 'Anderes', content: {} },
  ],
  ink: {
    updatedAt: new Date('2026-10-25T08:00:00Z'),
    data: { v: 1, bg: 'paper', pages: [{ items: [] }], layer: { blocks: { b1: { items: [{ id: 's1', type: 'stroke' }] } } } },
  },
});

// Kein Netz: Links lassen sich nicht holen und bleiben stehen.
const offline = (async () => { throw new Error('offline'); }) as any;

function entries(bytes: Buffer) {
  const zip = new AdmZip(bytes);
  return new Map(zip.getEntries().map((e) => [e.entryName, e.getData()]));
}

describe('buildZlm', () => {
  it('schreibt eine .zlm nach FORMAT.md: mimetype vorne, Bilder in media/, Quizze, Beschriftung', async () => {
    const bytes = await buildZlm(source(), { fetchImpl: offline });
    const zip = new AdmZip(bytes);
    expect(zip.getEntries()[0].entryName).toBe('mimetype');
    expect(zip.getEntries()[0].header.method).toBe(0);
    const files = entries(bytes);
    expect(files.get('mimetype')!.toString()).toBe(ZLM_MIME);

    const manifest = JSON.parse(files.get('manifest.json')!.toString());
    expect(manifest).toMatchObject({
      format: 'zlm', version: 1, id: '3f2a9c1e0b7d4e559a102c3d4e5f6a7b', title: 'Ohmsches Gesetz', kind: 'worksheet',
      created: '2026-10-01T08:00:00.000Z', modified: '2026-10-25T08:00:00.000Z',
    });

    const spec = JSON.parse(files.get('document.json')!.toString()).spec;
    const media = [...files.keys()].filter((n) => n.startsWith('media/'));
    expect(media).toHaveLength(1); // gleiches Bild zweimal → eine Datei
    expect(spec.content[0].src).toBe(media[0]);
    expect(spec.content[1].items[0].src).toBe(media[0]);
    expect(spec.content[1].items[1].src).toBe('https://cloud.example.org/bild.png');
    expect(files.get(media[0])).toEqual(PNG);

    expect([...files.keys()].filter((n) => n.startsWith('modules/')).sort()).toEqual(['modules/q1.json', 'modules/q1a.json']);
    expect(JSON.parse(files.get('layers/teacher.json')!.toString())).toMatchObject({ id: 'teacher', role: 'teacher', blocks: { b1: { items: [{ id: 's1' }] } }, editor: { bg: 'paper' } });
  });

  it('ergibt bei gleichem Inhalt dieselben Bytes', async () => {
    const a = await buildZlm(source(), { fetchImpl: offline });
    await new Promise((r) => setTimeout(r, 1100));
    expect((await buildZlm(source(), { fetchImpl: offline })).equals(a)).toBe(true);
  });

  it('holt verlinkte Bilder über den Server (Nextcloud)', async () => {
    const local = async (url: string) => (url.includes('cloud.example.org') ? { type: 'image/jpeg', data: Buffer.from('JPG') } : null);
    const files = entries(await buildZlm(source(), { fetchImpl: offline, local }));
    const spec = JSON.parse(files.get('document.json')!.toString()).spec;
    expect(spec.content[1].items[1].src).toMatch(/^media\/img-[0-9a-f]{16}\.jpg$/);
    expect(files.get(spec.content[1].items[1].src)!.toString()).toBe('JPG');
  });

  it('lässt die Ebene weg, wenn nichts beschriftet ist', async () => {
    const src = { ...source(), ink: null };
    expect(entries(await buildZlm(src, { fetchImpl: offline })).has('layers/teacher.json')).toBe(false);
  });
});

describe('Hilfen', () => {
  it('ordnet die Art zu', () => {
    expect(zlmKind('klassenarbeit')).toBe('exam');
    expect(zlmKind('arbeitsblatt')).toBe('worksheet');
    expect(zlmKind(undefined)).toBe('worksheet');
    expect(zlmKind('skript')).toBe('text');
  });

  it('macht aus jeder ID eine gültige Kennung', () => {
    expect(zlmId('abc')).toMatch(/^[a-z0-9]{32}$/);
    expect(zlmId('ABCDEF12-3456')).toBe('abcdef123456');
  });

  it('übernimmt eingefügte Schreibfelder in die Ebene', () => {
    const layer = teacherLayer({ bg: 'paper', layer: { blocks: {}, inserts: [{ id: 'ins1', after: null }] } });
    expect(layer).toMatchObject({ inserts: [{ id: 'ins1' }], editor: { bg: 'paper', pages: [{ items: [] }] } });
    expect(teacherLayer({ layer: { blocks: {} }, pages: [{ items: [] }] })).toBeNull();
  });
});
