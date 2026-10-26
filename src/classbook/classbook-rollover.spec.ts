import { planCopy, switchedOff } from './classbook-rollover';

describe('Klassennotizbuch beim Schuljahreswechsel', () => {
  it('ausschalten: alle Lernthemen bleiben, ohne Module; neue Lernthemen-IDs', () => {
    expect(switchedOff([{ topicId: 'a', all: true }, { topicId: 'b', all: false, moduleIds: ['m'] }], new Map([['b', 'B']])))
      .toEqual([{ topicId: 'a', all: false, moduleIds: [] }, { topicId: 'B', all: false, moduleIds: [] }]);
  });

  it('Kopie: Baum, klasseneigene Lernthemen samt Submodulen, Zuweisungen ohne Schlüssel auf ihrem Platz', () => {
    let n = 0;
    const res = planCopy({
      nodes: [{ id: 'n1', kind: 'area', title: 'HJ1', parentId: null, orderIndex: 0 }, { id: 'n2', kind: 'section', title: 'S', parentId: 'n1', orderIndex: 0 }],
      places: [{ id: 'l1', nodeId: 'n2', orderIndex: 3 }],
      topics: [{ id: 't1', title: 'Projekt', classId: 'alt' }],
      modules: [{ id: 'm1', topicId: 't1', parentId: null }, { id: 'm2', topicId: 't1', parentId: 'm1' }],
      links: [
        { id: 'l1', name: 'Projekt', token: 'x', examToken: 'y', selection: [{ topicId: 't1', all: false, moduleIds: ['m1'] }] },
        { id: 'l2', name: 'Verweis', token: 'z', selection: [{ topicId: 'fremd', all: true }] },
      ],
      newId: () => `id${++n}`,
    });
    const [area, sec] = res.nodes;
    expect(sec.parentId).toBe(area.id);
    expect(res.topics[0].id).not.toBe('t1');
    expect(res.modules[1]).toMatchObject({ topicId: res.topics[0].id, parentId: res.modules[0].id });
    expect(res.links[0]).toMatchObject({ token: null, examToken: null, customized: true, selection: [{ topicId: res.topics[0].id, all: false, moduleIds: [] }] });
    expect(res.links[1].selection).toEqual([{ topicId: 'fremd', all: false, moduleIds: [] }]);
    expect(res.places).toEqual([{ id: res.links[0].id, nodeId: sec.id, orderIndex: 3 }]);
  });
});
