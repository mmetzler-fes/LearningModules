import { FeedbackService, shortName } from './feedback.service';
import { AiBridgeController } from '../ai-bridge/ai-bridge.controller';
import { repo } from '../work/test-repo';

describe('FeedbackService', () => {
  const make = () => {
    const rows = repo([]);
    const users = repo([{ id: 'a1', role: 'admin', displayName: 'Admin', email: 'a@x' }, { id: 't1', role: 'teacher', displayName: 'Frau M', email: 'm@x' }]);
    return { svc: new FeedbackService(rows as any, users as any), rows };
  };
  const png = 'data:image/png;base64,iVBORw0KGgo=';

  it('jeder meldet (Schüler ohne Konto, Lehrkraft); nur der Admin liest, ordnet, löscht', async () => {
    const { svc, rows } = make();
    await svc.create({ text: 'Scrollen springt', reporter: 'Anna Berger', className: 'TG12', image: png, context: { view: 'x' } }, null, '1.2.3.4');
    await svc.create({ text: 'Farbe fehlt' }, { userId: 't1' }, '1.2.3.5');
    expect(rows.rows.map((r: any) => r.reporter)).toEqual(['TG12 · Anna B. (Schüler)', 'Frau M. (Lehrkraft)']);
    await expect(svc.list({ userId: 't1', role: 'teacher' })).rejects.toThrow(/Admins/);
    const id = rows.rows[1].id;
    await svc.update({ role: 'admin' }, id, { priority: 3 });
    const list = await svc.list({ role: 'admin' });
    expect(list[0]).toMatchObject({ id, priority: 3 });
    expect(list[1]).toMatchObject({ hasImage: true });
    expect((list[1] as any).image).toBeUndefined();
    expect((await svc.image({ role: 'admin' }, rows.rows[0].id)).type).toBe('image/png');
    await svc.remove({ role: 'admin' }, id);
    expect(rows.rows).toHaveLength(1);
  });

  it('lehnt leere Meldungen, fremde Bildformate und zu viele Meldungen ab', async () => {
    const { svc } = make();
    await expect(svc.create({ text: '  ' }, null, 'ip')).rejects.toThrow(/beschreiben/);
    await expect(svc.create({ text: 'x', image: 'data:text/html;base64,PGI+' }, null, 'ip')).rejects.toThrow(/Bild/);
    for (let i = 0; i < 30; i++) await svc.create({ text: `m${i}` }, null, 'flood');
    await expect(svc.create({ text: 'zu viel' }, null, 'flood')).rejects.toThrow(/Zu viele/);
  });

  it('speichert nur Vorname und ersten Buchstaben des Nachnamens', async () => {
    expect(shortName('Max Mustermann')).toBe('Max M.');
    expect(shortName('Mustermann, Max')).toBe('Max M.');
    expect(shortName('Anna Lena von Berg')).toBe('Anna B.');
    expect(shortName('Max M.')).toBe('Max M.');
    expect(shortName('Lea')).toBe('Lea');
    expect(shortName('🧪 Test Martin')).toBe('🧪 Test M.');
    expect(shortName('max.mustermann@schule.de')).toBe('max M.');
    const rows = repo([{ id: 'f1', reporter: 'TG12 · Anna Berger (Schüler)' }, { id: 'f2', reporter: 'Martin Metzler (Admin)' }, { id: 'f3', reporter: 'Gast' }]);
    await new FeedbackService(rows as any, repo([]) as any).onModuleInit();
    expect(rows.rows.map((r: any) => r.reporter)).toEqual(['TG12 · Anna B. (Schüler)', 'Martin M. (Admin)', 'Gast']);
  });

  it('KI-Token eines Admins liest und ordnet Feedback, andere nicht', async () => {
    const { svc, rows } = make();
    await svc.create({ text: 'Fehler' }, null, 'ip');
    const bridge = { authenticateToken: async (t: string) => ({ userId: t.endsWith('lma_admin') ? 'a1' : 't1' }) };
    const ctl = new AiBridgeController(bridge as any, svc);
    const req = (t: string) => ({ headers: { authorization: `Bearer ${t}` } }) as any;
    expect(await ctl.feedbackList(req('lma_admin'))).toHaveLength(1);
    await expect(ctl.feedbackList(req('lma_teacher'))).rejects.toThrow(/Admins/);
    await ctl.feedbackUpdate(req('lma_admin'), rows.rows[0].id, { status: 'done', priority: 2 });
    expect(rows.rows[0]).toMatchObject({ status: 'done', priority: 2 });
  });
});
