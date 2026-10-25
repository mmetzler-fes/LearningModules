import { NextcloudService, OWNER_FILE, SERVER_SCOPE, attachmentFileName, dataImageSizes } from './nextcloud.service';
import { SchoolNextcloudService } from './school-nextcloud.service';

const CLOUD = 'https://93.184.216.34'; // öffentliche Adresse – keine DNS-Abfrage nötig
const APP = 'https://lm.schule.de';
const USER_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

/**
 * Simulierte Nextcloud: Dateien je Freigabe (Kürzel aus der Anmeldung) und
 * WebDAV-Pfad – Schlüssel "<Kürzel><Pfad>". Zeichnet Anfragen auf.
 */
function fakeNextcloud() {
  const files = new Map<string, Buffer>();
  const calls: string[] = [];
  const alive = new Set(['LeseTok', 'NeuTok']); // offene Lesefreigaben, die es gibt
  const open = new Set<string>(); // Freigaben ohne Passwort – alle anderen wollen eins
  const impl = async (url: string, init: any = {}) => {
    const method = init.method || 'GET';
    calls.push(`${method} ${url}`);
    const auth = String(init.headers?.Authorization || '');
    const [token, password] = auth ? Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString().split(':') : ['', ''];
    const path = decodeURIComponent(url.replace(/^https:\/\/[^/]+/, '').split('?')[0]);
    const key = token + path;
    const res = (status: number, body: any = '', type = 'text/plain') => ({
      status, ok: status >= 200 && status < 300,
      headers: new Map([['content-type', type]]),
      text: async () => String(body), arrayBuffer: async () => Buffer.from(body), json: async () => JSON.parse(body),
    });
    if (auth && !password && !open.has(token)) return res(401);
    if (method === 'PROPFIND') {
      if (init.headers?.Depth !== '1') return res(path.endsWith('/') || files.has(key) ? 207 : 404, '<d:multistatus xmlns:d="DAV:"/>');
      // Tiefe 1: direkte Kinder – Dateien und Ordner, in denen Dateien liegen.
      const dir = key.replace(/\/$/, '') + '/';
      const kids = new Map<string, boolean>();
      for (const k of files.keys()) {
        if (!k.startsWith(dir)) continue;
        const [first, ...rest] = k.slice(dir.length).split('/');
        kids.set(first, kids.get(first) || rest.length > 0);
      }
      if (!kids.size && !path.endsWith('/')) return res(404);
      const href = (n: string) => encodeURI(path.replace(/\/$/, '') + '/' + n);
      const xml = [...kids].map(([n, folder]) => `<d:response><d:href>${href(n)}</d:href><d:propstat><d:prop>`
        + (folder ? '<d:resourcetype><d:collection/></d:resourcetype>'
          : `<d:resourcetype/><d:getcontenttype>image/png</d:getcontenttype><d:getcontentlength>${files.get(dir + n)?.length ?? 0}</d:getcontentlength>`)
        + '</d:prop></d:propstat></d:response>').join('');
      return res(207, `<d:multistatus xmlns:d="DAV:">${xml}</d:multistatus>`);
    }
    if (method === 'MKCOL') return res(201);
    if (method === 'PUT') { files.set(key, Buffer.from(init.body)); return res(201); }
    if (method === 'DELETE') { for (const k of [...files.keys()]) if (k === key || k.startsWith(key + '/')) files.delete(k); return res(204); }
    if (method === 'GET' && /\/s\/[^/?]+$/.test(url)) return res(alive.has(url.split('/s/')[1]) ? 200 : 404);
    if (method === 'GET') {
      // Lesefreigabe: /s/<Kürzel>/download?path=/&files=<Datei> → im Bilder-Ordner der eigenen Freigabe
      const m = /\/s\/[^/]+\/download\?path=([^&]*)&files=(.*)$/.exec(url);
      const f = m ? files.get(`EigenTok/public.php/webdav/Bilder${decodeURIComponent(m[1]).replace(/\/$/, '')}/${decodeURIComponent(m[2])}`) : files.get(key);
      return f ? res(200, f, 'image/png') : res(404);
    }
    return res(405);
  };
  return { files, calls, alive, open, impl };
}

/** Repositories im Speicher, mit LIKE-Suche über den JSON-Inhalt. */
function fakeRepo(rows: any[], field: string) {
  return {
    rows,
    createQueryBuilder: () => {
      let needles: string[] = [];
      let creator: string | undefined;
      const qb: any = {
        select: () => qb,
        innerJoin: () => qb,
        where: (_c: string, p: any) => {
          needles = Object.entries(p).filter(([k]) => k !== 'u').map(([, v]) => String(v).replace(/^%|%$/g, ''));
          creator = p.u;
          return qb;
        },
        // Kopien wie aus der Datenbank: Spätere Änderungen an den Zeilen sieht der Aufrufer nicht.
        getMany: async () => structuredClone(rows.filter((r) => needles.some((n) => JSON.stringify(r[field]).includes(n)) && (!creator || r.creatorId === creator))),
      };
      return qb;
    },
    findOne: async ({ where }: any) => rows.find((r) => r.id === where.id) || null,
    update: async ({ id }: any, patch: any) => Object.assign(rows.find((r) => r.id === id), patch),
  };
}

function setup(cloudBackup: any) {
  const links: any[] = [];
  const linkRepo: any = {
    findOne: async ({ where }: any) => links.find((l) => Object.entries(where).every(([k, v]) => l[k] === v)) || null,
    create: (x: any) => ({ ...x }),
    save: async (x: any) => { if (!links.includes(x)) links.push(x); x.createdAt = x.createdAt || new Date(); return x; },
    update: async ({ id }: any, patch: any) => Object.assign(links.find((l) => l.id === id), patch),
    find: async () => links,
  };
  const topics: any[] = [];
  const topicRepo: any = {
    findOne: async () => ({ id: 't1', title: 'Englisch Reisen' }),
    find: async ({ where }: any) => topics.filter((t) => where.id._value.includes(t.id)),
  };
  const moduleRepo: any = { ...fakeRepo([], 'content'), find: async () => [] };
  const config = new Map<string, any>(cloudBackup ? [['cloud_backup_config', cloudBackup]] : []);
  const configRepo: any = {
    findOne: async ({ where }: any) => (config.has(where.key) ? { value: config.get(where.key) } : null),
    create: (x: any) => x,
    save: async (x: any) => config.set(x.key, x.value),
  };
  const draftRepo: any = fakeRepo([], 'data');
  const masterKey: any = { sealSecret: (s: string) => `sealed:${s}`, unsealSecret: (s: string) => s.replace(/^sealed:/, '') };
  const users: any[] = [{ id: USER_ID, displayName: 'Max Muster', email: 'max@schule.de', schoolId: null }];
  const userRepo: any = { findOne: async ({ where }: any) => users.find((u) => u.id === where.id) || null };
  const schoolNc: any[] = [];
  const schoolNcRepo: any = {
    findOne: async ({ where }: any) => schoolNc.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) || null,
    create: (x: any) => ({ ...x }),
    save: async (x: any) => { if (!schoolNc.includes(x)) schoolNc.push(x); return x; },
    update: async ({ id }: any, patch: any) => Object.assign(schoolNc.find((r) => r.id === id), patch),
    find: async () => schoolNc,
  };
  const svc = new NextcloudService(linkRepo, topicRepo, moduleRepo, configRepo, draftRepo, masterKey, userRepo, schoolNcRepo);
  const school = new SchoolNextcloudService(schoolNcRepo, linkRepo, moduleRepo, draftRepo, userRepo, masterKey, svc);
  return { links, topics, moduleRepo, draftRepo, users, schoolNc, school, svc };
}

const png = { originalname: 'gate.png', mimetype: 'image/png', buffer: Buffer.from('PNGDATA'), size: 7 };
const user = { userId: USER_ID };
const schoolCfg = { url: `${CLOUD}/s/SchulTok`, passwordSealed: 'sealed:geheim', teacherImages: true };

describe('Nextcloud: Bilder nur in der Freigabe der Lehrkraft', () => {
  let cloud: ReturnType<typeof fakeNextcloud>;
  beforeEach(() => { cloud = fakeNextcloud(); jest.spyOn(global, 'fetch').mockImplementation(cloud.impl as any); });
  afterEach(() => jest.restoreAllMocks());

  it('nutzt den Ordner des Admin-Backups nicht mehr für neue Bilder', async () => {
    const { svc } = setup(schoolCfg);
    expect(await svc.status(user)).toMatchObject({ ready: false, mode: null, legacy: null });
    expect(await svc.isReady(USER_ID)).toBe(false);
    await expect(svc.uploadImage(user, 't1', png)).rejects.toThrow(/Keine Nextcloud verbunden/);
    expect(cloud.calls.some((c) => c.startsWith('PUT'))).toBe(false);
  });

  /** Lehrkraft mit Bildern im früheren Schulordner, wie vor der Umstellung angelegt. */
  function withLegacy() {
    const env = setup(schoolCfg);
    const id = 'f0f0f0f0-0000-4000-8000-00000000000a';
    env.links.push({ id, userId: USER_ID, serverFolder: 'Max Muster (a1b2c3d4)', appBase: APP, shareToken: null });
    const old = `/public.php/webdav/Bilder/Max Muster (a1b2c3d4)/Englisch Reisen`;
    cloud.files.set(`SchulTok${old}/gate.png`, Buffer.from('PNGDATA'));
    cloud.files.set(`SchulTok${old}/hund.png`, Buffer.from('HUND'));
    const oldUrl = (n: string) => `${APP}/api/nextcloud/school/${id}/Englisch%20Reisen/${n}`;
    env.moduleRepo.rows.push(
      { id: 'm1', content: { image: oldUrl('gate.png'), html: `<p><img src="${oldUrl('hund.png')}"></p>` } },
      { id: 'm2', content: { image: 'https://example.org/x.png' } },
    );
    env.draftRepo.rows.push({ id: 'd1', data: { content: { image: oldUrl('hund.png') } } });
    return { ...env, id, oldUrl };
  }

  it('liefert alte Bilder im Schulordner weiter aus – nur unter Bilder/', async () => {
    const { svc, id, oldUrl } = withLegacy();
    expect((await svc.readImageByUrl(oldUrl('gate.png')))?.data.toString()).toBe('PNGDATA');
    expect(await svc.readImage(id, '..', 'gate.png', true)).toBeNull();
    expect(await svc.readImage(id, 'Englisch Reisen', 'geheim.json', true)).toBeNull();
    expect(await svc.status(user)).toMatchObject({ ready: false, legacy: { pending: true } });
  });

  it('übernimmt alte Bilder beim Verbinden und stellt die Links um', async () => {
    const { svc, links, moduleRepo, draftRepo, id, oldUrl } = withLegacy();
    // Gleichnamiges, anderes Bild liegt schon in der eigenen Freigabe → -2
    cloud.files.set('EigenTok/public.php/webdav/Bilder/Englisch Reisen/hund.png', Buffer.from('ANDERER HUND'));
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    await svc.adoptSchoolImages(USER_ID); // läuft schon im Hintergrund – wartet hier nicht doppelt
    while ((await svc.status(user) as any).legacy.running) await new Promise((r) => setTimeout(r, 5));

    const own = '/public.php/webdav/Bilder/Englisch Reisen';
    expect(cloud.files.get(`EigenTok${own}/gate.png`)?.toString()).toBe('PNGDATA');
    expect(cloud.files.get(`EigenTok${own}/hund-2.png`)?.toString()).toBe('HUND');
    const newUrl = (n: string) => `${APP}/api/nextcloud/files/${id}/Englisch%20Reisen/${n}`;
    expect(moduleRepo.rows[0].content).toEqual({ image: newUrl('gate.png'), html: `<p><img src="${newUrl('hund-2.png')}"></p>` });
    expect(moduleRepo.rows[1].content).toEqual({ image: 'https://example.org/x.png' });
    expect(draftRepo.rows[0].data.content.image).toBe(newUrl('hund-2.png'));
    expect(links[0].legacyMovedAt).toBeInstanceOf(Date);
    expect(links[0].legacyResult).toMatchObject({ copied: 2, reused: 0, modules: 1, drafts: 1 });
    // Die alten Dateien und Links bleiben gültig.
    expect((await svc.readImageByUrl(oldUrl('gate.png')))?.data.toString()).toBe('PNGDATA');
    // Ein zweiter Lauf tut nichts mehr.
    await svc.adoptSchoolImages(USER_ID);
    expect(links[0].legacyResult.copied).toBe(2);
  });

  it('verwendet ein gleiches Bild in der eigenen Freigabe wieder', async () => {
    const { svc, links } = withLegacy();
    cloud.files.set('EigenTok/public.php/webdav/Bilder/Englisch Reisen/gate.png', Buffer.from('PNGDATA'));
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    while ((await svc.status(user) as any).legacy.running) await new Promise((r) => setTimeout(r, 5));
    expect(links[0].legacyResult).toMatchObject({ copied: 1, reused: 1 });
    expect(cloud.files.has('EigenTok/public.php/webdav/Bilder/Englisch Reisen/gate-2.png')).toBe(false);
  });
});

describe('Nextcloud: eigene Freigabe der Lehrkraft', () => {
  let cloud: ReturnType<typeof fakeNextcloud>;
  beforeEach(() => { cloud = fakeNextcloud(); jest.spyOn(global, 'fetch').mockImplementation(cloud.impl as any); });
  afterEach(() => jest.restoreAllMocks());

  it('verbindet mit Schreibprobe und lädt in Bilder/<Thema>', async () => {
    const { svc, links } = setup(schoolCfg);
    const res: any = await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    expect(res).toMatchObject({ mode: 'own', ready: true });
    expect(cloud.calls).toContain(`PUT ${CLOUD}/public.php/webdav/Bilder/lm-verbindungstest.txt`);
    expect(cloud.calls).toContain(`DELETE ${CLOUD}/public.php/webdav/Bilder/lm-verbindungstest.txt`);
    const up = await svc.uploadImage(user, 't1', png);
    expect(up.url).toBe(`${APP}/api/nextcloud/files/${links[0].id}/Englisch%20Reisen/gate.png`);
    expect(cloud.files.has('EigenTok/public.php/webdav/Bilder/Englisch Reisen/gate.png')).toBe(true);
  });

  it('nimmt nur Freigaben mit Passwort an', async () => {
    const { svc } = setup(null);
    await expect(svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok` }, APP)).rejects.toThrow(/Passwort der Freigabe angeben/);
    cloud.open.add('OffenTok');
    await expect(svc.connect(user, { shareUrl: `${CLOUD}/s/OffenTok`, password: 'egal' }, APP)).rejects.toThrow(/ohne Passwort öffnen/);
    // Dieselbe Freigabe erneut speichern: gespeichertes Passwort genügt.
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    await expect(svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok` }, APP)).resolves.toMatchObject({ mode: 'own', insecure: false });
  });
});

describe('Nextcloud: Anhänge (Modultyp „Anhang“)', () => {
  let cloud: ReturnType<typeof fakeNextcloud>;
  beforeEach(() => { cloud = fakeNextcloud(); jest.spyOn(global, 'fetch').mockImplementation(cloud.impl as any); });
  afterEach(() => jest.restoreAllMocks());
  const pdf = { originalname: 'Blatt 1.PDF', mimetype: 'application/octet-stream', buffer: Buffer.from('%PDF-1.4'), size: 8 };

  it('Dateiname: Endung klein, ohne Endung .bin', () => {
    expect(attachmentFileName('Blatt 1.PDF')).toBe('Blatt-1.pdf');
    expect(attachmentFileName('liesmich')).toBe('liesmich.bin');
    expect(attachmentFileName('.versteckt.txt')).toBe('versteckt.txt');
  });

  it('lädt neben die Bilder des Themas und liefert sie mit Typ nach Endung aus', async () => {
    const { svc, links } = setup(null);
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    const up = await svc.uploadAttachment(user, 't1', pdf);
    expect(up).toMatchObject({ name: 'Blatt-1.pdf', size: 8, type: 'application/pdf' });
    expect(up.url).toBe(`${APP}/api/nextcloud/files/${links[0].id}/Englisch%20Reisen/Blatt-1.pdf`);
    expect(cloud.files.has('EigenTok/public.php/webdav/Bilder/Englisch Reisen/Blatt-1.pdf')).toBe(true);
    const file = await svc.readImage(links[0].id, 'Englisch Reisen', 'Blatt-1.pdf');
    expect(file).toMatchObject({ type: 'application/pdf' });
    // Für Export und Arbeitsblätter bleibt es bei Bildern.
    expect(await svc.readImageByUrl(up.url)).toBeNull();
  });

  it('größer als 50 MB, .json und versteckte Dateien gehen nicht', async () => {
    const { svc, links } = setup(null);
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    await expect(svc.uploadAttachment(user, 't1', { ...pdf, size: 50 * 1024 * 1024 + 1 })).rejects.toThrow(/50 MB/);
    await expect(svc.uploadAttachment(user, 't1', { ...pdf, originalname: 'daten.json' })).rejects.toThrow(/\.json/);
    cloud.files.set('EigenTok/public.php/webdav/Bilder/Englisch Reisen/daten.json', Buffer.from('{}'));
    expect(await svc.readImage(links[0].id, 'Englisch Reisen', 'daten.json')).toBeNull();
    expect(await svc.readImage(links[0].id, 'Englisch Reisen', OWNER_FILE)).toBeNull();
  });
});

describe('Nextcloud: alte Links im ganzen Material umhängen', () => {
  let cloud: ReturnType<typeof fakeNextcloud>;
  beforeEach(() => { cloud = fakeNextcloud(); jest.spyOn(global, 'fetch').mockImplementation(cloud.impl as any); });
  afterEach(() => jest.restoreAllMocks());

  const ADMIN = 'a1b2c3d4-0000-4000-8000-0000000000ad';
  const ADMIN_LINK = 'f0f0f0f0-0000-4000-8000-0000000000ad';
  const school = (folder: string, file: string) => `SchulTok/public.php/webdav/Bilder/Admin (a1b2c3d4)/${folder}/${file}`;
  const oldUrl = (folder: string, file: string) => `${APP}/api/nextcloud/school/${ADMIN_LINK}/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;

  /** Admin hat Bilder im Schulordner hochgeladen; die Lehrkraft (USER_ID) besitzt das Thema. */
  async function scene() {
    const env = setup(schoolCfg);
    env.links.push({ id: ADMIN_LINK, userId: ADMIN, serverFolder: 'Admin (a1b2c3d4)', appBase: APP, shareToken: null });
    env.topics.push({ id: 'tq', ownerId: USER_ID });
    await env.svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    await env.svc.relinkAll();
    return env;
  }

  it('hängt Drag & Drop mit Klammern und Apostroph im Namen um – auch Bilder, die der Admin hochlud', async () => {
    cloud.files.set(school('Travel Quiz (A1-A2)', 'dog (1).png'), Buffer.from('DOG'));
    cloud.files.set(school('Travel Quiz (A1-A2)', "it's.png"), Buffer.from('ITS'));
    const env = await scene();
    env.moduleRepo.rows.push({
      id: 'dnd', topicId: 'tq', creatorId: ADMIN,
      content: {
        zones: [{ label: 'Hund', imageUrl: oldUrl('Travel Quiz (A1-A2)', 'dog (1).png') }],
        draggables: [{ text: 'x', imageUrl: oldUrl('Travel Quiz (A1-A2)', "it's.png") }],
        html: `<img src='${oldUrl('Travel Quiz (A1-A2)', 'dog (1).png')}'>`,
      },
    });
    const r = await env.svc.relinkAll();
    const me = env.links.find((l) => l.userId === USER_ID).id;
    const newUrl = (f: string) => `${APP}/api/nextcloud/files/${me}/${encodeURIComponent('Travel Quiz (A1-A2)')}/${encodeURIComponent(f)}`;
    expect(env.moduleRepo.rows[0].content).toEqual({
      zones: [{ label: 'Hund', imageUrl: newUrl('dog (1).png') }],
      draggables: [{ text: 'x', imageUrl: newUrl("it's.png") }],
      html: `<img src='${newUrl('dog (1).png')}'>`,
    });
    expect(cloud.files.get('EigenTok/public.php/webdav/Bilder/Travel Quiz (A1-A2)/dog (1).png')?.toString()).toBe('DOG');
    expect(r).toMatchObject({ modules: 1, copied: 2, missing: 0 });
    // Zweiter Lauf: nichts mehr zu tun.
    expect(await env.svc.relinkAll()).toMatchObject({ modules: 0, copied: 0 });
  });

  it('nutzt ein schon kopiertes Bild, auch wenn es beim Admin gelöscht ist', async () => {
    const env = await scene();
    cloud.files.set('EigenTok/public.php/webdav/Bilder/Reisen/gate.png', Buffer.from('PNG'));
    env.moduleRepo.rows.push({ id: 'm', topicId: 'tq', content: { image: oldUrl('Reisen', 'gate.png') } });
    expect(await env.svc.relinkAll()).toMatchObject({ modules: 1, reused: 1, missing: 0 });
    expect(env.moduleRepo.rows[0].content.image).toContain('/api/nextcloud/files/');
  });

  it('lässt Links stehen, solange die Lehrkraft keine Freigabe hat', async () => {
    const env = setup(schoolCfg);
    env.links.push({ id: ADMIN_LINK, userId: ADMIN, serverFolder: 'Admin (a1b2c3d4)', appBase: APP, shareToken: null });
    env.topics.push({ id: 'tq', ownerId: USER_ID });
    cloud.files.set(school('Reisen', 'gate.png'), Buffer.from('PNG'));
    env.moduleRepo.rows.push({ id: 'm', topicId: 'tq', content: { image: oldUrl('Reisen', 'gate.png') } });
    expect(await env.svc.relinkAll()).toMatchObject({ modules: 0, skipped: 1 });
    expect(env.moduleRepo.rows[0].content.image).toBe(oldUrl('Reisen', 'gate.png'));
  });
});

describe('Grenze für Bilder in der App', () => {
  let cloud: ReturnType<typeof fakeNextcloud>;
  beforeEach(() => { cloud = fakeNextcloud(); jest.spyOn(global, 'fetch').mockImplementation(cloud.impl as any); });
  afterEach(() => jest.restoreAllMocks());

  const img = (kb: number, seed = 'a') => `data:image/png;base64,${Buffer.alloc(kb * 1024, seed).toString('base64')}`;
  const mine = { id: 'm1', creatorId: USER_ID, topicOwnerId: USER_ID };

  it('zählt gleiche Bilder einmal', () => {
    const sizes = dataImageSizes([{ a: img(10) }, { b: [img(10), `<img src="${img(5, 'b')}">`] }]);
    expect(sizes.size).toBe(2);
    expect([...sizes.values()].sort((x, y) => x - y)).toEqual([5 * 1024, 10 * 1024]);
  });

  it('Standard: Hinweis ab 20 MB, Grenze 50 MB – der Admin stellt um', async () => {
    const { svc } = setup(null);
    expect(await svc.quotaSettings()).toEqual({ warnMb: 20, limitMb: 50 });
    await expect(svc.saveQuotaSettings({ warnMb: 60 })).rejects.toThrow(/vor der Grenze/);
    expect(await svc.saveQuotaSettings({ warnMb: 1, limitMb: 2 })).toEqual({ warnMb: 1, limitMb: 2 });
    expect(await svc.quotaSettings()).toEqual({ warnMb: 1, limitMb: 2 });
  });

  it('lehnt nur neu hinzugekommene Bilder über der Grenze ab', async () => {
    const { svc, moduleRepo } = setup(null);
    await svc.saveQuotaSettings({ warnMb: 1, limitMb: 2 });
    moduleRepo.rows.push({ id: 'alt', creatorId: USER_ID, content: { image: img(1500, 'x') } });
    expect(await svc.quota(user)).toMatchObject({ state: 'warn', usedBytes: 1500 * 1024 });
    // Neues Bild darüber hinaus → abgelehnt
    await expect(svc.assertAppImagesAllowed(user, mine, null, { image: img(600) })).rejects.toThrow(/Grenze von 2 MB/);
    // Ohne neues Bild geht Speichern immer
    await expect(svc.assertAppImagesAllowed(user, mine, { image: img(600) }, { image: img(600), text: 'neu' })).resolves.toBeUndefined();
    // Kleines Bild passt noch
    await expect(svc.assertAppImagesAllowed(user, mine, null, { image: img(100) })).resolves.toBeUndefined();
    // Gekauftes / fremdes Thema zählt nicht
    await expect(svc.assertAppImagesAllowed(user, { ...mine, topicOwnerId: 'jemand' }, null, { image: img(900) })).resolves.toBeUndefined();
    // Grenze 0 = keine
    await svc.saveQuotaSettings({ warnMb: 0, limitMb: 0 });
    await expect(svc.assertAppImagesAllowed(user, mine, null, { image: img(900) })).resolves.toBeUndefined();
  });

  it('mit Nextcloud gibt es keine Grenze', async () => {
    const { svc, moduleRepo } = setup(null);
    await svc.saveQuotaSettings({ warnMb: 1, limitMb: 1 });
    moduleRepo.rows.push({ id: 'alt', creatorId: USER_ID, content: { image: img(1500, 'x') } });
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    expect(await svc.quota(user)).toMatchObject({ state: 'nextcloud' });
    await expect(svc.assertAppImagesAllowed(user, mine, null, { image: img(900) })).resolves.toBeUndefined();
  });
});

describe('Lesefreigaben entfallen, Freigaben ohne Passwort werden gemeldet', () => {
  let cloud: ReturnType<typeof fakeNextcloud>;
  beforeEach(() => { cloud = fakeNextcloud(); jest.spyOn(global, 'fetch').mockImplementation(cloud.impl as any); });
  afterEach(() => jest.restoreAllMocks());

  const direct = (tok: string) => `${CLOUD}/s/${tok}/download?path=%2FEnglisch%20Reisen&files=gate%20(1).png`;

  it('direkte Links einer früheren Lesefreigabe laufen danach über den Server', async () => {
    const { svc, links, moduleRepo } = setup(null);
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    links[0].imageShareToken = 'LeseTok'; // wie aus einer früheren Fassung
    moduleRepo.rows.push({ id: 'm', content: { image: direct('LeseTok'), html: `<img src="${direct('LeseTok').replace('&', '&amp;')}">` } });
    expect(await svc.dropReadShares()).toBe(1);
    const proxy = `${APP}/api/nextcloud/files/${links[0].id}/Englisch%20Reisen/gate%20(1).png`;
    expect(moduleRepo.rows[0].content).toEqual({ image: proxy, html: `<img src="${proxy}">` });
    expect(links[0].imageShareToken).toBeNull();
    expect(await svc.status(user)).toMatchObject({ readShareLostAt: expect.any(Date) });
  });

  it('eine bestehende Freigabe ohne Passwort bleibt verbunden, wird aber gemeldet', async () => {
    const { svc, links } = setup(null);
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    cloud.open.add('EigenTok'); // später in der Nextcloud das Passwort entfernt
    await svc.checkProtection();
    expect(links[0].insecureAt).toBeInstanceOf(Date);
    expect(await svc.status(user)).toMatchObject({ mode: 'own', ready: true, insecure: true });
    cloud.open.delete('EigenTok');
    await svc.checkProtection();
    expect(await svc.status(user)).toMatchObject({ insecure: false });
  });
});

describe('Freigabe trennen und umziehen', () => {
  let cloud: ReturnType<typeof fakeNextcloud>;
  beforeEach(() => { cloud = fakeNextcloud(); jest.spyOn(global, 'fetch').mockImplementation(cloud.impl as any); });
  afterEach(() => jest.restoreAllMocks());

  /** Verbunden, zwei Bilder in der Freigabe, beide in einem Modul (eins im HTML). */
  async function connected() {
    const env = setup(null);
    await env.svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    const id = env.links[0].id;
    cloud.files.set('EigenTok/public.php/webdav/Bilder/Reisen/gate.png', Buffer.alloc(3000, 'g'));
    cloud.files.set('EigenTok/public.php/webdav/Bilder/Reisen/hund (1).png', Buffer.alloc(1000, 'h'));
    const url = (n: string) => `${APP}/api/nextcloud/files/${id}/Reisen/${encodeURIComponent(n)}`;
    env.topics.push({ id: 't1', title: 'Reisen', ownerId: USER_ID });
    env.moduleRepo.rows.push({ id: 'm', topicId: 't1', creatorId: USER_ID, content: { image: url('gate.png'), html: `<img src='${url('hund (1).png')}'>` } });
    return { ...env, id, url };
  }
  const png = (seed: string) => `data:image/png;base64,${Buffer.alloc(500, seed).toString('base64')}`;

  it('Überblick: Bilder, Größe, Themen, passt in die App', async () => {
    const { svc } = await connected();
    const u: any = await svc.usage(user);
    expect(u).toMatchObject({ count: 2, bytes: 4000, missing: 0, drafts: 0, fits: true, topics: [{ id: 't1', title: 'Reisen', mine: true }] });
    expect(u.images.map((i: any) => i.name).sort()).toEqual(['gate.png', 'hund (1).png']);
  });

  it('trennen nur ausdrücklich, solange Bilder in Modulen stecken', async () => {
    const { svc, links } = await connected();
    await expect(svc.disconnect(user)).rejects.toThrow(/zurückholen, umziehen/);
    await svc.disconnect(user, true);
    expect(links[0].shareToken).toBeNull();
  });

  it('zurückholen ersetzt die Links – strikt unter der Grenze', async () => {
    const { svc, moduleRepo } = await connected();
    await svc.saveQuotaSettings({ warnMb: 0, limitMb: 1 });
    const big = `data:image/png;base64,${Buffer.alloc(1100 * 1024, 'x').toString('base64')}`;
    await expect(svc.returnImages(user, [{ sub: 'Reisen', name: 'gate.png', dataUrl: big }])).rejects.toThrow(/über der Grenze/);
    expect(moduleRepo.rows[0].content.image).toContain('/api/nextcloud/files/');
    const r = await svc.returnImages(user, [
      { sub: 'Reisen', name: 'gate.png', dataUrl: png('g') },
      { sub: 'Reisen', name: 'hund (1).png', dataUrl: png('h') },
    ]);
    expect(r).toMatchObject({ modules: 1, images: 2 });
    expect(moduleRepo.rows[0].content).toEqual({ image: png('g'), html: `<img src='${png('h')}'>` });
    // Danach hängt nichts mehr dran – trennen geht ohne Nachfrage.
    await expect(svc.disconnect(user)).resolves.toMatchObject({ success: true });
  });

  it('eine andere Freigabe einfach eintragen geht nicht – dafür gibt es Umziehen', async () => {
    const { svc } = await connected();
    await expect(svc.connect(user, { shareUrl: `${CLOUD}/s/NeueTok`, password: 'x' }, APP)).rejects.toThrow(/Umziehen/);
  });

  it('andere Freigabe, nachdem die alte nicht mehr verbunden war: die Bilder kommen aus der alten mit', async () => {
    const { svc, links, url } = await connected();
    links[0].verifiedAt = null; // etwa nachdem der Ordner gelöscht war
    await svc.connect(user, { shareUrl: `${CLOUD}/s/AndereTok`, password: 'pw2' }, APP);
    expect(links[0].previousShares).toMatchObject([{ shareToken: 'EigenTok', passwordSealed: 'sealed:pw' }]);
    // Schon vor dem Kopieren liefert der Server aus der früheren Freigabe.
    expect((await svc.readImageByUrl(url('gate.png')))?.data.length).toBe(3000);
    await svc.followOwners();
    expect(cloud.files.get('AndereTok/public.php/webdav/Bilder/Reisen/gate.png')?.length).toBe(3000);
    expect(cloud.files.get('AndereTok/public.php/webdav/Bilder/Reisen/hund (1).png')?.length).toBe(1000);
    expect(links[0].imageCheck).toMatchObject({ count: 0 });
  });

  it('trennen und später eine andere verbinden: die Bilder kommen mit', async () => {
    const { svc, links } = await connected();
    await svc.disconnect(user, true);
    expect(links[0].previousShares).toHaveLength(1);
    await svc.connect(user, { shareUrl: `${CLOUD}/s/AndereTok`, password: 'pw2' }, APP);
    await svc.followOwners();
    expect(cloud.files.get('AndereTok/public.php/webdav/Bilder/Reisen/gate.png')?.length).toBe(3000);
  });

  it('meldet verlinkte Bilder, die nirgends mehr liegen', async () => {
    const { svc, links } = await connected();
    cloud.files.delete('EigenTok/public.php/webdav/Bilder/Reisen/gate.png');
    await svc.followOwners();
    expect(links[0].imageCheck).toMatchObject({ count: 1, missing: [{ sub: 'Reisen', name: 'gate.png' }] });
    expect(((await svc.status(user)) as any).imageCheck.count).toBe(1);
    // Wieder abgelegt – die Meldung verschwindet beim nächsten Lauf.
    cloud.files.set('EigenTok/public.php/webdav/Bilder/Reisen/gate.png', Buffer.alloc(3000, 'g'));
    await svc.followOwners();
    expect(links[0].imageCheck).toMatchObject({ count: 0 });
  });

  it('umziehen kopiert Bilder/ und schaltet erst danach um – Links bleiben gültig', async () => {
    const { svc, links, moduleRepo, url } = await connected();
    const res = await svc.startMove(user, { shareUrl: `${CLOUD}/s/NeueTok`, password: 'neu' }, APP);
    expect(res.success).toBe(true);
    await svc.waitForMove(USER_ID);
    expect(cloud.files.get('NeueTok/public.php/webdav/Bilder/Reisen/hund (1).png')?.length).toBe(1000);
    expect(links[0]).toMatchObject({ shareToken: 'NeueTok', passwordSealed: 'sealed:neu', moveResult: { copied: 2 } });
    expect(moduleRepo.rows[0].content.image).toBe(url('gate.png'));
    // Der Link liefert jetzt aus der neuen Freigabe.
    cloud.files.delete('EigenTok/public.php/webdav/Bilder/Reisen/gate.png');
    expect((await svc.readImageByUrl(url('gate.png')))?.data.length).toBe(3000);
  });
});

describe('Nextcloud der Schule', () => {
  let cloud: ReturnType<typeof fakeNextcloud>;
  beforeEach(() => { cloud = fakeNextcloud(); jest.spyOn(global, 'fetch').mockImplementation(cloud.impl as any); });
  afterEach(() => jest.restoreAllMocks());

  const FOLDER = 'Max Muster (a1b2c3d4)';
  const inSchool = (path: string) => `SchulNC/public.php/webdav/Bilder/${path}`;

  /** Max (USER_ID) an Schule s1, die Schule hat ihre Nextcloud verbunden. */
  async function scene() {
    const env = setup(null);
    env.users[0].schoolId = 's1';
    await env.school.connect('s1', { shareUrl: `${CLOUD}/s/SchulNC`, password: 'schule' }, APP);
    return { ...env, snc: env.schoolNc[0] };
  }
  const schUrl = (snc: any, folder: string, sub: string, name: string) =>
    `${APP}/api/nextcloud/sch/${snc.id}/${encodeURIComponent(folder)}/${encodeURIComponent(sub)}/${encodeURIComponent(name)}`;

  it('nur für Schuladmins', () => {
    const { school } = setup(null);
    expect(() => school.schoolOf({ userId: 'x', schoolId: 's1' })).toThrow(/Schuladmins/);
    expect(school.schoolOf({ userId: 'adm', isSchoolAdmin: true, schoolId: 's1' })).toBe('s1');
  });

  it('Lehrkräfte ohne eigene Freigabe legen Bilder in Bilder/<Lehrkraft>/<Thema>/ ab', async () => {
    const { svc, snc } = await scene();
    expect(await svc.status(user)).toMatchObject({ ready: true, mode: 'school', school: { available: true } });
    const up = await svc.uploadImage(user, 't1', png);
    expect(cloud.files.has(inSchool(`${FOLDER}/Englisch Reisen/gate.png`))).toBe(true);
    expect(up.url).toBe(schUrl(snc, FOLDER, 'Englisch Reisen', 'gate.png'));
    expect((await svc.readImageByUrl(up.url))?.data.toString()).toBe('PNGDATA');
    // Nichts außerhalb von Bilder/<Ordner>/
    expect(await svc.readSchoolImage(snc.id, '..', 'x', 'gate.png')).toBeNull();
  });

  it('eine eigene Freigabe geht vor – und die Bilder ziehen mit', async () => {
    const { svc, snc, moduleRepo, topics, links } = await scene();
    const up = await svc.uploadImage(user, 't1', png);
    topics.push({ id: 't1', ownerId: USER_ID });
    moduleRepo.rows.push({ id: 'm', topicId: 't1', creatorId: USER_ID, content: { image: up.url } });
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    await svc.followOwners();
    const own = `${APP}/api/nextcloud/files/${links[0].id}/Englisch%20Reisen/gate.png`;
    expect(moduleRepo.rows[0].content.image).toBe(own);
    expect(cloud.files.get('EigenTok/public.php/webdav/Bilder/Englisch Reisen/gate.png')?.toString()).toBe('PNGDATA');
    // Neue Bilder: in die eigene
    expect((await svc.uploadImage(user, 't1', { ...png, originalname: 'neu.png' })).url).toContain('/api/nextcloud/files/');
    expect(snc.id).toBeTruthy();
  });

  it('Kopie aus dem Shop: die Bilder wandern in den Ordner der neuen Eigentümerin', async () => {
    const { svc, snc, moduleRepo, topics, users } = await scene();
    const up = await svc.uploadImage(user, 't1', png);
    users.push({ id: 'b0b0b0b0-0000-4000-8000-000000000002', displayName: 'Bea', schoolId: 's1' });
    topics.push({ id: 'kopie', ownerId: users[1].id });
    moduleRepo.rows.push({ id: 'k', topicId: 'kopie', creatorId: USER_ID, content: { image: up.url } });
    const r = await svc.followOwners();
    expect(r).toMatchObject({ modules: 1, copied: 1 });
    expect(moduleRepo.rows[0].content.image).toBe(schUrl(snc, 'Bea (b0b0b0b0)', 'Englisch Reisen', 'gate.png'));
    expect(cloud.files.has(inSchool('Bea (b0b0b0b0)/Englisch Reisen/gate.png'))).toBe(true);
  });

  it('Schulwechsel: fester Schulordner, Mitnehmen sobald die neue Schule eine Nextcloud hat, erst danach aufräumen', async () => {
    const { svc, school, moduleRepo, topics, users, snc } = await scene();
    const up = await svc.uploadImage(user, 't1', png);
    topics.push({ id: 't1', ownerId: USER_ID });
    moduleRepo.rows.push({ id: 'm', topicId: 't1', creatorId: USER_ID, content: { image: up.url } });
    // Ordner-Übersicht: in Gebrauch – löschen geht nicht.
    expect((await school.folders('s1')).folders).toMatchObject([{ folder: FOLDER, teacher: 'Max Muster', atSchool: true, images: 1, references: 1 }]);
    await expect(school.removeFolder('s1', FOLDER)).rejects.toThrow(/noch in 1/);
    // Wechsel an eine Schule ohne Nextcloud: der Link bleibt und funktioniert.
    users[0].schoolId = 's2';
    await svc.followOwners();
    expect(moduleRepo.rows[0].content.image).toBe(up.url);
    expect((await school.folders('s1')).folders[0]).toMatchObject({ atSchool: false, references: 1 });
    // Die neue Schule verbindet ihre Nextcloud → Bilder ziehen mit.
    await school.connect('s2', { shareUrl: `${CLOUD}/s/NeueSchule`, password: 'x' }, APP);
    await svc.followOwners();
    expect(moduleRepo.rows[0].content.image).toContain('/api/nextcloud/sch/');
    expect(moduleRepo.rows[0].content.image).not.toContain(snc.id);
    expect(cloud.files.has(`NeueSchule/public.php/webdav/Bilder/${FOLDER}/Englisch Reisen/gate.png`)).toBe(true);
    // Jetzt kann die alte Schule aufräumen.
    expect((await school.folders('s1')).folders[0]).toMatchObject({ references: 0 });
    await school.removeFolder('s1', FOLDER);
    expect(cloud.files.has(inSchool(`${FOLDER}/Englisch Reisen/gate.png`))).toBe(false);
  });

  it('trennen nur ausdrücklich; umziehen kopiert und lässt die Links gleich', async () => {
    const { svc, school, moduleRepo, topics } = await scene();
    const up = await svc.uploadImage(user, 't1', png);
    topics.push({ id: 't1', ownerId: USER_ID });
    moduleRepo.rows.push({ id: 'm', topicId: 't1', creatorId: USER_ID, content: { image: up.url } });
    await expect(school.disconnect('s1')).rejects.toThrow(/trotzdem trennen/);
    await expect(school.connect('s1', { shareUrl: `${CLOUD}/s/Andere`, password: 'x' }, APP)).rejects.toThrow(/Umziehen/);
    await school.startMove('s1', { shareUrl: `${CLOUD}/s/Andere`, password: 'x' }, APP);
    await school.waitForMove('s1');
    expect(cloud.files.has(`Andere/public.php/webdav/Bilder/${FOLDER}/Englisch Reisen/gate.png`)).toBe(true);
    expect((await school.status('s1')).shareUrl).toBe(`${CLOUD}/s/Andere`);
    cloud.files.delete(inSchool(`${FOLDER}/Englisch Reisen/gate.png`));
    expect((await svc.readImageByUrl(up.url))?.data.toString()).toBe('PNGDATA');
    await school.disconnect('s1', true);
    expect(await svc.status(user)).toMatchObject({ ready: false, mode: null });
  });

  it('trotzdem trennen und eine andere verbinden: die Bilder kommen aus der früheren mit', async () => {
    const { svc, school, moduleRepo, topics } = await scene();
    const up = await svc.uploadImage(user, 't1', png);
    const second = await svc.uploadImage(user, 't1', { ...png, originalname: 'tor.png' });
    topics.push({ id: 't1', ownerId: USER_ID });
    moduleRepo.rows.push({ id: 'm', topicId: 't1', creatorId: USER_ID, content: { image: up.url, other: second.url } });
    await school.disconnect('s1', true);
    await school.connect('s1', { shareUrl: `${CLOUD}/s/Andere`, password: 'x' }, APP);
    // Gleich nach dem Wechsel liefert der Server aus der früheren Freigabe.
    expect((await svc.readImageByUrl(up.url))?.data.toString()).toBe('PNGDATA');
    // Eins liegt nirgends mehr: wird der Lehrkraft gemeldet.
    cloud.files.delete(inSchool(`${FOLDER}/Englisch Reisen/tor.png`));
    await svc.followOwners();
    expect(cloud.files.has(`Andere/public.php/webdav/Bilder/${FOLDER}/Englisch Reisen/gate.png`)).toBe(true);
    expect(moduleRepo.rows[0].content.image).toBe(up.url);
    expect(((await svc.status(user)) as any).imageCheck).toMatchObject({ count: 1, missing: [{ sub: 'Englisch Reisen', name: 'tor.png', path: `Bilder/${FOLDER}/Englisch Reisen/tor.png` }] });
  });

  it('Schuladmin als Lehrkraft: eigene Ablage nur in einem anderen Ordner als dem der Schule', async () => {
    const { svc, school } = await scene();
    await expect(svc.connect(user, { shareUrl: `${CLOUD}/s/SchulNC`, password: 'schule' }, APP)).rejects.toThrow(/eigenen Ordner/);
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    expect(await svc.status(user)).toMatchObject({ mode: 'own' });
    expect(JSON.parse(cloud.files.get(`EigenTok/public.php/webdav/${OWNER_FILE}`)!.toString())).toMatchObject({ kind: 'own' });
    expect(JSON.parse(cloud.files.get(`SchulNC/public.php/webdav/${OWNER_FILE}`)!.toString())).toMatchObject({ kind: 'school' });
    // Umgekehrt: die Schule nicht in den Ordner der Lehrkraft umziehen.
    await expect(school.startMove('s1', { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP)).rejects.toThrow(/eigenen Ordner/);
  });

  it('erkennt denselben Ordner hinter einem anderen Freigabelink', async () => {
    const { svc, school } = await scene();
    // Zweiter Link auf den Ordner der Schule: gleiche Kennungsdatei.
    cloud.files.set(`ZweitLink/public.php/webdav/${OWNER_FILE}`, cloud.files.get(`SchulNC/public.php/webdav/${OWNER_FILE}`)!);
    await expect(svc.connect(user, { shareUrl: `${CLOUD}/s/ZweitLink`, password: 'pw' }, APP)).rejects.toThrow(new RegExp(OWNER_FILE.replace('.', '\\.')));
    expect(await svc.status(user)).toMatchObject({ mode: 'school' });
    // Nutzt die Schule ihn nicht mehr, geht er.
    await school.disconnect('s1', true);
    await svc.connect(user, { shareUrl: `${CLOUD}/s/ZweitLink`, password: 'pw' }, APP);
    expect(JSON.parse(cloud.files.get(`ZweitLink/public.php/webdav/${OWNER_FILE}`)!.toString())).toMatchObject({ kind: 'own' });
  });

  it('aufräumen löscht nur Ordner von Lehrkräften', async () => {
    const { school } = await scene();
    cloud.files.set(inSchool('Englisch Reisen/gate.png'), Buffer.from('PNG'));
    expect((await school.folders('s1')).folders).toMatchObject([{ folder: 'Englisch Reisen', removable: false, references: 0 }]);
    await expect(school.removeFolder('s1', 'Englisch Reisen')).rejects.toThrow(/kein Ordner einer Lehrkraft/);
    expect(cloud.files.has(inSchool('Englisch Reisen/gate.png'))).toBe(true);
  });

  it('eigene Freigabe trennen: Bilder in die Nextcloud der Schule übernehmen', async () => {
    const { svc, moduleRepo, topics, snc } = await scene();
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    const up = await svc.uploadImage(user, 't1', png);
    topics.push({ id: 't1', ownerId: USER_ID });
    moduleRepo.rows.push({ id: 'm', topicId: 't1', creatorId: USER_ID, content: { image: up.url } });
    expect(await svc.usage(user)).toMatchObject({ count: 1, school: true });
    const r = await svc.handOverToSchool(user);
    expect(r).toMatchObject({ images: 1, missing: 0, modules: 1 });
    expect(moduleRepo.rows[0].content.image).toBe(schUrl(snc, FOLDER, 'Englisch Reisen', 'gate.png'));
    expect(await svc.status(user)).toMatchObject({ mode: 'school' });
  });
});

describe('Nextcloud des Servers', () => {
  let cloud: ReturnType<typeof fakeNextcloud>;
  beforeEach(() => { cloud = fakeNextcloud(); jest.spyOn(global, 'fetch').mockImplementation(cloud.impl as any); });
  afterEach(() => jest.restoreAllMocks());

  const FOLDER = 'Max Muster (a1b2c3d4)';

  /** Max (USER_ID) an Schule s1 ohne Nextcloud; der Admin hat die des Servers verbunden. */
  async function scene() {
    const env = setup(null);
    env.users[0].schoolId = 's1';
    await env.school.connect(SERVER_SCOPE, { shareUrl: `${CLOUD}/s/ServerNC`, password: 'srv' }, APP);
    return { ...env, server: env.schoolNc[0] };
  }

  it('nimmt die Bilder von Lehrkräften auf, deren Schule keine Nextcloud hat – auch ohne Schule', async () => {
    const { svc, users } = await scene();
    expect(await svc.status(user)).toMatchObject({ ready: true, mode: 'school', school: { available: true, server: true } });
    await svc.uploadImage(user, 't1', png);
    expect(cloud.files.has(`ServerNC/public.php/webdav/Bilder/${FOLDER}/Englisch Reisen/gate.png`)).toBe(true);
    users[0].schoolId = null;
    expect(await svc.status(user)).toMatchObject({ mode: 'school', school: { server: true } });
  });

  it('verbindet die Schule später ihre Nextcloud, ziehen die Bilder dorthin', async () => {
    const { svc, school, moduleRepo, topics, server } = await scene();
    const up = await svc.uploadImage(user, 't1', png);
    topics.push({ id: 't1', ownerId: USER_ID });
    moduleRepo.rows.push({ id: 'm', topicId: 't1', creatorId: USER_ID, content: { image: up.url } });
    expect((await school.folders(SERVER_SCOPE)).folders).toMatchObject([{ folder: FOLDER, atSchool: true, references: 1 }]);
    await school.connect('s1', { shareUrl: `${CLOUD}/s/SchulNC`, password: 'schule' }, APP);
    expect(await svc.status(user)).toMatchObject({ school: { server: false } });
    await svc.followOwners();
    expect(moduleRepo.rows[0].content.image).toContain('/api/nextcloud/sch/');
    expect(moduleRepo.rows[0].content.image).not.toContain(server.id);
    expect(cloud.files.has(`SchulNC/public.php/webdav/Bilder/${FOLDER}/Englisch Reisen/gate.png`)).toBe(true);
    // Beim Server ist der Ordner jetzt frei zum Aufräumen.
    expect((await school.folders(SERVER_SCOPE)).folders).toMatchObject([{ folder: FOLDER, atSchool: false, references: 0 }]);
  });

  it('Schule und Server brauchen verschiedene Ordner', async () => {
    const { school } = await scene();
    await expect(school.connect('s1', { shareUrl: `${CLOUD}/s/ServerNC`, password: 'srv' }, APP)).rejects.toThrow(/eigenen Ordner/);
    cloud.files.set(`Zweit/public.php/webdav/${OWNER_FILE}`, cloud.files.get(`ServerNC/public.php/webdav/${OWNER_FILE}`)!);
    await expect(school.connect('s1', { shareUrl: `${CLOUD}/s/Zweit`, password: 'x' }, APP)).rejects.toThrow(/eigenen Ordner/);
  });

  it('eigene Freigabe abgeben (etwa vor der Pensionierung): ohne Schul-Nextcloud an die des Servers', async () => {
    const { svc, moduleRepo, topics, server } = await scene();
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw' }, APP);
    const up = await svc.uploadImage(user, 't1', png);
    topics.push({ id: 't1', ownerId: USER_ID });
    moduleRepo.rows.push({ id: 'm', topicId: 't1', creatorId: USER_ID, content: { image: up.url } });
    expect(await svc.usage(user)).toMatchObject({ school: true, schoolServer: true });
    expect(await svc.handOverToSchool(user)).toMatchObject({ images: 1, missing: 0, modules: 1 });
    expect(moduleRepo.rows[0].content.image).toContain(`/api/nextcloud/sch/${server.id}/`);
  });
});

describe('Bilder aus der App automatisch auslagern', () => {
  let cloud: ReturnType<typeof fakeNextcloud>;
  beforeEach(() => { cloud = fakeNextcloud(); jest.spyOn(global, 'fetch').mockImplementation(cloud.impl as any); });
  afterEach(() => jest.restoreAllMocks());

  const img = (seed: string) => `data:image/png;base64,${Buffer.alloc(200, seed).toString('base64')}`;

  it('lagert in die Ablage der Themen-Eigentümerin aus – auch Gekauftes, gleiche Bilder einmal', async () => {
    const env = setup(null);
    env.users[0].schoolId = 's1';
    await env.school.connect('s1', { shareUrl: `${CLOUD}/s/SchulNC`, password: 'x' }, APP);
    env.topics.push({ id: 'tq', ownerId: USER_ID, title: 'Reisen' }, { id: 'fremd', ownerId: 'niemand', title: 'X' });
    env.moduleRepo.rows.push(
      // gekauft: Verfasserin ist jemand anderes
      { id: 'k', topicId: 'tq', creatorId: 'verkaeuferin', content: { image: img('a'), html: `<p><img src="${img('a')}"></p>` } },
      { id: 'e', topicId: 'tq', creatorId: USER_ID, content: { image: img('b') } },
      // Thema einer Lehrkraft ohne Ablage: bleibt
      { id: 'f', topicId: 'fremd', creatorId: 'niemand', content: { image: img('c') } },
    );
    const r = await env.svc.followOwners();
    expect(r).toMatchObject({ offloaded: 2 });
    const k = env.moduleRepo.rows[0].content;
    expect(k.image).toMatch(/\/api\/nextcloud\/sch\/.+\/Reisen\/bild-[0-9a-f]{12}\.png$/);
    expect(k.html).toBe(`<p><img src="${k.image}"></p>`);
    expect(env.moduleRepo.rows[1].content.image).toContain('/api/nextcloud/sch/');
    expect(env.moduleRepo.rows[2].content.image).toBe(img('c'));
    const stored = [...cloud.files.keys()].filter((key) => key.includes('/Reisen/bild-'));
    expect(stored).toHaveLength(2);
    expect((await env.svc.readImageByUrl(k.image))?.data.length).toBe(200);
    // Zweiter Lauf: nichts mehr zu tun.
    expect(await env.svc.followOwners()).toMatchObject({ offloaded: 0 });
  });

  it('überschreibt nicht, was die Lehrkraft während des Hochladens gespeichert hat', async () => {
    const env = setup(null);
    env.users[0].schoolId = 's1';
    await env.school.connect('s1', { shareUrl: `${CLOUD}/s/SchulNC`, password: 'x' }, APP);
    env.topics.push({ id: 'tq', ownerId: USER_ID, title: 'Reisen' });
    env.moduleRepo.rows.push({ id: 'e', topicId: 'tq', creatorId: USER_ID, content: { image: img('b'), extra: '' } });
    const neu = `${APP}/api/nextcloud/sch/x/Max/Reisen/bild-neu.png`;
    const impl = cloud.impl;
    jest.spyOn(global, 'fetch').mockImplementation((async (url: string, opts: any) => {
      // Die Lehrkraft speichert, während der Lauf das alte Bild hochlädt.
      if (opts?.method === 'PUT' && String(url).includes('/Reisen/bild-')) {
        env.moduleRepo.rows[0].content = { image: img('b'), extra: neu };
      }
      return impl(url, opts);
    }) as any);
    await env.svc.followOwners();
    const c = env.moduleRepo.rows[0].content;
    expect(c.extra).toBe(neu);
    expect(c.image).toContain('/api/nextcloud/sch/');
  });
});

describe('Nextcloud der Schule: nur mit Passwort', () => {
  let cloud: ReturnType<typeof fakeNextcloud>;
  beforeEach(() => { cloud = fakeNextcloud(); jest.spyOn(global, 'fetch').mockImplementation(cloud.impl as any); });
  afterEach(() => jest.restoreAllMocks());

  it('lehnt Freigaben ohne Passwort ab – beim Verbinden und beim Umziehen', async () => {
    const { school, svc, schoolNc } = setup(null);
    await expect(school.connect('s1', { shareUrl: `${CLOUD}/s/SchulNC` }, APP)).rejects.toThrow(/Passwort der Freigabe angeben/);
    cloud.open.add('Offen');
    await expect(school.connect('s1', { shareUrl: `${CLOUD}/s/Offen`, password: 'x' }, APP)).rejects.toThrow(/ohne Passwort öffnen/);
    await school.connect('s1', { shareUrl: `${CLOUD}/s/SchulNC`, password: 'x' }, APP);
    await expect(school.startMove('s1', { shareUrl: `${CLOUD}/s/Offen`, password: 'x' }, APP)).rejects.toThrow(/ohne Passwort öffnen/);
    cloud.open.add('SchulNC');
    await svc.checkProtection();
    expect(schoolNc[0].insecureAt).toBeInstanceOf(Date);
    expect(await school.status('s1')).toMatchObject({ verified: true, insecure: true });
  });
});
