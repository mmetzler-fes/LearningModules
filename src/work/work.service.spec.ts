import { WorkService } from './work.service';
import { issueTicket } from '../classes/student-ticket';

/** Kleine Tabelle im Speicher – genug für find/findOne/create/save/update/remove. */
function repo(rows: any[] = []) {
  const match = (r: any, where: any) => Object.entries(where || {}).every(([k, v]) => r[k] === v);
  return {
    rows,
    findOne: async ({ where }: any) => rows.find((r) => match(r, where)) || null,
    find: async ({ where }: any = {}) => rows.filter((r) => match(r, where)),
    create: (x: any) => ({ ...x }),
    save: async (x: any) => {
      const i = rows.findIndex((r) => r.id === x.id);
      x.updatedAt = new Date();
      if (i >= 0) rows[i] = x; else rows.push(x);
      return x;
    },
    update: async (where: any, changes: any) => { rows.filter((r) => match(r, where)).forEach((r) => Object.assign(r, changes)); },
    remove: async (x: any) => { rows.splice(rows.indexOf(x), 1); },
  };
}

const LINK = { id: 'l1', ownerId: 't1', name: 'Physik', active: true, classId: 'c1' };
const DOC = { id: 'd1', type: 'document', title: 'Blatt' };

function setup(access: 'practice' | 'exam' = 'practice') {
  const works = repo();
  const students = repo([{ id: 's1', classId: 'c1', firstName: 'Anna', lastName: 'B', pin: null, pinShownAt: null }]);
  const users = repo([{ id: 't1', active: true }]);
  const links: any = {
    linkOfToken: async (t: string) => (t === 'tok' ? { link: LINK, access } : null),
    resolveModules: async () => [{ topic: {}, modules: [DOC, { id: 'q1', type: 'multipleChoice' }] }],
  };
  const classes: any = { findById: async (id: string) => (id === 'c1' ? { id: 'c1', name: '10a' } : null) };
  const svc = new WorkService(works as any, students as any, users as any, links, classes);
  return { svc, works, students };
}

const data = { v: 1, bg: 'paper', pages: [{ items: [] }], layer: { blocks: { b1: { items: [{ id: 'x' }] } } } };
const body = (extra: any = {}) => ({ linkToken: 'tok', studentTicket: issueTicket('l1', 's1', 'Anna B'), moduleId: 'd1', ...extra });

describe('Bearbeitungen der Schüler', () => {
  it('erstes Speichern zeigt die PIN – danach geht es nur mit ihr weiter', async () => {
    const { svc, students } = setup();
    expect(await svc.load(body())).toEqual({ data: null });
    const first = await svc.save(body({ data }));
    expect(first.pin).toMatch(/^\d{4}$/);
    expect(students.rows[0].pin).toBe(first.pin);
    // Zweites Speichern: keine PIN mehr in der Antwort, aber ohne PIN abgelehnt.
    await expect(svc.save(body({ data }))).rejects.toMatchObject({ response: { needPin: true } });
    const again = await svc.save(body({ data, pin: first.pin }));
    expect(again.pin).toBeUndefined();
    expect((await svc.load(body({ pin: first.pin }))).data).toEqual(data);
    await expect(svc.load(body({ pin: first.pin === '0000' ? '1111' : '0000' }))).rejects.toMatchObject({ response: { needPin: true } });
  });

  it('bremst Raten nach fünf falschen PINs', async () => {
    const { svc, students } = setup();
    Object.assign(students.rows[0], { pin: '1234', pinShownAt: new Date() });
    for (let i = 0; i < 5; i++) await expect(svc.load(body({ pin: '0000' }))).rejects.toThrow(/Falsche PIN/);
    await expect(svc.load(body({ pin: '1234' }))).rejects.toThrow(/Zu viele falsche PINs/);
  });

  it('nur Dokumente des Links, nur mit gültigem Ausweis', async () => {
    const { svc } = setup();
    await expect(svc.load(body({ moduleId: 'q1' }))).rejects.toThrow(/Dokument nicht gefunden/);
    await expect(svc.load(body({ studentTicket: issueTicket('anderer', 's1', 'Anna B') }))).rejects.toThrow(/Anmeldung ist abgelaufen/);
    await expect(svc.save(body({ data: { v: 2 } }))).rejects.toThrow(/Kein gültiger Stand/);
  });

  it('Klassenarbeit: keine PIN, aber nachträglich weder öffnen noch ändern', async () => {
    const { svc } = setup('exam');
    const start = Date.now();
    const ticket = issueTicket('l1', 's1', 'Anna B', start);
    const res = await svc.save(body({ studentTicket: ticket, data }));
    expect(res.pin).toBeUndefined();
    expect((await svc.load(body({ studentTicket: ticket }))).data).toEqual(data);
    const later = issueTicket('l1', 's1', 'Anna B', start + 60000);
    await expect(svc.load(body({ studentTicket: later }))).rejects.toThrow(/nachträglich/);
    await expect(svc.save(body({ studentTicket: later, data }))).rejects.toThrow(/nachträglich/);
  });

  it('die Lehrkraft sieht nur Bearbeitungen ihrer Links', async () => {
    const { svc } = setup();
    await svc.save(body({ data }));
    expect(await svc.list({ userId: 't1' })).toHaveLength(1);
    expect(await svc.list({ userId: 'fremd' })).toHaveLength(0);
    await expect(svc.get({ userId: 'fremd' }, (await svc.list({ userId: 't1' }))[0].id)).rejects.toThrow(/nicht gefunden/);
  });
});
