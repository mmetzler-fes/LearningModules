/**
 * Regeln für die Übergabe von Inhalten, ohne Datenbank (handover-rules.spec.ts).
 * Siehe docs/uebergabe.md.
 */

export interface TagLike {
  id: string;
  name: string;
}

/**
 * Welche Tags der Empfänger bekommt: Für jeden verwendeten Tag des
 * Absenders entweder sein gleichnamiger (dann wird nichts doppelt angelegt)
 * oder ein neuer. Liefert die Zuordnung alt → neu und die anzulegenden Tags.
 */
export function planTags(
  used: TagLike[],
  theirs: TagLike[],
  newId: () => string,
): { map: Map<string, string>; create: Array<{ from: TagLike; id: string }> } {
  const byName = new Map(theirs.map((t) => [t.name.trim().toLowerCase(), t.id]));
  const map = new Map<string, string>();
  const create: Array<{ from: TagLike; id: string }> = [];
  for (const t of used) {
    const hit = byName.get(t.name.trim().toLowerCase());
    if (hit) { map.set(t.id, hit); continue; }
    const id = newId();
    map.set(t.id, id);
    byName.set(t.name.trim().toLowerCase(), id);
    create.push({ from: t, id });
  }
  return { map, create };
}

/** Tag-IDs umschreiben; was nicht in der Zuordnung steht (z. B. Schul-Tags), bleibt. */
export function remap(ids: string[] | null | undefined, map: Map<string, string>): string[] | null {
  if (!ids || !ids.length) return ids ?? null;
  const out = [...new Set(ids.map((id) => map.get(id) || id))];
  return out.length ? out : null;
}

/**
 * Was aus einem Angebot wird. Ohne Urheberschaft gehören die Module weiter
 * dem Absender – der Empfänger kann sie dann nur noch zur Nutzung anbieten
 * (wie erworbene Module), nicht zum Kopieren.
 */
export function adjustOffer<T extends { allowCopy: boolean; allowUse: boolean; includeForeign: boolean; active: boolean }>(
  offer: T,
  withCreator: boolean,
): T {
  if (withCreator) return offer;
  const next = { ...offer, allowCopy: false, includeForeign: true };
  // Nur Copy angeboten: Das geht nicht mehr – das Angebot ruht, bis sie es neu einstellt.
  if (!offer.allowUse) next.active = false;
  return next;
}

/** Top-Level-Books bekommen den Namen des Absenders dazu, damit klar ist, woher sie kommen. */
export function bookTitle(title: string, fromName: string): string {
  const suffix = ` (von ${fromName})`;
  return title.endsWith(suffix) ? title : `${title}${suffix}`.slice(0, 200);
}
