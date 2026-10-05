import { compareSchoolYearsDesc, shiftSchoolYear, isSchoolYear } from './school-year';

/**
 * Löschregel: aufbewahrt werden das aktuelle Schuljahr und die zwei davor.
 * Ältere Klassen, Schülerlisten und Ergebnisse löscht der Server 30 Tage
 * nach dem Schuljahreswechsel – Zeit genug, sie vorher zu exportieren.
 */
export const KEEP_PREVIOUS_YEARS = 2;
export const GRACE_DAYS = 30;

/** Ältestes Schuljahr, das noch aufbewahrt wird. */
export function oldestKeptYear(current: string): string {
  return shiftSchoolYear(current, -KEEP_PREVIOUS_YEARS);
}

/** Ist dieses Schuljahr abgelaufen? Einträge ohne gültiges Schuljahr gelten nie als abgelaufen. */
export function isExpired(year: string | null | undefined, current: string): boolean {
  return isSchoolYear(year) && compareSchoolYearsDesc(year, oldestKeptYear(current)) > 0;
}

/**
 * Ab wann gelöscht wird: 30 Tage nach dem Wechsel ins aktuelle Schuljahr.
 * Hat der Admin gewechselt, zählt dieser Tag; sonst der 1. August.
 */
export function deleteAfter(current: string, switchedAt: Date | null): Date {
  const start = switchedAt ?? new Date(2000 + Number(current.slice(2, 4)), 7, 1);
  return new Date(start.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
}
