import { PublicController, isExamDocument } from './public.controller';

/** Klassenarbeiten gibt es für Schüler nie als PDF oder Heft – auch nicht während sie freigeschaltet ist. */
describe('Klassenarbeit: kein Download', () => {
  const exam = { id: 'ka', topicId: 't', type: 'document', title: 'KA', content: { kind: 'klassenarbeit', spec: { content: [] } } };
  const sheet = { id: 'ab', topicId: 't', type: 'document', title: 'AB', content: { kind: 'arbeitsblatt', spec: { content: [] } } };
  const setup = (access: 'exam' | 'practice', modules: any[]) => {
    const c: any = Object.create(PublicController.prototype);
    c.findAccessByToken = async () => ({ link: { id: 'l', modes: ['exam', 'quiz'], selection: [] }, access });
    c.linksService = { resolveModules: async () => [{ topic: { id: 't' }, modules }] };
    c.moduleRepo = { findOne: async ({ where }: any) => modules.find((m) => m.id === where.id) || null };
    c.topicRepo = { findOne: async () => ({ id: 't', ownerId: 'o' }) };
    c.features = { has: async () => true };
    c.worksheets = { render: async () => ({ file: Buffer.from('pdf') }) };
    return c;
  };
  const res: any = { setHeader: () => {}, send: jest.fn() };

  it('erkennt Dokumente der Art „Klassenarbeit“', () => {
    expect(isExamDocument(exam)).toBe(true);
    expect(isExamDocument(sheet)).toBe(false);
    expect(isExamDocument({ type: 'document', content: JSON.stringify({ kind: 'klassenarbeit' }) })).toBe(true);
  });

  it('über den Link der Klassenarbeit: kein PDF, kein Stift-PDF, kein Heft', async () => {
    const c = setup('exam', [exam]);
    await expect(c.documentPdf('ka', { linkToken: 'x' }, res)).rejects.toThrow(/nicht herunterladen/);
    await expect(c.documentInkPdf('ka', { linkToken: 'x' }, {}, res)).rejects.toThrow(/nicht herunterladen/);
    await expect(c.topicGoodnotes('ka', { linkToken: 'x' }, {}, res)).rejects.toThrow(/nicht herunterladen/);
    await expect(c.goodnotesByLink('x', 't', {}, res)).rejects.toThrow(/nicht herunterladen/);
  });

  it('zur Besprechung freigegeben (Übungslink): Klassenarbeit nicht, Arbeitsblatt schon', async () => {
    const c = setup('practice', [exam, sheet]);
    await expect(c.documentPdf('ka', { linkToken: 'x' }, res)).rejects.toThrow(/nicht herunterladen/);
    await c.documentPdf('ab', { linkToken: 'x' }, res);
    expect(res.send).toHaveBeenCalled();
  });
});
