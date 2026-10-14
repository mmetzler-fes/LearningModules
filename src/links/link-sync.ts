/**
 * Klassenlinks und ihre Freigabe (Regel) abgleichen – ohne Datenbank
 * (link-sync.spec.ts). Siehe docs/themen-links.md.
 *
 * Ein Klassenlink ist eine Kopie seiner Regel mit eigener Klasse und eigenem
 * Token. Ändert sich die Regel, fragt die App, welche Klassenlinks den neuen
 * Stand übernehmen. Übernommen wird, was die Freigabe beschreibt; was zur
 * Klasse gehört (Tokens, aktiv/deaktiviert, Ergebnisse), bleibt.
 */

/** Was beim Nachziehen von der Regel in den Klassenlink geht. */
export const SYNCED_FIELDS = [
  'name',
  'modes',
  'selection',
  'accessPassword',
  'singleAttempt',
  'tagIds',
  'companionSettings',
  'contestSettings',
] as const;

type Synced = { [K in (typeof SYNCED_FIELDS)[number]]?: any };

/** JSON mit sortierten Schlüsseln – gleiche Inhalte ergeben gleichen Text. */
function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Vergleichbarer Stand der übernommenen Felder. Reihenfolgen, die nichts
 * bedeuten (Tags, Modi, Themen der Auswahl, Module darin), zählen nicht;
 * leere Tags und fehlende Tags sind dasselbe.
 */
export function syncedState(link: Synced): string {
  const sorted = (a: any) => (Array.isArray(a) ? [...a].map(String).sort() : []);
  const selection = (Array.isArray(link.selection) ? link.selection : [])
    .map((s: any) => ({ topicId: s.topicId, all: !!s.all, moduleIds: s.all ? [] : sorted(s.moduleIds) }))
    .sort((a: any, b: any) => String(a.topicId).localeCompare(String(b.topicId)));
  return stable({
    name: link.name ?? '',
    modes: sorted(link.modes),
    selection,
    accessPassword: link.accessPassword || null,
    singleAttempt: !!link.singleAttempt,
    tagIds: sorted(link.tagIds),
    companionSettings: link.companionSettings ?? null,
    contestSettings: link.contestSettings ?? null,
  });
}

/** Weicht der Klassenlink von seiner Regel ab? */
export function differsFromRule(link: Synced, rule: Synced): boolean {
  return syncedState(link) !== syncedState(rule);
}

/** Stand der Regel in den Klassenlink übernehmen (Kopien, keine geteilten Objekte). */
export function applyRule<T extends Synced & { customized?: boolean }>(link: T, rule: Synced): T {
  for (const key of SYNCED_FIELDS) {
    const value = rule[key];
    (link as any)[key] = value === undefined ? null : JSON.parse(JSON.stringify(value));
  }
  link.customized = false;
  return link;
}
