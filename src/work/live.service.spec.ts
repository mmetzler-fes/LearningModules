import { LiveService } from './live.service';
import { issueTicket } from '../classes/student-ticket';
import { repo } from './test-repo';

describe('Live-Ansicht', () => {
  const link = { id: 'l1', ownerId: 't1', name: 'Physik', classId: 'c1' };
  const setup = () => {
    const runs = repo();
    const works = repo();
    const links: any = { linkOfToken: async (t: string) => (t === 'tok' ? { link, access: 'practice' } : t === 'ohne' ? { link: { ...link, classId: null } } : null) };
    const classes: any = {
      findOne: async (id: string, user: any) => {
        if (id !== 'c1' || user.userId !== 't1') throw new Error('nicht gefunden');
        return { id: 'c1', students: [{ id: 's1', firstName: 'Anna', lastName: 'B' }, { id: 's2', firstName: 'Ben', lastName: 'C' }] };
      },
    };
    // MoreThan(...) aus der Abfrage lässt die kleine Tabelle nicht gelten – Filter hier nur nach klassen/teacher.
    const plain = (r: any) => ({ ...r, find: async ({ where }: any) => r.rows.filter((x: any) => x.classId === where.classId && x.teacherId === where.teacherId) });
    return { svc: new LiveService(plain(runs) as any, plain(works) as any, links, classes), runs };
  };
  const ticket = issueTicket('l1', 's1', 'Anna B');

  it('Start, Fortschritt, fertig – je Schüler ein Eintrag', async () => {
    const { svc, runs } = setup();
    await svc.report({ linkToken: 'tok', studentTicket: ticket, steps: ['A', 'B', 'C'], done: 0, mode: 'quiz' });
    await svc.report({ linkToken: 'tok', studentTicket: ticket, done: 2 });
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]).toMatchObject({ done: 2, steps: ['A', 'B', 'C'], finishedAt: null });
    await svc.report({ linkToken: 'tok', studentTicket: ticket, done: 9, finished: true });
    expect(runs.rows[0].done).toBe(3);
    expect(runs.rows[0].finishedAt).toBeInstanceOf(Date);
    // Neuer Start: von vorn.
    await svc.report({ linkToken: 'tok', studentTicket: ticket, steps: ['A'], done: 0 });
    expect(runs.rows[0]).toMatchObject({ done: 0, finishedAt: null });
  });

  it('ohne Klasse nichts, die Ansicht nur für die eigene Klasse', async () => {
    const { svc, runs } = setup();
    expect(await svc.report({ linkToken: 'ohne', studentTicket: ticket, done: 1 })).toMatchObject({ stored: false });
    await svc.report({ linkToken: 'tok', studentTicket: ticket, steps: ['A'], done: 1 });
    const live = await svc.ofClass({ userId: 't1' }, 'c1');
    expect(live.students.map((s) => s.name)).toEqual(['Anna B', 'Ben C']);
    expect(live.runs).toHaveLength(1);
    expect(runs.rows).toHaveLength(1);
    await expect(svc.ofClass({ userId: 'fremd' }, 'c1')).rejects.toThrow(/nicht gefunden/);
  });

  it('übersprungene Aufgaben (Weiter ohne Eingabe) bleiben erkennbar', async () => {
    const { svc, runs } = setup();
    await svc.report({ linkToken: 'tok', studentTicket: ticket, steps: ['A', 'B', 'C'], done: 0 });
    await svc.report({ linkToken: 'tok', studentTicket: ticket, done: 2, states: ['d', 's', 'x'] as any });
    expect(runs.rows[0].states).toEqual(['d', 's', '']);
    // Zurück zu B: aktuell ist wieder B, der Stand je Aufgabe bleibt.
    await svc.report({ linkToken: 'tok', studentTicket: ticket, done: 1, states: ['d', 's', ''] });
    expect(runs.rows[0]).toMatchObject({ done: 1, states: ['d', 's', ''] });
    const live = await svc.ofClass({ userId: 't1' }, 'c1');
    expect(live.runs[0].states).toEqual(['d', 's', '']);
  });
});
