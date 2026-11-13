import { ClassBoardService } from './class-board.service';
import { repo } from '../work/test-repo';

const KLASSE = { id: 'c1', name: '10a', ownerId: 't1' };
const DOC = { id: 'd1', topicId: 'tp1', type: 'document', title: 'Variablen', content: { spec: { content: [{ type: 'p', text: 'Hallo' }] } } };

function setup() {
  const boards = repo();
  const modules = repo([DOC, { id: 'd2', topicId: 'fremd', type: 'document', title: 'Fremd', content: {} }, { id: 'q1', topicId: 'tp1', type: 'multipleChoice', title: 'Quiz' }]);
  const topics = repo([{ id: 'tp1', ownerId: 't1' }, { id: 'fremd', ownerId: 'andere' }, { id: 'shop', ownerId: 'andere' }]);
  const links = repo([{ id: 'l1', classId: 'c1', selection: [{ topicId: 'shop', all: true }] }]);
  modules.rows.push({ id: 'd3', topicId: 'shop', type: 'document', title: 'Aus dem Shop', content: {} });
  const classes: any = { ownedClass: async (id: string) => { if (id !== 'c1') throw new Error('fremde Klasse'); return KLASSE; } };
  const classbook: any = { studentSession: async (token: string) => { if (token !== 'kb') throw new Error('abgelaufen'); return { klasse: KLASSE }; } };
  const svc = new ClassBoardService(boards as any, modules as any, topics as any, links as any, classes, classbook);
  return { svc, boards };
}

const T = { userId: 't1' };

describe('✍️ Tafelbild je Klasse', () => {
  it('speichert nur für diese Klasse und startet für Schüler ausgeschaltet', async () => {
    const { svc, boards } = setup();
    await svc.put(T, 'c1', 'd1', { data: { strokes: [1] } });
    expect(boards.rows).toHaveLength(1);
    expect(boards.rows[0]).toMatchObject({ id: 'c1:d1', classId: 'c1', moduleId: 'd1', studentVisible: false });
    expect((await svc.get(T, 'c1', 'd1')).data).toEqual({ strokes: [1] });
    expect(await svc.list(T, 'c1')).toEqual([expect.objectContaining({ moduleId: 'd1', studentVisible: false })]);
    expect(await svc.listForStudent('kb', 'x')).toEqual([]);
    await expect(svc.getForStudent('kb', 'x', 'd1')).rejects.toThrow(/nicht freigegeben/);
  });

  it('●: Schüler sehen es mit dem Dokument, ohne dass sich das Tafelbild ändert', async () => {
    const { svc } = setup();
    await svc.put(T, 'c1', 'd1', { data: { strokes: [1] } });
    await svc.put(T, 'c1', 'd1', { studentVisible: true });
    expect((await svc.get(T, 'c1', 'd1')).data).toEqual({ strokes: [1] });
    expect(await svc.listForStudent('kb', 'x')).toEqual([expect.objectContaining({ moduleId: 'd1' })]);
    const seen = await svc.getForStudent('kb', 'x', 'd1');
    expect(seen).toMatchObject({ moduleId: 'd1', title: 'Variablen', data: { strokes: [1] } });
    expect(seen.content.spec.content).toHaveLength(1);
  });

  it('nur Dokumente, die der Lehrkraft gehören oder der Klasse zugewiesen sind', async () => {
    const { svc } = setup();
    await expect(svc.put(T, 'c1', 'd2', { data: {} })).rejects.toThrow(/nicht zu dieser Klasse/);
    await expect(svc.put(T, 'c1', 'q1', { data: {} })).rejects.toThrow(/nicht gefunden/);
    await expect(svc.put(T, 'c1', 'd3', { data: {} })).resolves.toMatchObject({ success: true });
  });

  it('ohne Stand lässt sich nichts einschalten; Neues Tafelbild löscht das alte', async () => {
    const { svc, boards } = setup();
    await expect(svc.put(T, 'c1', 'd1', { studentVisible: true })).rejects.toThrow(/Noch kein Tafelbild/);
    await svc.put(T, 'c1', 'd1', { data: { strokes: [1] } });
    await svc.remove(T, 'c1', 'd1');
    expect(boards.rows).toHaveLength(0);
    expect((await svc.get(T, 'c1', 'd1')).data).toBeNull();
  });
});
