import { embeddedQuizIds } from './student-view';

describe('Eingebettete Quizze eines Dokuments', () => {
  it('findet Quiz-Blöcke auch in Aufgaben und Kästen, jedes einmal', () => {
    const doc = {
      type: 'document',
      content: JSON.stringify({
        spec: {
          content: [
            { type: 'quiz', module: 'q1' },
            { type: 'task', title: 'A', blocks: [{ type: 'box', blocks: [{ type: 'quiz', module: 'q2' }, { type: 'quiz', module: 'q1' }] }] },
          ],
        },
      }),
    };
    expect(embeddedQuizIds(doc)).toEqual(['q1', 'q2']);
  });

  it('andere Modultypen betten nichts ein', () => {
    expect(embeddedQuizIds({ type: 'quiz', content: { spec: { content: [{ type: 'quiz', module: 'x' }] } } })).toEqual([]);
  });
});
