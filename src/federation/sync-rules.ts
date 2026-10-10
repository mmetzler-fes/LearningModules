/**
 * Regeln für den Abgleich eigener Inhalte zwischen verknüpften Konten, ohne
 * Datenbank (sync-rules.spec.ts). Siehe docs/uebergabe.md.
 */
import * as crypto from 'crypto';

export interface SyncModule {
  /** Kennung, die über Server hinweg gleich bleibt (Herkunft) */
  key: string;
  parentKey: string | null;
  type: string;
  title: string;
  description: string | null;
  content: any;
  orderIndex: number;
  moduleSelected: boolean;
}

/** JSON mit sortierten Schlüsseln – gleiche Inhalte ergeben gleiche Zeichen. */
export function stable(v: any): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** Prüfsumme eines Lernthemas: Titel, Beschreibung und alle Module. */
export function topicHash(title: string, description: string | null, modules: SyncModule[]): string {
  const mods = [...modules].sort((a, b) => a.key.localeCompare(b.key)).map((m) => [
    m.key, m.parentKey, m.type, m.title, m.description || '', m.content ?? null, m.orderIndex, m.moduleSelected !== false,
  ]);
  return crypto.createHash('sha256').update(stable([title, description || '', mods])).digest('hex');
}

export type SyncDecision = 'create' | 'update' | 'unchanged' | 'conflict';

/**
 * Was mit einem Lernthema geschieht:
 *   create    – gibt es hier noch nicht
 *   unchanged – drüben seit dem letzten Abgleich nicht geändert
 *   update    – drüben geändert, hier nicht: übernehmen
 *   conflict  – hier seit dem letzten Abgleich geändert: nicht überschreiben
 */
export function decide(existing: { syncHash: string | null; localHash: string } | null, incomingHash: string): SyncDecision {
  if (!existing) return 'create';
  if (existing.localHash !== existing.syncHash) return existing.localHash === incomingHash ? 'unchanged' : 'conflict';
  return existing.syncHash === incomingHash ? 'unchanged' : 'update';
}

/** Module abgleichen über ihre Kennung: ändern, neu anlegen, entfernen. */
export function planModules<T extends { key: string }>(here: T[], incoming: SyncModule[]) {
  const byKey = new Map(here.map((m) => [m.key, m]));
  const keys = new Set(incoming.map((m) => m.key));
  return {
    update: incoming.filter((m) => byKey.has(m.key)).map((m) => ({ here: byKey.get(m.key)!, next: m })),
    create: incoming.filter((m) => !byKey.has(m.key)),
    remove: here.filter((m) => !keys.has(m.key)),
  };
}

/** Code zum Verknüpfen: 8 Zeichen ohne Verwechslungsgefahr (kein 0/O, 1/I/L). */
export function newLinkCode(): string {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((b) => abc[b % abc.length]).join('').replace(/^(.{4})/, '$1-');
}

export function cleanCode(v: unknown): string {
  const s = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : '';
}
