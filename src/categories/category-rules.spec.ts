import * as fs from 'fs';
import * as path from 'path';
import {
  cannotAddUnder, cleanIds, cleanLabel, depthOf, effectiveOf, hasSubject, MAX_DEPTH, seedRows, siblingWithLabel, withAncestors, withDescendants,
  CategoryLike,
} from './category-rules';

const cats: CategoryLike[] = [
  { id: 'et', facet: 'subject', parentId: null, label: 'Elektrotechnik', status: 'active' },
  { id: 'at', facet: 'subject', parentId: 'et', label: 'Automatisierungstechnik', status: 'active' },
  { id: 'sps', facet: 'subject', parentId: 'at', label: 'SPS-Programmierung', status: 'active' },
  { id: 'old', facet: 'subject', parentId: 'et', label: 'Alt', status: 'hidden' },
  { id: 'mine', facet: 'subject', parentId: 'at', label: 'TIA-Portal', status: 'proposed', proposedBy: 'u1' },
  { id: 'bb', facet: 'stage', parentId: null, label: 'Berufliche Bildung', status: 'active' },
  { id: 'fs', facet: 'stage', parentId: 'bb', label: 'Fachschule', status: 'active' },
];
const byId = new Map(cats.map((c) => [c.id, c]));

describe('Kategorien: Ebenen', () => {
  it('Tiefe und Vorfahren', () => {
    expect(depthOf('sps', byId)).toBe(3);
    expect(depthOf('et', byId)).toBe(1);
    expect(depthOf('xx', byId)).toBe(0);
    expect(withAncestors('sps', byId)).toEqual(['sps', 'at', 'et']);
  });

  it('Suche findet auch alles darunter', () => {
    expect([...withDescendants(['et'], cats)].sort()).toEqual(['at', 'et', 'mine', 'old', 'sps']);
  });

  it('Fach höchstens 3, Stufe höchstens 2 Ebenen', () => {
    expect(MAX_DEPTH).toEqual({ subject: 3, stage: 2 });
    expect(cannotAddUnder(byId.get('at'), byId)).toBeNull();
    expect(cannotAddUnder(byId.get('sps'), byId)).toMatch(/drei Ebenen/);
    expect(cannotAddUnder(byId.get('bb'), byId)).toBeNull();
    expect(cannotAddUnder(byId.get('fs'), byId)).toMatch(/zwei Ebenen/);
    expect(cannotAddUnder(byId.get('old'), byId)).toMatch(/ausgeblendet/);
    expect(cannotAddUnder(undefined, byId)).toMatch(/nicht gefunden/);
  });
});

describe('Kategorien: Auswahl', () => {
  it('nur wählbare – eigene Vorschläge ja, fremde und ausgeblendete nein', () => {
    expect(cleanIds(['sps', 'mine', 'old', 'xx', 'sps'], byId, 'u1')).toEqual(['sps', 'mine']);
    expect(cleanIds(['sps', 'mine'], byId, 'u2')).toEqual(['sps']);
  });

  it('schon Zugeordnetes bleibt, auch wenn es inzwischen ausgeblendet ist', () => {
    expect(cleanIds(['old', 'sps'], byId, 'u2', ['old'])).toEqual(['old', 'sps']);
  });

  it('eigene plus die der Tags', () => {
    expect(effectiveOf(['fs'], ['t1', 't2'], new Map([['t1', ['sps']], ['t3', ['et']]])).sort()).toEqual(['fs', 'sps']);
  });

  it('Fach vorhanden?', () => {
    expect(hasSubject(['fs'], byId)).toBe(false);
    expect(hasSubject(['fs', 'at'], byId)).toBe(true);
  });

  it('gleicher Name unter demselben Oberbegriff', () => {
    expect(siblingWithLabel('at', '  sps-programmierung ', cats)?.id).toBe('sps');
    expect(siblingWithLabel('et', 'alt', cats)).toBeUndefined();
  });

  it('Bezeichnung', () => {
    expect(cleanLabel('  SPS   Grundlagen ')).toBe('SPS Grundlagen');
    expect(cleanLabel('')).toBeNull();
    expect(cleanLabel('x'.repeat(61))).toBeNull();
  });
});

describe('Ausgelieferte Listen', () => {
  const dir = path.join(__dirname, 'vocab');
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const rows = seedRows({
    discipline: read('oeh-discipline.json'),
    context: read('oeh-educational-context.json'),
    shared: read('lm-shared.json'),
  });
  const all = new Map(rows.map((r) => [r.id, { ...r, status: 'active' as const }]));

  it('Kennungen eindeutig', () => {
    expect(all.size).toBe(rows.length);
  });

  it('jeder Oberbegriff existiert und gehört zur selben Facette', () => {
    for (const r of rows) {
      if (!r.parentId) continue;
      expect(all.get(r.parentId)?.facet).toBe(r.facet);
    }
  });

  it('keine Ebene zu tief', () => {
    for (const r of rows) expect(depthOf(r.id, all)).toBeLessThanOrEqual(MAX_DEPTH[r.facet]);
  });

  it('OpenEduHub-Fächer und -Stufen mit Adresse', () => {
    expect(all.get('oeh-d:04005')?.label).toBe('Elektrotechnik');
    expect(all.get('oeh-c:berufliche_bildung')?.uri).toBe('http://w3id.org/openeduhub/vocabs/educationalContext/berufliche_bildung');
  });
});
