import { TopicsService } from './topics.service';
import { DataSource } from 'typeorm';

describe('TopicsService.attachQuizIds (echte Datenbank)', () => {
  it('liest die Quiz-Blöcke in Reihenfolge, auch geschachtelt; kaputtes JSON stört nicht', async () => {
    const ds = new DataSource({ type: 'sqlite', database: ':memory:' });
    await ds.initialize();
    await ds.query('CREATE TABLE modules (id TEXT, topicId TEXT, type TEXT, content TEXT)');
    const add = (id: string, type: string, content: unknown, topic = 't1') => ds.query('INSERT INTO modules VALUES (?,?,?,?)', [id, topic, type, typeof content === 'string' ? content : JSON.stringify(content)]);
    await add('d1', 'document', { kind: 'arbeitsblatt', spec: { content: [
      { type: 'quiz', module: 'q2' },
      { type: 'task', title: 'A', blocks: [{ type: 'box', blocks: [{ type: 'quiz', module: 'q1', title: 'x' }] }] },
      { type: 'table', rows: [[{ text: 'z', blocks: [{ type: 'quiz', module: 'q3' }] }]] },
      { type: 'text', text: 'ein "quiz" im Text', module: 'keinQuiz' },
    ] } });
    await add('d2', 'document', { spec: { content: [{ type: 'text', text: 'ohne' }] } });
    await add('d3', 'document', '{"quiz" kaputt');
    await add('q9', 'multipleChoice', { type: 'quiz', module: 'x' });
    await add('d9', 'document', { spec: { content: [{ type: 'quiz', module: 'fremd' }] } }, 't2');
    const svc: any = Object.create(TopicsService.prototype);
    svc.moduleRepo = { query: (sql: string, params: unknown[]) => ds.query(sql, params) };
    const mods: any[] = ['d1', 'd2', 'd3', 'q9'].map((id) => ({ id }));
    await svc.attachQuizIds(['t1'], mods);
    expect(mods.find((m) => m.id === 'd1').quizIds).toEqual(['q2', 'q1', 'q3']);
    expect(mods.filter((m) => m.quizIds).map((m) => m.id)).toEqual(['d1']);
    await ds.destroy();
  });
});
