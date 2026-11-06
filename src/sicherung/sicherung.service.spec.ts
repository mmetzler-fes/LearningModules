import AdmZip from 'adm-zip';
import { SicherungService } from './sicherung.service';
import { repo as baseRepo } from '../work/test-repo';

/** test-repo plus In(...) und IsNull(); Lernthemen bringen ihre Module mit (relations). */
function repo(rows: any[] = [], withModules?: () => any[]) {
  const r = baseRepo(rows);
  const ok = (x: any, where: any) => Object.entries(where || {}).every(([k, v]: any) =>
    v && v._type === 'in' ? v._value.includes(x[k]) : v && v._type === 'isNull' ? x[k] == null : x[k] === v);
  const attach = (x: any) => (withModules ? { ...x, modules: withModules().filter((m) => m.topicId === x.id) } : x);
  r.find = async ({ where }: any = {}) => rows.filter((x) => ok(x, where)).map(attach);
  r.findOne = async ({ where }: any) => { const x = rows.find((y) => ok(y, where)); return x ? attach(x) : null; };
  return r;
}

function fakeNc() {
  const files = new Map<string, { data: Buffer; etag: string }>();
  const folders = new Set<string>();
  let n = 0;
  const k = (p: string[]) => p.join('/');
  return {
    files,
    async stat(p: string[]) { const f = files.get(k(p)); return f ? { isFolder: false, size: f.data.length, etag: f.etag } : folders.has(k(p)) ? { isFolder: true, size: 0, etag: '' } : null; },
    async put(p: string[], data: Buffer) { const etag = `e${++n}`; files.set(k(p), { data, etag }); return etag; },
    async get(p: string[]) { const f = files.get(k(p)); return f ? { type: 'x', data: f.data } : null; },
    async move(a: string[], b: string[]) { const f = files.get(k(a))!; files.delete(k(a)); files.set(k(b), f); },
    async ensureFolder(p: string[]) { for (let i = 1; i <= p.length; i++) folders.add(k(p.slice(0, i))); },
    async list(p: string[]) {
      const pre = k(p) + '/';
      const names = new Map<string, boolean>();
      for (const f of files.keys()) if (f.startsWith(pre)) { const rest = f.slice(pre.length).split('/'); names.set(rest[0], rest.length > 1); }
      return [...names].map(([name, isFolder]) => ({ name, isFolder }));
    },
    async remove(p: string[]) { folders.delete(k(p)); for (const f of [...files.keys()]) if (f.startsWith(k(p) + '/')) files.delete(f); },
    edit(path: string, data: Buffer) { files.set(path, { data, etag: `e${++n}` }); },
  };
}

function setup() {
  const modules = repo([
    { id: 'doc1', topicId: 't1', type: 'document', title: 'Arbeitsblatt', creatorId: 'u1', orderIndex: 0, content: { kind: 'arbeitsblatt', spec: { titel: 'AB', content: [{ id: 'b1', type: 'quiz', module: 'q1' }] } } },
    { id: 'q1', topicId: 't1', type: 'multipleChoice', title: 'Quiz Ohm', creatorId: 'u1', orderIndex: 1, content: { question: 'R?' } },
    { id: 'att1', topicId: 't1', type: 'attachment', title: 'Material', creatorId: 'u1', orderIndex: 2, content: { files: [{ name: 'Tabelle.pdf', url: 'https://x/api/nextcloud/files/a/b/Tabelle.pdf', size: 3 }] } },
    { id: 'q9', topicId: 't2', type: 'trueFalse', title: 'Lose', creatorId: 'u1', orderIndex: 0, content: {} },
  ]);
  const topics = repo([
    { id: 't1', ownerId: 'u1', title: 'Ohmsches Gesetz', classId: null },
    { id: 't2', ownerId: 'u1', title: 'Ohne Platz', classId: null },
  ], () => modules.rows);
  const nodes = repo([{ id: 'n1', ownerId: 'u1', kind: 'book', title: 'Elektrotechnik', parentId: null, orderIndex: 0 }]);
  const places = repo([{ id: 'p1', ownerId: 'u1', topicId: 't1', nodeId: 'n1', orderIndex: 0 }]);
  const links = repo([{ id: 'l1', userId: 'u1', sicherungFiles: null }]);
  const nc = fakeNc();
  const nextcloud: any = {
    connection: async () => ({ l: links.rows[0], nc }),
    readImageByUrl: async () => ({ type: 'application/pdf', data: Buffer.from('PDF') }),
    uploadAttachment: async (_u: any, topicId: string, f: any) => ({ url: `https://x/api/nextcloud/files/neu/${topicId}/${f.originalname}`, size: f.size, type: f.mimetype }),
  };
  const inks = repo();
  const svc = new SicherungService(links as any, nodes as any, places as any, topics as any, modules as any, inks as any, repo() as any, nextcloud, { setRunner() {} } as any);
  return { svc, nc, modules, links, nodes, places, topics, inks };
}

describe('Sicherung: Dienst', () => {
  it('legt den Aufbau des Notizbuchs an: .zlm je Modul, Anhang als Datei, _lernthema.json', async () => {
    const { svc, nc } = setup();
    const r = await svc.run('u1');
    expect(r.errors).toBe(0);
    const paths = [...nc.files.keys()].sort();
    expect(paths).toEqual([
      'Sicherung/Elektrotechnik/Ohmsches Gesetz/01 Arbeitsblatt.zlm',
      'Sicherung/Elektrotechnik/Ohmsches Gesetz/02 Quiz Ohm.zlm',
      'Sicherung/Elektrotechnik/Ohmsches Gesetz/03 Material – Tabelle.pdf',
      'Sicherung/Elektrotechnik/Ohmsches Gesetz/_lernthema.json',
      'Sicherung/LIESMICH.txt',
      'Sicherung/Unsortiert/Ohne Platz/01 Lose.zlm',
      'Sicherung/Unsortiert/Ohne Platz/_lernthema.json',
    ]);
    const meta = JSON.parse(nc.files.get('Sicherung/Elektrotechnik/Ohmsches Gesetz/_lernthema.json')!.data.toString());
    expect(meta.modules.map((m: any) => m.file || m.files[0])).toEqual(['01 Arbeitsblatt.zlm', '02 Quiz Ohm.zlm', '03 Material – Tabelle.pdf']);
    // Zweiter Lauf: nichts zu schreiben.
    expect((await svc.run('u1')).written).toBe(0);
  });

  it('offline geändertes Quiz: gemeldet, übernommen, alter Stand unter _Gesichert', async () => {
    const { svc, nc, modules } = setup();
    await svc.run('u1');
    const path = 'Sicherung/Elektrotechnik/Ohmsches Gesetz/02 Quiz Ohm.zlm';
    const zip = new AdmZip(nc.files.get(path)!.data);
    const q = JSON.parse(zip.getEntry('modules/q1.json')!.getData().toString());
    zip.updateFile('modules/q1.json', Buffer.from(JSON.stringify({ ...q, title: 'Quiz Ohm (neu)', content: { question: 'R = U/I?' } })));
    nc.edit(path, zip.toBuffer());
    const r = await svc.run('u1');
    expect(r.changed).toBe(1);
    expect((await svc.changed({ userId: 'u1' })).files).toEqual([expect.objectContaining({ key: 'mod:q1', title: 'Quiz Ohm', path })]);
    const res = await svc.takeOver({ userId: 'u1' }, 'mod:q1');
    expect(res.success).toBe(true);
    expect(modules.rows.find((m) => m.id === 'q1')).toMatchObject({ title: 'Quiz Ohm (neu)', content: { question: 'R = U/I?' } });
    expect([...nc.files.keys()].some((p) => p.startsWith('Sicherung/_Gesichert/') && p.endsWith('02 Quiz Ohm (App).zlm'))).toBe(true);
    expect((await svc.changed({ userId: 'u1' })).files).toEqual([]);
    // Danach schreibt die App die Datei wieder in ihrem Format – unter dem neuen Titel.
    await svc.run('u1');
    expect(nc.files.has('Sicherung/Elektrotechnik/Ohmsches Gesetz/02 Quiz Ohm (neu).zlm')).toBe(true);
  });

  it('offline geändertes Dokument: Spec übernommen; Verwerfen stellt die App-Fassung wieder her', async () => {
    const { svc, nc, modules } = setup();
    await svc.run('u1');
    const path = 'Sicherung/Elektrotechnik/Ohmsches Gesetz/01 Arbeitsblatt.zlm';
    const original = nc.files.get(path)!.data;
    const zip = new AdmZip(original);
    zip.updateFile('document.json', Buffer.from(JSON.stringify({ spec: { titel: 'AB', content: [{ id: 'b0', type: 'text', text: 'Neu' }, { id: 'b1', type: 'quiz', module: 'q1' }] } })));
    nc.edit(path, zip.toBuffer());
    await svc.run('u1');
    await svc.takeOver({ userId: 'u1' }, 'mod:doc1');
    expect(modules.rows.find((m) => m.id === 'doc1').content.spec.content[0]).toEqual({ id: 'b0', type: 'text', text: 'Neu' });
    // Noch einmal draußen ändern, diesmal verwerfen.
    nc.edit(path, Buffer.from('kaputt'));
    await svc.run('u1');
    await svc.discard({ userId: 'u1' }, 'mod:doc1');
    expect(nc.files.get(path)!.data.toString()).not.toBe('kaputt');
    expect([...nc.files.entries()].some(([p, f]) => p.startsWith('Sicherung/_Gesichert/') && f.data.toString() === 'kaputt')).toBe(true);
  });

  it('Wiederherstellen: neues Book mit Lernthema, neue Kennungen, Quiz-Verweis angepasst, Anhang neu hochgeladen', async () => {
    const { svc, nc, modules, nodes, places, topics } = setup();
    await svc.run('u1');
    const tree = await svc.tree({ userId: 'u1' });
    expect(tree.folders.map((f: any) => [f.name, f.topic])).toEqual([['Elektrotechnik', false], ['Unsortiert', false]]);
    expect(tree.folders[0].children[0]).toMatchObject({ name: 'Ohmsches Gesetz', topic: true });
    const res = await svc.restore({ userId: 'u1' }, ['Elektrotechnik']);
    expect(res).toMatchObject({ topics: 1, errors: [] });
    const book = nodes.rows.find((n) => n.id === res.bookId);
    expect(book).toMatchObject({ kind: 'book', parentId: null });
    expect(book.title).toMatch(/^Aus der Nextcloud \(/);
    const topic = topics.rows.find((t) => t.title === 'Ohmsches Gesetz' && t.id !== 't1');
    expect(places.rows.find((p) => p.topicId === topic.id)?.nodeId).toBe(book.id);
    const mine = modules.rows.filter((m) => m.topicId === topic.id).sort((a, b) => a.orderIndex - b.orderIndex);
    expect(mine.map((m) => m.type)).toEqual(['document', 'multipleChoice', 'attachment']);
    const quiz = mine.find((m) => m.type === 'multipleChoice');
    expect(quiz.id).not.toBe('q1');
    expect(mine[0].content.spec.content[0]).toMatchObject({ type: 'quiz', module: quiz.id });
    expect(mine[2].content.files[0]).toMatchObject({ name: 'Tabelle.pdf' });
    // Das Original bleibt unberührt.
    expect(modules.rows.find((m) => m.id === 'q1').topicId).toBe('t1');
    expect(() => svc.restore({ userId: 'u1' }, ['..'])).rejects.toThrow(/Ungültig/);
  });
});
