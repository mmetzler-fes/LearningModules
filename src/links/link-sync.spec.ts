import { applyRule, differsFromRule, syncedState } from './link-sync';

const rule = () => ({
  name: 'TG12 Arduino',
  modes: ['quiz', 'exam'],
  selection: [
    { topicId: 't2', all: false, moduleIds: ['m3', 'm1'] },
    { topicId: 't1', all: true },
  ],
  accessPassword: 'geheim',
  singleAttempt: true,
  tagIds: ['a', 'b'],
  companionSettings: { jokerMax: 2 },
  contestSettings: { maxPoints: 1000, defaultSeconds: 30, seconds: {}, sound: true },
});

describe('Klassenlink und Freigabe abgleichen', () => {
  it('gleicher Inhalt in anderer Reihenfolge weicht nicht ab', () => {
    const link = {
      ...rule(),
      modes: ['exam', 'quiz'],
      tagIds: ['b', 'a'],
      selection: [
        { topicId: 't1', all: true, moduleIds: [] },
        { topicId: 't2', all: false, moduleIds: ['m1', 'm3'] },
      ],
      contestSettings: { sound: true, seconds: {}, defaultSeconds: 30, maxPoints: 1000 },
    };
    expect(differsFromRule(link, rule())).toBe(false);
  });

  it('leere und fehlende Tags sind dasselbe', () => {
    expect(syncedState({ ...rule(), tagIds: null })).toBe(syncedState({ ...rule(), tagIds: [] }));
  });

  it('erkennt geänderte Inhalte, Modi, Passwort und Namen', () => {
    expect(differsFromRule({ ...rule(), selection: [{ topicId: 't1', all: true }] }, rule())).toBe(true);
    expect(differsFromRule({ ...rule(), modes: ['quiz'] }, rule())).toBe(true);
    expect(differsFromRule({ ...rule(), accessPassword: null }, rule())).toBe(true);
    expect(differsFromRule({ ...rule(), name: 'TG13 Arduino' }, rule())).toBe(true);
  });

  it('übernimmt den Stand der Regel, ohne Tokens und Aktivierung anzufassen', () => {
    const link: any = { name: 'alt', modes: ['learn'], selection: [], accessPassword: null, token: 'tok', active: false, customized: true };
    const r = rule();
    applyRule(link, r);
    expect(differsFromRule(link, r)).toBe(false);
    expect(link.token).toBe('tok');
    expect(link.active).toBe(false);
    expect(link.customized).toBe(false);
    // Kopie, keine geteilten Objekte: Spätere Änderungen an der Regel wirken nicht mit.
    r.selection.push({ topicId: 't9', all: true });
    expect(differsFromRule(link, r)).toBe(true);
  });
});
