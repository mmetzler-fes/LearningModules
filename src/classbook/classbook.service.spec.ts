import { ClassbookService } from './classbook.service';
import { pinGuard } from '../work/pin';
import { repo } from '../work/test-repo';
import { readTicket } from '../classes/student-ticket';
import { classbookTicketKey } from './classbook-rules';

const KLASSE = { id: 'c1', name: '10a', ownerId: 't1', strict: false };
const QUIZ = { id: 'm1', type: 'multipleChoice', title: 'Frage', orderIndex: 0 };

function setup({ firstLogin = false } = {}) {
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
    resolveStudent: async (_k: any, name: string) => (name.startsWith('Anna')
      ? { studentId: 's1', name: 'Anna B' } : { studentId: 's2', name: 'Neu' }),
  };
  const linksService: any = {
    resolveModules: async () => [{ topic: { id: 't', title: 'Strom' }, modules: [QUIZ] }],
    practiceToken: async (l: any) => l.token,
  };
  const attempts = repo();
  const nodes = repo();
  const places = repo();
  const topics = repo();
  const modules = repo();
  const svc = new ClassbookService(notebooks as any, students as any, results as any, works as any, links as any, users as any, attempts as any, classes, linksService, {} as any, { isOpen: () => false } as any,
    nodes as any, places as any, topics as any, modules as any, repo() as any, repo() as any);
  return { svc, students, links, notebooks, attempts, nodes, places, topics, modules };
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

describe('Klassennotizbuch: Startseite', () => {
  it('bestätigter Schüler: Aufgaben mit Stand, Ergebnisse', async () => {
    const { svc } = setup();
    const { ticket } = await svc.login('kb', { name: 'Anna', pin: '1234' });
    const home = await svc.home('kb', ticket);
    expect(home.pending).toBe(false);
    expect(home.assignments[0].topics[0].units[0]).toMatchObject({ id: 'm1', done: true, pct: 100 });
    expect(home.results).toHaveLength(1);
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
  it('Lehrkraft setzt ihn, Schüler sehen ihn nur bei sichtbarem Modul; entfernen', async () => {
    const { svc, notebooks, links } = setup();
    links.rows[0].selection = [{ topicId: 't', all: true }];
    (svc as any).classes.ownedClass = async () => KLASSE;
    const user = { userId: 't1' };
    await expect(svc.setMarker(user, 'c1', { linkId: 'l1', moduleId: 'nix' })).rejects.toThrow(/gehört nicht/);
    expect((await svc.setMarker(user, 'c1', { linkId: 'l1', moduleId: 'm1' })).marker).toEqual({ linkId: 'l1', topicId: 't', moduleId: 'm1' });
    const { ticket } = await svc.login('kb', { name: 'Anna', pin: '1234' });
    expect((await svc.home('kb', ticket)).marker).toEqual({ linkId: 'l1', topicId: 't', moduleId: 'm1' });
    // Modul inzwischen nicht mehr bei den Schülern: kein Merker
    notebooks.rows[0].marker = { linkId: 'l1', topicId: 't', moduleId: 'weg' };
    expect((await svc.home('kb', ticket)).marker).toBeNull();
    expect((await svc.setMarker(user, 'c1', {})).marker).toBeNull();
  });
});

describe('Klassennotizbuch: Baum und klasseneigene Lernthemen', () => {
  const user = { userId: 't1' };
  const ready = () => {
    const ctx = setup();
    (ctx.svc as any).classes.ownedClass = async () => KLASSE;
    return ctx;
  };

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
