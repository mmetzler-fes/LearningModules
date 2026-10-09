/** Einträge in Zielgruppen: Benutzer-ID oder 'group:<id>'. Eigene Datei, damit der Shop sie ohne den GroupsService importieren kann. */

/** Präfix, mit dem eine Gruppe in der Zielgruppe eines Shop-Angebots steht. */
export const GROUP_PREFIX = 'group:';

/** Macht aus einer Gruppen-ID den Eintrag, wie er in der Zielgruppe eines Angebots steht. */
export const groupRef = (id: string) => `${GROUP_PREFIX}${id}`;

/** Die Gruppen-ID aus einem Eintrag, oder null bei einer Einzelperson. */
export const groupIdOf = (entry: string): string | null =>
  typeof entry === 'string' && entry.startsWith(GROUP_PREFIX)
    ? entry.slice(GROUP_PREFIX.length)
    : null;
