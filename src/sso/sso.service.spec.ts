import * as crypto from 'crypto';
import { SsoService } from './sso.service';

/** Ablauf mit nachgebautem Microsoft: Discovery, Schlüssel, Code-Tausch. */
describe('SsoService – Anmeldung mit dem Schulkonto', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk: any = { ...(publicKey.export({ format: 'jwk' }) as any), kid: 'k1' };
  const ISS = 'https://login.microsoftonline.com/tid-1/v2.0';
  const sign = (payload: any) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
  };
  let claims: any;
  let lastTokenBody = '';
  const realFetch = global.fetch;

  beforeEach(() => {
    claims = null;
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      const u = String(url);
      const json = (v: any, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => v });
      if (u.includes('.well-known')) return json({ issuer: ISS, authorization_endpoint: 'https://login.example/authorize', token_endpoint: 'https://login.example/token', jwks_uri: 'https://login.example/keys' });
      if (u.endsWith('/keys')) return json({ keys: [jwk] });
      if (u.endsWith('/token')) { lastTokenBody = String(init?.body || ''); return json({ id_token: sign(claims) }); }
      return json({}, false);
    });
  });
  afterAll(() => { (global as any).fetch = realFetch; });

  function make() {
    const cfg: any = { id: 'c1', schoolId: 'sch1', provider: 'microsoft', tenant: 'schule.de', clientId: 'client-1', secretSealed: Buffer.from('geheim').toString('base64'), forTeachers: true, forStudents: true };
    const ssoRepo: any = { findOne: jest.fn(async () => cfg), find: jest.fn(async () => [cfg]), update: jest.fn(async () => undefined) };
    const masterKey: any = { decrypt: (b: Buffer) => b.toString(), encrypt: (_k: string, s: string) => Buffer.from(s) };
    const auth: any = { ssoLogin: jest.fn(async (email: string) => ({ token: 't', role: 'teacher', email })) };
    const classbook: any = {
      ssoContext: jest.fn(async () => ({ classId: 'k1', schoolId: 'sch1' })),
      ssoLogin: jest.fn(async (_t: string, who: any) => ({ ticket: 'tk', name: `${who.firstName} ${who.lastName}`, subject: who.subject })),
      ssoLoginClassId: jest.fn(async (classId: string, who: any) => ({ ticket: 'tk', deviceTicket: 'dev', classId, name: `${who.firstName} ${who.lastName}` })),
    };
    const links: any = { linkOfToken: jest.fn(async (t: string) => (t === 'LINK.k1' ? { link: { classId: 'k1', ownerId: 'lehrer' } } : t === 'anon' ? { link: { classId: null } } : null)) };
    const users: any = { findOne: async ({ where }: any) => (where?.id === 'lehrer' ? { id: 'lehrer', schoolId: 'sch1' } : null) };
    const svc = new SsoService(ssoRepo, { findOne: async () => ({ name: 'FES' }) } as any, users, masterKey, auth, classbook, links);
    return { svc, auth, classbook };
  }
  const stateOf = (url: string) => new URL(url).searchParams;

  it('Lehrkraft: start → callback → redeem liefert die Sitzung', async () => {
    const { svc, auth } = make();
    const go = stateOf(await svc.start({ purpose: 'teacher', school: 'sch1' }, 'https://lm.test'));
    expect(go.get('code_challenge_method')).toBe('S256');
    expect(go.get('redirect_uri')).toBe('https://lm.test/api/sso/callback');
    claims = { iss: ISS, aud: 'client-1', sub: 's1', oid: 'o1', exp: Math.floor(Date.now() / 1000) + 300, nonce: go.get('nonce'), preferred_username: 'M.Muster@Schule.de' };
    const back = await svc.callback({ code: 'abc', state: go.get('state')! }, 'https://lm.test', 'PC');
    expect(back).toMatch(/^https:\/\/lm\.test\/\?sso=/);
    expect(lastTokenBody).toContain('code_verifier=');
    expect(auth.ssoLogin).toHaveBeenCalledWith('m.muster@schule.de', 'sch1', { device: 'PC' });
    const res = svc.redeem(new URL(back).searchParams.get('sso')!);
    expect(res).toMatchObject({ token: 't', purpose: 'teacher' });
    expect(() => svc.redeem(new URL(back).searchParams.get('sso')!)).toThrow(/abgelaufen/);
  });

  it('Schüler: Klassenbuch bleibt in der Adresse, Name und feste Kennung gehen an die Klassenliste', async () => {
    const { svc, classbook } = make();
    const go = stateOf(await svc.start({ purpose: 'student', k: 'tok' }, 'https://lm.test'));
    claims = { iss: ISS, aud: 'client-1', sub: 's2', oid: 'o2', exp: Math.floor(Date.now() / 1000) + 300, nonce: go.get('nonce'), name: 'Apfel, Anna' };
    const back = await svc.callback({ code: 'abc', state: go.get('state')! }, 'https://lm.test', '');
    expect(new URL(back).searchParams.get('k')).toBe('tok');
    expect(classbook.ssoLogin).toHaveBeenCalledWith('tok', { subject: `${ISS}|o2`, firstName: 'Anna', lastName: 'Apfel' });
  });

  it('Schüler über Klassenlink: Knopf nur bei Klassenlinks, Rückkehr mit ?l=, Ausweis für die Klasse', async () => {
    const { svc, classbook } = make();
    expect(await svc.linkOption('LINK.k1')).toMatchObject({ enabled: true });
    expect(await svc.linkOption('anon')).toMatchObject({ enabled: false });
    const go = stateOf(await svc.start({ purpose: 'student', l: 'LINK.k1' } as any, 'https://lm.test'));
    claims = { iss: ISS, aud: 'client-1', sub: 's3', oid: 'o3', exp: Math.floor(Date.now() / 1000) + 300, nonce: go.get('nonce'), given_name: 'Ben', family_name: 'Berg' };
    const back = new URL(await svc.callback({ code: 'abc', state: go.get('state')! }, 'https://lm.test', ''));
    expect(back.searchParams.get('l')).toBe('LINK.k1');
    expect(classbook.ssoLoginClassId).toHaveBeenCalledWith('k1', { subject: `${ISS}|o3`, firstName: 'Ben', lastName: 'Berg' });
    expect(svc.redeem(back.searchParams.get('sso')!)).toMatchObject({ deviceTicket: 'dev', classId: 'k1' });
  });

  it('falsche nonce, unbekannter state und Abbruch landen als Meldung in der App', async () => {
    const { svc } = make();
    const go = stateOf(await svc.start({ purpose: 'teacher', school: 'sch1' }, 'https://lm.test'));
    claims = { iss: ISS, aud: 'client-1', sub: 's1', exp: Math.floor(Date.now() / 1000) + 300, nonce: 'falsch', email: 'a@b.de' };
    expect(await svc.callback({ code: 'x', state: go.get('state')! }, 'https://lm.test', '')).toContain('ssoError=');
    expect(await svc.callback({ code: 'x', state: 'unbekannt' }, 'https://lm.test', '')).toContain('ssoError=');
    const go2 = stateOf(await svc.start({ purpose: 'teacher', school: 'sch1' }, 'https://lm.test'));
    expect(decodeURIComponent(await svc.callback({ error: 'access_denied', state: go2.get('state')! }, 'https://lm.test', ''))).toContain('abgebrochen');
  });
});
