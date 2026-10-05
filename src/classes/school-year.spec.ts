import {
  isSchoolYear,
  schoolYearOfDate,
  shiftSchoolYear,
  compareSchoolYearsDesc,
  splitSchoolYearPrefix,
} from './school-year';

describe('Schuljahr', () => {
  it('erkennt gültige Schuljahre', () => {
    expect(isSchoolYear('SJ26-27')).toBe(true);
    expect(isSchoolYear('SJ99-00')).toBe(true);
    expect(isSchoolYear('SJ26-28')).toBe(false);
    expect(isSchoolYear('26-27')).toBe(false);
    expect(isSchoolYear(null)).toBe(false);
  });

  it('wechselt nach Kalender am 1. August', () => {
    expect(schoolYearOfDate(new Date(2026, 6, 31))).toBe('SJ25-26');
    expect(schoolYearOfDate(new Date(2026, 7, 1))).toBe('SJ26-27');
    expect(schoolYearOfDate(new Date(2027, 0, 15))).toBe('SJ26-27');
  });

  it('verschiebt über den Jahrhundertwechsel', () => {
    expect(shiftSchoolYear('SJ26-27', 1)).toBe('SJ27-28');
    expect(shiftSchoolYear('SJ26-27', -1)).toBe('SJ25-26');
    expect(shiftSchoolYear('SJ99-00', 1)).toBe('SJ00-01');
  });

  it('sortiert neuestes zuerst', () => {
    expect(['SJ25-26', 'SJ99-00', 'SJ26-27'].sort(compareSchoolYearsDesc)).toEqual(['SJ26-27', 'SJ25-26', 'SJ99-00']);
  });

  it('trennt den Vorsatz des SchülerLernTools ab', () => {
    expect(splitSchoolYearPrefix('SJ26-27-E1ME1')).toEqual({ schoolYear: 'SJ26-27', name: 'E1ME1' });
    expect(splitSchoolYearPrefix('sj26-27 TG12')).toEqual({ schoolYear: 'SJ26-27', name: 'TG12' });
    expect(splitSchoolYearPrefix('TG12')).toEqual({ schoolYear: null, name: 'TG12' });
    expect(splitSchoolYearPrefix('SJ26-28-TG12')).toEqual({ schoolYear: null, name: 'SJ26-28-TG12' });
  });
});
