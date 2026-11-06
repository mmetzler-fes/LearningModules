import { PlansService } from './plans.service';
import { repo as baseRepo } from '../work/test-repo';

/** Wie test-repo, versteht zusätzlich `In([...])`. */
function repo(rows: any[] = []) {
  const r = baseRepo(rows);
  const match = (x: any, where: any) => Object.entries(where || {}).every(([k, v]: any) => (v && v._type === 'in' ? v._value.includes(x[k]) : x[k] === v));
  r.find = async ({ where }: any = {}) => rows.filter((x) => match(x, where));
  r.findOne = async ({ where }: any) => rows.find((x) => match(x, where)) || null;
  return r;
}

const USER = { userId: 't1' };

function setup() {
  const nodes = repo();
  const entries = repo();
  const nbNodes = repo([
    { id: 'book', ownerId: 't1', kind: 'book', title: 'Elektrotechnik', parentId: null, orderIndex: 0 },
    { id: 'grund', ownerId: 't1', kind: 'area', title: 'Grundlagen', parentId: 'book', orderIndex: 0 },
    { id: 'strom', ownerId: 't1', kind: 'section', title: 'Strom', parentId: 'grund', orderIndex: 0 },
  ]);
  const nbPlaces = repo([
    { id: 'p1', ownerId: 't1', topicId: 'ohm', nodeId: 'strom', orderIndex: 0 },
    { id: 'p2', ownerId: 't1', topicId: 'reihe', nodeId: 'strom', orderIndex: 1 },
    { id: 'p3', ownerId: 't1', topicId: 'sps', nodeId: 'book', orderIndex: 0 },
  ]);
  const topics = repo([
    { id: 'ohm', ownerId: 't1', title: 'Ohmsches Gesetz' },
    { id: 'reihe', ownerId: 't1', title: 'Reihenschaltung' },
    { id: 'sps', ownerId: 't1', title: 'SPS' },
    { id: 'fremd', ownerId: 'x', title: 'Fremd' },
  ]);
  const svc = new PlansService(nodes as any, entries as any, nbNodes as any, nbPlaces as any, topics as any, { topicsOfNode: async () => ({ included: [], notReleased: [], title: '' }) } as any);
  return { svc, nodes, entries, nbNodes, nbPlaces, topics };
}

describe('Planungsebene: Dienst', () => {
  it('Ordner, Plan, Lernthema; doppelt im Plan geht nicht, fremdes Lernthema ohne Platz nicht', async () => {
    const { svc } = setup();
    const bs = (await svc.createNode(USER, { kind: 'folder', title: 'Berufsschule' })).id;
    const plan = (await svc.createNode(USER, { kind: 'plan', title: 'Mechatroniker 1', parentId: bs })).id;
    await expect(svc.createNode(USER, { kind: 'area', parentId: bs })).rejects.toThrow(/Plan oder Bereich/);
    expect(await svc.add(USER, { parentId: plan, items: [{ type: 'topic', id: 'ohm' }, { type: 'topic', id: 'ohm' }] })).toEqual({ added: 1, present: ['Ohmsches Gesetz'] });
    await expect(svc.add(USER, { parentId: plan, items: [{ type: 'topic', id: 'fremd' }] })).rejects.toThrow(/nicht gefunden/);
    await expect(svc.add(USER, { parentId: bs, items: [{ type: 'topic', id: 'ohm' }] })).rejects.toThrow(/nur Pläne/);
    const t = await svc.tree(USER);
    expect(t.entries).toHaveLength(1);
    expect(t.topics[0].title).toBe('Ohmsches Gesetz');
  });

  it('Bereich aus dem Notizbuch kommt als Baum und wächst mit; Entferntes kommt nicht wieder', async () => {
    const { svc, nbPlaces, entries } = setup();
    const plan = (await svc.createNode(USER, { kind: 'plan', title: 'P' })).id;
    const r = await svc.add(USER, { parentId: plan, items: [{ type: 'nbnode', id: 'book' }] });
    expect(r.added).toBe(3);
    const ex = await svc.expanded(USER, plan);
    const book: any = ex.items[0];
    expect(book.title).toBe('Elektrotechnik');
    expect(book.children[0].title).toBe('Grundlagen');
    expect(book.children[0].children[0]).toMatchObject({ kind: 'section', title: 'Strom' });
    // Neu im Notizbuch → kommt dazu.
    nbPlaces.rows.push({ id: 'p4', ownerId: 't1', topicId: 'neu', nodeId: 'strom', orderIndex: 2 });
    (svc as any).topicRepo.rows?.push?.({ id: 'neu', ownerId: 't1', title: 'Neu' });
    await svc.tree(USER);
    expect(entries.rows.map((e) => e.topicId)).toContain('neu');
    // Aus dem Plan entfernt → bleibt weg.
    const ohm = entries.rows.find((e) => e.topicId === 'ohm');
    await svc.deleteEntry(USER, ohm.id);
    await svc.tree(USER);
    expect(entries.rows.map((e) => e.topicId)).not.toContain('ohm');
  });

  it('Teilplan einbinden, Kreis verboten, Löschen nimmt ihn überall heraus', async () => {
    const { svc, nodes } = setup();
    const el = (await svc.createNode(USER, { kind: 'plan', title: 'Elektro LF1-4' })).id;
    const mech = (await svc.createNode(USER, { kind: 'plan', title: 'Mechatroniker' })).id;
    await svc.add(USER, { parentId: el, items: [{ type: 'topic', id: 'ohm' }] });
    await svc.add(USER, { parentId: mech, items: [{ type: 'plan', id: el }, { type: 'topic', id: 'sps' }] });
    await expect(svc.add(USER, { parentId: el, items: [{ type: 'plan', id: mech }] })).rejects.toThrow(/Kreis/);
    expect((await svc.tree(USER)).usedIn[el]).toEqual([{ id: mech, title: 'Mechatroniker' }]);
    const ex: any = await svc.expanded(USER, mech);
    expect(ex.items[0]).toMatchObject({ title: 'Elektro LF1-4', include: el });
    expect(ex.items[1]).toEqual({ type: 'topic', topicId: 'sps' });
    expect((await svc.deleteNode(USER, el)).usedIn).toEqual(['Mechatroniker']);
    expect(nodes.rows.filter((x) => x.kind === 'include')).toHaveLength(0);
  });

  it('Bereich löschen: Inhalt rückt hoch; Verschieben in einen anderen Plan ohne Doppelte', async () => {
    const { svc, entries } = setup();
    const a = (await svc.createNode(USER, { kind: 'plan', title: 'A' })).id;
    const b = (await svc.createNode(USER, { kind: 'plan', title: 'B' })).id;
    const area = (await svc.createNode(USER, { kind: 'area', title: 'LF 5', parentId: a })).id;
    await svc.add(USER, { parentId: area, items: [{ type: 'topic', id: 'ohm' }, { type: 'topic', id: 'sps' }] });
    await svc.add(USER, { parentId: b, items: [{ type: 'topic', id: 'ohm' }] });
    await svc.move(USER, { type: 'node', id: area, parentId: b });
    expect(entries.rows.filter((e) => e.nodeId === area).map((e) => e.topicId)).toEqual(['sps']);
    await svc.deleteNode(USER, area);
    expect(entries.rows.filter((e) => e.nodeId === b).map((e) => e.topicId).sort()).toEqual(['ohm', 'sps']);
  });

  it('Plan in einen Ordner kopieren (F5)', async () => {
    const { svc, nodes, entries } = setup();
    const f = (await svc.createNode(USER, { kind: 'folder', title: 'Elektroniker' })).id;
    const p = (await svc.createNode(USER, { kind: 'plan', title: 'Mech' })).id;
    await svc.add(USER, { parentId: p, items: [{ type: 'topic', id: 'ohm' }] });
    await svc.add(USER, { parentId: f, items: [{ type: 'plan', id: p }] });
    const copy = nodes.rows.find((x) => x.parentId === f);
    expect(copy).toMatchObject({ kind: 'plan', title: 'Mech (Kopie)' });
    expect(entries.rows.filter((e) => e.nodeId === copy.id)).toHaveLength(1);
  });
});
