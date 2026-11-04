import { ancestorsOf, canHoldNode, depthOf, isInside, nodeMoveError, reorder, dissolve, leavesInOrder, normalizeMarker, MAX_CLASS_DEPTH, TreeLink, TreeNode, veiledNodeIds } from './classbook-tree';
import { commonPath } from './classbook-tree';

const N = (id: string, kind: 'area' | 'section', parentId: string | null, orderIndex = 0): TreeNode => ({ id, kind, parentId, orderIndex });

describe('Baum des Klassennotizbuchs', () => {
  const nodes = [N('a', 'area', null), N('b', 'area', 'a'), N('s', 'section', 'b'), N('t', 'section', null, 1)];

  it('Abschnitte enthalten keine Bereiche', () => {
    expect(canHoldNode(null)).toBe(true);
    expect(canHoldNode(nodes[0])).toBe(true);
    expect(canHoldNode(nodes[2])).toBe(false);
  });

  it('Tiefe und Lage', () => {
    expect(depthOf(nodes, 's')).toBe(3);
    expect(depthOf(nodes, null)).toBe(0);
    expect(isInside(nodes, 's', 'a')).toBe(true);
    expect(isInside(nodes, 't', 'a')).toBe(false);
  });

  it('Verschieben: nicht in sich selbst, nicht in Abschnitte, nicht zu tief', () => {
    expect(nodeMoveError(nodes, 'a', 'b')).toMatch(/sich selbst/);
    expect(nodeMoveError(nodes, 'b', 't')).toMatch(/nur Lernthemen/);
    expect(nodeMoveError(nodes, 't', 'b')).toBeNull();
    const deep: TreeNode[] = [];
    for (let i = 0; i < MAX_CLASS_DEPTH; i++) deep.push(N(`d${i}`, 'area', i ? `d${i - 1}` : null));
    deep.push(N('x', 'area', null));
    expect(nodeMoveError(deep, 'x', `d${MAX_CLASS_DEPTH - 1}`)).toMatch(/Ebenen/);
  });

  it('Reihenfolge: an Stelle oder ans Ende', () => {
    const sib = [{ id: 'p', orderIndex: 0 }, { id: 'q', orderIndex: 1 }, { id: 'r', orderIndex: 2 }];
    expect([...reorder(sib, 'r', 0).entries()]).toEqual([['r', 0], ['p', 1], ['q', 2]]);
    expect([...reorder(sib, 'p', null).entries()]).toEqual([['q', 0], ['r', 1], ['p', 2]]);
    expect([...reorder(sib, 'neu', 1).entries()]).toEqual([['p', 0], ['neu', 1], ['q', 2], ['r', 3]]);
  });

  it('Vorfahren eines Knotens, von ihm selbst nach oben', () => {
    expect(ancestorsOf(nodes, 's')).toEqual(['s', 'b', 'a']);
    expect(ancestorsOf(nodes, null)).toEqual([]);
  });

  it('Löschen: Inhalt rückt eine Ebene höher ans Ende', () => {
    const entries = [{ id: 'e1', nodeId: 'b', orderIndex: 0 }, { id: 'e2', nodeId: 'a', orderIndex: 0 }];
    const res = dissolve(nodes, entries, 'b');
    expect(res.nodes).toEqual([{ id: 's', parentId: 'a', orderIndex: 0 }]);
    expect(res.entries).toEqual([{ id: 'e1', nodeId: 'a', orderIndex: 1 }]);
  });
});

describe('Merker: Module unter einem Anker in Dokumentreihenfolge', () => {
  const nodes: TreeNode[] = [
    { id: 'a', kind: 'area', parentId: null, orderIndex: 0 },
    { id: 'b', kind: 'section', parentId: 'a', orderIndex: 0 },
  ];
  const links: TreeLink[] = [
    { id: 'l1', nodeId: null, orderIndex: 0, topics: [{ topicId: 't1', moduleIds: ['m1', 'm2'] }] },
    { id: 'l2', nodeId: 'a', orderIndex: 0, topics: [{ topicId: 't2', moduleIds: ['m3'] }] },
    { id: 'l3', nodeId: 'b', orderIndex: 0, topics: [{ topicId: 't3', moduleIds: ['m4', 'm5'] }] },
  ];

  it('Buch (Wurzel): verschachtelte Zuweisungen zuerst, dann die direkten – wie im Baum angezeigt', () => {
    expect(leavesInOrder(nodes, links, { level: 'root' }).map((l) => l.moduleId)).toEqual(['m4', 'm5', 'm3', 'm1', 'm2']);
  });

  it('Bereich/Abschnitt: nur das, was darunter liegt', () => {
    expect(leavesInOrder(nodes, links, { level: 'node', nodeId: 'a' }).map((l) => l.moduleId)).toEqual(['m4', 'm5', 'm3']);
    expect(leavesInOrder(nodes, links, { level: 'node', nodeId: 'b' }).map((l) => l.moduleId)).toEqual(['m4', 'm5']);
  });

  it('Zuweisung und Lernthema', () => {
    expect(leavesInOrder(nodes, links, { level: 'link', linkId: 'l1' }).map((l) => l.moduleId)).toEqual(['m1', 'm2']);
    expect(leavesInOrder(nodes, links, { level: 'topic', linkId: 'l1', topicId: 't1' }).map((l) => l.moduleId)).toEqual(['m1', 'm2']);
  });

  it('Modul: genau das eine', () => {
    expect(leavesInOrder(nodes, links, { level: 'module', linkId: 'l1', topicId: 't1', moduleId: 'm2' })).toEqual([{ linkId: 'l1', topicId: 't1', moduleId: 'm2' }]);
  });

  it('Modul, das es im Baum nicht (mehr) gibt: leer statt erfunden', () => {
    expect(leavesInOrder(nodes, links, { level: 'module', linkId: 'l1', topicId: 't1', moduleId: 'weg' })).toEqual([]);
    expect(leavesInOrder(nodes, links, { level: 'module', linkId: 'unbekannt', topicId: 't1', moduleId: 'm1' })).toEqual([]);
  });

  it('unbekannter Anker liefert leer statt Fehler', () => {
    expect(leavesInOrder(nodes, links, { level: 'link', linkId: 'unbekannt' })).toEqual([]);
    expect(leavesInOrder(nodes, links, { level: 'topic', linkId: 'l1', topicId: 'unbekannt' })).toEqual([]);
  });
});

describe('Alte Marker ohne `level` lesen', () => {
  it('leer bleibt leer', () => {
    expect(normalizeMarker(null)).toBeNull();
    expect(normalizeMarker(undefined)).toBeNull();
  });

  it('altes Format (linkId, topicId, moduleId) wird als Modul-Marker gelesen', () => {
    expect(normalizeMarker({ linkId: 'l1', topicId: 't1', moduleId: 'm1' })).toEqual({ level: 'module', linkId: 'l1', topicId: 't1', moduleId: 'm1' });
  });

  it('neues Format bleibt unverändert', () => {
    expect(normalizeMarker({ level: 'node', nodeId: 'a' })).toEqual({ level: 'node', nodeId: 'a' });
  });
});

describe('Für Schüler ausblenden', () => {
  it('ausgeblendeter Bereich nimmt alles darunter mit, Geschwister bleiben', () => {
    const nodes = [
      { id: 'a', kind: 'area' as const, parentId: null, orderIndex: 0, studentHidden: true },
      { id: 'a1', kind: 'section' as const, parentId: 'a', orderIndex: 0 },
      { id: 'b', kind: 'area' as const, parentId: null, orderIndex: 1 },
      { id: 'b1', kind: 'area' as const, parentId: 'b', orderIndex: 0, studentHidden: true },
      { id: 'b2', kind: 'section' as const, parentId: 'b1', orderIndex: 0 },
      { id: 'b3', kind: 'section' as const, parentId: 'b', orderIndex: 1 },
    ];
    expect([...veiledNodeIds(nodes)].sort()).toEqual(['a', 'a1', 'b1', 'b2']);
  });
});

describe('commonPath', () => {
  it('nimmt den gemeinsamen Anfang', () => {
    expect(commonPath([['b', 'a', 's'], ['b', 'a', 't']])).toEqual(['b', 'a']);
    expect(commonPath([['b', 'a'], ['b', 'a']])).toEqual(['b', 'a']);
    expect(commonPath([['b'], ['c']])).toEqual([]);
    expect(commonPath([['b', 'a'], []])).toEqual([]);
    expect(commonPath([])).toEqual([]);
  });
});
