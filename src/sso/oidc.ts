import * as crypto from 'crypto';

/**
 * OpenID Connect – nur, was LearningModules braucht (docs/sso.md): Discovery, PKCE und die Prüfung
 * des ID-Tokens (RS256) über die öffentlichen Schlüssel des Anbieters. Ohne Bibliothek, damit
 * dieselbe Prüfung später auch LTI 1.3 dient.
 */

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface IdClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  tid?: string;
  oid?: string;
  email?: string;
  preferred_username?: string;
  upn?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  [k: string]: unknown;
}

const HOUR = 60 * 60 * 1000;
const discoveryCache = new Map<string, { at: number; value: OidcDiscovery }>();
const jwksCache = new Map<string, { at: number; keys: any[] }>();

/** Discovery-Adresse eines Microsoft-Mandanten (GUID oder Domäne, z. B. schule.de). */
export function microsoftDiscoveryUrl(tenant: string): string {
  const t = String(tenant || '').trim();
  if (!/^[a-z0-9.-]{3,100}$/i.test(t)) throw new Error('Ungültige Mandanten-ID.');
  return `https://login.microsoftonline.com/${encodeURIComponent(t)}/v2.0/.well-known/openid-configuration`;
}

async function getJson(url: string, fetcher: typeof fetch): Promise<any> {
  const res = await fetcher(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function discover(url: string, fetcher: typeof fetch = fetch): Promise<OidcDiscovery> {
  const hit = discoveryCache.get(url);
  if (hit && Date.now() - hit.at < HOUR) return hit.value;
  const v = await getJson(url, fetcher);
  for (const k of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (typeof v?.[k] !== 'string' || !/^https:\/\//.test(v[k]) && k !== 'issuer') throw new Error(`Discovery ohne ${k}.`);
  }
  const value = { issuer: v.issuer, authorization_endpoint: v.authorization_endpoint, token_endpoint: v.token_endpoint, jwks_uri: v.jwks_uri };
  discoveryCache.set(url, { at: Date.now(), value });
  return value;
}

async function keysOf(uri: string, fetcher: typeof fetch, fresh = false): Promise<any[]> {
  const hit = jwksCache.get(uri);
  if (!fresh && hit && Date.now() - hit.at < HOUR) return hit.keys;
  const v = await getJson(uri, fetcher);
  const keys = Array.isArray(v?.keys) ? v.keys : [];
  jwksCache.set(uri, { at: Date.now(), keys });
  return keys;
}

const b64url = (b: Buffer) => b.toString('base64url');

/** PKCE (S256): Prüfwert für die Anfrage, Geheimnis für den Tausch des Codes. */
export function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export const randomToken = (bytes = 24) => b64url(crypto.randomBytes(bytes));

export function decodeJwt(token: string) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Kein gültiges Token.');
  const parse = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  return { header: parse(parts[0]), payload: parse(parts[1]), signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') };
}

/**
 * ID-Token prüfen: Signatur (RS256, Schlüssel per `kid` aus den JWKS des Anbieters), Aussteller,
 * Empfänger, Ablauf und nonce. Wirft mit einer verständlichen Meldung.
 */
export async function verifyIdToken(
  token: string,
  opts: { jwksUri: string; issuer: string; audience: string; nonce?: string; now?: number; fetcher?: typeof fetch; keys?: any[] },
): Promise<IdClaims> {
  const { header, payload, signingInput, signature } = decodeJwt(token);
  if (header?.alg !== 'RS256') throw new Error('Unerwartetes Signaturverfahren.');
  const fetcher = opts.fetcher || fetch;
  let keys = opts.keys || (await keysOf(opts.jwksUri, fetcher));
  let jwk = keys.find((k) => k.kid === header.kid);
  // Der Anbieter hat seine Schlüssel gewechselt: einmal frisch holen.
  if (!jwk && !opts.keys) {
    keys = await keysOf(opts.jwksUri, fetcher, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error('Unbekannter Signaturschlüssel.');
  const key = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
  if (!crypto.verify('RSA-SHA256', Buffer.from(signingInput), key, signature)) throw new Error('Signatur ungültig.');

  const claims = payload as IdClaims;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (claims.iss !== opts.issuer) throw new Error('Falscher Aussteller.');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.audience)) throw new Error('Token ist nicht für diese App.');
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new Error('Anmeldung abgelaufen.');
  if (typeof claims.iat === 'number' && claims.iat > now + 300) throw new Error('Token aus der Zukunft.');
  if (opts.nonce !== undefined && claims.nonce !== opts.nonce) throw new Error('Anmeldung passt nicht zur Anfrage.');
  return claims;
}

/** E-Mail aus den Angaben: email, sonst der Anmeldename (UPN). */
export function emailOf(c: IdClaims): string {
  const v = c.email || c.preferred_username || c.upn || '';
  return String(v).trim().toLowerCase();
}

/** Vor- und Nachname; sonst aus dem Anzeigenamen geteilt. */
export function namesOf(c: IdClaims): { firstName: string; lastName: string; name: string } {
  const name = String(c.name || '').trim();
  let firstName = String(c.given_name || '').trim();
  let lastName = String(c.family_name || '').trim();
  if (!firstName && !lastName && name) {
    // „Nachname, Vorname“ (häufig in Schul-Mandanten) oder „Vorname Nachname“
    if (name.includes(',')) [lastName, firstName] = name.split(',').map((s) => s.trim());
    else { const parts = name.split(/\s+/); lastName = parts.length > 1 ? parts.pop()! : ''; firstName = parts.join(' '); }
  }
  return { firstName, lastName, name: name || `${firstName} ${lastName}`.trim() };
}
