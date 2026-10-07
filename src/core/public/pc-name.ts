/**
 * Rechnername aus dem Start-Link (…&pc=%COMPUTERNAME%). Windows setzt ihn
 * beim Öffnen der Verknüpfung ein; tut es das nicht, kommt der Platzhalter
 * selbst an – der zählt als "unbekannt". Erlaubt sind nur Zeichen, die in
 * Rechnernamen vorkommen.
 */
export function cleanPcName(value: unknown): string | null {
  const v = String(value ?? '').trim();
  if (!v || /[%$]/.test(v)) return null;
  return /^[A-Za-z0-9._-]{1,63}$/.test(v) ? v : null;
}
