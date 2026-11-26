import { pinGuard } from './pin';
import { WorkService, syncDecision } from './work.service';
import { issueTicket } from '../classes/student-ticket';
import { ExamService } from './exam.service';
import { repo } from './test-repo';

const LINK = { modes: ['quiz', 'exam'], id: 'l1', ownerId: 't1', name: 'Physik', active: true, classId: 'c1', singleAttempt: true };
const DOC = { id: 'd1', type: 'document', title: 'Blatt', content: { spec: { content: [{ type: 'quiz', module: 'q1' }] } } };

function setup(access: 'practice' | 'exam' = 'practice') {
  pinGuard.reset();
  const works = repo();
  const students = repo([{ id: 's1', classId: 'c1', firstName: 'Anna', lastName: 'B', pin: null, pinShownAt: null }]);
  const users = repo([{ id: 't1', active: true }]);
  const links: any = {
    linkOfToken: async (t: string) => (t === 'tok' ? { link: LINK, access } : null),
    resolveModules: async () => [{ topic: {}, modules: [DOC, { id: 'q1', type: 'multipleChoice' }] }],
  };
  const classes: any = { findById: async (id: string) => (id === 'c1' ? { id: 'c1', name: '10a' } : null) };
  const attempts = repo();
  const exams = new ExamService(attempts as any, links);
  const versions = repo();
  const svc = new WorkService(works as any, versions as any, students as any, users as any, links, classes, exams);
  return { svc, works, students, exams, attempts, versions };
}

const data = { v: 1, bg: 'paper', pages: [{ items: [] }], layer: { blocks: { b1: { items: [{ id: 'x' }] } } } };
const body = (extra: any = {}) => ({ linkToken: 'tok', studentTicket: issueTicket('l1', 's1', 'Anna B'), moduleId: 'd1', ...extra });

describe('Bearbeitungen der Schüler', () => {
  it('erstes Speichern zeigt die PIN – danach geht es nur mit ihr weiter', async () => {
    const { svc, students } = setup();
    expect(await svc.load(body())).toEqual({ data: null, rev: 0, teacher: null });
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

  it('Klassenarbeit: keine PIN; zweiter Start nur nach Freigabe, dann mit Blatt und Zwischenstand', async () => {
    const { svc, exams, attempts } = setup('exam');
    const start = Date.now();
    const ticket = issueTicket('l1', 's1', 'Anna B', start);
    const e1 = start + 12 * 3600 * 1000;
    await exams.begin(LINK as any, { id: 's1', name: 'Anna B' }, e1);
    const res = await svc.save(body({ studentTicket: ticket, data }));
    expect(res.pin).toBeUndefined();
    const progress = { steps: ['m1', 'm2'], index: 1, answers: [{ isCorrect: true }], embeddedAnswers: {} };
    await exams.saveProgress({ linkToken: 'tok', studentTicket: ticket, progress });

    // Browser zu, Link neu geöffnet: ohne Freigabe kein zweiter Start.
    const e2 = e1 + 60000;
    const later = issueTicket('l1', 's1', 'Anna B', start + 60000);
    await expect(exams.begin(LINK as any, { id: 's1', name: 'Anna B' }, e2)).rejects.toThrow(/schon begonnen/);
    await expect(svc.load(body({ studentTicket: later }))).rejects.toThrow(/Wiedereinstieg/);

    // Lehrkraft gibt frei: Fortsetzen mit Zwischenstand, die alte Anmeldung ist abgemeldet.
    await exams.setReentry({ userId: 't1' }, attempts.rows[0].id, true);
    expect(await exams.mayStartAgain(LINK as any, 's1')).toBe(true);
    const again = await exams.begin(LINK as any, { id: 's1', name: 'Anna B' }, e2);
    expect(again.progress).toMatchObject({ index: 1, steps: ['m1', 'm2'] });
    expect((await svc.load(body({ studentTicket: later }))).data).toEqual(data);
    await expect(svc.save(body({ studentTicket: ticket, data }))).rejects.toThrow(/anderen Gerät/);
    await expect(exams.submit(LINK as any, 's1', e1)).rejects.toThrow(/anderen Gerät/);

    // Abgabe: ersetzt die frühere, danach ist wieder zu.
    expect(await exams.submit(LINK as any, 's1', e2)).toEqual({ replaces: true });
    await expect(svc.save(body({ studentTicket: later, data }))).rejects.toThrow(/abgegeben/);
    await expect(exams.begin(LINK as any, { id: 's1', name: 'Anna B' }, e2 + 1)).rejects.toThrow(/schon abgegeben/);
  });

  it('Klassenarbeit ohne „nur ein Durchlauf“: ein neuer Start setzt einfach fort', async () => {
    const { exams } = setup('exam');
    const link = { ...LINK, singleAttempt: false } as any;
    await exams.begin(link, { id: 's1', name: 'Anna B' }, 1);
    await expect(exams.begin(link, { id: 's1', name: 'Anna B' }, 2)).resolves.toMatchObject({ reentry: true });
    expect(await exams.isOpen('l1', 's1', 2)).toBe(true);
    expect(await exams.isOpen('l1', 's1', 1)).toBe(false);
  });

  it('hält die Fassung des Blatts mit seinen Quizzen fest – einmal je Inhalt', async () => {
    const { svc, versions } = setup();
    const first = await svc.save(body({ data }));
    await svc.save(body({ data, pin: first.pin }));
    expect(versions.rows).toHaveLength(1);
    expect(versions.rows[0].embedded.map((m: any) => m.id)).toEqual(['q1']);
    const id = (await svc.list({ userId: 't1' }))[0].id;
    const full = await svc.getWithVersion({ userId: 't1' }, id);
    expect(full.version).toMatchObject({ title: 'Blatt', content: DOC.content });
  });

  it('die Lehrkraft sieht nur Bearbeitungen ihrer Links', async () => {
    const { svc } = setup();
    await svc.save(body({ data }));
    expect(await svc.list({ userId: 't1' })).toHaveLength(1);
    expect(await svc.list({ userId: 'fremd' })).toHaveLength(0);
    await expect(svc.get({ userId: 'fremd' }, (await svc.list({ userId: 't1' }))[0].id)).rejects.toThrow(/nicht gefunden/);
  });

  describe('Nachsenden ohne WLAN (docs/offline-sync.md)', () => {
    const at = (iso: string) => ({ ...data, updatedAt: iso });
    // Ohne PIN-Abfrage: Klassenarbeit (keine PIN) wäre umständlicher, also PIN durchreichen.
    async function saver() {
      const s = setup();
      const first = await s.svc.save(body({ data: at('2026-11-26T10:00:00Z'), sync: { device: 'A', seq: 1, base: 0 } }));
      const pin = first.pin;
      const save = (d: any, sync: any) => s.svc.save(body({ data: d, pin, sync }));
      return { ...s, save, pin };
    }

    it('ein überholter älterer Stand desselben Geräts wird verworfen', async () => {
      const { save, works } = await saver();
      await save(at('2026-11-26T10:05:00Z'), { device: 'A', seq: 3, base: 1 });
      const late = await save(at('2026-11-26T10:02:00Z'), { device: 'A', seq: 2, base: 1 });
      expect(late.stale).toBe(true);
      expect(works.rows[0].data.updatedAt).toBe('2026-11-26T10:05:00Z');
      expect(works.rows[0].previousData ?? null).toBeNull();
    });

    it('zählt die Revision hoch und merkt die Uhrzeit des Geräts', async () => {
      const { save, works } = await saver();
      const res = await save(at('2026-11-26T10:05:00Z'), { device: 'A', seq: 2, base: 1 });
      expect(res.rev).toBe(2);
      expect(works.rows[0].clientAt).toEqual(new Date('2026-11-26T10:05:00Z'));
    });

    it('zweites Gerät mit bekanntem Stand: einfach übernehmen', async () => {
      const { save, works } = await saver();
      const res = await save(at('2026-11-26T10:05:00Z'), { device: 'B', seq: 1, base: 1 });
      expect(res.conflict).toBeUndefined();
      expect(works.rows[0].previousData ?? null).toBeNull();
    });

    it('zwei Geräte unabhängig: der neuere gewinnt, der andere bleibt als zweite Fassung', async () => {
      const { save, works, svc } = await saver();
      await save(at('2026-11-26T10:10:00Z'), { device: 'A', seq: 2, base: 1 });
      // B hatte nur Stand 1 gesehen (oder offline gar keinen) und schreibt früher, kommt aber später an.
      const older = await save(at('2026-11-26T10:07:00Z'), { device: 'B', seq: 1, base: null });
      expect(older.superseded).toBe(true);
      expect(works.rows[0].data.updatedAt).toBe('2026-11-26T10:10:00Z');
      expect(works.rows[0].previousData.updatedAt).toBe('2026-11-26T10:07:00Z');
      // Später schreibt B etwas Neueres, immer noch ohne den Stand von A zu kennen.
      const newer = await save(at('2026-11-26T10:20:00Z'), { device: 'B', seq: 2, base: 1 });
      expect(newer.conflict).toBe(true);
      expect(works.rows[0].data.updatedAt).toBe('2026-11-26T10:20:00Z');
      expect(works.rows[0].previousData.updatedAt).toBe('2026-11-26T10:10:00Z');
      // Die Lehrkraft übernimmt die zweite Fassung – getauscht, nichts geht verloren.
      const id = works.rows[0].id;
      await svc.decidePrevious({ userId: 't1' }, id, 'take');
      expect(works.rows[0].data.updatedAt).toBe('2026-11-26T10:10:00Z');
      expect(works.rows[0].previousData.updatedAt).toBe('2026-11-26T10:20:00Z');
      await svc.decidePrevious({ userId: 't1' }, id, 'discard');
      expect(works.rows[0].previousData).toBeNull();
      await expect(svc.decidePrevious({ userId: 't1' }, id, 'discard')).rejects.toThrow(/keine zweite Fassung/);
    });

    it('alte Geräte ohne Angaben schreiben wie bisher', () => {
      expect(syncDecision({ data, syncDevice: 'A', syncSeq: 5, syncRev: 3 }, undefined, data)).toBe('write');
      expect(syncDecision(null, { device: 'A', seq: 1 }, data)).toBe('write');
    });
  });
});
