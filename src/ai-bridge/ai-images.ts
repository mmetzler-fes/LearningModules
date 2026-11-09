/**
 * Bilder für die KI: Dokumente tragen ihre Bilder als `data:image/…;base64,…`
 * – oft Megabytes. Die KI sieht stattdessen kurze Verweise `lm-img:<hash>`
 * und schreibt sie unverändert zurück; der Server setzt beim Speichern die
 * echten Bilder wieder ein. So bleiben Grafiken beim Neuaufbereiten erhalten,
 * ohne den Kontext der KI zu sprengen.
 */
import * as crypto from 'crypto';

const DATA_URI = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
const REF = /lm-img:[a-f0-9]{12}/g;

export interface MaskedImage {
  ref: string;
  mime: string;
  kb: number;
}

export function imageRef(dataUri: string): string {
  return `lm-img:${crypto.createHash('sha256').update(dataUri).digest('hex').slice(0, 12)}`;
}

/** Alle Zeichenketten eines JSON-Werts umschreiben (Objekte und Listen werden kopiert). */
function mapStrings(value: any, fn: (s: string) => string): any {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, fn);
    return out;
  }
  return value;
}

/** Eingebettete Bilder → `lm-img:`-Verweise, dazu eine Liste der Bilder (Art, Größe). */
export function maskImages<T>(value: T): { value: T; images: MaskedImage[] } {
  const images = new Map<string, MaskedImage>();
  const masked = mapStrings(value, (s) => s.replace(DATA_URI, (uri) => {
    const ref = imageRef(uri);
    if (!images.has(ref)) images.set(ref, { ref, mime: /^data:(image\/[^;]+)/.exec(uri)?.[1] || 'image', kb: Math.round((uri.length * 3) / 4 / 1024) });
    return ref;
  }));
  return { value: masked, images: [...images.values()] };
}

/** Bilder aus beliebigen Inhalten sammeln: Verweis → Daten-URI. */
export function collectImages(values: any[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const v of values) {
    mapStrings(v, (s) => {
      for (const uri of s.match(DATA_URI) || []) found.set(imageRef(uri), uri);
      return s;
    });
  }
  return found;
}

/** `lm-img:`-Verweise wieder durch die Bilder ersetzen; unbekannte Verweise werden gemeldet. */
export function unmaskImages<T>(value: T, known: Map<string, string>): { value: T; unknown: string[] } {
  const unknown = new Set<string>();
  const restored = mapStrings(value, (s) => s.replace(REF, (ref) => {
    const uri = known.get(ref);
    if (!uri) { unknown.add(ref); return ref; }
    return uri;
  }));
  return { value: restored, unknown: [...unknown] };
}
