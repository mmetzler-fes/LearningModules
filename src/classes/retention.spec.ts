import { oldestKeptYear, isExpired, deleteAfter } from './retention';

describe('Löschregel', () => {
  it('bewahrt das aktuelle und zwei Vorjahre', () => {
    expect(oldestKeptYear('SJ26-27')).toBe('SJ24-25');
    expect(isExpired('SJ26-27', 'SJ26-27')).toBe(false);
    expect(isExpired('SJ24-25', 'SJ26-27')).toBe(false);
    expect(isExpired('SJ23-24', 'SJ26-27')).toBe(true);
    expect(isExpired('SJ19-20', 'SJ26-27')).toBe(true);
  });

  it('ohne Schuljahr nie abgelaufen', () => {
    expect(isExpired(null, 'SJ26-27')).toBe(false);
    expect(isExpired('kaputt', 'SJ26-27')).toBe(false);
  });

  it('30 Tage nach dem Wechsel, sonst nach dem 1. August', () => {
    expect(deleteAfter('SJ26-27', new Date(2026, 8, 10)).toDateString()).toBe(new Date(2026, 9, 10).toDateString());
    expect(deleteAfter('SJ26-27', null).toDateString()).toBe(new Date(2026, 7, 31).toDateString());
  });
});
