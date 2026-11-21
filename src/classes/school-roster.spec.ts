import { nameDistance, planRosterSync, rosterOverlap, sameClassByStudents, groupByClass } from './school-roster';

const s = (id: string, firstName: string, lastName: string, loginId: string | null = null) => ({ id, firstName, lastName, loginId });

describe('nameDistance', () => {
  it('zählt Zeichen, ein Dreher ist eins', () => {
    expect(nameDistance('meier', 'maier')).toBe(1);
    expect(nameDistance('adrain', 'adrian')).toBe(1);
    expect(nameDistance('müller', 'mueller')).toBe(2);
    expect(nameDistance('schmidt', 'schmitt')).toBe(1);
    expect(nameDistance('anna', 'hannah s')).toBe(4);
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

  it('bis zu 3 Zeichen: derselbe Schüler, mehr: ein anderer', () => {
    expect(planRosterSync([s('1', 'Jörg', 'Müller')], [{ firstName: 'Joerg', lastName: 'Mueller' }]).add).toHaveLength(1);
    const plan = planRosterSync([s('1', 'Max', 'Meier')], [{ firstName: 'Max', lastName: 'Mayr' }]);
    expect(plan.update).toHaveLength(1);
    expect(planRosterSync([s('1', 'Max', 'Meier')], [{ firstName: 'Moritz', lastName: 'Meier' }]).add).toHaveLength(1);
  });

  it('vertauschter Vor- und Nachname', () => {
    const plan = planRosterSync([s('1', 'Meier', 'Max')], [{ firstName: 'Max', lastName: 'Meier' }]);
    expect(plan.update).toEqual([{ id: '1', firstName: 'Max', lastName: 'Meier', loginId: null }]);
  });

  it('zwei gleich nahe Einträge: lieber neu', () => {
    const plan = planRosterSync([s('1', 'Max', 'Meier'), s('2', 'Max', 'Mayer')], [{ firstName: 'Max', lastName: 'Maier' }]);
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

  it('dieselbe Klasse ab der Hälfte, in beiden Richtungen', () => {
    expect(sameClassByStudents(2, 25, 25)).toBe(false);
    expect(sameClassByStudents(13, 25, 30)).toBe(true);
    expect(sameClassByStudents(12, 12, 30)).toBe(true); // Teil einer geteilten Klasse
    expect(sameClassByStudents(10, 30, 20)).toBe(true); // vorhandene Klasse ganz in der neuen
    expect(sameClassByStudents(0, 0, 0)).toBe(false);
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
