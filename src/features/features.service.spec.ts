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
    expect(config.features).toEqual({ worksheets: 'selected' });
  });
});
