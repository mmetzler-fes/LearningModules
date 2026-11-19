import { loadBrowserModule } from '../core/browser-module';
import { contentCounts } from './content-counts';

const browser = loadBrowserModule<{
  contentCounts(modules: any[]): {
    documents: number;
    embeddedQuizzes: number;
    quizzes: number;
  };
  contentText(c: any): string;
}>('../lm-editor/src/doc/doc-quiz.js');

const doc = (id: string, quizIds: string[]) => ({
  id,
  type: 'document',
  content: {
    spec: { content: quizIds.map((q) => ({ type: 'quiz', module: q })) },
  },
});
const quiz = (id: string, extra: any = {}) => ({
  id,
  type: 'multipleChoice',
  content: {},
  ...extra,
});

describe('Inhalt eines Links statt „N Aufgaben“', () => {
  const mods = [doc('d', ['q1', 'q2']), quiz('q1'), quiz('q2'), quiz('q3')];

  it('zählt Dokumente, Quizze darin und weitere Quizze – Server und Browser gleich', () => {
    const want = { documents: 1, embeddedQuizzes: 2, quizzes: 1 };
    expect(contentCounts([{ modules: mods }])).toEqual(want);
    expect(browser.contentCounts(mods)).toEqual(want);
  });

  it('Quizze aus fremden Lernthemen im Dokument zählen als „darin“', () => {
    expect(
      contentCounts([
        { modules: [doc('d', ['x']), quiz('x', { embeddedOnly: true })] },
      ]),
    ).toEqual({
      documents: 1,
      embeddedQuizzes: 1,
      quizzes: 0,
    });
  });

  it('Text', () => {
    expect(
      browser.contentText({ documents: 1, embeddedQuizzes: 2, quizzes: 1 }),
    ).toBe('1 Dokument mit 2 Quizzen · 1 weiteres Quiz');
    expect(
      browser.contentText({ documents: 2, embeddedQuizzes: 1, quizzes: 3 }),
    ).toBe('2 Dokumente mit 1 Quiz · 3 weitere Quizze');
    expect(
      browser.contentText({ documents: 0, embeddedQuizzes: 0, quizzes: 3 }),
    ).toBe('3 Quizze');
    expect(
      browser.contentText({ documents: 1, embeddedQuizzes: 0, quizzes: 0 }),
    ).toBe('1 Dokument');
  });
});
