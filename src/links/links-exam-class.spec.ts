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
