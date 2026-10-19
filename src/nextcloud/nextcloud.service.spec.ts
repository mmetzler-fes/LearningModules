import { NextcloudService } from './nextcloud.service';

const CLOUD = 'https://93.184.216.34'; // öffentliche Adresse – keine DNS-Abfrage nötig
const APP = 'https://lm.schule.de';
const USER_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

/** Simulierte Nextcloud: Dateien je WebDAV-Pfad, zeichnet Anfragen auf. */
function fakeNextcloud() {
  const files = new Map<string, Buffer>();
  const calls: string[] = [];
  const impl = async (url: string, init: any = {}) => {
    const method = init.method || 'GET';
    calls.push(`${method} ${url}`);
    const path = decodeURIComponent(url.replace(/^https:\/\/[^/]+/, '').split('?')[0]);
    const res = (status: number, body: any = '', type = 'text/plain') => ({
      status, ok: status >= 200 && status < 300,
      headers: new Map([['content-type', type]]),
      text: async () => String(body), arrayBuffer: async () => Buffer.from(body), json: async () => JSON.parse(body),
    });
    if (method === 'PROPFIND') return res(path.endsWith('/') || ![...files.keys()].every((k) => k !== path) ? 207 : 404, '<d:multistatus xmlns:d="DAV:"/>');
    if (method === 'MKCOL') return res(201);
    if (method === 'PUT') { files.set(path, Buffer.from(init.body)); return res(201); }
    if (method === 'DELETE') { files.delete(path); return res(204); }
    if (method === 'GET') {
      // Lesefreigabe: /s/<Kürzel>/download?path=/&files=<Datei> → im Bilder-Ordner
      const m = /\/s\/[^/]+\/download\?path=([^&]*)&files=(.*)$/.exec(url);
      const key = m ? `/public.php/webdav/Bilder${decodeURIComponent(m[1]).replace(/\/$/, '')}/${decodeURIComponent(m[2])}` : path;
      const f = files.get(key);
      return f ? res(200, f, 'image/png') : res(404);
    }
    return res(405);
  };
  return { files, calls, impl };
}

/** Repositories im Speicher. */
function setup(cloudBackup: any) {
  const links: any[] = [];
  const linkRepo: any = {
    findOne: async ({ where }: any) => links.find((l) => Object.entries(where).every(([k, v]) => l[k] === v)) || null,
    create: (x: any) => ({ ...x }),
    save: async (x: any) => { if (!links.includes(x)) links.push(x); x.createdAt = x.createdAt || new Date(); return x; },
  };
  const topicRepo: any = { findOne: async () => ({ id: 't1', title: 'Englisch Reisen' }) };
  const configRepo: any = { findOne: async () => (cloudBackup ? { value: cloudBackup } : null) };
  const userRepo: any = { findOne: async () => ({ id: USER_ID, displayName: 'Max Muster', email: 'max@schule.de' }) };
  const masterKey: any = { sealSecret: (s: string) => `sealed:${s}`, unsealSecret: (s: string) => s.replace(/^sealed:/, '') };
  return { links, svc: new NextcloudService(linkRepo, topicRepo, {} as any, configRepo, userRepo, masterKey) };
}

const png = { originalname: 'gate.png', mimetype: 'image/png', buffer: Buffer.from('PNGDATA'), size: 7 };
const user = { userId: USER_ID };

describe('Nextcloud: Ordner der Schule (Freigabe des Admin-Backups)', () => {
  let cloud: ReturnType<typeof fakeNextcloud>;
  beforeEach(() => { cloud = fakeNextcloud(); jest.spyOn(global, 'fetch').mockImplementation(cloud.impl as any); });
  afterEach(() => jest.restoreAllMocks());

  const schoolCfg = { url: `${CLOUD}/s/SchulTok`, passwordSealed: 'sealed:geheim', teacherImages: true };

  it('ist ohne eigene Einrichtung bereit', async () => {
    const { svc } = setup(schoolCfg);
    expect(await svc.status(user)).toMatchObject({ ready: true, mode: 'school', school: { available: true } });
    const { svc: off } = setup({ ...schoolCfg, teacherImages: false });
    expect(await off.status(user)).toMatchObject({ ready: false, mode: null });
  });

  it('lädt nach Bilder/<Lehrkraft>/<Thema> hoch und liefert über den Server aus', async () => {
    const { svc, links } = setup(schoolCfg);
    const res = await svc.uploadImage(user, 't1', png, APP);
    const folder = 'Max Muster (a1b2c3d4)';
    expect([...cloud.files.keys()]).toEqual([`/public.php/webdav/Bilder/${folder}/Englisch Reisen/gate.png`]);
    expect(res.url).toBe(`${APP}/api/nextcloud/school/${links[0].id}/Englisch%20Reisen/gate.png`);
    // Anmeldung mit dem Kürzel der Schul-Freigabe und ihrem Passwort
    expect(cloud.calls.some((c) => c.startsWith('PUT'))).toBe(true);
    const img = await svc.readImageByUrl(res.url);
    expect(img?.data.toString()).toBe('PNGDATA');
    // Nichts außerhalb von Bilder/ und keine Tricks im Pfad
    expect(await svc.readImage(links[0].id, '..', 'gate.png', true)).toBeNull();
    expect(await svc.readImage(links[0].id, 'Englisch Reisen', 'geheim.json', true)).toBeNull();
  });
});

describe('Nextcloud: eigene Freigabe der Lehrkraft', () => {
  let cloud: ReturnType<typeof fakeNextcloud>;
  beforeEach(() => { cloud = fakeNextcloud(); jest.spyOn(global, 'fetch').mockImplementation(cloud.impl as any); });
  afterEach(() => jest.restoreAllMocks());

  it('verbindet mit Schreibprobe und hat Vorrang vor dem Schulordner', async () => {
    const { svc, links } = setup({ url: `${CLOUD}/s/SchulTok`, passwordSealed: 'sealed:x', teacherImages: true });
    const res: any = await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    expect(res).toMatchObject({ mode: 'own', ready: true });
    expect(cloud.calls).toContain(`PUT ${CLOUD}/public.php/webdav/Bilder/lm-verbindungstest.txt`);
    expect(cloud.calls).toContain(`DELETE ${CLOUD}/public.php/webdav/Bilder/lm-verbindungstest.txt`);
    const up = await svc.uploadImage(user, 't1', png, APP);
    expect(up.url).toBe(`${APP}/api/nextcloud/files/${links[0].id}/Englisch%20Reisen/gate.png`);
    expect(cloud.files.has('/public.php/webdav/Bilder/Englisch Reisen/gate.png')).toBe(true);
  });

  it('prüft eine Lesefreigabe für Bilder und liefert dann direkte Links', async () => {
    const { svc } = setup(null);
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw', readShareUrl: `${CLOUD}/s/LeseTok` }, APP);
    const up = await svc.uploadImage(user, 't1', png, APP);
    expect(up.url).toBe(`${CLOUD}/s/LeseTok/download?path=%2FEnglisch%20Reisen&files=gate.png`);
  });

  it('lehnt dieselbe Freigabe als Lesefreigabe ab', async () => {
    const { svc } = setup(null);
    await expect(svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw', readShareUrl: `${CLOUD}/s/EigenTok` }, APP))
      .rejects.toThrow(/eigener Link/);
  });
});
