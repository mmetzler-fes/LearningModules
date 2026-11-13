import { rescoreExam } from './exam-points';

const ka = { id: 'ka', type: 'document', content: { spec: { content: [
  { type: 'task', title: 'Umwandeln', points: 6, blocks: [{ type: 'quiz', module: 'q1' }] },
  { type: 'task', title: 'Aussagen', points: 2, blocks: [{ type: 'quiz', module: 'tf' }] },
] } } };

describe('Klassenarbeit nach Aufgabenpunkten nachrechnen', () => {
  it('aus je Frage 1 werden die Aufgabenpunkte', () => {
    const details = [
      { moduleId: 'q1', inDoc: 'ka', points: 0.5 },
      { moduleId: 'tf', inDoc: 'ka', isCorrect: true }, { moduleId: 'tf', inDoc: 'ka', isCorrect: false },
      { moduleId: 'info', informational: true },
    ];
    const next = rescoreExam({ score: 1.5, maxScore: 3, payload: { details } }, [ka]);
    expect(next).toMatchObject({ score: 4, maxScore: 8, percentage: 50, changed: true });
    expect(next.details.map((d: any) => d.pts)).toEqual([{ earned: 3, max: 6 }, { earned: 1, max: 1 }, { earned: 0, max: 1 }, undefined]);
  });

  it('ohne Aufgabenpunkte bleibt es, wie es war', () => {
    const details = [{ moduleId: 'x', isCorrect: true }, { moduleId: 'y', isCorrect: false }];
    expect(rescoreExam({ score: 1, maxScore: 2, payload: { details } }, [])).toMatchObject({ changed: false });
  });
});

describe('Klassenarbeit: Wörter ziehen anteilig, halbe Punkte abgerundet (rückwirkend)', () => {
  it('älteres „Wörter ziehen“ (nur percent) zählt anteilig', () => {
    const doc = { id: 'ka', type: 'document', content: { spec: { content: [{ type: 'task', title: 'IPv4', points: 5, blocks: [{ type: 'quiz', module: 'dtw' }] }] } } };
    const details = [{ moduleId: 'dtw', moduleType: 'dragTheWords', inDoc: 'ka', isCorrect: false, points: 0, percent: 40 }];
    expect(rescoreExam({ score: 0, maxScore: 5, payload: { details } }, [doc])).toMatchObject({ score: 2, maxScore: 5, changed: true });
  });
});
