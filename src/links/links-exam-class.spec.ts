import { LinksService } from './links.service';
import { repo } from '../work/test-repo';

/** 📝 im Klassennotizbuch: Link der Klassenarbeit einer Klasse für ein Modul. */
describe('LinksService.examLinkForClass', () => {
  const setup = () => {
    const svc: any = Object.create(LinksService.prototype);
    const links = repo();
    svc.linkRepo = links;
    svc.moduleRepo = { findOne: async ({ where }: any) => (where.id === 'ka' && where.topicId === 't' ? { id: 'ka', topicId: 't', title: 'Klassenarbeit Netze' } : null) };
    svc.classesService = { ownedClass: async (id: string, user: any) => { if (id !== 'c1' || user.userId !== 'me') throw new Error('nicht deine Klasse'); return { id }; } };
    svc.cleanSelection = async (_u: any, sel: any) => sel;
    return { svc, links };
  };
  const me = { userId: 'me' };

  it('legt einen Link an: nur Klassenarbeit, ein Durchlauf, für Schüler noch aus, ohne Schlüssel', async () => {
    const { svc, links } = setup();
    const link = await svc.examLinkForClass(me, 'c1', 't', 'ka');
    expect(link).toMatchObject({ classId: 'c1', ownerId: 'me', name: 'Klassenarbeit Netze', modes: ['exam'], singleAttempt: true, hiddenFromStudents: true, examToken: null, token: null });
    expect(link.selection).toEqual([{ topicId: 't', all: false, moduleIds: ['ka'] }]);
    expect(links.rows).toHaveLength(1);
  });

  it('nimmt einen vorhandenen Link derselben Klasse für dieses Modul', async () => {
    const { svc, links } = setup();
    const first = await svc.examLinkForClass(me, 'c1', 't', 'ka');
    const again = await svc.examLinkForClass(me, 'c1', 't', 'ka');
    expect(again.id).toBe(first.id);
    expect(links.rows).toHaveLength(1);
  });

  it('fremde Klasse oder unbekanntes Modul: nein', async () => {
    const { svc } = setup();
    await expect(svc.examLinkForClass({ userId: 'other' }, 'c1', 't', 'ka')).rejects.toThrow();
    await expect(svc.examLinkForClass(me, 'c1', 't', 'nix')).rejects.toThrow(/nicht gefunden/);
  });
});

describe('LinksService.examLinkForTopics', () => {
  const setup = () => {
    const svc: any = Object.create(LinksService.prototype);
    const links = repo();
    svc.linkRepo = links;
    svc.classesService = { ownedClass: async (id: string) => ({ id }) };
    svc.cleanSelection = async (_u: any, sel: any) => sel;
    return { svc, links };
  };
  const me = { userId: 'me' };

  it('ganze Lernthemen: ein Link, für Schüler aus, ein Durchlauf – derselbe beim zweiten Mal', async () => {
    const { svc, links } = setup();
    const link = await svc.examLinkForTopics(me, 'c1', 'Klassenarbeit OOP', ['t1', 't2', 't1']);
    expect(link).toMatchObject({ classId: 'c1', name: 'Klassenarbeit OOP', modes: ['exam'], singleAttempt: true, hiddenFromStudents: true });
    expect(link.selection).toEqual([{ topicId: 't1', all: true }, { topicId: 't2', all: true }]);
    expect((await svc.examLinkForTopics(me, 'c1', 'x', ['t2', 't1'])).id).toBe(link.id);
    expect(links.rows).toHaveLength(1);
  });
  it('ohne Lernthema: nein', async () => {
    await expect(setup().svc.examLinkForTopics(me, 'c1', 'x', [])).rejects.toThrow(/kein Lernthema/);
  });
});

describe('LinksService.setExamVisible', () => {
  it('● gibt die Klassenarbeit aus: Ohne Schlüssel entsteht einer, ○ lässt ihn stehen', async () => {
    const svc: any = Object.create(LinksService.prototype);
    const link: any = { id: 'x', classId: 'c1', modes: ['exam'], examToken: null, hiddenFromStudents: true };
    svc.own = async () => link;
    svc.linkRepo = { save: async (l: any) => l };
    await svc.setExamVisible({ userId: 'me' }, 'x', true);
    expect(link.hiddenFromStudents).toBe(false);
    expect(link.examToken).toEqual(expect.any(String));
    const token = link.examToken;
    await svc.setExamVisible({ userId: 'me' }, 'x', false);
    expect(link).toMatchObject({ hiddenFromStudents: true, examToken: token });
  });
});
