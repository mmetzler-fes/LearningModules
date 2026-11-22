import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GoodnotesService, heftDocuments } from './goodnotes.service';

const doc = (id: string, extra: any = {}) => ({
  id, type: 'document', title: `Blatt ${id}`, orderIndex: Number(id.replace(/\D/g, '')) || 0, moduleSelected: true, parentId: null,
  content: { spec: { content: [{ type: 'text', text: id }] } }, updatedAt: new Date('2026-11-10T10:00:00Z'), ...extra,
});

describe('heftDocuments', () => {
  it('nimmt Dokumente in Reihenfolge, ohne Klassenarbeit, Gesperrtes und Quizze', () => {
    const list = [
      doc('d2'), doc('d1'), doc('d3', { content: { kind: 'klassenarbeit', spec: { content: [] } } }),
      doc('d4', { moduleSelected: false }), { id: 'q1', type: 'multipleChoice', orderIndex: 0 },
    ] as any[];
    expect(heftDocuments(list).map((m) => m.id)).toEqual(['d1', 'd2']);
    expect(heftDocuments(list, new Set(['d2'])).map((m) => m.id)).toEqual(['d2']);
  });
});

describe('GoodnotesService', () => {
  let dir: string;
  let topic: any;
  let renders: number;
  let svc: GoodnotesService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-'));
    renders = 0;
    topic = { id: 't1', ownerId: 'u1', title: 'Variablen', updatedAt: new Date('2026-11-01T00:00:00Z'), modules: [doc('d1'), doc('d2')] };
    const worksheets: any = {
      renderSheets: jest.fn(async (_u: any, list: any[], output: string, opts: any) => {
        renders++;
        expect(opts.karoPage).toBe(true);
        expect(opts.quizzes).toBe('print');
        return { file: Buffer.from(`%PDF ${output} ${list.map((m: any) => m.id).join(',')}`), warnings: [] };
      }),
      quickTokenFor: jest.fn(async () => 'qt_1'),
    };
    const numbering: any = { numberingFor: async () => ({ docs: new Map(), refs: new Map() }) };
    const topicRepo: any = { findOne: async () => topic };
    const nodeRepo: any = { find: async () => [] };
    svc = new GoodnotesService(worksheets, numbering, topicRepo, nodeRepo);
    (svc as any).dir = dir;
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('rendert nur einmal, solange sich nichts ändert; Stand im Namen', async () => {
    const a = await svc.heft('u1', 't1');
    expect(a.cached).toBe(false);
    expect(a.name).toBe('Variablen (Stand 2026-11-10).pdf');
    const b = await svc.heft('u1', 't1');
    expect(b.cached).toBe(true);
    expect(b.file.equals(a.file)).toBe(true);
    expect(renders).toBe(1);
  });

  it('gleichzeitige Anfragen warten auf dasselbe Rendern', async () => {
    await Promise.all([svc.heft('u1', 't1'), svc.heft('u1', 't1'), svc.heft('u1', 't1')]);
    expect(renders).toBe(1);
  });

  it('rendert neu nach einer Änderung; Lösungsheft getrennt', async () => {
    await svc.heft('u1', 't1');
    topic.modules[0] = doc('d1', { title: 'Neu', updatedAt: new Date('2026-11-14T08:00:00Z') });
    const c = await svc.heft('u1', 't1');
    expect(c.cached).toBe(false);
    expect(c.stand).toBe('2026-11-14');
    const s = await svc.heft('u1', 't1', { solution: true });
    expect(s.name).toBe('Variablen – Lösung (Stand 2026-11-14).pdf');
    expect(s.file.toString()).toContain('loesung_pdf');
    expect(renders).toBe(3);
  });

  it('Schülerweg: nur die freigegebenen Dokumente, eigener Zwischenspeicher', async () => {
    const h = await svc.heft('u1', 't1', { allowed: new Set(['d2']) });
    expect(h.file.toString()).toContain('pdf d2');
    expect(h.file.toString()).not.toContain('d1');
  });

  it('über einen Klassenlink: Quiz-Adressen ins Klassennotizbuch, eigener Zwischenspeicher', async () => {
    const anon = await svc.heft('u1', 't1');
    const quizLink = 'https://lm.test/?k=kb1&cl=L-1&mod=';
    const cls = await svc.heft('u1', 't1', { quizLink });
    expect(cls.cached).toBe(false);
    expect(anon.cached).toBe(false);
    const calls = ((svc as any).worksheets.renderSheets as jest.Mock).mock.calls;
    expect(calls[0][3].quizLink).toBeUndefined();
    expect(calls[1][3].quizLink).toBe(quizLink);
  });

  it('fremdes Lernthema wird abgelehnt', async () => {
    await expect(svc.heft('u2', 't1')).rejects.toThrow('gehört dir nicht');
  });

  it('feste Adresse des Schülerhefts über den Quick-Link, sonst keine', async () => {
    const l = await svc.studentLink('u1', 't1', 'https://lm.test');
    expect(l.url).toBe('https://lm.test/api/public/goodnotes/qt_1/t1');
    await expect(svc.studentLink('u2', 't1', 'https://lm.test')).rejects.toThrow('gehört dir nicht');
    ((svc as any).worksheets.quickTokenFor as jest.Mock).mockResolvedValueOnce(null);
    expect(await svc.studentLink('u1', 't1', 'https://lm.test')).toEqual({ url: null, qr: null });
  });
});

describe('GoodNotes-Heft eines Abschnitts', () => {
  it('alle Dokumente darunter in der Reihenfolge des Notizbuchs (Unterordner zuerst), fremde Lernthemen nicht, Link-Auswahl gilt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-'));
    const lists: string[][] = [];
    const worksheets: any = { renderSheets: async (_u: any, list: any[]) => { lists.push(list.map((m: any) => m.id)); return { file: Buffer.from('%PDF'), warnings: [] }; } };
    const numbering: any = { numberingFor: async () => ({ docs: new Map(), refs: new Map() }) };
    const topics: any[] = [
      { id: 'a', ownerId: 'u1', title: 'A', updatedAt: new Date(0), modules: [doc('d1')] },
      { id: 'b', ownerId: 'u1', title: 'B', updatedAt: new Date(0), modules: [doc('d2'), { id: 'q', type: 'multipleChoice', orderIndex: 1 }] },
      { id: 'c', ownerId: 'u1', title: 'C', updatedAt: new Date(0), modules: [doc('d3')] },
    ];
    const topicRepo: any = { find: async ({ where }: any) => topics.filter((t) => where.id._value.includes(t.id) && t.ownerId === where.ownerId) };
    const nodeRepo: any = { find: async () => [
      { id: 'S', ownerId: 'u1', kind: 'area', title: 'Gleichstrommotor', parentId: null, orderIndex: 0 },
      { id: 'K', ownerId: 'u1', kind: 'section', title: 'PWM', parentId: 'S', orderIndex: 0 },
    ] };
    const placeRepo: any = { find: async ({ where }: any) => ({
      S: [{ topicId: 'c', orderIndex: 0 }, { topicId: 'fremd', orderIndex: 1 }],
      K: [{ topicId: 'b', orderIndex: 1 }, { topicId: 'a', orderIndex: 0 }],
    } as any)[where.nodeId] || [] };
    const svc = new GoodnotesService(worksheets, numbering, topicRepo, nodeRepo, undefined, undefined, placeRepo);
    (svc as any).dir = dir;
    const h = await svc.heftForNode('u1', 'S');
    expect(h.name).toMatch(/^Gleichstrommotor \(Stand/);
    expect(lists[0]).toEqual(['d1', 'd2', 'd3']);
    await svc.heftForNode('u1', 'S', { allowed: new Set(['d2']) });
    expect(lists[1]).toEqual(['d2']);
    await expect(svc.heftForNode('u1', 'X')).rejects.toThrow(/nicht gefunden/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
