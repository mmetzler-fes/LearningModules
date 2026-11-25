import { PublicController } from './public.controller';

/** Der Link der Klassenarbeit: Name und PIN wie im Klassennotizbuch (oder vorher Microsoft) – das Gerät merkt sich nichts. */
describe('Klassenarbeit-Link: Anmeldung', () => {
  const setup = () => {
    const c: any = Object.create(PublicController.prototype);
    const link = { id: 'x', ownerId: 'o', classId: 'k', active: true, modes: ['exam'], selection: [], singleAttempt: false, hiddenFromStudents: false, blockedStudentIds: null };
    c.findAccessByToken = async () => ({ link, access: 'exam' });
    c.linksService = {
      resolveModules: async () => [{ topic: { id: 't', title: 'T', ownerId: 'o' }, modules: [{ id: 'm', type: 'multipleChoice', content: {} }] }],
      entryModes: async () => ({ modes: ['exam'], blocked: false }),
      startViewOf: async () => null,
    };
    c.classesService = { findById: async () => ({ id: 'k', name: '10a', ownerId: 'o' }) };
    c.classbook = {
      loginViaLink: jest.fn(async (_k: any, b: any) => {
        if (b.pin !== '0194') throw Object.assign(new Error('Bitte deine PIN eingeben.'), { needPin: true });
        return { studentId: 's1', name: 'Test', deviceTicket: 'dev', pin: undefined };
      }),
      deviceLogin: async () => ({ s: 's1', n: 'Test' }),
    };
    c.exams = { mayStartAgain: async () => false, begin: async () => ({ progress: null }) };
    c.userRepo = { findOne: async () => ({ id: 'o', email: 'l@x' }) };
    c.features = { has: async () => false };
    return c;
  };

  it('ohne PIN nicht hinein, mit PIN schon – ohne gemerktes Gerät', async () => {
    const c = setup();
    await expect(c.startLink('tok', { studentName: 'Test', mode: 'exam' })).rejects.toThrow(/PIN/);
    const res = await c.startLink('tok', { studentName: 'Test', mode: 'exam', pin: '0194' });
    expect(c.classbook.loginViaLink).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ name: 'Test', pin: '0194' }));
    expect(res.studentName).toBe('Test');
    expect(res.deviceTicket).toBeUndefined();
    expect(res.topics[0].modules).toHaveLength(1);
  });

  it('nach „Mit Microsoft anmelden“ (Ausweis) ohne PIN', async () => {
    const c = setup();
    const res = await c.startLink('tok', { mode: 'exam', classTicket: 'sso' });
    expect(res.studentName).toBe('Test');
    expect(c.classbook.loginViaLink).not.toHaveBeenCalled();
  });
});
