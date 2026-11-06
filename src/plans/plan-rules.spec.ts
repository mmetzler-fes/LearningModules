import { canHoldPlanNode, canHoldTopic, expandPlan, includeError, placeError, planMoveError, planTopicIds, plansIncluding, PlanTreeNode } from './plan-rules';

const n = (id: string, kind: any, parentId: string | null, orderIndex = 0, extra: Partial<PlanTreeNode> = {}): PlanTreeNode => ({ id, kind, parentId, orderIndex, title: id, ...extra });

// Berufsschule › Mechatroniker › Plan „Mech 1“ mit Teilplan „Elektro LF1-4“ (in Gemeinsam).
const NODES: PlanTreeNode[] = [
  n('bs', 'folder', null), n('mech', 'folder', 'bs'), n('gem', 'folder', 'bs', 1),
  n('m1', 'plan', 'mech'), n('lf5', 'area', 'm1', 1), n('inc', 'include', 'm1', 0, { refId: 'el', title: 'LF 1–4' }),
  n('el', 'plan', 'gem'), n('lf1', 'section', 'el'),
];

describe('Planungsebene: Regeln', () => {
  it('Ordner und Pläne oben oder in Ordnern; Bereiche, Abschnitte, Teilpläne nur in Plänen und Bereichen', () => {
    expect(canHoldPlanNode(null, 'folder')).toBe(true);
    expect(canHoldPlanNode('folder', 'plan')).toBe(true);
    expect(canHoldPlanNode('plan', 'folder')).toBe(false);
    expect(canHoldPlanNode('folder', 'area')).toBe(false);
    expect(canHoldPlanNode('area', 'include')).toBe(true);
    expect(canHoldPlanNode('section', 'area')).toBe(false);
    expect(canHoldTopic('folder')).toBe(false);
    expect(canHoldTopic('section')).toBe(true);
    expect(placeError(NODES, 'area', 'lf1')).toMatch(/Abschnitt/);
  });

  it('kein Kreis bei Teilplänen', () => {
    expect(includeError(NODES, 'm1', 'm1')).toMatch(/selbst/);
    expect(includeError(NODES, 'el', 'm1')).toMatch(/Kreis/);
    expect(includeError(NODES, 'm1', 'el')).toBeNull();
    expect(plansIncluding(NODES, 'el').map((p) => p.id)).toEqual(['m1']);
  });

  it('verschieben: nicht in sich selbst, Bereich mit Teilplan nicht in den Teilplan', () => {
    expect(planMoveError(NODES, 'bs', 'mech')).toMatch(/selbst/);
    expect(planMoveError(NODES, 'lf5', 'el')).toBeNull();
    const withArea = [...NODES, n('a', 'area', 'm1', 2), n('inc2', 'include', 'a', 0, { refId: 'el' })];
    expect(planMoveError(withArea, 'a', 'el')).toMatch(/Kreis|selbst/);
    expect(planMoveError(NODES, 'm1', 'gem')).toBeNull();
    expect(planMoveError(NODES, 'm1', 'lf1')).toMatch(/Ordner/);
  });

  it('ausrollen: Teilplan als Bereich, Unterknoten vor Lernthemen, jedes Lernthema einmal', () => {
    const entries = [
      { id: 'e1', nodeId: 'm1', topicId: 'T-direkt', orderIndex: 0 },
      { id: 'e2', nodeId: 'lf5', topicId: 'T-lf5', orderIndex: 0 },
      { id: 'e3', nodeId: 'lf1', topicId: 'T-ohm', orderIndex: 0 },
      { id: 'e4', nodeId: 'lf5', topicId: 'T-ohm', orderIndex: 1 },
    ];
    const items = expandPlan(NODES, entries, 'm1');
    expect(items.map((i) => (i.type === 'node' ? i.key : i.topicId))).toEqual(['inc', 'lf5', 'T-direkt']);
    const inc: any = items[0];
    expect(inc.title).toBe('LF 1–4');
    expect(inc.children[0].key).toBe('inc/lf1');
    expect(planTopicIds(items)).toEqual(['T-ohm', 'T-lf5', 'T-direkt']);
  });
});
