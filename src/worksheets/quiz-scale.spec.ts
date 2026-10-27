import { NumNode, sanitizeDocSettings, settingsAt } from './numbering';
import { quizScaleFor } from './quiz-scale.service';

describe('Größe eingebetteter Quizze (Dokument-Einstellungen)', () => {
  it('bereinigt: nur bekannte Größen, Typnamen oder *', () => {
    const s = sanitizeDocSettings({ quizScale: { dragAndDrop: 0.5, '*': 0.9, evil: 7, 'a b': 0.5 } }, null);
    expect(s?.quizScale).toEqual({ dragAndDrop: 0.5, '*': 0.9 });
    expect(sanitizeDocSettings({ quizScale: {} }, { quizScale: { dragAndDrop: 0.5 } })).toBeNull();
  });

  it('erbt Art für Art, das Nähere gilt', () => {
    const nodes: NumNode[] = [
      { id: 'b', kind: 'book', title: 'B', parentId: null, orderIndex: 0, docSettings: { quizScale: { dragAndDrop: 0.5, '*': 0.9 } } },
      { id: 'a', kind: 'area', title: 'A', parentId: 'b', orderIndex: 0, docSettings: { quizScale: { '*': 1 } } },
    ];
    expect(settingsAt(nodes, 'a').quizScale).toEqual({ dragAndDrop: 0.5, '*': 1 });
  });

  it('nur Dokumente mit Quizzen bekommen die Vorgabe', () => {
    const withQuiz = { spec: { content: [{ type: 'quiz', module: 'm1' }] } };
    expect(quizScaleFor(withQuiz, { dragAndDrop: 0.5 })).toEqual({ dragAndDrop: 0.5 });
    expect(quizScaleFor({ spec: { content: [{ type: 'text', text: 'x' }] } }, { dragAndDrop: 0.5 })).toBeNull();
    expect(quizScaleFor(withQuiz, undefined)).toBeNull();
  });
});
