import { assertPublicHost } from './nextcloud-upload';

/**
 * Für H5P- und Moodle-Export: Bilder, die nur verlinkt sind (z. B. aus der
 * Nextcloud der Lehrkraft), holen und als data:-URL einsetzen – die Exporte
 * betten data:-Bilder als Datei ein. Sonst hinge die .h5p- bzw. .xml-Datei
 * von einer fremden Freigabe ab, die später verschwinden kann.
 *
 * Der Server holt dabei von Adressen, die eine Lehrkraft eingetragen hat:
 * nur http(s), nur öffentliche Hosts, keine Weiterleitungen, nur Bildtypen,
 * höchstens MAX_BYTES. Was nicht klappt, bleibt ein Link.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
/** Felder, in denen ein Bild-Link steht: imageUrl, backgroundImage, aImage, bImage, imageFile … */
const IMAGE_KEY = /image|background/i;

type Fetch = typeof fetch;
/** Bilder, die dieser Server selbst ausliefert (Nextcloud über den Server), ohne HTTP-Umweg holen. */
export type LocalImage = (url: string) => Promise<{ type: string; data: Buffer } | null>;

async function fetchImage(url: string, fetchImpl: Fetch): Promise<{ type: string; data: Buffer } | null> {
  try {
    await assertPublicHost(new URL(url).origin);
  } catch {
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetchImpl(url, { redirect: 'manual', signal: ctrl.signal });
    if (!res.ok) return null;
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!TYPES.has(type)) return null;
    if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_BYTES) return null;
    return { type, data };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Ein verlinktes Bild holen – erst über `local`, sonst aus dem Netz (Regeln oben). Null, wenn es nicht klappt. */
export async function loadRemoteImage(url: string, fetchImpl: Fetch = fetch, local?: LocalImage): Promise<{ type: string; data: Buffer } | null> {
  const own = local ? await local(url).catch(() => null) : null;
  if (own && TYPES.has(own.type) && own.data.length <= MAX_BYTES) return own;
  return fetchImage(url, fetchImpl);
}

/**
 * Kopien der Module, verlinkte Bilder eingebettet. `failed`: Links, die sich
 * nicht holen ließen (bleiben als Link stehen).
 */
export async function inlineRemoteImages<T extends { content?: any }>(modules: T[], fetchImpl: Fetch = fetch, local?: LocalImage): Promise<{ modules: T[]; failed: string[] }> {
  const load = async (url: string) => {
    const img = await loadRemoteImage(url, fetchImpl, local);
    return img ? `data:${img.type};base64,${img.data.toString('base64')}` : null;
  };
  const cache = new Map<string, Promise<string | null>>();
  const failed = new Set<string>();
  const visit = async (value: any): Promise<any> => {
    if (Array.isArray(value)) return Promise.all(value.map(visit));
    if (!value || typeof value !== 'object') return value;
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string' && IMAGE_KEY.test(k) && /^https?:\/\//i.test(v.trim())) {
        const url = v.trim();
        if (!cache.has(url)) cache.set(url, load(url));
        const data = await cache.get(url)!;
        if (!data) failed.add(url);
        out[k] = data || v;
      } else {
        out[k] = await visit(v);
      }
    }
    return out;
  };
  const copies = await Promise.all(modules.map(async (m) => {
    let content = m.content;
    if (typeof content === 'string') { try { content = JSON.parse(content); } catch { /* bleibt Text */ } }
    return { ...m, content: await visit(content) } as T;
  }));
  return { modules: copies, failed: [...failed] };
}
