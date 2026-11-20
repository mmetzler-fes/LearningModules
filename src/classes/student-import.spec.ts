import { planStudentImport, ExistingStudent } from './student-import';

const student = (over: Partial<ExistingStudent>): ExistingStudent => ({
  id: 'x',
  firstName: '',
  lastName: '',
  status: 'confirmed',
  importId: null,
  ...over,
});

describe('planStudentImport', () => {
  it('legt neue Schüler an', () => {
    const plan = planStudentImport([], [{ firstName: 'Anna Lena', lastName: 'Müller', importId: 'a1' }]);
    expect(plan.add).toEqual([{ firstName: 'Anna Lena', lastName: 'Müller', importId: 'a1' }]);
    expect(plan.update).toEqual([]);
  });

  it('aktualisiert über die Schüler-ID, auch bei geändertem Namen', () => {
    const plan = planStudentImport(
      [student({ id: 's1', firstName: 'Adrian', lastName: 'Albrecht', importId: 'a1' })],
      [{ firstName: 'Adrian', lastName: 'Albrecht-Weiß', importId: 'a1' }],
    );
    expect(plan.add).toEqual([]);
    expect(plan.update).toEqual([
      { id: 's1', firstName: 'Adrian', lastName: 'Albrecht-Weiß', importId: 'a1', status: 'confirmed' },
    ]);
  });

  it('ordnet über den Namen zu und bestätigt unbestätigte Einträge', () => {
    const plan = planStudentImport(
      [student({ id: 's1', firstName: 'adrian', lastName: 'albrecht', status: 'pending' })],
      [{ firstName: 'Adrian', lastName: 'Albrecht', importId: 'a1' }],
    );
    expect(plan.update).toEqual([
      { id: 's1', firstName: 'Adrian', lastName: 'Albrecht', importId: 'a1', status: 'confirmed' },
    ]);
  });

  it('zählt Unverändertes und lässt Fehlende stehen', () => {
    const plan = planStudentImport(
      [
        student({ id: 's1', firstName: 'Adrian', lastName: 'Albrecht', importId: 'a1' }),
        student({ id: 's2', firstName: 'Berta', lastName: 'Bauer' }),
      ],
      [{ firstName: 'Adrian', lastName: 'Albrecht', importId: 'a1' }],
    );
    expect(plan).toEqual({ add: [], update: [], unchanged: 1, duplicates: [] });
  });

  it('trennt gleichnamige Schüler mit verschiedenen Schüler-IDs', () => {
    const plan = planStudentImport(
      [student({ id: 's1', firstName: 'Max', lastName: 'Maier', importId: 'a1' })],
      [
        { firstName: 'Max', lastName: 'Maier', importId: 'a1' },
        { firstName: 'Max', lastName: 'Maier', importId: 'a2' },
      ],
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.add).toEqual([{ firstName: 'Max', lastName: 'Maier', importId: 'a2' }]);
    expect(plan.duplicates).toEqual(['Max Maier']);
  });

  it('übergeht leere Zeilen und vereinheitlicht Leerraum', () => {
    const plan = planStudentImport([], [
      { firstName: '  ', lastName: '' },
      { firstName: ' Anna   Lena ', lastName: 'Müller ' },
    ]);
    expect(plan.add).toEqual([{ firstName: 'Anna Lena', lastName: 'Müller', importId: null }]);
  });
});

describe('Schülerliste: Benutzername des Schulkontos', () => {
  const existing = [
    { id: 's1', firstName: 'Anna', lastName: 'Apfel', status: 'confirmed', importId: null, loginId: null },
    { id: 's2', firstName: 'Ben', lastName: 'Berg', status: 'confirmed', importId: null, loginId: 'ben.berg' },
  ];
  it('erneutes Einlesen ergänzt den Benutzernamen (Teil vor dem @, klein) – ohne neue Einträge', () => {
    const plan = planStudentImport(existing, [
      { firstName: 'Anna', lastName: 'Apfel', loginId: 'Anna.Apfel@fesesde.onmicrosoft.com' },
      { firstName: 'Ben', lastName: 'Berg', loginId: null },
    ]);
    expect(plan.add).toHaveLength(0);
    expect(plan.update).toEqual([expect.objectContaining({ id: 's1', loginId: 'anna.apfel' })]);
    expect(plan.unchanged).toBe(1); // Ben: in der Datei ohne – der vorhandene bleibt
  });
  it('neue Schüler bekommen ihn gleich mit', () => {
    const plan = planStudentImport([], [{ firstName: 'Cem', lastName: 'Cal', loginId: ' CEM.CAL ' }]);
    expect(plan.add[0]).toMatchObject({ firstName: 'Cem', loginId: 'cem.cal' });
  });
});
