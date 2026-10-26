import { canHoldNode, depthOf, isInside, nodeMoveError, reorder, dissolve, MAX_CLASS_DEPTH, TreeNode } from './classbook-tree';

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

  it('Löschen: Inhalt rückt eine Ebene höher ans Ende', () => {
    const entries = [{ id: 'e1', nodeId: 'b', orderIndex: 0 }, { id: 'e2', nodeId: 'a', orderIndex: 0 }];
    const res = dissolve(nodes, entries, 'b');
    expect(res.nodes).toEqual([{ id: 's', parentId: 'a', orderIndex: 0 }]);
    expect(res.entries).toEqual([{ id: 'e1', nodeId: 'a', orderIndex: 1 }]);
  });
});
