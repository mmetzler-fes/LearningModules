import { NextcloudService } from './nextcloud.service';

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
  const impl = async (url: string, init: any = {}) => {
    const method = init.method || 'GET';
    calls.push(`${method} ${url}`);
    const auth = String(init.headers?.Authorization || '');
    const token = auth ? Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString().split(':')[0] : '';
    const path = decodeURIComponent(url.replace(/^https:\/\/[^/]+/, '').split('?')[0]);
    const key = token + path;
    const res = (status: number, body: any = '', type = 'text/plain') => ({
      status, ok: status >= 200 && status < 300,
      headers: new Map([['content-type', type]]),
      text: async () => String(body), arrayBuffer: async () => Buffer.from(body), json: async () => JSON.parse(body),
    });
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
        + (folder ? '<d:resourcetype><d:collection/></d:resourcetype>' : '<d:resourcetype/><d:getcontenttype>image/png</d:getcontenttype>')
        + '</d:prop></d:propstat></d:response>').join('');
      return res(207, `<d:multistatus xmlns:d="DAV:">${xml}</d:multistatus>`);
    }
    if (method === 'MKCOL') return res(201);
    if (method === 'PUT') { files.set(key, Buffer.from(init.body)); return res(201); }
    if (method === 'DELETE') { files.delete(key); return res(204); }
    if (method === 'GET') {
      // Lesefreigabe: /s/<Kürzel>/download?path=/&files=<Datei> → im Bilder-Ordner der eigenen Freigabe
      const m = /\/s\/[^/]+\/download\?path=([^&]*)&files=(.*)$/.exec(url);
      const f = m ? files.get(`EigenTok/public.php/webdav/Bilder${decodeURIComponent(m[1]).replace(/\/$/, '')}/${decodeURIComponent(m[2])}`) : files.get(key);
      return f ? res(200, f, 'image/png') : res(404);
    }
    return res(405);
  };
  return { files, calls, impl };
}

/** Repositories im Speicher, mit LIKE-Suche über den JSON-Inhalt. */
function fakeRepo(rows: any[], field: string) {
  return {
    rows,
    createQueryBuilder: () => {
      let needle = '';
      const qb: any = {
        select: () => qb,
        where: (_c: string, p: any) => { needle = String(p.n).replace(/^%|%$/g, ''); return qb; },
        getMany: async () => rows.filter((r) => JSON.stringify(r[field]).includes(needle)),
      };
      return qb;
    },
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
  };
  const topics: any[] = [];
  const topicRepo: any = {
    findOne: async () => ({ id: 't1', title: 'Englisch Reisen' }),
    find: async ({ where }: any) => topics.filter((t) => where.id._value.includes(t.id)),
  };
  const moduleRepo: any = { ...fakeRepo([], 'content'), find: async () => [] };
  const configRepo: any = { findOne: async () => (cloudBackup ? { value: cloudBackup } : null) };
  const draftRepo: any = fakeRepo([], 'data');
  const masterKey: any = { sealSecret: (s: string) => `sealed:${s}`, unsealSecret: (s: string) => s.replace(/^sealed:/, '') };
  return { links, topics, moduleRepo, draftRepo, svc: new NextcloudService(linkRepo, topicRepo, moduleRepo, configRepo, draftRepo, masterKey) };
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

  it('prüft eine Lesefreigabe für Bilder und liefert dann direkte Links', async () => {
    const { svc } = setup(null);
    await svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw', readShareUrl: `${CLOUD}/s/LeseTok` }, APP);
    const up = await svc.uploadImage(user, 't1', png);
    expect(up.url).toBe(`${CLOUD}/s/LeseTok/download?path=%2FEnglisch%20Reisen&files=gate.png`);
  });

  it('lehnt dieselbe Freigabe als Lesefreigabe ab', async () => {
    const { svc } = setup(null);
    await expect(svc.connect(user, { shareUrl: `${CLOUD}/s/EigenTok`, password: 'pw', readShareUrl: `${CLOUD}/s/EigenTok` }, APP))
      .rejects.toThrow(/eigener Link/);
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
