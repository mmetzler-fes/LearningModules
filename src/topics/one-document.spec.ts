import { groupByDocument, hasDocument, oneDocumentEach } from './one-document';

const doc = (id: string, quizzes: string[] = [], orderIndex = 0) => ({
  id, type: 'document', title: `Blatt ${id}`, topicId: 'T', orderIndex, parentId: null as string | null,
  content: { kind: 'arbeitsblatt', spec: { content: quizzes.map((q) => ({ type: 'quiz', module: q })) } },
});
const quiz = (id: string, orderIndex = 0, parentId: string | null = null) => ({
  id, type: 'multipleChoice', title: `Quiz ${id}`, topicId: 'T', orderIndex, parentId, content: {},
});

describe('Ein Dokument je Lernthema', () => {
  it('erkennt Dokumente auf oberster Ebene, Anhänge zählen mit', () => {
    expect(hasDocument([quiz('q')])).toBe(false);
    expect(hasDocument([quiz('q'), { id: 'a', type: 'attachment' }])).toBe(true);
    expect(hasDocument([{ id: 'd', type: 'document' }], new Set(['d']))).toBe(false);
    expect(hasDocument([{ id: 'k', type: 'document', parentId: 'x' }])).toBe(false);
  });

  it('teilt nach Dokumenten auf: eingebettete Quizze samt Untermodulen gehen mit, ein Quiz in zwei Blättern bleibt beim ersten', () => {
    const mods = [quiz('q1', 0), doc('a', ['q1', 'q2'], 1), quiz('q2', 2), quiz('s', 0, 'q2'), doc('b', ['q2', 'q3'], 3), quiz('q3', 4), quiz('lose', 5)];
    const { groups, loose } = groupByDocument(mods);
    expect(groups.map((g) => g.map((m) => m.id))).toEqual([['q1', 'a', 'q2', 's'], ['b', 'q3']]);
    expect(loose.map((m) => m.id)).toEqual(['lose']);
  });

  it('Import mit drei Blättern: drei Lernthemen hintereinander, das erste heißt wie sein Blatt', async () => {
    const mods = [doc('a', ['q1'], 0), quiz('q1', 1), doc('b', [], 2), quiz('lose', 3), doc('c', [], 4)];
    const topic: any = { id: 'T', title: 'Mappe', classId: null };
    const made: string[] = [];
    const ids = await oneDocumentEach(mods, topic, false, {
      existing: async () => [],
      sibling: async (after, title) => { made.push(`${after.id}→${title}`); return { id: `S${made.length}` } as any; },
      rename: async () => undefined,
    });
    expect(ids).toEqual(['T', 'S1', 'S2']);
    expect(made).toEqual(['T→Blatt b', 'S1→Blatt c']);
    expect(topic.title).toBe('Blatt a');
    expect(mods.map((m) => [m.id, m.topicId, m.orderIndex])).toEqual([
      ['a', 'T', 0], ['q1', 'T', 1], ['b', 'S1', 0], ['lose', 'T', 2], ['c', 'S2', 0],
    ]);
  });

  it('ins Lernthema, das schon ein Dokument hat: das neue bekommt ein eigenes dahinter', async () => {
    const mods = [doc('a'), quiz('q')];
    const ids = await oneDocumentEach(mods, { id: 'T', title: 'Alt' } as any, true, {
      existing: async () => [{ id: 'x', type: 'document' }],
      sibling: async () => ({ id: 'S' }) as any,
      rename: async () => { throw new Error('nicht umbenennen'); },
    });
    expect(ids).toEqual(['T', 'S']);
    expect(mods.find((m) => m.id === 'a')!.topicId).toBe('S');
    expect(mods.find((m) => m.id === 'q')!.topicId).toBe('T');
  });

  it('ein Blatt oder nur Quizze: alles bleibt, wie es war', async () => {
    const io = { existing: async () => [], sibling: async () => { throw new Error('kein neues'); }, rename: async () => { throw new Error('nicht umbenennen'); } };
    await expect(oneDocumentEach([doc('a'), quiz('q')], { id: 'T' } as any, false, io)).resolves.toEqual(['T']);
    await expect(oneDocumentEach([quiz('q'), quiz('r')], { id: 'T' } as any, true, io)).resolves.toEqual(['T']);
    // Klasseneigenes Lernthema: eigene Regeln
    await expect(oneDocumentEach([doc('a'), doc('b')], { id: 'T', classId: 'K' } as any, false, io)).resolves.toEqual(['T']);
  });
});

describe('createSiblingTopic (echte Datenbank)', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { DataSource } = require('typeorm');
  const { LearningTopic } = require('../core/entities/learning-topic.entity');
  const { LearningModule } = require('../core/entities/learning-module.entity');
  const { NotebookPlacement } = require('../core/entities/notebook-placement.entity');
  const { PlanEntry } = require('../core/entities/plan-entry.entity');
  const { TopicLink } = require('../core/entities/topic-link.entity');
  const { createSiblingTopic } = require('./one-document');

  it('legt das neue Lernthema direkt dahinter: Notizbuch, Planung, Links, Freigabe und Tags', async () => {
    const ds = new DataSource({ type: 'sqlite', database: ':memory:', entities: [LearningTopic, LearningModule, NotebookPlacement, PlanEntry, TopicLink], synchronize: true });
    await ds.initialize();
    const m = ds.manager;
    const topic = await m.save(LearningTopic, { id: 'T', title: 'Mappe', ownerId: 'u', selected: true, teacherOnly: true, visibility: 'locked', tagIds: ['tag'] });
    await m.save(LearningTopic, { id: 'X', title: 'Nächstes', ownerId: 'u', visibility: 'locked' });
    await m.save(NotebookPlacement, [
      { id: 'p1', ownerId: 'u', topicId: 'T', nodeId: 'N', orderIndex: 0, inheritedTagIds: ['tag'] },
      { id: 'p2', ownerId: 'u', topicId: 'X', nodeId: 'N', orderIndex: 1 },
      { id: 'p3', ownerId: 'andere', topicId: 'T', nodeId: 'M', orderIndex: 0 },
    ]);
    await m.save(PlanEntry, [{ id: 'e1', ownerId: 'u', nodeId: 'P', topicId: 'T', orderIndex: 0 }, { id: 'e2', ownerId: 'u', nodeId: 'P', topicId: 'X', orderIndex: 1 }]);
    await m.save(TopicLink, [
      { id: 'l1', name: 'Klasse', ownerId: 'u', token: null, examToken: null, contestHostToken: null, modes: ['quiz'], selection: [{ topicId: 'T', all: true }, { topicId: 'X', all: true }] },
      { id: 'l2', name: 'Auswahl', ownerId: 'u', token: null, examToken: null, contestHostToken: null, modes: ['quiz'], selection: [{ topicId: 'T', all: false, moduleIds: ['q'] }] },
    ]);

    const s = await createSiblingTopic(m, topic, 'Blatt 2', 'u');
    expect(s).toMatchObject({ title: 'Blatt 2', ownerId: 'u', selected: true, teacherOnly: true, tagIds: ['tag'] });
    const places = await m.find(NotebookPlacement, { where: { ownerId: 'u' }, order: { orderIndex: 'ASC' } });
    expect(places.map((p: any) => [p.topicId, p.orderIndex])).toEqual([['T', 0], [s.id, 1], ['X', 2]]);
    expect(places[1].inheritedTagIds).toEqual(['tag']);
    // Wer das Lernthema nur einsortiert hat, ohne Rechte am neuen: dort kein Platz.
    expect(await m.count(NotebookPlacement, { where: { ownerId: 'andere' } })).toBe(1);
    const entries = await m.find(PlanEntry, { order: { orderIndex: 'ASC' } });
    expect(entries.map((e: any) => e.topicId)).toEqual(['T', s.id, 'X']);
    const l1 = await m.findOneBy(TopicLink, { id: 'l1' });
    expect(l1.selection.map((x: any) => x.topicId)).toEqual(['T', s.id, 'X']);
    const l2 = await m.findOneBy(TopicLink, { id: 'l2' });
    expect(l2.selection).toHaveLength(1);
    await ds.destroy();
  });
});

describe('TopicsService: ein Dokument je Lernthema (echte Datenbank)', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { DataSource } = require('typeorm');
  const { TopicsService } = require('./topics.service');
  const { LearningTopic } = require('../core/entities/learning-topic.entity');
  const { LearningModule } = require('../core/entities/learning-module.entity');
  const { NotebookPlacement } = require('../core/entities/notebook-placement.entity');
  const { PlanEntry } = require('../core/entities/plan-entry.entity');
  const { TopicLink } = require('../core/entities/topic-link.entity');
  const user = { userId: 'u' };

  async function setup() {
    const ds = new DataSource({ type: 'sqlite', database: ':memory:', entities: [LearningTopic, LearningModule, NotebookPlacement, PlanEntry, TopicLink], synchronize: true });
    await ds.initialize();
    const svc: any = Object.create(TopicsService.prototype);
    svc.topicRepo = ds.getRepository(LearningTopic);
    svc.moduleRepo = ds.getRepository(LearningModule);
    svc.nextcloud = { assertAppImagesAllowed: async () => undefined };
    await ds.manager.save(LearningTopic, { id: 'T', title: 'Blatt 1', ownerId: 'u', visibility: 'locked' });
    await ds.manager.save(NotebookPlacement, { id: 'p', ownerId: 'u', topicId: 'T', nodeId: 'N', orderIndex: 0 });
    return { ds, svc };
  }
  const docData = (id: string, title: string) => ({ id, type: 'document', title, content: { kind: 'arbeitsblatt', spec: { content: [] } } });

  it('das erste Dokument bleibt, ein zweites bekommt ein eigenes Lernthema, Bearbeiten bleibt an Ort und Stelle', async () => {
    const { ds, svc } = await setup();
    const a = await svc.addModule('T', user, docData('a', 'Blatt 1'));
    expect(a.topicId).toBe('T');
    const q = await svc.addModule('T', user, { id: 'q', type: 'multipleChoice', title: 'Quiz', content: {} });
    expect(q.topicId).toBe('T');
    const b = await svc.addModule('T', user, docData('b', 'Blatt 2'));
    expect(b.topicId).not.toBe('T');
    expect((await ds.manager.findOneBy(LearningTopic, { id: b.topicId })).title).toBe('Blatt 2');
    // Speichern eines vorhandenen Dokuments: kein neues Lernthema
    const again = await svc.addModule('T', user, { ...docData('a', 'Blatt 1'), content: { kind: 'arbeitsblatt', spec: { content: [{ type: 'text', text: 'x' }] } } });
    expect(again.topicId).toBe('T');
    expect(await ds.manager.count(LearningTopic)).toBe(2);
    // Anhang, der umgewandelt wird: sein Platz geht ans neue Dokument
    await ds.manager.save(LearningTopic, { id: 'A', title: 'Anhang', ownerId: 'u', visibility: 'locked' });
    await ds.manager.save(LearningModule, { id: 'att', topicId: 'A', type: 'attachment', title: 'PDF', orderIndex: 0, content: { files: [] } } as any);
    expect((await svc.addModule('A', user, { ...docData('c', 'PDF'), replacesId: 'att' })).topicId).toBe('A');
    await ds.destroy();
  });

  it('Duplizieren: eigenes Lernthema dahinter; Verschieben in ein Lernthema mit Dokument wird abgelehnt', async () => {
    const { ds, svc } = await setup();
    svc.syncHtmlAppUnits = async () => undefined;
    await svc.addModule('T', user, docData('a', 'Blatt 1'));
    const res = await svc.transferModules('T', 'T', ['a'], 'copy', user);
    expect(res.ownTopics).toHaveLength(1);
    const copy = await ds.manager.findOneBy(LearningModule, { topicId: res.ownTopics[0] });
    expect(copy.title).toBe('Blatt 1 (Kopie)');
    expect(await ds.manager.count(LearningModule, { where: { topicId: 'T' } })).toBe(1);
    await expect(svc.transferModules(res.ownTopics[0], 'T', [copy.id], 'move', user)).rejects.toThrow(/schon ein Dokument/);
    // Rückgängig der KI-Schnittstelle darf den alten Stand wiederherstellen
    await expect(svc.transferModules(res.ownTopics[0], 'T', [copy.id], 'move', user, { allowSeveralDocs: true })).resolves.toMatchObject({ success: true });
    await ds.destroy();
  });
});
