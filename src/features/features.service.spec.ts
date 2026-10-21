import { FeaturesService } from './features.service';

/** Minimaler Ersatz für die beiden Repositories. */
function setup(mode?: string, users: Record<string, string[] | null> = {}) {
  const config: Record<string, any> = mode ? { features: { worksheets: mode } } : {};
  const configRepo = {
    findOne: async ({ where }: any) => (config[where.key] ? { key: where.key, value: config[where.key] } : null),
    save: async (row: any) => { config[row.key] = row.value; return row; },
  };
  const userRepo = {
    findOne: async ({ where }: any) => (where.id in users ? { id: where.id, features: users[where.id] } : null),
    save: async (u: any) => { users[u.id] = u.features; return u; },
  };
  return { service: new FeaturesService(userRepo as any, configRepo as any), config, users };
}

describe('FeaturesService', () => {
  const env = process.env.WORKSHEET_RENDERER_URL;
  beforeEach(() => { process.env.WORKSHEET_RENDERER_URL = 'http://renderer:8090'; });
  afterAll(() => { process.env.WORKSHEET_RENDERER_URL = env; });

  it('ist ohne Einstellung für niemanden an', async () => {
    const { service } = setup(undefined, { a: ['worksheets'] });
    expect(await service.has('a', 'worksheets')).toBe(false);
  });

  it('„ausgewählte“: nur Konten mit Häkchen', async () => {
    const { service } = setup('selected', { a: ['worksheets'], b: null });
    expect(await service.has('a', 'worksheets')).toBe(true);
    expect(await service.has('b', 'worksheets')).toBe(false);
  });

  it('„alle“: jedes Konto', async () => {
    const { service } = setup('all', { b: null });
    expect(await service.enabledFor({ features: null })).toEqual(['worksheets']);
  });

  it('ohne Renderer nie, auch bei „alle“', async () => {
    delete process.env.WORKSHEET_RENDERER_URL;
    const { service } = setup('all');
    expect(await service.enabledFor({ features: ['worksheets'] })).toEqual([]);
    expect((await service.overview()).features[0]).toMatchObject({ id: 'worksheets', mode: 'all', available: false });
  });

  it('Häkchen setzen und entfernen; unbekannte Funktionen und Modi werden abgelehnt', async () => {
    const { service, users } = setup('selected', { a: null });
    await service.setForUser('a', 'worksheets', true);
    expect(users.a).toEqual(['worksheets']);
    await service.setForUser('a', 'worksheets', false);
    expect(users.a).toBeNull();
    await expect(service.setForUser('a', 'zauberei', true)).rejects.toThrow('Unbekannte Funktion');
    await expect(service.setMode('worksheets', 'manchmal')).rejects.toThrow('Modus');
  });

  it('speichert den Modus', async () => {
    const { service, config } = setup();
    await service.setMode('worksheets', 'selected');
    expect(config.features).toEqual({ worksheets: 'selected', pdfImport: 'off' });
  });
});

describe('FeaturesService: Schuladmin', () => {
  beforeEach(() => { process.env.WORKSHEET_RENDERER_URL = 'http://renderer:8090'; });
  function school(mode: string) {
    const users: Record<string, any> = { t1: { id: 't1', schoolId: 's1', features: null }, t2: { id: 't2', schoolId: 's2', features: null } };
    const config: Record<string, any> = { features: { worksheets: mode } };
    const service = new FeaturesService(
      { findOne: async ({ where }: any) => users[where.id] || null, save: async (u: any) => { users[u.id] = u; return u; } } as any,
      { findOne: async ({ where }: any) => (config[where.key] ? { key: where.key, value: config[where.key] } : null), save: async () => undefined } as any,
    );
    return { service, users };
  }
  const admin = { userId: 'a', schoolId: 's1', isSchoolAdmin: true };

  it('schaltet Lehrkräfte der eigenen Schule frei, wenn der Hauptadmin „ausgewählte“ eingestellt hat', async () => {
    const { service, users } = school('selected');
    await service.setForSchoolTeacher(admin, 't1', 'worksheets', true);
    expect(users.t1.features).toEqual(['worksheets']);
    expect((await service.schoolOverview(admin)).features[0].mayEnable).toBe(true);
  });
  it('nicht für fremde Schulen, nicht ohne Schuladmin-Recht, nicht bei „aus“', async () => {
    await expect(school('selected').service.setForSchoolTeacher(admin, 't2', 'worksheets', true)).rejects.toThrow('eigenen Schule');
    await expect(school('selected').service.setForSchoolTeacher({ userId: 'x', schoolId: 's1', isSchoolAdmin: false }, 't1', 'worksheets', true)).rejects.toThrow('Schuladmins');
    await expect(school('off').service.setForSchoolTeacher(admin, 't1', 'worksheets', true)).rejects.toThrow('Hauptadmin');
  });
});
