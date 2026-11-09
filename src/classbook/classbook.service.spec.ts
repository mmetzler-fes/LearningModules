import { ClassbookService } from './classbook.service';
import { pinGuard } from '../work/pin';
import { repo } from '../work/test-repo';
import { readTicket } from '../classes/student-ticket';
import { classbookTicketKey } from './classbook-rules';

const KLASSE = { id: 'c1', name: '10a', ownerId: 't1', strict: false };
const QUIZ = { id: 'm1', type: 'multipleChoice', title: 'Frage', orderIndex: 0 };

function setup({ firstLogin = false, plans = undefined as any } = {}) {
  pinGuard.reset();
  const notebooks = repo([{ id: 'n1', classId: 'c1', ownerId: 't1', token: 'kb', firstLoginUntil: firstLogin ? new Date(Date.now() + 3600_000) : null, teacherItems: [] }]);
  const students = repo([
    { id: 's1', classId: 'c1', firstName: 'Anna', lastName: 'B', status: 'confirmed', pin: '1234', pinShownAt: null },
    { id: 's2', classId: 'c1', firstName: 'Neu', lastName: '', status: 'pending', pin: null, pinShownAt: null },
  ]);
  const results = repo([{ id: 'r1', classId: 'c1', studentId: 's1', linkId: 'l1', mode: 'quiz', score: 1, maxScore: 1, payload: { percentage: 100, details: [{ moduleId: 'm1', isCorrect: true }] } }]);
  const works = repo();
  const links = repo([{ id: 'l1', classId: 'c1', ownerId: 't1', name: 'Physik', active: true, modes: ['quiz'], token: null, createdAt: new Date() }]);
  const users = repo([{ id: 't1', active: true, displayName: 'Frau M' }]);
  const classes: any = {
    findById: async (id: string) => (id === 'c1' ? KLASSE : null),
    ownedClass: async (id: string) => (id === 'c1' ? KLASSE : null),
    resolveStudent: async (_k: any, name: string) => (name.startsWith('Anna')
      ? { studentId: 's1', name: 'Anna B' } : { studentId: 's2', name: 'Neu' }),
  };
  const linksService: any = {
    resolveModules: async () => [{ topic: { id: 't', title: 'Strom' }, modules: [QUIZ] }],
    practiceToken: async (l: any) => l.token,
    lockedOf: async () => [],
    // 🗂 Plan zuweisen: je Lernthema ein Klassenlink mit „alles“
    classLinkForTopic: async (topicId: string) => {
      const id = `p-${topicId}`;
      await links.save({ id, classId: 'c1', ownerId: 't1', name: 'Strom', active: true, modes: ['quiz'], token: null, selection: [{ topicId, all: true }], createdAt: new Date() });
      return { id };
    },
  };
  const attempts = repo();
  const nodes = repo();
  const places = repo();
  const topics = repo();
  const modules = repo();
  const progress = repo();
  const svc = new ClassbookService(notebooks as any, students as any, results as any, works as any, links as any, users as any, attempts as any, classes, linksService, {} as any, { isOpen: () => false } as any, { markerChanged() {}, online: () => 0, isFollowing: () => false } as any,
    nodes as any, places as any, topics as any, modules as any, repo() as any, repo() as any, progress as any,
    repo() as any, repo() as any, repo() as any, repo() as any, repo() as any, plans);
  return { svc, students, links, notebooks, attempts, nodes, places, topics, modules, progress };
}

describe('Klassennotizbuch: Anmeldung', () => {
  it('Erstanmeldung offen: PIN wird einmal angezeigt, danach verlangt', async () => {
    const { svc, students } = setup({ firstLogin: true });
    const first = await svc.login('kb', { name: 'Anna' });
    expect(first.pin).toBe('1234');
    expect(readTicket(first.ticket, classbookTicketKey('c1'))?.s).toBe('s1');
    expect(students.rows[0].pinShownAt).toBeInstanceOf(Date);
    await expect(svc.login('kb', { name: 'Anna' })).rejects.toMatchObject({ response: { needPin: true } });
    expect((await svc.login('kb', { name: 'Anna', pin: '1234' })).pin).toBeUndefined();
  });

  it('Erstanmeldung zu: ohne PIN nicht hinein, die gesagte PIN gilt', async () => {
    const { svc, students } = setup();
    await expect(svc.login('kb', { name: 'Anna' })).rejects.toMatchObject({ response: { needPin: true } });
    const ok = await svc.login('kb', { name: 'Anna', pin: '1234' });
    expect(ok.pin).toBeUndefined();
    expect(students.rows[0].pinShownAt).toBeInstanceOf(Date);
  });

  it('fünf falsche PINs sperren – auch die richtige', async () => {
    const { svc } = setup();
    for (let i = 0; i < 5; i++) await expect(svc.login('kb', { name: 'Anna', pin: '0000' })).rejects.toThrow(/Falsche PIN/);
    await expect(svc.login('kb', { name: 'Anna', pin: '1234' })).rejects.toThrow(/Zu viele/);
  });

  it('unbekannter Link', async () => {
    const { svc } = setup();
    await expect(svc.info('nix')).rejects.toThrow(/gibt es nicht/);
  });
});

describe('Klassennotizbuch: 👁 Vorschau der Lehrkraft', () => {
  const start = () => {
    const ctx = setup();
    (ctx.svc as any).classes.ownedClass = async (id: string, user: any) => {
      if (user.userId !== 't1') throw new Error('nicht deine Klasse');
      return KLASSE;
    };
    return ctx;
  };
  const me = { userId: 't1', role: 'teacher' };

  it('gibt der Lehrkraft einen Ausweis als Testschüler, ohne Name und PIN', async () => {
    const { svc } = start();
    const { token, ticket, name } = await svc.preview(me, 'c1');
    expect(token).toBe('kb');
    expect(name).toBe('🧪 Vorschau');
    expect(readTicket(ticket, classbookTicketKey('c1'))).toMatchObject({ s: 'test:t1' });
  });
  it('nur für die eigene Klasse', async () => {
    const { svc } = start();
    await expect(svc.preview({ userId: 'andere' }, 'c1')).rejects.toThrow('nicht deine Klasse');
    await expect(svc.resetPreview({ userId: 'andere' }, 'c1')).rejects.toThrow('nicht deine Klasse');
  });
  it('sieht wie ein bestätigter Schüler die eigenen Ergebnisse und nicht die anderer', async () => {
    const { svc } = start();
    (svc as any).resultRepo.rows.push({ id: 'r9', classId: 'c1', studentId: 'test:t1', linkId: 'l1', mode: 'quiz', score: 1, maxScore: 2, payload: { percentage: 50, details: [] } });
    const { ticket } = await svc.preview(me, 'c1');
    const home = await svc.home('kb', ticket);
    expect(home.pending).toBe(false);
    expect(home.results.map((r: any) => r.id)).toEqual(['r9']);
  });
  it('🧹 löscht nur die Daten des Testschülers in dieser Klasse', async () => {
    const { svc } = start();
    const row = (studentId: string, classId = 'c1') => ({ id: `${studentId}-${classId}`, classId, studentId });
    const test = 'test:t1';
    (svc as any).resultRepo.rows.push(row(test), row(test, 'c2'));
    (svc as any).workRepo.rows.push(row(test), row('s1'));
    (svc as any).runRepo = repo([row(test), row('s1')]);
    (svc as any).appStateRepo = repo([{ id: 'a', studentId: test }, { id: 'b', studentId: 's1' }]);
    await svc.resetPreview(me, 'c1');
    expect((svc as any).resultRepo.rows.filter((r: any) => r.studentId === test).map((r: any) => r.classId)).toEqual(['c2']);
    expect((svc as any).resultRepo.rows.some((r: any) => r.studentId === 's1')).toBe(true);
    expect((svc as any).workRepo.rows.map((r: any) => r.studentId)).toEqual(['s1']);
    expect((svc as any).runRepo.rows.map((r: any) => r.studentId)).toEqual(['s1']);
    expect((svc as any).appStateRepo.rows.map((r: any) => r.studentId)).toEqual(['s1']);
  });
});

describe('Klassennotizbuch: Blatt zu einem gelöschten Dokument', () => {
  const spec = { content: [{ type: 'text', text: 'Aufgabe' }, { type: 'solution', blocks: [{ type: 'text', text: 'Geheim' }] }] };
  const work = (over = {}) => ({ id: 'w1', classId: 'c1', studentId: 's1', moduleId: 'weg', moduleTitle: 'Blatt', access: 'practice', versionId: 'v1', data: { paths: [1] }, updatedAt: new Date(), ...over });
  const run = async ({ w = work(), kind = 'arbeitsblatt', hidden = false, modules = [] as any[], name = 'Anna', other = false } = {}) => {
    const { svc, notebooks, modules: mods } = setup({ firstLogin: false });
    (svc as any).workRepo.rows.push(w);
    (svc as any).versionRepo = repo([{ id: 'v1', title: 'Blatt', content: { kind, spec }, embedded: [{ id: 'q' }] }]);
    mods.rows.push(...modules);
    notebooks.rows[0].studentHidden = hidden;
    const { ticket } = await svc.login('kb', { name, pin: '1234' });
    if (other) (svc as any).workRepo.rows[0].studentId = 'andere';
    return svc.goneWork('kb', { ticket, workId: 'w1' });
  };
  it('zeigt die Fassung mit dem Stand des Schülers, ohne Lösungen', async () => {
    const res: any = await run();
    expect(res.data).toEqual({ paths: [1] });
    expect(res.embedded).toEqual([{ id: 'q' }]);
    expect(JSON.stringify(res.content)).not.toContain('Geheim');
    expect(JSON.stringify(res.content)).toContain('Aufgabe');
  });
  it('kein fremdes Blatt, keine Klassenarbeit, nichts bei ausgeblendetem Klassennotizbuch', async () => {
    await expect(run({ other: true })).rejects.toThrow('nicht mehr verfügbar');
    await expect(run({ w: work({ access: 'exam' }) })).rejects.toThrow('nicht mehr verfügbar');
    await expect(run({ kind: 'klassenarbeit' })).rejects.toThrow('nicht mehr verfügbar');
    await expect(run({ hidden: true })).rejects.toThrow('nicht mehr verfügbar');
  });
  it('solange das Dokument besteht, gilt der gewöhnliche Weg mit allen Schaltern', async () => {
    await expect(run({ modules: [{ id: 'weg' }] })).rejects.toThrow('nicht mehr verfügbar');
  });
  it('Startseite markiert das Blatt', async () => {
    const { svc, modules: mods } = setup();
    (svc as any).workRepo.rows.push(work(), work({ id: 'w2', moduleId: 'da', linkId: 'l1', versionId: null }));
    mods.find = async () => [{ id: 'da' }] as any;
    const { ticket } = await svc.login('kb', { name: 'Anna', pin: '1234' });
    const list = (await svc.home('kb', ticket)).works;
    expect(list.find((x: any) => x.workId === 'w1')).toMatchObject({ gone: true, viewable: true });
    expect(list.find((x: any) => x.workId === 'w2')).toMatchObject({ gone: false, viewable: false });
  });
});

describe('Klassennotizbuch: Startseite', () => {
  it('bestätigter Schüler: Aufgaben mit Stand, Ergebnisse', async () => {
    const { svc } = setup();
    const { ticket } = await svc.login('kb', { name: 'Anna', pin: '1234' });
    const home = await svc.home('kb', ticket);
    expect(home.pending).toBe(false);
    expect(home.assignments[0].topics[0].units[0]).toMatchObject({ id: 'm1', done: true, pct: 100 });
    expect(home.results).toHaveLength(1);
  });

  it('nennt die Quizze im Dokument, damit sie darunter eingerückt stehen', async () => {
    const { svc } = setup();
    const doc = { id: 'd1', type: 'document', title: 'Blatt', orderIndex: 1, content: { spec: { content: [{ type: 'quiz', module: 'm1' }] } } };
    (svc as any).links.resolveModules = async () => [{ topic: { id: 't', title: 'Strom' }, modules: [QUIZ, doc] }];
    const { ticket } = await svc.login('kb', { name: 'Anna', pin: '1234' });
    const units = (await svc.home('kb', ticket)).assignments[0].topics[0].units;
    expect(units.find((u: any) => u.id === 'd1').quizIds).toEqual(['m1']);
  });

  it('unbestätigt: Aufgaben ja, eigene Daten nein', async () => {
    const { svc } = setup();
    const { ticket, pending } = await svc.login('kb', { name: 'Neu' });
    expect(pending).toBe(true);
    const home = await svc.home('kb', ticket);
    expect(home.pending).toBe(true);
    expect(home.assignments).toHaveLength(1);
    expect(home.assignments[0].topics[0].units[0].done).toBeUndefined();
    expect(home.results).toEqual([]);
  });

  it('Aufgabe öffnen: Klassenlink bekommt bei Bedarf einen Token; fremder Ausweis gilt nicht', async () => {
    const { svc, links } = setup();
    const { ticket } = await svc.login('kb', { name: 'Anna', pin: '1234' });
    const { linkToken } = await svc.enter('kb', { ticket, linkId: 'l1' });
    expect(linkToken).toBe(links.rows[0].token);
    await expect(svc.home('kb', 'falsch')).rejects.toMatchObject({ response: { expired: true } });
  });
});

describe('Klassennotizbuch: Klassenarbeit', () => {
  it('erscheint, solange sie aktiv ist und ihr Link erzeugt wurde; Start über ihren eigenen Link', async () => {
    const { svc, links, attempts } = setup();
    links.rows.push({ id: 'x1', classId: 'c1', ownerId: 't1', name: 'KA 1', active: true, modes: ['exam'], examToken: null, singleAttempt: true, createdAt: new Date() });
    const { ticket } = await svc.login('kb', { name: 'Anna', pin: '1234' });
    expect((await svc.home('kb', ticket)).exams).toEqual([]);
    await expect(svc.enter('kb', { ticket, linkId: 'x1', exam: true })).rejects.toThrow(/nicht freigegeben/);

    links.rows[1].examToken = 'ex';
    expect((await svc.home('kb', ticket)).exams).toEqual([{ linkId: 'x1', name: 'KA 1', state: 'open' }]);
    expect(await svc.enter('kb', { ticket, linkId: 'x1', exam: true })).toEqual({ linkToken: 'ex' });

    attempts.rows.push({ id: 'a1', linkId: 'x1', studentId: 's1', submittedAt: null, reentryAllowed: false });
    expect((await svc.home('kb', ticket)).exams[0].state).toBe('locked');
    attempts.rows[0].submittedAt = new Date();
    expect((await svc.home('kb', ticket)).exams[0].state).toBe('submitted');
    attempts.rows[0].reentryAllowed = true;
    expect((await svc.home('kb', ticket)).exams[0].state).toBe('reentry');
  });
});

describe('Klassennotizbuch: Lernthemen und Module schalten', () => {
  it('Modul aus: Auswahl wird ausdrücklich, Schüler sehen es nicht mehr; Thema aus und wieder an', async () => {
    const { svc, links } = setup();
    const QUIZ2 = { id: 'm2', type: 'multipleChoice', title: 'Zweite', orderIndex: 1 };
    links.rows[0].selection = [{ topicId: 't', all: true }];
    (svc as any).links.resolveModules = async (l: any) => (l.selection || []).map((e: any) => ({
      topic: { id: e.topicId, title: 'Strom' },
      modules: [QUIZ, QUIZ2].filter((m) => e.all || (e.moduleIds || []).includes(m.id)),
    }));
    (svc as any).classes.ownedClass = async () => KLASSE;
    const user = { userId: 't1' };
    await svc.setItem(user, 'c1', 'l1', { topicId: 't', moduleId: 'm1', enabled: false });
    expect(links.rows[0].selection).toEqual([{ topicId: 't', all: false, moduleIds: ['m2'] }]);
    expect(links.rows[0].customized).toBe(true);
    await svc.setItem(user, 'c1', 'l1', { topicId: 't', enabled: false });
    expect(links.rows[0].selection).toEqual([{ topicId: 't', all: false, moduleIds: [] }]);
    await svc.setItem(user, 'c1', 'l1', { topicId: 't', enabled: true });
    expect(links.rows[0].selection).toEqual([{ topicId: 't', all: false, moduleIds: ['m1', 'm2'] }]);
    await expect(svc.setItem(user, 'c1', 'l1', { topicId: 'x', enabled: true })).rejects.toThrow(/gehört nicht/);
  });
});

describe('Klassennotizbuch: 📍 Merker', () => {
  it('Lehrkraft setzt ihn auf Modul-Ebene, Schüler sehen ihn nur bei sichtbarem Modul; entfernen', async () => {
    const { svc, notebooks, links } = setup();
    links.rows[0].selection = [{ topicId: 't', all: true }];
    (svc as any).classes.ownedClass = async () => KLASSE;
    const user = { userId: 't1' };
    await expect(svc.setMarker(user, 'c1', { level: 'module', linkId: 'l1', topicId: 't', moduleId: 'nix' })).rejects.toThrow(/nichts zum Merken/);
    expect((await svc.setMarker(user, 'c1', { level: 'module', linkId: 'l1', topicId: 't', moduleId: 'm1' })).marker)
      .toEqual({ level: 'module', linkId: 'l1', topicId: 't', moduleId: 'm1' });
    const { ticket } = await svc.login('kb', { name: 'Anna', pin: '1234' });
    expect((await svc.home('kb', ticket)).marker).toEqual({
      anchor: { level: 'module', linkId: 'l1', topicId: 't', moduleId: 'm1' },
      current: { linkId: 'l1', topicId: 't', moduleId: 'm1' },
      openNodeIds: [],
      hasNext: false,
    });
    // Modul inzwischen nicht mehr bei den Schülern: kein Merker
    notebooks.rows[0].marker = { level: 'module', linkId: 'l1', topicId: 't', moduleId: 'weg' };
    expect((await svc.home('kb', ticket)).marker).toBeNull();
    expect((await svc.setMarker(user, 'c1', {})).marker).toBeNull();
  });

  it('👣 Folgen führt auf jeder Ebene zum ersten Modul unter dem Merker', async () => {
    const { svc, notebooks, links } = setup();
    links.rows[0].selection = [{ topicId: 't', all: true }];
    (svc as any).classes.ownedClass = async () => KLASSE;
    const user = { userId: 't1' };
    const follow = jest.fn(() => 0);
    const open = jest.fn();
    (svc as any).live = { setFollow: follow, open, isFollowing: () => true, markerChanged() {}, online: () => 0 };
    const { ticket } = await svc.login('kb', { name: 'Anna', pin: '1234' });
    const target = { linkId: 'l1', moduleId: 'm1', title: '' };
    for (const anchor of [{ level: 'root' }, { level: 'link', linkId: 'l1' }, { level: 'topic', linkId: 'l1', topicId: 't' }]) {
      await svc.setMarker(user, 'c1', anchor);
      await svc.setFollow(user, 'c1', true);
      expect(follow).toHaveBeenLastCalledWith('c1', true, target);
      await svc.liveStream('kb', ticket, {} as any);
      expect(open).toHaveBeenLastCalledWith('c1', {}, target);
    }
    // Nichts mehr darunter sichtbar: kein Ziel statt eines halben
    notebooks.rows[0].marker = { level: 'link', linkId: 'weg' };
    await svc.setFollow(user, 'c1', true);
    expect(follow).toHaveBeenLastCalledWith('c1', true, null);
  });

  it('auch auf Bereich-, Zuweisungs- und Lernthema-Ebene: springt zum ersten Modul darunter', async () => {
    const { svc, links, places } = setup();
    links.rows[0].selection = [{ topicId: 't', all: true }];
    (svc as any).classes.ownedClass = async () => KLASSE;
    const user = { userId: 't1' };
    const area = await svc.createNode(user, 'c1', { kind: 'area', title: 'Bereich 1' });
    places.rows.push({ id: 'l1', classId: 'c1', nodeId: area.id, orderIndex: 0, hidden: false });
    const { ticket } = await svc.login('kb', { name: 'Anna', pin: '1234' });

    expect((await svc.setMarker(user, 'c1', { level: 'node', nodeId: area.id })).marker).toEqual({ level: 'node', nodeId: area.id });
    let home = await svc.home('kb', ticket);
    expect(home.marker.current).toEqual({ linkId: 'l1', topicId: 't', moduleId: 'm1' });
    expect(home.marker.openNodeIds).toEqual([area.id]);

    expect((await svc.setMarker(user, 'c1', { level: 'link', linkId: 'l1' })).marker).toEqual({ level: 'link', linkId: 'l1' });
    expect((await svc.home('kb', ticket)).marker.current).toEqual({ linkId: 'l1', topicId: 't', moduleId: 'm1' });

    expect((await svc.setMarker(user, 'c1', { level: 'topic', linkId: 'l1', topicId: 't' })).marker).toEqual({ level: 'topic', linkId: 'l1', topicId: 't' });
    expect((await svc.home('kb', ticket)).marker.current).toEqual({ linkId: 'l1', topicId: 't', moduleId: 'm1' });

    expect((await svc.setMarker(user, 'c1', { level: 'root' })).marker).toEqual({ level: 'root' });
    home = await svc.home('kb', ticket);
    expect(home.marker.current).toEqual({ linkId: 'l1', topicId: 't', moduleId: 'm1' });

    await expect(svc.setMarker(user, 'c1', { level: 'node', nodeId: 'unbekannt' })).rejects.toThrow(/nichts zum Merken/);
  });
});

describe('Klassennotizbuch: „Weiter“ im 📍-Pfad', () => {
  it('schreitet je Schüler gespeichert fort, bleibt nach Neuladen erhalten', async () => {
    const { svc, links } = setup();
    const QUIZ2 = { id: 'm2', type: 'multipleChoice', title: 'Zweite', orderIndex: 1 };
    links.rows[0].selection = [{ topicId: 't', all: true }];
    (svc as any).links.resolveModules = async () => [{ topic: { id: 't', title: 'Strom' }, modules: [QUIZ, QUIZ2] }];
    (svc as any).classes.ownedClass = async () => KLASSE;
    const user = { userId: 't1' };
    await svc.setMarker(user, 'c1', { level: 'topic', linkId: 'l1', topicId: 't' });
    const { ticket } = await svc.login('kb', { name: 'Anna', pin: '1234' });

    expect(await svc.weiter('kb', ticket)).toEqual({ current: { linkId: 'l1', topicId: 't', moduleId: 'm1' }, hasNext: true });
    expect(await svc.advanceWeiter('kb', ticket)).toEqual({ current: { linkId: 'l1', topicId: 't', moduleId: 'm2' }, hasNext: false });
    // Am Ende bleibt „Weiter“ beim letzten Modul stehen.
    expect(await svc.advanceWeiter('kb', ticket)).toEqual({ current: { linkId: 'l1', topicId: 't', moduleId: 'm2' }, hasNext: false });

    // Gespeichert: ein neuer Aufruf (z. B. nach Neuladen) zeigt weiter das zweite Modul.
    expect((await svc.home('kb', ticket)).marker.current).toEqual({ linkId: 'l1', topicId: 't', moduleId: 'm2' });

    // Unbestätigter Schüler: liest den Stand, schreitet aber nicht fort.
    const { ticket: pendingTicket } = await svc.login('kb', { name: 'Neu' });
    await expect(svc.advanceWeiter('kb', pendingTicket)).rejects.toThrow(/bestätigt/);
  });
});

describe('Klassennotizbuch: Baum und klasseneigene Lernthemen', () => {
  const user = { userId: 't1' };
  const ready = () => {
    const ctx = setup();
    (ctx.svc as any).classes.ownedClass = async () => KLASSE;
    return ctx;
  };

  it('🙈 Bereich ausblenden: Lernthemen darin fehlen bei Schülern und lassen sich nicht öffnen, Module unverändert', async () => {
    const { svc, places, links } = ready();
    const area = await svc.createNode(user, 'c1', { kind: 'area', title: 'Halbjahr 2' });
    const sec = await svc.createNode(user, 'c1', { kind: 'section', title: 'Später', parentId: area.id });
    places.rows.push({ id: 'l1', classId: 'c1', nodeId: sec.id, orderIndex: 0, hidden: false });
    const selection = JSON.stringify(links.rows[0].selection ?? null);
    const { ticket } = await svc.login('kb', { name: 'Anna', pin: '1234' });
    expect((await svc.home('kb', ticket)).assignments).toHaveLength(1);
    await svc.setVisibility(user, 'c1', { type: 'node', id: area.id, hidden: true });
    const home = await svc.home('kb', ticket);
    expect(home.assignments).toEqual([]);
    expect(home.nodes).toEqual([]);
    await expect(svc.enter('kb', { ticket, linkId: 'l1' })).rejects.toThrow(/nicht freigegeben/);
    expect(JSON.stringify(links.rows[0].selection ?? null)).toBe(selection);
    await svc.setVisibility(user, 'c1', { type: 'node', id: area.id, hidden: false });
    expect((await svc.home('kb', ticket)).assignments).toHaveLength(1);
    // Das ganze Klassennotizbuch
    await svc.setVisibility(user, 'c1', { type: 'book', hidden: true });
    expect((await svc.home('kb', ticket)).assignments).toEqual([]);
  });

  it('Bereiche und Abschnitte; Abschnitt nimmt keinen Bereich auf', async () => {
    const { svc } = ready();
    const area = await svc.createNode(user, 'c1', { kind: 'area', title: 'Halbjahr 1' });
    const sec = await svc.createNode(user, 'c1', { kind: 'section', title: 'Strom', parentId: area.id });
    await expect(svc.createNode(user, 'c1', { kind: 'area', title: 'X', parentId: sec.id })).rejects.toThrow(/nur Lernthemen/);
    await expect(svc.createNode(user, 'c1', { kind: 'area', title: ' ' })).rejects.toThrow(/Namen/);
  });

  it('klasseneigenes Lernthema: Thema mit Klassenvermerk, Klassenlink, Platz; Löschen nimmt alles mit', async () => {
    const { svc, topics, links, places, modules } = ready();
    const sec = await svc.createNode(user, 'c1', { kind: 'section', title: 'Projekt' });
    const { topicId, linkId } = await svc.createTopic(user, 'c1', { title: 'Projektwoche', nodeId: sec.id });
    expect(topics.rows[0]).toMatchObject({ id: topicId, classId: 'c1', ownerId: 't1', selected: true });
    expect(links.rows.find((l) => l.id === linkId)).toMatchObject({ classId: 'c1', selection: [{ topicId, all: false, moduleIds: [] }] });
    expect(places.rows[0]).toMatchObject({ id: linkId, nodeId: sec.id });
    modules.rows.push({ id: 'mx', topicId });
    await svc.renameEntry(user, 'c1', linkId, 'Projektwoche 2');
    expect(topics.rows[0].title).toBe('Projektwoche 2');
    await svc.deleteEntry(user, 'c1', linkId);
    expect(topics.rows).toEqual([]);
    expect(modules.rows).toEqual([]);
    expect(links.rows.some((l) => l.id === linkId)).toBe(false);
  });

  it('Bereich löschen: Lernthemen rücken hoch; Verschieben', async () => {
    const { svc, places } = ready();
    const area = await svc.createNode(user, 'c1', { kind: 'area', title: 'A' });
    const { linkId } = await svc.createTopic(user, 'c1', { title: 'T', nodeId: area.id });
    await svc.deleteNode(user, 'c1', area.id);
    expect(places.rows.find((p) => p.id === linkId).nodeId).toBeNull();
    const sec = await svc.createNode(user, 'c1', { kind: 'section', title: 'S' });
    await svc.move(user, 'c1', { type: 'entry', id: linkId, parentId: sec.id, index: 0 });
    expect(places.rows.find((p) => p.id === linkId).nodeId).toBe(sec.id);
  });
});

describe('Klassennotizbuch: 🗂 Plan zuweisen', () => {
  const TEACHER = { userId: 't1', role: 'teacher' };
  const plans = { expanded: async () => ({ items: [{ type: 'node', key: 'k1', title: 'Lernfeld 1', kind: 'area', children: [{ type: 'topic', topicId: 't' }] }] }) };
  const entry = (links: any) => links.rows.find((l: any) => l.id === 'p-t').selection[0];

  it('eingeschaltet: Bereich und Lernthema mit allen Modulen', async () => {
    const { svc, links, nodes } = setup({ plans });
    const res = await svc.setPlan(TEACHER, 'c1', 'plan1');
    expect(res).toMatchObject({ planId: 'plan1', switchedOn: true, added: 1 });
    expect(nodes.rows.map((n: any) => n.title)).toEqual(['Lernfeld 1']);
    expect(entry(links)).toEqual({ topicId: 't', all: false, moduleIds: ['m1'] });
  });

  it('ausgeschaltet: dieselbe Struktur, aber kein Modul an – die Lehrkraft schaltet ein', async () => {
    const { svc, links, nodes } = setup({ plans });
    const res = await svc.setPlan(TEACHER, 'c1', 'plan1', undefined, false);
    expect(res).toMatchObject({ switchedOn: false, added: 1 });
    expect(nodes.rows.map((n: any) => n.title)).toEqual(['Lernfeld 1']);
    expect(entry(links)).toEqual({ topicId: 't', all: false, moduleIds: [] });
  });
});

describe('Klassennotizbuch: eigener 🔗 Link auf einen Bereich bzw. eine Zuweisung', () => {
  async function twoAreas() {
    const ctx = setup();
    const { svc, links, places } = ctx;
    links.rows[0].selection = [{ topicId: 't', all: true }];
    links.rows.push({ id: 'l2', classId: 'c1', ownerId: 't1', name: 'Chemie', active: true, modes: ['quiz'], token: null, selection: [{ topicId: 't', all: true }], createdAt: new Date() });
    const user = { userId: 't1' };
    const a = await svc.createNode(user, 'c1', { kind: 'area', title: 'Physik-Bereich' });
    const b = await svc.createNode(user, 'c1', { kind: 'area', title: 'Chemie-Bereich' });
    places.rows.push({ id: 'l1', classId: 'c1', nodeId: a.id, orderIndex: 0, hidden: false });
    places.rows.push({ id: 'l2', classId: 'c1', nodeId: b.id, orderIndex: 0, hidden: false });
    return { ...ctx, user, a, b };
  }
  const tokenOf = (url: string) => url.split('?k=')[1];

  it('zeigt nur den Bereich – gleiche Anmeldung, Fremdes lässt sich nicht öffnen', async () => {
    const { svc, user, a } = await twoAreas();
    const share = await svc.shareLink(user, 'c1', { type: 'node', id: a.id });
    const token = tokenOf(share.url!);
    expect(share.title).toBe('Physik-Bereich');
    // Derselbe Link beim zweiten Aufruf
    expect((await svc.shareLink(user, 'c1', { type: 'node', id: a.id })).url).toBe(share.url);

    expect((await svc.info(token)).scopeTitle).toBe('Physik-Bereich');
    const { ticket } = await svc.login(token, { name: 'Anna', pin: '1234' });
    const home = await svc.home(token, ticket);
    expect(home.assignments.map((x: any) => x.linkId)).toEqual(['l1']);
    expect(home.nodes.map((n: any) => [n.title, n.parentId])).toEqual([['Physik-Bereich', null]]);
    await expect(svc.enter(token, { ticket, linkId: 'l2' })).rejects.toThrow(/nicht zu diesem Link/);
    // Der Ausweis gilt auch im ganzen Klassennotizbuch (gleiche Klasse).
    expect((await svc.home('kb', ticket)).assignments).toHaveLength(2);
  });

  it('ausgeschaltete Zuweisungen bleiben auch über den Link verborgen', async () => {
    const { svc, user, a, links } = await twoAreas();
    links.rows[0].active = false;
    const token = tokenOf((await svc.shareLink(user, 'c1', { type: 'node', id: a.id })).url!);
    const { ticket } = await svc.login(token, { name: 'Anna', pin: '1234' });
    expect((await svc.home(token, ticket)).assignments).toEqual([]);
  });

  it('Zuweisung allein; Zurückziehen macht den Link ungültig', async () => {
    const { svc, user } = await twoAreas();
    const token = tokenOf((await svc.shareLink(user, 'c1', { type: 'entry', id: 'l2' })).url!);
    const { ticket } = await svc.login(token, { name: 'Anna', pin: '1234' });
    const home = await svc.home(token, ticket);
    expect(home.assignments.map((x: any) => [x.linkId, x.nodeId])).toEqual([['l2', null]]);
    expect(home.nodes).toEqual([]);
    expect(await svc.shareLink(user, 'c1', { type: 'entry', id: 'l2', revoke: true })).toEqual({ revoked: true });
    await expect(svc.info(token)).rejects.toThrow(/gibt es nicht/);
  });

  it('gemerkte Anmeldung des Geräts: ohne Name und PIN', async () => {
    const { svc, user, a } = await twoAreas();
    const token = tokenOf((await svc.shareLink(user, 'c1', { type: 'node', id: a.id })).url!);
    const first = await svc.login('kb', { name: 'Anna', pin: '1234' });
    const again = await svc.login(token, { deviceTicket: first.deviceTicket });
    expect(again.name).toBe('Anna B');
    expect((await svc.home(token, again.ticket)).assignments).toHaveLength(1);
    await expect(svc.login(token, { deviceTicket: 'falsch' })).rejects.toThrow(/neu anmelden/);
  });
});
