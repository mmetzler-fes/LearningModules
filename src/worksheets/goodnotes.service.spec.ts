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

  it('fremdes Lernthema wird abgelehnt', async () => {
    await expect(svc.heft('u2', 't1')).rejects.toThrow('gehört dir nicht');
  });
});
