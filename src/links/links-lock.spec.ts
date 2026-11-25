import { LinksService } from './links.service';

/** Alle Schüler-Wege (Übungslink, Klassennotizbuch, Quiz-Arena, Abgabe) gehen durch resolveModules. */
describe('LinksService.resolveModules: Sperre', () => {
  const mods = [
    { id: 'ka', topicId: 't', type: 'document', orderIndex: 0, content: { kind: 'klassenarbeit', spec: { content: [{ type: 'quiz', module: 'q' }] } } },
    { id: 'q', topicId: 't', type: 'multipleChoice', orderIndex: 1, content: {} },
    { id: 'frei', topicId: 't', type: 'multipleChoice', orderIndex: 2, content: {} },
    { id: 'rel', topicId: 't', type: 'document', orderIndex: 3, studentRelease: true, content: { kind: 'klassenarbeit' } },
  ];
  const service = (ownerId: string, topic: object = { selected: true }): any => {
    const svc: any = Object.create(LinksService.prototype);
    svc.topicRepo = { find: async () => [{ id: 't', ownerId, ...topic }] };
    svc.moduleRepo = { find: async () => mods };
    svc.groupsService = { asUser: async () => ({}) };
    svc.topicsService = { accessLevel: () => 'read', visibleModules: (_t: unknown, m: unknown) => m };
    return svc;
  };
  const link = { ownerId: 'me', selection: [{ topicId: 't', all: true }] };
  const ids = (r: any[]) => r.flatMap((x) => x.modules.map((m: any) => m.id));

  it('ohne Angabe ohne Gesperrtes – auch wer vergisst, etwas anzugeben, zeigt nichts', async () => {
    expect(ids(await service('me').resolveModules(link))).toEqual(['frei', 'rel']);
  });
  it('Link der Klassenarbeit einer Klasse: alles', async () => {
    expect(ids(await service('me').resolveModules({ ...link, classId: 'k' }, { exam: true }))).toEqual(['ka', 'q', 'frei', 'rel']);
  });
  it('Probearbeit über einen anonymen Link: Gesperrtes nur, wenn es einzeln gewählt ist', async () => {
    expect(ids(await service('me').resolveModules(link, { exam: true }))).toEqual(['frei', 'rel']);
    expect(ids(await service('me').resolveModules({ ...link, selection: [{ topicId: 't', moduleIds: ['ka', 'frei'] }] }, { exam: true }))).toEqual(expect.arrayContaining(['ka', 'frei']));
  });
  it('Link einer anderen Lehrkraft: Die Freigabe zur Besprechung gilt nicht', async () => {
    expect(ids(await service('andere').resolveModules(link))).toEqual(['frei']);
  });

  describe('Hauptschalter im Lernnotizbuch', () => {
    it('Modul aus: fällt für Übungen weg', async () => {
      const svc = service('me');
      svc.moduleRepo = { find: async () => mods.map((m) => (m.id === 'frei' ? { ...m, moduleSelected: false } : m)) };
      expect(ids(await svc.resolveModules(link))).toEqual(['rel']);
    });
    it('Thema einer anderen Lehrkraft: Der Schalter dort zählt nicht', async () => {
      expect(ids(await service('other', { selected: false }).resolveModules(link)).length).toBeGreaterThan(0);
    });
    it('Thema aus: für Übungen nirgends, die Klassenarbeit und die Sicht der Lehrkraft bleiben', async () => {
      const svc = service('me', { selected: false });
      expect(ids(await svc.resolveModules(link))).toEqual([]);
      expect(ids(await svc.resolveModules(link, { exam: true })).length).toBeGreaterThan(0);
      expect(ids(await svc.resolveModules(link, { includeOff: true })).length).toBeGreaterThan(0);
    });
    it('Thema „Nur Lehrkraft“: regelt 🔒 je Klasse, nicht der Hauptschalter', async () => {
      const svc = service('me', { selected: false, teacherOnly: true });
      expect(ids(await svc.resolveModules({ ...link, selection: [{ topicId: 't', moduleIds: ['frei'] }] }))).toEqual(expect.any(Array));
      expect(await svc.resolveModules(link)).toEqual(expect.any(Array));
    });
  });
});

/** 📝 Läuft eine Klassenarbeit der Klasse, ist ihr Inhalt dort nicht zum Üben zu sehen. */
describe('LinksService.resolveModules: laufende Klassenarbeit', () => {
  const mods = [
    { id: 'a', topicId: 't', type: 'multipleChoice', orderIndex: 0, content: {} },
    { id: 'b', topicId: 't', type: 'multipleChoice', orderIndex: 1, content: {} },
    { id: 'c', topicId: 'u', type: 'multipleChoice', orderIndex: 0, content: {} },
  ];
  const practice = { id: 'p', ownerId: 'me', classId: 'k', selection: [{ topicId: 't', all: true }, { topicId: 'u', all: true }] };
  const service = (exams: any[]): any => {
    const svc: any = Object.create(LinksService.prototype);
    svc.topicRepo = { find: async () => [{ id: 't', ownerId: 'me', selected: true }, { id: 'u', ownerId: 'me', selected: true }] };
    svc.moduleRepo = { find: async () => mods };
    svc.linkRepo = { find: async () => [practice, ...exams] };
    svc.groupsService = { asUser: async () => ({}) };
    svc.topicsService = { accessLevel: () => 'read', visibleModules: (_t: unknown, m: unknown) => m };
    return svc;
  };
  const exam = (over: object = {}) => ({ id: 'x', ownerId: 'me', classId: 'k', modes: ['exam'], active: true, examToken: 'e', hiddenFromStudents: false, selection: [{ topicId: 't', all: true }], ...over });
  const ids = (r: any[]) => r.flatMap((x) => x.modules.map((m: any) => m.id));

  it('ganzes Lernthema als Klassenarbeit (●): fällt in der Klasse weg, das andere bleibt', async () => {
    expect(ids(await service([exam()]).resolveModules(practice))).toEqual(['c']);
  });
  it('einzelnes Modul: nur das fällt weg', async () => {
    expect(ids(await service([exam({ selection: [{ topicId: 't', all: false, moduleIds: ['b'] }] })]).resolveModules(practice))).toEqual(['a', 'c']);
  });
  it('noch aus (○), deaktiviert oder ohne Link: alles zum Üben da', async () => {
    for (const over of [{ hiddenFromStudents: true }, { active: false }, { examToken: null }]) {
      expect(ids(await service([exam(over)]).resolveModules(practice))).toEqual(['a', 'b', 'c']);
    }
  });
  it('die Klassenarbeit selbst und die Sicht der Lehrkraft bleiben', async () => {
    const svc = service([exam()]);
    expect(ids(await svc.resolveModules(exam(), { exam: true }))).toEqual(['a', 'b']);
    expect(ids(await svc.resolveModules(practice, { includeOff: true }))).toEqual(['a', 'b', 'c']);
  });
});
