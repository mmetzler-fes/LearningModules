/**
 * Zeitplan nach "Slots" für regelmäßige Läufe (Backups): der letzte
 * planmäßige Zeitpunkt, der nicht in der Zukunft liegt. Liegt der letzte
 * Versuch davor, ist ein Lauf fällig – so holt ein Server, der zum Termin
 * aus war, ihn beim nächsten Start nach.
 */
export interface Schedule {
  interval: 'weekly' | 'daily';
  /** 0 = Sonntag … 6 = Samstag (nur wöchentlich). */
  weekday: number;
  hour: number;
}

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export function period(s: Schedule) {
  return s.interval === 'daily' ? DAY : 7 * DAY;
}

export function lastSlot(s: Schedule, now: Date): Date {
  const slot = new Date(now);
  slot.setHours(s.hour, 0, 0, 0);
  if (s.interval === 'weekly') {
    slot.setDate(slot.getDate() - ((slot.getDay() - s.weekday + 7) % 7));
  }
  if (slot > now) slot.setDate(slot.getDate() - (s.interval === 'daily' ? 1 : 7));
  return slot;
}

export function nextSlot(s: Schedule, now: Date): Date {
  return new Date(lastSlot(s, now).getTime() + period(s));
}

/**
 * Fällig, wenn seit dem letzten Slot noch nicht versucht wurde – oder wenn
 * der letzte Versuch scheiterte, seit dem Slot nichts gelang und der Versuch
 * mindestens eine Stunde her ist (stündlich erneut versuchen).
 */
export function isDue(
  s: Schedule,
  st: { lastAttemptAt: Date | string | null; lastSuccessAt: Date | string | null; lastStatus: string | null },
  now: Date,
) {
  const slot = lastSlot(s, now);
  const lastAttempt = st.lastAttemptAt ? new Date(st.lastAttemptAt) : null;
  const lastSuccess = st.lastSuccessAt ? new Date(st.lastSuccessAt) : null;
  if (!lastAttempt || lastAttempt < slot) return true;
  return st.lastStatus === 'error' && (!lastSuccess || lastSuccess < slot) && now.getTime() - lastAttempt.getTime() >= HOUR;
}
