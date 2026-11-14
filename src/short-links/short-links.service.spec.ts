import { ShortLinksService, checkTarget, newCode } from './short-links.service';
import { shortLinkRedirect } from './short-link-redirect';

/** Kleiner Speicher statt Datenbank – reicht für find/findOne/save/update/delete. */
function memoryRepo() {
  const rows: any[] = [];
  const match = (r: any, where: any) => Object.entries(where).every(([k, v]) => r[k] === v);
  return {
    rows,
    create: (x: any) => ({ ...x }),
    find: async ({ where }: any) => rows.filter((r) => match(r, where)),
    findOne: async ({ where }: any) => rows.find((r) => match(r, where)) || null,
    save: async (x: any) => {
      const i = rows.findIndex((r) => r.id === x.id);
      const row = { createdAt: new Date(), ...x };
      if (i >= 0) rows[i] = row; else rows.push(row);
      return row;
    },
    update: async (where: any, patch: any) => {
      rows.filter((r) => match(r, where)).forEach((r) => {
        for (const [k, v] of Object.entries(patch)) r[k] = typeof v === 'function' ? r[k] + 1 : v;
      });
    },
    delete: async (where: any) => { const i = rows.findIndex((r) => match(r, where)); if (i >= 0) rows.splice(i, 1); },
  };
}

const BASE = 'https://lm.test';
const SPICE = 'https://librespice.example/#circuit=' + 'x'.repeat(3000);

describe('Kurzlinks', () => {
  let repo: ReturnType<typeof memoryRepo>;
  let svc: ShortLinksService;
  beforeEach(() => { repo = memoryRepo(); svc = new ShortLinksService(repo as any); });

  it('Code ohne Verwechsler', () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^[2-9a-hjkmnp-z]{6}$/);
  });

  it('prüft das Ziel', () => {
    expect(checkTarget(' ' + SPICE + ' ', BASE)).toBe(SPICE);
    expect(() => checkTarget('', BASE)).toThrow('lange Adresse');
    expect(() => checkTarget('javascript:alert(1)', BASE)).toThrow('http');
    expect(() => checkTarget('kein link', BASE)).toThrow('gültige');
    expect(() => checkTarget(`${BASE}/k/abcdef`, BASE)).toThrow('schon ein Kurzlink');
    expect(() => checkTarget('https://a.de/' + 'x'.repeat(40000), BASE)).toThrow('zu lang');
  });

  it('erzeugt, findet dieselbe Adresse wieder, leitet weiter und zählt', async () => {
    const a = await svc.create('u1', { url: SPICE, title: 'Spannungsteiler' }, BASE);
    expect(a.short).toBe(`${BASE}/k/${a.code}`);
    expect(a.existing).toBe(false);
    const b = await svc.create('u1', { url: SPICE }, BASE);
    expect(b.code).toBe(a.code);
    expect(b.existing).toBe(true);
    const other = await svc.create('u2', { url: SPICE }, BASE);
    expect(other.code).not.toBe(a.code);
    expect(await svc.resolve(a.code.toUpperCase())).toBe(SPICE);
    expect(await svc.resolve('nix')).toBeNull();
    expect(repo.rows.find((r) => r.code === a.code).hits).toBe(1);
  });

  it('Ziel ändern behält den Code; fremde Links bleiben unerreichbar', async () => {
    const a = await svc.create('u1', { url: SPICE }, BASE);
    const changed = await svc.update('u1', a.id, { url: 'https://neu.example/x' }, BASE);
    expect(changed.code).toBe(a.code);
    expect(await svc.resolve(a.code)).toBe('https://neu.example/x');
    await expect(svc.update('u2', a.id, { title: 'x' }, BASE)).rejects.toThrow('nicht gefunden');
    await expect(svc.remove('u2', a.id)).rejects.toThrow('nicht gefunden');
    await svc.remove('u1', a.id);
    expect(await svc.list('u1', BASE)).toEqual([]);
  });

  it('Weiterleitung nur für /k/<code>', async () => {
    const a = await svc.create('u1', { url: SPICE }, BASE);
    const mw = shortLinkRedirect(svc);
    const run = async (path: string, method = 'GET') => {
      const res: any = { headers: {}, setHeader(k: string, v: string) { this.headers[k] = v; }, redirect: jest.fn(), status: jest.fn(() => res), type: jest.fn(() => res), send: jest.fn() };
      const next = jest.fn();
      await mw({ method, path }, res, next);
      return { res, next };
    };
    const ok = await run(`/k/${a.code}`);
    expect(ok.res.redirect).toHaveBeenCalledWith(302, SPICE);
    const missing = await run('/k/zzzzzz');
    expect(missing.res.status).toHaveBeenCalledWith(404);
    expect((await run('/api/k/x')).next).toHaveBeenCalled();
    expect((await run(`/k/${a.code}`, 'POST')).next).toHaveBeenCalled();
  });
});
