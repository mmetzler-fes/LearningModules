/**
 * Regeln für Angebote, ohne Datenbank (offer-rules.spec.ts).
 *
 * Ein Angebot umfasst die Module eines Lernthemas, eines Notebook-Knotens
 * (Book, Bereich, Abschnitt – mit allem, was später dazukommt) oder eine feste
 * Auswahl von Modulen. Darin können eigene Module des Anbieters liegen und
 * fremde, die er als Kopie erworben hat:
 *
 *   eigene  – Copy und Use, je nachdem, was er anbietet
 *   fremde  – nur Use, und nur, wenn er sie ausdrücklich mit anbietet
 *             (`includeForeign`). Kopieren darf sie niemand weiter.
 */

export interface ModuleLike {
  id: string;
  parentId?: string | null;
  creatorId?: string | null;
  orderIndex?: number;
}

/** Module samt ihren Untermodulen, ausgehend von den gewählten Elternmodulen. */
export function withSubmodules<T extends ModuleLike>(modules: T[], rootIds: Set<string>): T[] {
  return modules.filter((m) => rootIds.has(m.id) || (!!m.parentId && rootIds.has(m.parentId)));
}

/**
 * Welche Elternmodule eines Lernthemas zum Angebot gehören.
 *
 * - `onlyIds`: feste Auswahl (Angebot „Auswahl von Modulen“), sonst alle
 * - eigene Module des Anbieters immer – außer bei `onlyForeign`
 * - fremde nur mit `includeForeign` oder `onlyForeign`
 *
 * `onlyForeign` gilt für das Nutzungsrecht, das ein Käufer beim Kopieren
 * eines gemischten Angebots für die fremden Module bekommt.
 */
export function offerRoots<T extends ModuleLike>(
  modules: T[],
  sellerId: string,
  opts: { includeForeign: boolean; onlyForeign?: boolean; onlyIds?: Set<string> | null },
): T[] {
  return modules.filter((m) => {
    if (m.parentId) return false;
    if (opts.onlyIds && !opts.onlyIds.has(m.id)) return false;
    const own = m.creatorId === sellerId;
    if (opts.onlyForeign) return !own;
    return own || opts.includeForeign;
  });
}

/**
 * Die Module eines Lernthemas, die über diese Nutzungsrechte sichtbar sind
 * (Einträge aus ShopService.expandGrants für dieses Thema). Untermodule
 * folgen ihrem Elternmodul.
 */
export function visibleFor<T extends ModuleLike>(
  modules: T[],
  entries: Array<{ scope: string; creatorId?: string | null; moduleIds?: string[] }>,
): T[] {
  if (entries.some((e) => e.scope === 'all')) return modules;
  const creators = new Set(entries.filter((e) => e.scope === 'creator').map((e) => e.creatorId).filter(Boolean) as string[]);
  const listed = new Set(entries.flatMap((e) => (e.scope === 'list' ? e.moduleIds || [] : [])));
  const direct = new Set(modules.filter((m) => (m.creatorId && creators.has(m.creatorId)) || listed.has(m.id)).map((m) => m.id));
  return modules.filter((m) => direct.has(m.id) || (!!m.parentId && direct.has(m.parentId)));
}
