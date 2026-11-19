import { topicUsage, UsageInput } from './topic-usage';

const base = (over: Partial<UsageInput> = {}): UsageInput => ({
  topicId: 't',
  topicOn: true,
  modules: [
    { id: 'd', type: 'document', embeds: ['q1'] },
    { id: 'q1', type: 'multipleChoice' },
    { id: 'q2', type: 'multipleChoice' },
  ],
  notebookNodes: [
    { id: 'b', kind: 'book', title: 'Elektrotechnik', parentId: null },
    { id: 'a', kind: 'area', title: 'BPE 3', parentId: 'b' },
  ],
  placementNodeId: 'a',
  planNodes: [
    {
      id: 'p',
      kind: 'plan',
      title: 'Kurs DASM',
      parentId: null,
      orderIndex: 0,
    },
    {
      id: 'ps',
      kind: 'section',
      title: 'Woche 1',
      parentId: 'p',
      orderIndex: 0,
    },
    { id: 'big', kind: 'plan', title: 'TG 11', parentId: null, orderIndex: 1 },
    {
      id: 'inc',
      kind: 'include',
      title: 'Kurs DASM',
      parentId: 'big',
      orderIndex: 0,
      refId: 'p',
    },
  ],
  planEntries: [{ nodeId: 'ps', topicId: 't' }],
  classLinks: [
    {
      id: 'l1',
      classId: 'c1',
      active: true,
      modes: ['quiz'],
      selection: [{ topicId: 't', all: false, moduleIds: ['d'] }],
    },
    {
      id: 'l2',
      classId: 'c2',
      active: true,
      modes: ['quiz'],
      selection: [{ topicId: 't', all: false, moduleIds: [] }],
    },
    {
      id: 'l3',
      classId: 'old',
      active: true,
      modes: ['quiz'],
      selection: [{ topicId: 't', all: true }],
    },
    {
      id: 'l4',
      classId: 'c3',
      active: true,
      modes: ['exam'],
      selection: [{ topicId: 't', all: true }],
    },
  ],
  classes: [
    { id: 'c1', name: '2BFE1' },
    { id: 'c2', name: 'BGY-J1' },
    { id: 'old', name: 'Alt', rolledOver: 'copied' },
    { id: 'c3', name: 'Nur Arbeit' },
  ],
  ...over,
});

describe('Verwendet in (Kopfzeile des Editors)', () => {
  it('Pfad, Klassen mit „an“ und Pläne samt einbindender Pläne', () => {
    const u = topicUsage(base());
    expect(u.path.map((p) => p.title)).toEqual(['Elektrotechnik', 'BPE 3']);
    expect(u.classes).toEqual([
      { id: 'c1', name: '2BFE1', on: true },
      { id: 'c2', name: 'BGY-J1', on: false },
    ]);
    expect(u.plans.map((p) => p.title)).toEqual(['Kurs DASM', 'TG 11']);
  });

  it('je Modul: ein Quiz im eingeschalteten Dokument ist an, ein loses nicht', () => {
    expect(
      topicUsage(base({ moduleId: 'q1' })).classes.find((c) => c.id === 'c1')
        ?.on,
    ).toBe(true);
    expect(
      topicUsage(base({ moduleId: 'q2' })).classes.find((c) => c.id === 'c1')
        ?.on,
    ).toBe(false);
  });

  it('● im Lernnotizbuch aus oder 🙈 in der Klasse: nirgends an', () => {
    expect(
      topicUsage(base({ topicOn: false })).classes.every((c) => !c.on),
    ).toBe(true);
    const hidden = base();
    hidden.classLinks[0].active = false;
    expect(topicUsage(hidden).classes.find((c) => c.id === 'c1')?.on).toBe(
      false,
    );
  });
});
