import { DataSource } from 'typeorm';
import { MappenMigrationService, planMappe } from './mappen-migration.service';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { PlanEntry } from '../core/entities/plan-entry.entity';
import { PlanNode } from '../core/entities/plan-node.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { ClassNotebookPlace } from '../core/entities/class-notebook-place.entity';
import { ClassNotebookNode } from '../core/entities/class-notebook-node.entity';
import { Result } from '../core/entities/result.entity';
import { DocumentWork } from '../core/entities/document-work.entity';
import { ModuleDraft } from '../core/entities/module-draft.entity';
import { ContentFeedback } from '../core/entities/content-feedback.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { FederationCopy } from '../core/entities/federation-copy.entity';
import { User } from '../core/entities/user.entity';

const ENTITIES = [LearningTopic, LearningModule, NotebookNode, NotebookPlacement, PlanEntry, PlanNode, TopicLink, TopicQuickLink,
  ClassNotebookPlace, ClassNotebookNode, Result, DocumentWork, ModuleDraft, ContentFeedback, UseGrant, ShopOffer, FederationCopy, User];

const doc = (id: string, topicId: string, orderIndex: number, quizzes: string[] = []) => ({
  id, topicId, type: 'document', title: `Blatt ${id}`, orderIndex, moduleSelected: true,
  content: { kind: 'arbeitsblatt', spec: { content: quizzes.map((q) => ({ type: 'quiz', module: q })) } },
});
const quiz = (id: string, topicId: string, orderIndex: number, parentId: string | null = null) => ({
  id, topicId, type: 'multipleChoice', title: `Quiz ${id}`, orderIndex, parentId, moduleSelected: true, content: {},
});
const link = (id: string, more: Partial<TopicLink>) => ({
  id, name: id, ownerId: 'u', token: null, examToken: null, contestHostToken: null, active: true, modes: ['quiz'], selection: [], ...more,
});

describe('Mappen auflösen: Planung', () => {
  const nodes = [
    { id: 'B', kind: 'book', title: 'ET', parentId: null },
    { id: 'A', kind: 'area', title: 'DC', parentId: 'B' },
    { id: 'N', kind: 'section', title: 'Gleichstrommotor', parentId: 'A' },
  ];
  const mods = [doc('d1', 'M', 0, ['q1']), quiz('q1', 'M', 1), doc('d2', 'M', 2), quiz('lose', 'M', 3)];

  it('im Abschnitt: Abschnitt wird Bereich; im Bereich: neuer Abschnitt; unsortiert: hintereinander', () => {
    const t = { id: 'M', title: 'PWM', ownerId: 'u' };
    expect(planMappe(t, mods, { nodeId: 'N' }, nodes)).toMatchObject({ mode: 'section-to-area', convertNodeId: 'N', parentNodeId: 'N', path: 'ET › DC › Gleichstrommotor' });
    expect(planMappe(t, mods, { nodeId: 'A' }, nodes)).toMatchObject({ mode: 'new-section', convertNodeId: null, parentNodeId: 'A' });
    expect(planMappe(t, mods, null, nodes)).toMatchObject({ mode: 'flat', path: 'Unsortiert' });
    expect(planMappe(t, mods, { nodeId: 'N' }, nodes)!.parts).toEqual([
      { title: 'Blatt d1', moduleIds: ['d1', 'q1'] },
      { title: 'Blatt d2', moduleIds: ['d2'] },
      { title: 'PWM – Quizze', moduleIds: ['lose'], quizzes: true },
    ]);
    expect(planMappe(t, [doc('d1', 'M', 0), quiz('q', 'M', 1)], { nodeId: 'N' }, nodes)).toBeNull();
  });

  it('zu tief: kein weiterer Abschnitt', () => {
    const deep = [{ id: 'n0', kind: 'book', title: 'b', parentId: null }, ...Array.from({ length: 7 }, (_, i) => ({ id: `n${i + 1}`, kind: i === 6 ? 'section' : 'area', title: `${i}`, parentId: `n${i}` }))];
    expect(planMappe({ id: 'M', title: 'x', ownerId: 'u' }, mods, { nodeId: 'n7' }, deep)!.mode).toBe('flat');
  });
});

describe('Mappen auflösen (echte Datenbank)', () => {
  let ds: DataSource;
  beforeEach(async () => {
    ds = new DataSource({ type: 'sqlite', database: ':memory:', entities: ENTITIES, synchronize: true });
    await ds.initialize();
    const m = ds.manager;
    await m.save(User, [{ id: 'u', email: 'u@x', username: 'u', displayName: 'Lehrer', passwordHash: '', role: 'teacher' }, { id: 'c', email: 'c@x', username: 'c', passwordHash: '', role: 'teacher' }] as any);
    await m.save(NotebookNode, [
      { id: 'B', ownerId: 'u', kind: 'book', title: 'ET', parentId: null, orderIndex: 0 },
      { id: 'N', ownerId: 'u', kind: 'section', title: 'Gleichstrommotor', parentId: 'B', orderIndex: 0 },
    ] as any);
    await m.save(LearningTopic, [
      { id: 'M', title: 'PWM und H-Brücke', ownerId: 'u', selected: true, teacherOnly: false, visibility: 'locked', tagIds: ['t1'] },
      { id: 'X', title: 'Einzeln', ownerId: 'u', selected: true, visibility: 'locked' },
    ] as any);
    await m.save(LearningModule, [doc('d1', 'M', 0, ['q1']), quiz('q1', 'M', 1), quiz('s1', 'M', 0, 'q1'), doc('d2', 'M', 2, ['q2']), quiz('q2', 'M', 3), quiz('lose', 'M', 4), doc('x1', 'X', 0)] as any);
    await m.save(NotebookPlacement, [
      { id: 'p1', ownerId: 'u', topicId: 'M', nodeId: 'N', orderIndex: 0, inheritedTagIds: ['t1'] },
      { id: 'p2', ownerId: 'u', topicId: 'X', nodeId: 'N', orderIndex: 1 },
      { id: 'p3', ownerId: 'c', topicId: 'M', nodeId: null, orderIndex: 0 },
      { id: 'p4', ownerId: 'c', topicId: 'Y', nodeId: null, orderIndex: 1 },
    ] as any);
    await m.save(UseGrant, { id: 'g1', userId: 'c', topicId: 'M', offerId: 'o1', scope: 'all', creatorId: 'u', pricePaid: 5, paidTo: null, onlyForeign: false } as any);
    await m.save(ShopOffer, { id: 'o1', topicId: 'M', scopeType: 'topic', kind: 'creator', sellerId: 'u', audience: [] } as any);
    await m.save(PlanEntry, [{ id: 'e1', ownerId: 'u', nodeId: 'P', topicId: 'M', orderIndex: 0 }, { id: 'e2', ownerId: 'u', nodeId: 'P', topicId: 'X', orderIndex: 1 }]);
    await m.save(PlanNode, { id: 'P', ownerId: 'u', kind: 'section', title: 'GM', parentId: null, orderIndex: 0, sourceNodeId: 'N', seen: ['M', 'X'] } as any);
    await m.save(TopicLink, [
      link('R', { quickTopicId: 'M', token: 'tok', classIds: ['k1'], modes: ['quiz', 'companion'] }),
      link('L', { classId: 'k1', templateId: 'R', selection: [{ topicId: 'M', all: true }], startView: 'ink', solutionModuleIds: ['d1', 'd2'] }),
      link('E', { classId: 'k1', templateId: 'R', modes: ['exam'], selection: [{ topicId: 'M', all: false, moduleIds: ['d2'] }] }),
      link('F', { selection: [{ topicId: 'M', all: false, moduleIds: ['d1', 'q2'] }, { topicId: 'X', all: true }] }),
    ] as any);
    await m.save(ClassNotebookPlace, [
      { id: 'L', classId: 'k1', nodeId: null, orderIndex: 0, hidden: false },
      { id: 'Z', classId: 'k1', nodeId: null, orderIndex: 1, hidden: false },
    ] as any);
    await m.save(Result, { id: 'r1', userId: '', studentName: 'Anna', teacherId: 'u', schoolId: '', topicId: 'M', moduleId: 'q2', score: 1, maxScore: 1, payload: {}, mode: 'quiz', ipAddress: '' } as any);
    await m.save(ContentFeedback, { id: 'f1', userId: 'c', topicId: 'M', stars: 5, thanks: false, comment: null } as any);
  });
  afterEach(() => ds.destroy());

  it('Vorschau ändert nichts und nennt, was passiert', async () => {
    const svc = new MappenMigrationService(ds);
    const p = await svc.preview();
    expect(p.count).toBe(1);
    expect(p.items[0]).toMatchObject({ title: 'PWM und H-Brücke', ownerName: 'Lehrer', mode: 'section-to-area' });
    expect(p.items[0].notes.join(' ')).toMatch(/Quick-Link.*Abschnitt/);
    expect(p.items[0].notes.join(' ')).toMatch(/Klassenarbeit/);
    expect(await ds.manager.count(LearningTopic)).toBe(2);
  });

  it('löst die Mappe auf: Abschnitt, Lernthemen, Ergebnisse, Plätze, Links, Klassennotizbuch, Shop', async () => {
    const res = await new MappenMigrationService(ds).run();
    expect(res.failed).toEqual([]);
    expect(res.done).toBe(1);
    const m = ds.manager;

    // Notizbuch: Gleichstrommotor ist jetzt ein Bereich, darin der Abschnitt der Mappe
    expect((await m.findOneBy(NotebookNode, { id: 'N' }))!.kind).toBe('area');
    const S = (await m.findOneBy(NotebookNode, { parentId: 'N' }))!;
    expect(S).toMatchObject({ kind: 'section', title: 'PWM und H-Brücke' });
    const inS = await m.find(NotebookPlacement, { where: { ownerId: 'u', nodeId: S.id }, order: { orderIndex: 'ASC' } });
    expect(inS).toHaveLength(3);
    expect(inS[0].topicId).toBe('M');
    const [t2, tq] = await Promise.all(inS.slice(1).map((p) => m.findOneBy(LearningTopic, { id: p.topicId })));
    expect(t2).toMatchObject({ title: 'Blatt d2', selected: true, tagIds: ['t1'] });
    expect(tq!.title).toBe('PWM und H-Brücke – Quizze');
    expect((await m.findOneBy(LearningTopic, { id: 'M' }))!.title).toBe('Blatt d1');
    expect((await m.findOneBy(NotebookPlacement, { id: 'p2' }))!.nodeId).toBe('N');

    // Module samt Untermodulen, Reihenfolge ohne Lücken; das Ergebnis zieht mit
    const where = async (id: string) => (await m.findOneBy(LearningModule, { id }))!;
    expect([(await where('d1')).topicId, (await where('q1')).topicId, (await where('s1')).topicId]).toEqual(['M', 'M', 'M']);
    expect([(await where('d2')).topicId, (await where('q2')).topicId]).toEqual([t2!.id, t2!.id]);
    expect([(await where('d2')).orderIndex, (await where('q2')).orderIndex]).toEqual([0, 1]);
    expect((await where('lose')).topicId).toBe(tq!.id);
    expect((await m.findOneBy(Result, { id: 'r1' }))!.topicId).toBe(t2!.id);

    // Kollegin mit Nutzungsrecht: Platz dahinter, Rechte und Bewertung auch für die neuen
    const cp = await m.find(NotebookPlacement, { where: { ownerId: 'c' }, order: { orderIndex: 'ASC' } });
    expect(cp.map((p) => p.topicId)).toEqual(['M', t2!.id, tq!.id, 'Y']);
    expect((await m.find(UseGrant, { where: { userId: 'c' } })).map((g) => g.topicId).sort()).toEqual(['M', t2!.id, tq!.id].sort());
    expect(await m.count(ContentFeedback)).toBe(3);

    // Planung: dahinter, und der übernommene Abschnitt zieht nichts doppelt nach
    expect((await m.find(PlanEntry, { order: { orderIndex: 'ASC' } })).map((e) => e.topicId)).toEqual(['M', t2!.id, tq!.id, 'X']);
    expect((await m.findOneBy(PlanNode, { id: 'P' }))!.seen).toEqual(expect.arrayContaining([t2!.id, tq!.id, S.id]));

    // Quick-Link: Token und Klassen am Abschnitt
    const R = (await m.findOneBy(TopicLink, { id: 'R' }))!;
    expect([R.token, R.classIds]).toEqual([null, null]);
    const RS = (await m.findOneBy(TopicLink, { quickNodeId: S.id }))!;
    expect(RS).toMatchObject({ token: 'tok', classIds: ['k1'], name: 'PWM und H-Brücke' });
    expect(RS.selection.map((s) => s.topicId)).toEqual(['M', t2!.id, tq!.id]);

    // Klassennotizbuch: je Lernthema ein Eintrag direkt hinter dem der Mappe, mit Einstellungen
    const places = await m.find(ClassNotebookPlace, { where: { classId: 'k1' }, order: { orderIndex: 'ASC' } });
    expect(places).toHaveLength(4);
    expect(places[0].id).toBe('L');
    expect(places[3].id).toBe('Z');
    const L2 = (await m.findOneBy(TopicLink, { id: places[1].id }))!;
    expect(L2).toMatchObject({ classId: 'k1', name: 'Blatt d2', startView: 'ink', solutionModuleIds: ['d2'], selection: [{ topicId: t2!.id, all: true }] });
    expect((await m.findOneBy(TopicLink, { id: L2.templateId! }))!.quickTopicId).toBe(t2!.id);
    expect((await m.findOneBy(TopicLink, { id: 'L' }))!.selection).toEqual([{ topicId: 'M', all: true }]);

    // Klassenarbeit und Freigabe: ein Link, Auswahl über alle Lernthemen
    expect((await m.findOneBy(TopicLink, { id: 'E' }))!.selection).toEqual([{ topicId: 'M', all: false, moduleIds: [] }, { topicId: t2!.id, all: false, moduleIds: ['d2'] }]);
    expect((await m.findOneBy(TopicLink, { id: 'F' }))!.selection).toEqual([
      { topicId: 'M', all: false, moduleIds: ['d1'] }, { topicId: t2!.id, all: false, moduleIds: ['q2'] }, { topicId: 'X', all: true },
    ]);

    // Shop: das Angebot umfasst alle Module der früheren Mappe
    expect(await m.findOneBy(ShopOffer, { id: 'o1' })).toMatchObject({ scopeType: 'modules', moduleIds: ['d1', 'q1', 'd2', 'q2', 'lose'], title: 'PWM und H-Brücke', topicId: '' });

    // Ein zweiter Lauf findet nichts mehr
    expect((await new MappenMigrationService(ds).preview()).count).toBe(0);
  });
});
