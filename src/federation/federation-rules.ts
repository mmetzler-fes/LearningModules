/**
 * Regeln für die Vernetzung, ohne Datenbank (federation-rules.spec.ts).
 * Siehe docs/vernetzung.md.
 */
import * as crypto from 'crypto';

/** So weit darf die Uhr eines signierten Aufrufs abweichen. */
export const MAX_SKEW_MS = 5 * 60 * 1000;

export const HEADER_SERVER = 'x-lm-server';
export const HEADER_DATE = 'x-lm-date';
export const HEADER_SIGNATURE = 'x-lm-signature';

/**
 * Was signiert wird: Methode, Pfad samt Abfrage, Zeitpunkt und der Hash des
 * Inhalts. Mit Zeitpunkt, damit ein mitgeschnittener Aufruf nicht beliebig
 * später wiederholt werden kann.
 */
export function canonical(method: string, path: string, date: string, body: Buffer | string | null | undefined): string {
  const hash = crypto.createHash('sha256').update(body || '').digest('hex');
  return [method.toUpperCase(), path, date, hash].join('\n');
}

export function newKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

export function sign(privateKey: string, text: string): string {
  const key = crypto.createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  return crypto.sign(null, Buffer.from(text), key).toString('base64');
}

export function verify(publicKey: string, text: string, signature: string): boolean {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(text), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

/** Kurzer Fingerabdruck eines öffentlichen Schlüssels, zum Vergleichen am Telefon. */
export function fingerprint(publicKey: string): string {
  const hex = crypto.createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex').slice(0, 16).toUpperCase();
  return hex.match(/.{4}/g)!.join('-');
}

/** Liegt der Zeitpunkt nah genug an jetzt? */
export function freshDate(date: string, now = Date.now()): boolean {
  const t = Date.parse(date);
  return Number.isFinite(t) && Math.abs(now - t) <= MAX_SKEW_MS;
}

/**
 * Adresse eines Servers: nur Schema und Host (samt Port), ohne Pfad und ohne
 * Schrägstrich am Ende. Nur https – http allein mit `allowHttp` (zum Testen).
 * Liefert null, wenn die Eingabe keine taugliche Adresse ist.
 */
export function normalizeUrl(input: unknown, allowHttp = false): string | null {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) return null;
  if (u.username || u.password) return null;
  return `${u.protocol}//${u.host}`;
}

/** Kennung einer Person oder eines Moduls auf einem anderen Server. */
export function remoteRef(peerId: string, id: string): string {
  return `remote:${peerId}:${id}`;
}

export function parseRemoteRef(ref: string | null | undefined): { peerId: string; id: string } | null {
  const m = /^remote:([^:]+):(.+)$/.exec(String(ref || ''));
  return m ? { peerId: m[1], id: m[2] } : null;
}

export interface RemoteCategory {
  id: string;
  facet: string;
  parentId: string | null;
  label: string;
}

/**
 * Kategorien eines fremden Angebots auf die hiesigen abbilden: Was es hier
 * gibt, bleibt; einen nur dort ergänzten Begriff ersetzt sein nächster
 * Oberbegriff, den es hier gibt. So bleibt ein Angebot unter
 * „Automatisierungstechnik“ auffindbar, auch wenn sein genauer Begriff nur
 * dort existiert.
 */
export function mapCategories(ids: string[], theirs: RemoteCategory[], known: Set<string>): string[] {
  const byId = new Map(theirs.map((c) => [c.id, c]));
  const out = new Set<string>();
  for (const id of ids) {
    let cur: string | null = id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (known.has(cur)) { out.add(cur); break; }
      cur = byId.get(cur)?.parentId ?? null;
    }
  }
  return [...out];
}

/** Höchstens so viele Angebote nimmt ein Katalogabgleich an. */
export const MAX_REMOTE_OFFERS = 2000;
