import { syncSicherung, uniqueNames, WantedFile, SicherungNc, FileRecord } from './sicherung';

/** Nextcloud im Speicher: Pfad → Inhalt und ETag. */
function fakeNc() {
  const files = new Map<string, { data: Buffer; etag: string }>();
  const folders = new Set<string>(['']);
  let n = 0;
  const k = (p: string[]) => p.join('/');
  const nc: SicherungNc & { files: typeof files; edit(p: string[], text: string): void } = {
    files,
    edit(p, text) { files.set(k(p), { data: Buffer.from(text), etag: `e${++n}` }); },
    async stat(p) { const f = files.get(k(p)); return f ? { isFolder: false, size: f.data.length, etag: f.etag } : folders.has(k(p)) ? { isFolder: true, size: 0, etag: '' } : null; },
    async put(p, data) { const etag = `e${++n}`; files.set(k(p), { data, etag }); return etag; },
    async get(p) { const f = files.get(k(p)); return f ? { type: 'x', data: f.data } : null; },
    async move(a, b) { const f = files.get(k(a)); if (!f) throw new Error('fehlt'); files.delete(k(a)); files.set(k(b), f); },
    async ensureFolder(p) { for (let i = 1; i <= p.length; i++) folders.add(k(p.slice(0, i))); },
    async list(p) {
      const pre = k(p) + '/';
      const names = new Map<string, boolean>();
      for (const f of files.keys()) if (f.startsWith(pre)) { const rest = f.slice(pre.length).split('/'); names.set(rest[0], rest.length > 1); }
      for (const d of folders) if (d.startsWith(pre)) names.set(d.slice(pre.length).split('/')[0], true);
      return [...names].map(([name, isFolder]) => ({ name, isFolder }));
    },
    async remove(p) { folders.delete(k(p)); for (const f of [...files.keys()]) if (f.startsWith(k(p) + '/')) files.delete(f); },
  };
  return nc;
}

const want = (key: string, path: string[], text: string, editable = true): WantedFile => ({
  key, path, hash: `h:${text}`, contentType: 'x', editable, data: async () => Buffer.from(text), title: key,
});
const ROOT = ['Sicherung'];
const text = (nc: ReturnType<typeof fakeNc>, p: string[]) => nc.files.get(['Sicherung', ...p].join('/'))?.data.toString();

describe('Sicherung in die Nextcloud', () => {
  it('schreibt Neues, lässt Unverändertes, schreibt Geändertes neu', async () => {
    const nc = fakeNc();
    let r = await syncSicherung(nc, ROOT, [want('a', ['Book', 'Thema', 'Quiz.zlm'], 'v1')], {});
    expect(r.report.written).toBe(1);
    expect(text(nc, ['Book', 'Thema', 'Quiz.zlm'])).toBe('v1');
    r = await syncSicherung(nc, ROOT, [want('a', ['Book', 'Thema', 'Quiz.zlm'], 'v1')], r.records);
    expect(r.report).toMatchObject({ written: 0, unchanged: 1 });
    r = await syncSicherung(nc, ROOT, [want('a', ['Book', 'Thema', 'Quiz.zlm'], 'v2')], r.records);
    expect(text(nc, ['Book', 'Thema', 'Quiz.zlm'])).toBe('v2');
  });

  it('draußen geänderte .zlm bleibt liegen und wird gemeldet; Verwerfen sichert sie und schreibt neu', async () => {
    const nc = fakeNc();
    let r = await syncSicherung(nc, ROOT, [want('a', ['T', 'Q.zlm'], 'app')], {});
    nc.edit(['Sicherung', 'T', 'Q.zlm'], 'offline');
    r = await syncSicherung(nc, ROOT, [want('a', ['T', 'Q.zlm'], 'app2')], r.records, { now: new Date('2026-11-06T10:00:00Z') });
    expect(r.report.changed).toBe(1);
    expect(r.records.a.state).toBe('changed');
    expect(text(nc, ['T', 'Q.zlm'])).toBe('offline');
    // Verwerfen
    r.records.a.state = 'discard';
    r = await syncSicherung(nc, ROOT, [want('a', ['T', 'Q.zlm'], 'app2')], r.records, { now: new Date('2026-11-06T10:00:00Z') });
    expect(text(nc, ['T', 'Q.zlm'])).toBe('app2');
    expect(text(nc, ['_Gesichert', '2026-11-06', 'T', 'Q.zlm'])).toBe('offline');
    expect(r.records.a.state).toBe('ok');
  });

  it('draußen geänderte Datei, die nicht zurückkommt (Anhang, _lernthema.json): sichern und überschreiben', async () => {
    const nc = fakeNc();
    let r = await syncSicherung(nc, ROOT, [want('m', ['T', '_lernthema.json'], '{}', false)], {});
    nc.edit(['Sicherung', 'T', '_lernthema.json'], 'kaputt');
    r = await syncSicherung(nc, ROOT, [want('m', ['T', '_lernthema.json'], '{}', false)], r.records, { now: new Date('2026-11-06T10:00:00Z') });
    expect(text(nc, ['T', '_lernthema.json'])).toBe('{}');
    expect(text(nc, ['_Gesichert', '2026-11-06', 'T', '_lernthema.json'])).toBe('kaputt');
  });

  it('verschoben: Datei zieht um, leerer Ordner verschwindet; gelöscht: nach _Gesichert', async () => {
    const nc = fakeNc();
    let r = await syncSicherung(nc, ROOT, [want('a', ['Alt', 'T', 'Q.zlm'], 'v'), want('b', ['Alt', 'T', 'W.zlm'], 'w')], {});
    r = await syncSicherung(nc, ROOT, [want('a', ['Neu', 'T', 'Q.zlm'], 'v')], r.records, { now: new Date('2026-11-06T10:00:00Z') });
    expect(r.report.moved).toBe(1);
    expect(text(nc, ['Neu', 'T', 'Q.zlm'])).toBe('v');
    expect(text(nc, ['_Gesichert', '2026-11-06', 'Alt', 'T', 'W.zlm'])).toBe('w');
    expect(await nc.list(['Sicherung'])).not.toContainEqual(expect.objectContaining({ name: 'Alt' }));
    expect(Object.keys(r.records)).toEqual(['a']);
  });

  it('Fremdes am Zielort wird vor dem ersten Schreiben gesichert', async () => {
    const nc = fakeNc();
    nc.edit(['Sicherung', 'T', 'Q.zlm'], 'fremd');
    await syncSicherung(nc, ROOT, [want('a', ['T', 'Q.zlm'], 'app')], {}, { now: new Date('2026-11-06T10:00:00Z') });
    expect(text(nc, ['T', 'Q.zlm'])).toBe('app');
    expect(text(nc, ['_Gesichert', '2026-11-06', 'T', 'Q.zlm'])).toBe('fremd');
  });

  it('eindeutige Namen unter Geschwistern', () => {
    const names = uniqueNames(['Quiz', 'quiz', 'Test'], (x) => x, '.zlm');
    expect([...names.values()]).toEqual(['Quiz.zlm', 'quiz (2).zlm', 'Test.zlm']);
  });

  it('Fehler bei einer Datei hält den Rest nicht auf', async () => {
    const nc = fakeNc();
    const bad: WantedFile = { ...want('x', ['T', 'X.zlm'], 'x'), data: async () => { throw new Error('kaputt'); } };
    const r = await syncSicherung(nc, ROOT, [bad, want('a', ['T', 'Q.zlm'], 'v')], {} as Record<string, FileRecord>);
    expect(r.report.errors).toEqual([expect.objectContaining({ key: 'x', error: 'kaputt' })]);
    expect(text(nc, ['T', 'Q.zlm'])).toBe('v');
  });
});

describe('.zlm auf dem Server lesen', () => {
  const { buildZlm, buildModuleZlm } = require('../github-backup/zlm-export');
  const { readZlmBuffer, inlineMedia, inkStandOf } = require('./zlm-read');
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

  it('Dokument mit Bild, Quiz und Beschriftung: hin und zurück', async () => {
    const buf = await buildZlm({
      doc: { id: 'doc1', title: 'Ohm', content: { kind: 'arbeitsblatt', spec: { titel: 'Ohm', content: [{ id: 'b1', type: 'image', src: `data:image/png;base64,${PNG.toString('base64')}` }, { id: 'b2', type: 'quiz', module: 'q1' }] } } },
      modules: [{ id: 'q1', type: 'multipleChoice', title: 'Q', content: { question: '?' } }],
      ink: { data: { v: 1, bg: 'paper', pages: [], layer: { blocks: { b1: { items: [{ id: 's', type: 'stroke' }] } } } } },
    });
    const z = readZlmBuffer(buf);
    expect(z.manifest.kind).toBe('worksheet');
    expect(z.spec.content[0].src).toMatch(/^media\//);
    expect(inlineMedia(z.spec, z.media).content[0].src).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(z.modules.q1.title).toBe('Q');
    expect(inkStandOf(z.layers.teacher).layer.blocks.b1.items).toHaveLength(1);
  });

  it('Art module und kaputte Dateien', async () => {
    const z = readZlmBuffer(await buildModuleZlm({ module: { id: 'q1', type: 'trueFalse', title: 'T', content: {} } }));
    expect(z.manifest).toMatchObject({ kind: 'module', module: 'q1' });
    expect(() => readZlmBuffer(Buffer.from('kein zip'))).toThrow(/ZIP/);
  });
});
