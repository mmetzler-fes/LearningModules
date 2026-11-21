import { withinOneEdit, planRosterSync, rosterOverlap, overlapLimit, groupByClass } from './school-roster';

const s = (id: string, firstName: string, lastName: string, loginId: string | null = null) => ({ id, firstName, lastName, loginId });

describe('withinOneEdit', () => {
  it('erkennt einen Buchstaben Unterschied', () => {
    expect(withinOneEdit('meier', 'maier')).toBe(true);
    expect(withinOneEdit('mayer', 'mayers')).toBe(true);
    expect(withinOneEdit('adrian', 'adrin')).toBe(true);
    expect(withinOneEdit('müller', 'mueller')).toBe(false);
    expect(withinOneEdit('anna', 'hanna s')).toBe(false);
  });
});

describe('planRosterSync', () => {
  it('ordnet über die UserID zu, auch bei neuem Namen', () => {
    const plan = planRosterSync([s('1', 'Lea', 'Alt', 'lea.alt')], [{ firstName: 'Lea', lastName: 'Neu', loginId: 'Lea.Alt@schule.de' }]);
    expect(plan.add).toEqual([]);
    expect(plan.update).toEqual([{ id: '1', firstName: 'Lea', lastName: 'Neu', loginId: 'lea.alt' }]);
    expect(plan.renamed).toEqual([]);
  });

  it('gleicher Name: unverändert, UserID wird ergänzt', () => {
    const plan = planRosterSync([s('1', 'Max', 'Meier'), s('2', 'Eva', 'Ost')], [
      { firstName: 'max', lastName: 'Meier', loginId: 'mmeier' },
      { firstName: 'Eva', lastName: 'Ost' },
    ]);
    expect(plan.unchanged).toBe(1);
    expect(plan.update).toEqual([{ id: '1', firstName: 'max', lastName: 'Meier', loginId: 'mmeier' }]);
  });

  it('ein Buchstabe Unterschied: Name aus der Datei', () => {
    const plan = planRosterSync([s('1', 'Adrain', 'Albrecht')], [{ firstName: 'Adrian', lastName: 'Albrecht' }]);
    expect(plan.update).toEqual([{ id: '1', firstName: 'Adrian', lastName: 'Albrecht', loginId: null }]);
    expect(plan.renamed).toEqual(['Adrain Albrecht → Adrian Albrecht']);
  });

  it('zwei Buchstaben sind ein anderer Schüler', () => {
    const plan = planRosterSync([s('1', 'Max', 'Meier')], [{ firstName: 'Max', lastName: 'Mayr' }]);
    expect(plan.add).toHaveLength(1);
  });

  it('der genaue Name geht dem Tippfehler vor', () => {
    const plan = planRosterSync([s('1', 'Max', 'Meier'), s('2', 'Max', 'Maier')], [
      { firstName: 'Max', lastName: 'Maier' }, { firstName: 'Max', lastName: 'Meier' },
    ]);
    expect(plan.unchanged).toBe(2);
    expect(plan.add).toEqual([]);
  });

  it('verschiedene UserIDs sind verschiedene Schüler', () => {
    const plan = planRosterSync([s('1', 'Tim', 'Kurz', 'tkurz1')], [{ firstName: 'Tim', lastName: 'Kurz', loginId: 'tkurz2' }]);
    expect(plan.add).toHaveLength(1);
  });

  it('bestätigt unbestätigte Einträge', () => {
    const plan = planRosterSync([{ ...s('1', 'Ali', 'Can'), status: 'pending' }], [{ firstName: 'Ali', lastName: 'Can' }]);
    expect(plan.update).toHaveLength(1);
  });
});

describe('Klassen der Schulliste', () => {
  it('zählt gemeinsame Schüler', () => {
    expect(rosterOverlap([s('1', 'A', 'B', 'ab'), s('2', 'C', 'D')], [{ firstName: 'x', lastName: 'y', loginId: 'ab' }, { firstName: 'c', lastName: 'd' }, { firstName: 'E', lastName: 'F' }])).toBe(2);
  });

  it('teilweise gleich: Hälfte der Klasse, höchstens 3', () => {
    expect(overlapLimit(1)).toBe(1);
    expect(overlapLimit(4)).toBe(2);
    expect(overlapLimit(25)).toBe(3);
  });

  it('gruppiert nach Klasse, Schuljahr aus dem Vorsatz', () => {
    const groups = groupByClass([
      { className: 'TG12', firstName: 'A', lastName: 'B' },
      { className: 'SJ27-28-E1ME1', firstName: 'C', lastName: 'D' },
      { className: 'tg12', firstName: 'E', lastName: 'F' },
      { className: '', firstName: 'G', lastName: 'H' },
    ], 'SJ26-27');
    expect(groups.map((g) => [g.name, g.schoolYear, g.students.length])).toEqual([['TG12', 'SJ26-27', 2], ['E1ME1', 'SJ27-28', 1]]);
  });
});
