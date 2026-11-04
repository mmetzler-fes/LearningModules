import {
  appHeaders, frameAllowedHere, isShopApproved, issueToken, parentOriginOf, planUnits, readManifest, readToken,
  shellPage, withoutBlockedApps,
} from './html-app-rules';

const good = { lmApp: 2, id: 'ohm', version: '1.0', title: 'Ohm', units: [
  { id: 'a', title: 'A', steps: [{ id: 's1', title: 'S1', kind: 'task' }] },
  { id: 'b', title: 'B', steps: [{ id: 's2', title: 'S2', kind: 'info' }] },
] };
const read = (m: unknown) => readManifest(JSON.stringify(m));

describe('readManifest', () => {
  it('liest den Steckbrief', () => {
    const { manifest, errors } = read(good);
    expect(errors).toEqual([]);
    expect(manifest?.units.map((u) => u.steps[0].id)).toEqual(['s1', 's2']);
  });
  it('lehnt die alte Schnittstelle ab', () => {
    expect(read({ ...good, lmApp: 1 }).errors.join()).toContain('umgebaut');
  });
  it('lehnt Ungültiges ab und nennt den Grund', () => {
    expect(readManifest('{kein json').errors[0]).toContain('JSON');
    expect(read({ ...good, id: 'A B' }).errors.join()).toContain('„id“');
    expect(read({ ...good, units: [good.units[0], good.units[0]] }).errors.join()).toContain('doppelt');
    expect(read({ ...good, units: [{ id: 'a', title: 'A', steps: [{ id: 's', title: 'S', kind: 'x' }] }] }).errors.join()).toContain('kind');
    expect(read({ ...good, units: [{ id: 'a', title: 'A', steps: [] }] }).errors.join()).toContain('steps');
    expect(read({ ...good, units: Array.from({ length: 31 }, (_, i) => ({ id: `u${i}`, title: 'x', steps: [{ id: `s${i}`, title: 'y', kind: 'info' }] })) }).errors.join()).toContain('Höchstens');
    expect(read({ ...good, units: [{ id: 'a', title: 'A', steps: Array.from({ length: 501 }, (_, i) => ({ id: `s${i}`, title: 'y', kind: 'info' })) }] }).errors.join()).toContain('Höchstens');
  });
});

describe('planUnits', () => {
  it('ordnet über die id zu, neu und entfernt getrennt', () => {
    const m = read(good).manifest;
    const plan = planUnits(m, [{ id: 'k1', content: { unit: 'a' } }, { id: 'k2', content: { unit: 'alt' } }]);
    expect(plan.create.map((c) => c.unit.id)).toEqual(['b']);
    expect(plan.update.map((u) => u.id)).toEqual(['k1']);
    expect(plan.remove).toEqual(['k2']);
  });
  it('ohne Steckbrief fallen alle Abschnitte weg', () => {
    expect(planUnits(null, [{ id: 'k1', content: { unit: 'a' } }]).remove).toEqual(['k1']);
  });
});

describe('Ausweise', () => {
  const later = Date.now() + 1000;
  it('gilt nur für die eigene Sorte und bis zum Ablauf', () => {
    const view = issueToken({ k: 'view', f: 'f', o: 'https://a' }, later);
    expect(readToken(view, 'view')).toMatchObject({ f: 'f' });
    expect(readToken(view, 'session')).toBeNull();
    expect(readToken(view, 'view', later + 1)).toBeNull();
  });
  it('erkennt Veränderung', () => {
    const [, mac] = issueToken({ k: 'view', f: 'f', o: 'https://a' }, later).split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'view', f: 'fremd', o: 'https://a', e: later })).toString('base64url');
    expect(readToken(`${forged}.${mac}`, 'view')).toBeNull();
  });
});

describe('Adressen', () => {
  const origin = 'https://apps.schule.de';
  it('App-Adresse nur Rahmen, Hauptadresse keine', () => {
    expect(frameAllowedHere({ host: 'apps.schule.de' }, '/api/html-app-frame/app', origin)).toBe(true);
    expect(frameAllowedHere({ host: 'apps.schule.de' }, '/', origin)).toBe(false);
    expect(frameAllowedHere({ host: 'apps.schule.de' }, '/api/auth/login', origin)).toBe(false);
    expect(frameAllowedHere({ host: 'lm.schule.de' }, '/api/html-app-frame/app', origin)).toBe(false);
    expect(frameAllowedHere({ host: 'lm.schule.de' }, '/index.html', origin)).toBe(true);
    expect(frameAllowedHere({ 'x-forwarded-host': 'apps.schule.de', host: 'intern:3000' }, '/', origin)).toBe(false);
  });
  it('ohne Einstellung gibt es keine Rahmen', () => {
    expect(frameAllowedHere({ host: 'lm.schule.de' }, '/api/html-app-frame/app', null)).toBe(false);
    expect(frameAllowedHere({ host: 'lm.schule.de' }, '/', null)).toBe(true);
  });
  it('Ursprung der Hauptseite', () => {
    expect(parentOriginOf({ origin: 'https://lm.schule.de', host: 'lm.schule.de' }, '')).toBe('https://lm.schule.de');
    expect(parentOriginOf({ origin: 'https://boese.de', host: 'lm.schule.de' }, '')).toBeNull();
    expect(parentOriginOf({ host: 'lm.schule.de' }, '')).toBeNull();
    expect(parentOriginOf({ origin: 'https://app.schule.de', host: 'intern' }, 'https://app.schule.de')).toBe('https://app.schule.de');
  });
});

describe('Rahmen', () => {
  it('App: Sandkasten ohne Netz, nur in der eigenen Rahmenseite', () => {
    const headers = appHeaders('https://apps', 'https://lm', ["'sha256-abc'"]);
    const csp = headers['Content-Security-Policy'];
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).not.toContain('allow-downloads');
    expect(csp).toContain("script-src 'sha256-abc'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(headers['X-DNS-Prefetch-Control']).toBe('off');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain('frame-ancestors https://apps https://lm');
  });
  it('Rahmenseite: hält den Seitenwechsel auf, nur die Hauptseite bettet sie ein', () => {
    const { html, headers } = shellPage('t</script>', 'https://lm');
    const csp = headers['Content-Security-Policy'];
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain('frame-ancestors https://lm');
    expect(csp).not.toContain('unsafe-inline');
    expect(html).not.toContain('t</script>');
  });
});

describe('Shop', () => {
  const mods = [
    { id: 'q', type: 'quiz' }, { id: 'a', type: 'htmlApp', content: { app: { fileId: 'f1' } } }, { id: 'a1', type: 'htmlAppUnit', parentId: 'a' },
    { id: 'b', type: 'htmlApp', content: JSON.stringify({ app: { fileId: 'f2' } }) }, { id: 'b1', type: 'htmlAppUnit', parentId: 'b' },
    { id: 'c', type: 'htmlApp', content: {} },
  ];
  it('lässt HTML-Apps ohne freigegebene Datei samt Abschnitten aus', () => {
    expect(withoutBlockedApps(mods, new Set(['f2'])).map((m) => m.id)).toEqual(['q', 'b', 'b1']);
    expect(withoutBlockedApps(mods).map((m) => m.id)).toEqual(['q']);
  });
  it('die alte Freigabe am Modul zählt nicht mehr', () => {
    expect(withoutBlockedApps([{ id: 'a', type: 'htmlApp', content: { shopAllowed: true, app: { fileId: 'f1' } } }])).toEqual([]);
  });
  it('die Freigabe gilt nur für den gesehenen Hash und die aktuelle Schnittstelle', () => {
    const file = { sha: 'x', shopApprovedSha: 'x', manifest: { lmApp: 2 } };
    expect(isShopApproved(file)).toBe(true);
    expect(isShopApproved({ ...file, sha: 'y' })).toBe(false);
    expect(isShopApproved({ ...file, shopApprovedSha: null })).toBe(false);
    expect(isShopApproved({ ...file, manifest: { lmApp: 1 } })).toBe(false);
  });
});
