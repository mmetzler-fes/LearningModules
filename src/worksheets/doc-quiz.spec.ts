import { loadBrowserModule } from '../core/browser-module';

const { quizIdsOf, planRun } = loadBrowserModule<{
  quizIdsOf(mod: any): string[];
  planRun(modules: any[], opts?: { companion?: boolean; onlyModule?: string | null }): { steps: any[]; embedded: Map<string, any> };
}>('doc-quiz.js');

const doc = (id: string, content: any[], topic = 't1') => ({ id, type: 'document', _topicId: topic, content: { spec: { content } } });
const quiz = (id: string, topic = 't1') => ({ id, type: 'multipleChoice', _topicId: topic, content: {} });

describe('Quiz im Dokument', () => {
  it('findet Quiz-Blöcke auch in Aufgaben und Kästen', () => {
    const d = doc('d', [{ type: 'quiz', module: 'q1' }, { type: 'task', title: 'A', blocks: [{ type: 'box', blocks: [{ type: 'quiz', module: 'q2' }] }] }]);
    expect(quizIdsOf(d)).toEqual(['q1', 'q2']);
    expect(quizIdsOf({ id: 'x', type: 'document', content: JSON.stringify(d.content) })).toEqual(['q1', 'q2']);
  });

  it('nimmt eingebettete Quizze aus den Schritten', () => {
    const { steps, embedded } = planRun([doc('d', [{ type: 'quiz', module: 'q1' }]), quiz('q1'), quiz('q2')]);
    expect(steps.map((m) => m.id)).toEqual(['d', 'q2']);
    expect([...embedded.keys()]).toEqual(['q1']);
  });

  it('bettet nichts aus einem anderen Lernthema, kein Dokument und kein fehlendes Modul ein', () => {
    const { steps, embedded } = planRun([doc('d', [{ type: 'quiz', module: 'q1' }, { type: 'quiz', module: 'd2' }, { type: 'quiz', module: 'weg' }]), quiz('q1', 't2'), doc('d2', [])]);
    expect(steps.map((m) => m.id)).toEqual(['d', 'q1', 'd2']);
    expect(embedded.size).toBe(0);
  });

  it('Lernbegleitung: jedes Quiz bleibt ein eigener Schritt', () => {
    const { steps, embedded } = planRun([doc('d', [{ type: 'quiz', module: 'q1' }]), quiz('q1')], { companion: true });
    expect(steps.map((m) => m.id)).toEqual(['d', 'q1']);
    expect(embedded.size).toBe(0);
  });

  it('QR-Code im Druck: nur dieses eine Modul', () => {
    const { steps } = planRun([doc('d', [{ type: 'quiz', module: 'q1' }]), quiz('q1')], { onlyModule: 'q1' });
    expect(steps.map((m) => m.id)).toEqual(['q1']);
    expect(planRun([quiz('q2')], { onlyModule: 'weg' }).steps.map((m) => m.id)).toEqual(['q2']);
  });
});
