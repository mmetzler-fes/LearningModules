/**
 * Quick-Link mit vorgewählter Klasse: `<token>.<klassen-ID>`.
 *
 * Der Quick-Link eines Lernthemas (bzw. Notebook-Knotens) ist eine Regel mit
 * eigenem Token und einer Auswahl von Klassen. Ohne Klasse wählt der Schüler
 * sie aus der Liste; mit Klasse geht es direkt zum Namen. Dahinter steht
 * jeweils der Klassenlink dieser Klasse – so gelten Schülerliste, „strikt“,
 * Ergebnisse und Quiz-Arena wie dort. Zieht die Lehrkraft den Quick-Link
 * zurück, sind alle Varianten zugleich ungültig, weil sie seinen Token tragen.
 *
 * Tokens sind base64url und enthalten keinen Punkt.
 */

export function quickToken(token: string, classId: string): string {
  return `${token}.${classId}`;
}

/** `<token>.<klasse>` → beide Teile; ein gewöhnlicher Token → `null`. */
export function splitQuickToken(value: string): { token: string; classId: string } | null {
  const i = value.indexOf('.');
  if (i <= 0 || i === value.length - 1) return null;
  return { token: value.slice(0, i), classId: value.slice(i + 1) };
}

/** Regel hinter einem Quick-Link-Knopf (Lernthema oder Notebook-Knoten)? */
export function isQuickRule(link: { classId?: string | null; quickTopicId?: string | null; quickNodeId?: string | null } | null | undefined): boolean {
  return !!link && !link.classId && !!(link.quickTopicId || link.quickNodeId);
}
