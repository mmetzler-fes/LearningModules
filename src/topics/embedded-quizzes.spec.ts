import { foreignEmbeddedQuizzes } from './embedded-quizzes';

const doc = (id: string, quizIds: string[]) => ({
  id, type: 'document', topicId: 'tDoc', content: { spec: { content: quizIds.map((q) => ({ type: 'quiz', module: q })) } },
}) as any;
const mod = (id: string, topicId: string, extra: any = {}) => ({ id, type: 'multipleChoice', topicId, moduleSelected: true, orderIndex: 0, ...extra });

function repos(modules: any[], topics: any[]) {
  const inList = (where: any) => (where.id?._value ?? where.parentId?._value ?? []) as string[];
  return {
    modules: { find: async ({ where }: any) => modules.filter((m) => (where.id ? inList(where).includes(m.id) : inList(where).includes(m.parentId))) },
    topics: { find: async ({ where }: any) => topics.filter((t) => inList(where).includes(t.id)) },
  } as any;
}

describe('Quizze aus anderen Lernthemen (Verweis im Dokument)', () => {
  const topics = [{ id: 'tQ', ownerId: 'me' }, { id: 'tFremd', ownerId: 'other' }, { id: 'tZu', ownerId: 'me', teacherOnly: true }];
  it('bringt eigene Quizze mit, als embeddedOnly, samt Untermodulen', async () => {
    const r = repos([mod('q1', 'tQ'), mod('k1', 'tQ', { parentId: 'q1' })], topics);
    const out = await foreignEmbeddedQuizzes(r, [doc('d', ['q1'])], 'me', new Set());
    expect(out.map((m: any) => [m.id, m.embeddedOnly, (m.subModules || []).map((k: any) => k.id)])).toEqual([['q1', true, ['k1']]]);
  });
  it('nicht: fremde, ausgeschaltete, gesperrte, schon vorhandene und Dokumente', async () => {
    const r = repos([
      mod('qFremd', 'tFremd'), mod('qAus', 'tQ', { moduleSelected: false }), mod('qDa', 'tQ'),
      mod('qZu', 'tZu'), mod('qDoc', 'tQ', { type: 'document' }),
    ], topics);
    const out = await foreignEmbeddedQuizzes(r, [doc('d', ['qFremd', 'qAus', 'qDa', 'qZu', 'qDoc'])], 'me', new Set(['qDa']));
    expect(out).toEqual([]);
  });
});
