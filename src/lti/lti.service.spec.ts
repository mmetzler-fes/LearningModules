import * as crypto from 'crypto';
import { LtiService, scoresUrl, signJwt } from './lti.service';
import { decodeJwt } from '../sso/oidc';
import { repo } from '../work/test-repo';

/** LTI 1.3 mit nachgebautem Moodle: Login, Start (Schüler, Lehrkraft, Deep Linking), Noten. */
describe('LtiService', () => {
  const platformKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platformJwk: any = { ...(platformKey.publicKey.export({ format: 'jwk' }) as any), kid: 'm1' };
  const ISS = 'https://moodle.test';
  const CL = 'https://purl.imsglobal.org/spec/lti/claim/';
  let fetched: Array<{ url: string; init: any }> = [];
  const realFetch = global.fetch;

  beforeEach(() => {
    fetched = [];
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      fetched.push({ url: String(url), init });
      const json = (v: any, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => v });
      if (String(url).endsWith('/certs.php')) return json({ keys: [platformJwk] });
      if (String(url).endsWith('/token.php')) return json({ access_token: 'at1', expires_in: 3600 });
      if (String(url).includes('/scores')) return json({});
      return json({}, false);
    });
  });
  afterAll(() => { (global as any).fetch = realFetch; });

  function make() {
    const platforms = repo([{ id: 'p1', schoolId: 'sch1', name: 'Moodle', issuer: ISS, clientId: 'cid', deploymentIds: ['1'], authLoginUrl: `${ISS}/mod/lti/auth.php`, tokenUrl: `${ISS}/mod/lti/token.php`, jwksUrl: `${ISS}/mod/lti/certs.php`, active: true }]);
    const courses = repo([]);
    const grades = repo([]);
    const config = repo([]);
    const links = repo([{ id: 'link1', classId: 'k1', ownerId: 't1' }]);
    const topics = repo([{ id: 'top1', title: 'Ohmsches Gesetz' }]);
    const results = repo([]);
    const users = repo([{ id: 't1', schoolId: 'sch1', isSchoolAdmin: true }]);
    const masterKey: any = { encrypt: (_k: string, s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
    const auth: any = { ssoLogin: jest.fn(async (email: string) => ({ token: 'tok', role: 'teacher', id: 't1', email })) };
    const classbook: any = { ltiStudent: jest.fn(async (classId: string, who: any) => ({ deviceTicket: 'dev', studentId: 's1', classId, name: `${who.firstName} ${who.lastName}` })) };
    const classes: any = { create: jest.fn(async (_u: any, b: any) => ({ id: 'kNeu', name: b.name })), ownedClass: jest.fn(async (id: string) => ({ id })) };
    const linksService: any = { share: jest.fn(async () => ({ url: 'https://lm.test/?l=TOKEN1' })), classLinkForTopic: jest.fn(async () => ({ id: 'link1' })) };
    const svc = new LtiService(platforms as any, courses as any, grades as any, config as any, links as any, topics as any, results as any, users as any, masterKey, auth, classbook, classes, linksService);
    return { svc, platforms, courses, grades, results, auth, classbook, classes, linksService };
  }

  const idToken = (nonce: string, extra: any) => signJwt({
    iss: ISS, aud: 'cid', sub: 'u42', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, nonce,
    [CL + 'deployment_id']: '1', [CL + 'version']: '1.3.0', given_name: 'Anna', family_name: 'Apfel', email: 'lehrer@schule.de',
    [CL + 'context']: { id: 'c7', title: 'Elektrotechnik 10a' }, ...extra,
  }, platformKey.privateKey, 'm1');

  async function start(svc: LtiService) {
    const go = new URL(await svc.login({ iss: ISS, login_hint: 'x', client_id: 'cid', lti_message_hint: 'h' }, 'https://lm.test'));
    expect(go.searchParams.get('response_mode')).toBe('form_post');
    expect(go.searchParams.get('redirect_uri')).toBe('https://lm.test/api/lti/launch');
    return { state: go.searchParams.get('state')!, nonce: go.searchParams.get('nonce')! };
  }

  it('Schüler: Start aus Moodle → Klassenlink ohne Name und PIN, Bewertungsaspekt gemerkt', async () => {
    const { svc, classbook, grades } = make();
    const { state, nonce } = await start(svc);
    const tok = idToken(nonce, {
      [CL + 'message_type']: 'LtiResourceLinkRequest', [CL + 'roles']: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
      [CL + 'custom']: { lm_link: 'link1', lm_class: 'k1' },
      'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint': { lineitem: `${ISS}/mod/lti/services.php/2/lineitems/5/lineitem?type_id=1`, scope: ['https://purl.imsglobal.org/spec/lti-ags/scope/score'] },
    });
    const back = new URL(await svc.launch({ id_token: tok, state }, 'https://lm.test'));
    expect(back.searchParams.get('l')).toBe('TOKEN1');
    expect(classbook.ltiStudent).toHaveBeenCalledWith('k1', { subject: `${ISS}|u42`, firstName: 'Anna', lastName: 'Apfel' });
    expect(grades.rows[0]).toMatchObject({ linkId: 'link1', studentId: 's1', userSub: 'u42' });
    const r = svc.redeem(back.searchParams.get('lti')!);
    expect(r).toMatchObject({ kind: 'student', deviceTicket: 'dev', classId: 'k1' });
  });

  it('Noten: bestes Ergebnis geht einmal an Moodle, ein schlechteres nicht', async () => {
    const { svc, grades, results } = make();
    grades.rows.push({ id: 'g1', platformId: 'p1', lineitem: `${ISS}/li/5/lineitem?type_id=1`, linkId: 'link1', classId: 'k1', studentId: 's1', userSub: 'u42', sentPercent: null });
    results.rows.push({ id: 'r1', linkId: 'link1', studentId: 's1', score: 3, maxScore: 4, payload: { percentage: 75 } });
    await svc.sendGrade({ id: 'r1', linkId: 'link1', studentId: 's1' });
    const score = fetched.find((f) => f.url.includes('/scores'))!;
    expect(score.url).toBe(`${ISS}/li/5/lineitem/scores?type_id=1`);
    expect(JSON.parse(score.init.body)).toMatchObject({ userId: 'u42', scoreGiven: 75, scoreMaximum: 100 });
    const assertion = new URLSearchParams(fetched.find((f) => f.url.endsWith('/token.php'))!.init.body).get('client_assertion')!;
    expect(decodeJwt(assertion).payload).toMatchObject({ iss: 'cid', sub: 'cid', aud: `${ISS}/mod/lti/token.php` });
    expect(grades.rows[0].sentPercent).toBe(75);
    results.rows.push({ id: 'r2', linkId: 'link1', studentId: 's1', score: 1, maxScore: 4, payload: { percentage: 25 } });
    fetched = [];
    await svc.sendGrade({ id: 'r2', linkId: 'link1', studentId: 's1' });
    expect(fetched.some((f) => f.url.includes('/scores'))).toBe(false);
  });

  it('Deep Linking: Lehrkraft wählt Lernthema, neue Klasse; Antwort ist von LearningModules signiert', async () => {
    const { svc, courses, classes } = make();
    const { state, nonce } = await start(svc);
    const tok = idToken(nonce, {
      [CL + 'message_type']: 'LtiDeepLinkingRequest', [CL + 'roles']: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
      'https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings': { deep_link_return_url: `${ISS}/mod/lti/contentitem_return.php`, data: 'abc' },
    });
    const back = new URL(await svc.launch({ id_token: tok, state }, 'https://lm.test'));
    const code = back.searchParams.get('lti')!;
    expect(svc.redeem(code)).toMatchObject({ kind: 'deep', deep: { contextTitle: 'Elektrotechnik 10a' } });
    const out = await svc.deepLinkComplete({ userId: 't1' }, { code, topicId: 'top1', classMode: 'new' }, 'https://lm.test');
    expect(classes.create).toHaveBeenCalledWith({ userId: 't1' }, { name: 'Elektrotechnik 10a' });
    expect(courses.rows[0]).toMatchObject({ contextId: 'c7', classId: 'kNeu' });
    const { header, payload, signingInput, signature } = decodeJwt(out.jwt);
    const jwks = await svc.jwks();
    const pub = crypto.createPublicKey({ key: jwks.keys[0], format: 'jwk' });
    expect(crypto.verify('RSA-SHA256', Buffer.from(signingInput), pub, signature)).toBe(true);
    expect(header.kid).toBe(jwks.keys[0].kid);
    expect(payload).toMatchObject({ iss: 'cid', aud: ISS });
    expect(payload['https://purl.imsglobal.org/spec/lti-dl/claim/content_items'][0]).toMatchObject({ title: 'Ohmsches Gesetz', custom: { lm_link: 'link1', lm_class: 'kNeu' } });
    expect(payload['https://purl.imsglobal.org/spec/lti-dl/claim/data']).toBe('abc');
  });

  it('Schutz: falscher state, fremde Deployment-ID und Schüler beim Deep Linking werden abgewiesen', async () => {
    const { svc } = make();
    expect(await svc.launch({ id_token: 'x', state: 'nix' }, 'https://lm.test')).toContain('ltiError=');
    let s = await start(svc);
    expect(decodeURIComponent(await svc.launch({ id_token: idToken(s.nonce, { [CL + 'deployment_id']: '99', [CL + 'message_type']: 'LtiResourceLinkRequest' }), state: s.state }, 'https://lm.test'))).toContain('Deployment');
    s = await start(svc);
    const learnerDeep = idToken(s.nonce, { [CL + 'message_type']: 'LtiDeepLinkingRequest', [CL + 'roles']: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'] });
    expect(decodeURIComponent(await svc.launch({ id_token: learnerDeep, state: s.state }, 'https://lm.test'))).toContain('nur Lehrkräfte');
    expect(scoresUrl('https://m/x/lineitem')).toBe('https://m/x/lineitem/scores');
  });
});
