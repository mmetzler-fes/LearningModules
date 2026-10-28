import { cleanLabel, deviceLabel } from './device-label';
import { REMEMBER_DAYS, SessionsService, sessionEnd } from './sessions.service';

describe('Anmeldungen je Gerät', () => {
  it('Gerätename aus dem User-Agent', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Windows · Edge');
    expect(deviceLabel('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('iPad · Safari');
    expect(deviceLabel('')).toBe('Gerät · Browser');
  });

  it('Name vom Browser: nur harmlose Zeichen, kurz', () => {
    expect(cleanLabel('iPad · Safari (App)')).toBe('iPad · Safari (App)');
    expect(cleanLabel('<script>x</script>')).toBe('scriptxscript');
    expect(cleanLabel('a'.repeat(200))).toHaveLength(80);
  });

  it('„Angemeldet bleiben“ 90 Tage, sonst 12 Stunden', () => {
    const now = new Date('2026-10-27T08:00:00Z');
    expect(sessionEnd(now, true).getTime() - now.getTime()).toBe(REMEMBER_DAYS * 24 * 3600 * 1000);
    expect(sessionEnd(now, false).toISOString()).toBe('2026-10-27T20:00:00.000Z');
  });

  it('beendete, fremde und abgelaufene Anmeldungen gelten nicht; Verlängern auch ohne Häkchen', async () => {
    const rows = new Map<string, any>();
    const repo: any = {
      create: (x: any) => ({ ...x, createdAt: new Date() }),
      save: async (x: any) => { rows.set(x.id, { ...x }); return x; },
      findOne: async ({ where }: any) => rows.get(where.id) || null,
      update: async ({ id }: any, patch: any) => { if (rows.has(id)) Object.assign(rows.get(id), patch); },
      delete: async (where: any) => {
        for (const [id, r] of rows) {
          if (where.id && typeof where.id === 'string' && id !== where.id) continue;
          if (where.userId && r.userId !== where.userId) continue;
          if (where.id && typeof where.id === 'object' && id === where.id._value) continue; // Not(keep)
          if (where.expiresAt && !(new Date(r.expiresAt) < where.expiresAt._value)) continue; // LessThan(now)
          rows.delete(id);
        }
      },
      find: async ({ where }: any) => [...rows.values()].filter((r) => r.userId === where.userId),
    };
    const svc = new SessionsService(repo);
    const a = await svc.open('u1', true, 'iPad · Safari');
    const b = await svc.open('u1', false, 'Windows · Edge');
    // Kurze Anmeldung: Verlängern schiebt das Ende auf 12 Stunden ab jetzt.
    rows.get(b.id).expiresAt = new Date(Date.now() + 60 * 1000);
    const extended = await svc.extend(b.id, 'u1');
    expect(new Date(extended!.expiresAt).getTime()).toBeGreaterThan(Date.now() + 11.9 * 3600 * 1000);
    expect(await svc.valid(a.id, 'u1')).toBeTruthy();
    expect(await svc.valid(a.id, 'u2')).toBeNull();
    rows.get(b.id).expiresAt = new Date(Date.now() - 1000);
    expect(await svc.valid(b.id, 'u1')).toBeNull();
    expect(await svc.extend(b.id, 'u1')).toBeNull();
    await svc.endAll('u1', a.id);
    expect(await svc.valid(a.id, 'u1')).toBeTruthy();
    await svc.end('u1', a.id);
    expect(await svc.valid(a.id, 'u1')).toBeNull();
  });
});
