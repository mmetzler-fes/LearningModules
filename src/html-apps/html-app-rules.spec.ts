import * as fs from 'fs';
import * as path from 'path';
import {
  appHeaders, cleanProgress, cleanResult, frameAllowedHere, issueToken, parentOriginOf, parseManifest, planUnits, readToken,
  shellPage, withoutBlockedApps,
} from './html-app-rules';

const page = (json: string) => `<html><head><script type="application/lm-app+json">${json}</script></head></html>`;
const good = { lmApp: 1, id: 'ohm', version: '1.0', title: 'Ohm', units: [{ id: 'a', title: 'A', kind: 'graded', items: 2 }, { id: 'b', title: 'B', kind: 'info' }] };

describe('parseManifest', () => {
  it('liest den Steckbrief', () => {
    const { manifest, errors } = parseManifest(page(JSON.stringify(good)));
    expect(errors).toEqual([]);
    expect(manifest?.units.map((u) => u.id)).toEqual(['a', 'b']);
  });
  it('ohne Steckbrief: nur Anzeige, kein Fehler', () => {
    expect(parseManifest('<html></html>')).toEqual({ manifest: null, errors: [] });
  });
  it('lehnt Ungültiges ab und nennt den Grund', () => {
    expect(parseManifest(page('{kein json')).errors[0]).toContain('JSON');
    expect(parseManifest(page(JSON.stringify({ ...good, id: 'A B' }))).errors.join()).toContain('„id“');
    expect(parseManifest(page(JSON.stringify({ ...good, units: [good.units[0], good.units[0]] }))).errors.join()).toContain('doppelt');
    expect(parseManifest(page(JSON.stringify({ ...good, units: [{ id: 'a', title: 'A', kind: 'x' }] }))).errors.join()).toContain('kind');
    expect(parseManifest(page(JSON.stringify({ ...good, units: Array.from({ length: 31 }, (_, i) => ({ id: `u${i}`, title: 'x', kind: 'info' })) }))).errors.join()).toContain('30');
  });
});

describe('Beispiel-App', () => {
  const file = fs.readFileSync(path.join(__dirname, '../../docs/html-app-beispiel.html'), 'utf8');
  it('hat einen gültigen Steckbrief', () => {
    expect(parseManifest(file).manifest?.units.map((u) => u.id)).toEqual(['theorie', 'rechnen', 'ueben']);
  });
  it('enthält die aktuelle Bridge', () => {
    expect(file).toContain(fs.readFileSync(path.join(__dirname, '../renderer/lm-bridge.js'), 'utf8'));
  });
});

describe('planUnits', () => {
  it('ordnet über die id zu, neu und entfernt getrennt', () => {
    const m = parseManifest(page(JSON.stringify(good))).manifest;
    const plan = planUnits(m, [{ id: 'k1', content: { unit: 'a' } }, { id: 'k2', content: { unit: 'alt' } }]);
    expect(plan.create.map((c) => c.unit.id)).toEqual(['b']);
    expect(plan.update.map((u) => u.id)).toEqual(['k1']);
    expect(plan.remove).toEqual(['k2']);
  });
  it('ohne Steckbrief fallen alle Abschnitte weg', () => {
    expect(planUnits(null, [{ id: 'k1', content: { unit: 'a' } }]).remove).toEqual(['k1']);
  });
});

describe('Meldungen', () => {
  it('prüft Ergebnisse', () => {
    expect(cleanResult({ unit: 'a', score: 1, max: 2 })).toMatchObject({ score: 1, max: 2, items: [] });
    expect(cleanResult({ unit: 'a', score: 1, max: 2, items: null })).toMatchObject({ items: [] }); // sendet die Bridge ohne items
    for (const bad of [{ score: 3, max: 2 }, { score: -1, max: 2 }, { score: 0, max: 0 }, { score: 'x', max: 2 }, { score: 1, max: 2, items: [{ id: 'a', points: 2 }] }]) {
      expect(cleanResult(bad)).toHaveProperty('error');
    }
  });
  it('prüft Fortschritt', () => {
    expect(cleanProgress({ unit: 'a', active: true })).toMatchObject({ active: true });
    expect(cleanProgress({ unit: 'a', done: 1, total: 2 })).toMatchObject({ done: 1, total: 2 });
    expect(cleanProgress({ unit: 'a', done: 3, total: 2 })).toHaveProperty('error');
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
    const csp = appHeaders('https://apps', 'https://lm')['Content-Security-Policy'];
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
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
  it('lässt HTML-Apps ohne Freigabe samt Abschnitten aus', () => {
    const mods = [
      { id: 'q', type: 'quiz' }, { id: 'a', type: 'htmlApp', content: {} }, { id: 'a1', type: 'htmlAppUnit', parentId: 'a' },
      { id: 'b', type: 'htmlApp', content: JSON.stringify({ shopAllowed: true }) }, { id: 'b1', type: 'htmlAppUnit', parentId: 'b' },
    ];
    expect(withoutBlockedApps(mods).map((m) => m.id)).toEqual(['q', 'b', 'b1']);
  });
});
