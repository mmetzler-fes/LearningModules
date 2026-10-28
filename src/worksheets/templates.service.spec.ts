import { ForbiddenException } from '@nestjs/common';
import { TemplatesService, templateKindOf } from './templates.service';

/** Sehr kleine Repository-Attrappe: where als Objekt oder Liste von Objekten. */
function repo<T extends { id: string }>(rows: T[]) {
  const match = (r: any, w: any) => Object.entries(w).every(([k, v]) => (v && typeof v === 'object' && '_value' in (v as any) ? (v as any)._value.includes(r[k]) : r[k] === v));
  return {
    rows,
    find: async ({ where }: any = {}) => rows.filter((r) => !where || (Array.isArray(where) ? where.some((w) => match(r, w)) : match(r, where))),
    findOne: async ({ where }: any) => rows.find((r) => (Array.isArray(where) ? where.some((w) => match(r, w)) : match(r, where))) || null,
    save: async (x: any) => { for (const r of Array.isArray(x) ? x : [x]) { const i = rows.findIndex((y) => y.id === r.id); if (i >= 0) rows[i] = r; else rows.push(r); } return x; },
    remove: async (x: any) => { rows.splice(rows.findIndex((y) => y.id === x.id), 1); return x; },
    create: (x: any) => x,
  };
}

function setup() {
  const users = repo([
    { id: 'u1', schoolId: 's1', isSchoolAdmin: false, role: 'teacher' },
    { id: 'admin', schoolId: 's1', isSchoolAdmin: true, role: 'teacher' },
    { id: 'u2', schoolId: 's2', isSchoolAdmin: false, role: 'teacher' },
  ]);
  const tpl = (id: string, o: any) => ({ id, name: id, kind: 'arbeitsblatt', data: id, size: 1, isDefault: false, ownerId: null, schoolId: null, updatedAt: new Date(0), ...o });
  const templates = repo([
    tpl('eigen', { ownerId: 'u1' }),
    tpl('eigenStd', { ownerId: 'u1', isDefault: true }),
    tpl('schuleStd', { schoolId: 's1', isDefault: true }),
    tpl('schuleKA', { schoolId: 's1', kind: 'klassenarbeit', isDefault: true }),
    tpl('fremd', { ownerId: 'u2', isDefault: true }),
  ]);
  const nodes = [
    { id: 'book', ownerId: 'u1', parentId: null, docSettings: { templates: { arbeitsblatt: 'eigen' } } },
    { id: 'sec', ownerId: 'u1', parentId: 'book', docSettings: null },
    { id: 'frei', ownerId: 'u1', parentId: null, docSettings: { templates: { arbeitsblatt: 'fremd' } } },
  ];
  const renderer = { inspect: jest.fn().mockResolvedValue({ hasTitle: true, hasContent: false, placeholders: ['TITEL'], paragraphStyles: [] }) };
  const service = new TemplatesService(templates as any, users as any, repo(nodes as any) as any, renderer as any);
  return { service, templates, renderer };
}

describe('TemplatesService.resolve', () => {
  it('am Ordner gewählt, vererbt nach unten', async () => {
    const { service } = setup();
    expect((await service.resolve('u1', 'sec', 'arbeitsblatt'))!.id).toBe('eigen');
  });
  it('sonst eigener Standard, dann Schulstandard, dann Grundvorlage', async () => {
    const { service, templates } = setup();
    expect((await service.resolve('u1', null, 'arbeitsblatt'))!.id).toBe('eigenStd');
    expect((await service.resolve('u1', null, 'klassenarbeit'))!.id).toBe('schuleKA');
    templates.rows.splice(templates.rows.findIndex((t) => t.id === 'eigenStd'), 1);
    expect((await service.resolve('u1', null, 'arbeitsblatt'))!.id).toBe('schuleStd');
    expect(await service.resolve('u2', null, 'klassenarbeit')).toBeNull();
  });
  it('am Dokument gewählt geht vor dem Ordner – eigene oder der Schule, gleich welcher Art; fremde nicht', async () => {
    const { service } = setup();
    expect((await service.resolve('u1', 'sec', 'arbeitsblatt', undefined, 'schuleKA'))!.id).toBe('schuleKA');
    expect((await service.resolve('u1', 'sec', 'arbeitsblatt', undefined, 'fremd'))!.id).toBe('eigen');
    expect((await service.resolve('u1', 'sec', 'arbeitsblatt', undefined, null))!.id).toBe('eigen');
  });
  it('fremde Vorlagen am Ordner zählen nicht', async () => {
    const { service } = setup();
    expect((await service.resolve('u1', 'frei', 'arbeitsblatt'))!.id).toBe('eigenStd');
  });
  it('Art des Dokuments → Art der Vorlage', () => {
    expect(templateKindOf('klassenarbeit')).toBe('klassenarbeit');
    expect(templateKindOf('text')).toBe('arbeitsblatt');
  });
});

describe('TemplatesService: hochladen und Rechte', () => {
  it('prüft beim Hochladen und meldet fehlenden Inhalt-Platzhalter', async () => {
    const { service, renderer, templates } = setup();
    const res = await service.upload('u1', { name: 'Meine', kind: 'arbeitsblatt', scope: 'own', buffer: Buffer.from('ott') });
    expect(renderer.inspect).toHaveBeenCalledWith(Buffer.from('ott').toString('base64'));
    expect(res.warnings).toEqual([expect.stringContaining('{{INHALT}}')]);
    expect(templates.rows.find((t) => t.id === res.id)).toMatchObject({ ownerId: 'u1', schoolId: null, name: 'Meine' });
  });
  it('Schulvorlagen nur durch den Schuladmin', async () => {
    const { service } = setup();
    await expect(service.upload('u1', { kind: 'arbeitsblatt', scope: 'school', buffer: Buffer.from('x') })).rejects.toBeInstanceOf(ForbiddenException);
    const ok = await service.upload('admin', { kind: 'arbeitsblatt', scope: 'school', buffer: Buffer.from('x') });
    expect(ok.success).toBe(true);
    await expect(service.setDefault('u1', 'schuleStd', true)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('Standard ist je Bereich und Art eindeutig', async () => {
    const { service, templates } = setup();
    await service.setDefault('u1', 'eigen', true);
    expect(templates.rows.filter((t) => t.ownerId === 'u1' && t.isDefault).map((t) => t.id)).toEqual(['eigen']);
    expect(templates.rows.find((t) => t.id === 'schuleStd')!.isDefault).toBe(true);
  });
});
