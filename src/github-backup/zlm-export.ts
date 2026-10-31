import AdmZip from 'adm-zip';
import * as crypto from 'crypto';
import { contentOf, embeddedQuizIds } from '../core/public/student-view';
import { inlineRemoteImages, loadRemoteImage, LocalImage } from '../core/share/remote-images';

/**
 * Ein Dokument-Modul als .zlm – die Datei des lm-editors
 * (src/renderer/lm-editor/docs/FORMAT.md), damit sich das Backup auch ohne
 * Server öffnen lässt: eingebettete Quizze in modules/, Bilder in media/,
 * die Beschriftung der Lehrkraft als Ebene „teacher“.
 *
 * Gleicher Inhalt ergibt dieselben Bytes (feste Zeitstempel, feste
 * Reihenfolge, nichts gepackt) – sonst lüde jedes Backup alles neu hoch.
 * Ungepackt lässt Git die Stände außerdem als Differenz speichern.
 */

export const ZLM_MIME = 'application/vnd.lm-editor.zlm+zip';
const GENERATOR = 'LearningModules';
/** Zeitstempel der ZIP-Einträge – fest, damit die Bytes gleich bleiben. */
const ZIP_TIME = new Date(2020, 0, 1);
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

export interface ZlmSource {
  doc: { id: string; title?: string; content?: any; createdAt?: Date; updatedAt?: Date };
  /** Module des Themas – darunter die im Dokument eingebetteten Quizze samt Untermodulen. */
  modules: Array<{ id: string; parentId?: string | null; type: string; title?: string; description?: string; content?: any }>;
  /** Stand des Stift-Editors der Lehrkraft (document_inks.data) oder null. */
  ink?: { data: any; updatedAt?: Date } | null;
}

/** Art im lm-editor: Klassenarbeit, Arbeitsblatt, sonst Text. */
export function zlmKind(kind: unknown) {
  if (kind === 'klassenarbeit') return 'exam';
  if (kind === undefined || kind === null || kind === 'arbeitsblatt') return 'worksheet';
  return 'text';
}

/** Kennung fürs Manifest (a–z, 0–9, 8–64 Zeichen) aus der Modul-ID. */
export function zlmId(id: string) {
  const plain = String(id).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /^[a-z0-9]{8,64}$/.test(plain) ? plain : crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 32);
}

/** Stand des Stift-Editors → Ebene der Datei (wie layerOf im lm-editor, mit den eingefügten Feldern). Null, wenn nichts darauf ist. */
export function teacherLayer(stand: any) {
  if (!stand || typeof stand !== 'object') return null;
  const blocks = stand.layer?.blocks && typeof stand.layer.blocks === 'object' ? stand.layer.blocks : {};
  const inserts = Array.isArray(stand.layer?.inserts) ? stand.layer.inserts : [];
  const pages = Array.isArray(stand.pages) ? stand.pages : [];
  const empty = !Object.keys(blocks).length && !inserts.length && !pages.some((p: any) => p?.items?.length);
  if (empty) return null;
  return {
    id: 'teacher',
    role: 'teacher',
    blocks,
    ...(inserts.length ? { inserts } : {}),
    editor: { bg: stand.bg || 'paper', ruler: stand.ruler, pages: pages.length ? pages : [{ items: [] }] },
  };
}

function parseDataUrl(src: string) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(src);
  if (!m || !EXT[m[1].toLowerCase()]) return null;
  return { type: m[1].toLowerCase(), data: Buffer.from(m[2], 'base64') };
}

/**
 * Bilder des Dokuments (jedes `src` im Spec, also Bild und Bildgruppe) nach
 * media/ – aus data:-Adressen und Links. Was sich nicht holen lässt, bleibt
 * ein Link. Gleiches Bild → eine Datei (Name aus dem Inhalt).
 */
async function extractMedia(spec: any, load: (url: string) => Promise<{ type: string; data: Buffer } | null>) {
  const media = new Map<string, Buffer>();
  const cache = new Map<string, Promise<string | null>>();
  const toMedia = async (src: string) => {
    const img = src.startsWith('data:') ? parseDataUrl(src) : await load(src);
    if (!img || !EXT[img.type]) return null;
    const name = `img-${crypto.createHash('sha1').update(img.data).digest('hex').slice(0, 16)}.${EXT[img.type]}`;
    media.set(name, img.data);
    return `media/${name}`;
  };
  const visit = async (v: any): Promise<void> => {
    if (Array.isArray(v)) { for (const x of v) await visit(x); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'src' && typeof x === 'string' && /^(data:image\/|https?:\/\/)/i.test(x.trim())) {
        const src = x.trim();
        if (!cache.has(src)) cache.set(src, toMedia(src));
        const path = await cache.get(src)!;
        if (path) v[k] = path;
      } else await visit(x);
    }
  };
  await visit(spec);
  return media;
}

/** Bytes der .zlm. `local`: Bilder dieses Servers ohne HTTP-Umweg (Nextcloud). */
export async function buildZlm(src: ZlmSource, opts: { fetchImpl?: typeof fetch; local?: LocalImage } = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const content = contentOf(src.doc);
  const spec = structuredClone(content.spec && typeof content.spec === 'object' ? content.spec : { content: [] });
  const media = await extractMedia(spec, (url) => loadRemoteImage(url, fetchImpl, opts.local));

  // Eingebettete Quizze samt ihren Untermodulen; verlinkte Bilder darin als data:.
  const wanted = new Set(embeddedQuizIds({ type: 'document', content }));
  for (const m of src.modules) if (m.parentId && wanted.has(String(m.parentId))) wanted.add(String(m.id));
  const picked = src.modules
    .filter((m) => wanted.has(String(m.id)) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(m.id)))
    .map((m) => ({ id: String(m.id), ...(m.parentId ? { parentId: String(m.parentId) } : {}), type: m.type, title: m.title || '', description: m.description || '', content: contentOf(m) }));
  const { modules } = await inlineRemoteImages(picked, fetchImpl, opts.local);

  const times = [src.doc.updatedAt, src.ink?.updatedAt].filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
  const created = src.doc.createdAt instanceof Date ? src.doc.createdAt : new Date(Math.min(...times, Date.UTC(2020, 0, 1)));
  const manifest = {
    format: 'zlm',
    version: 1,
    id: zlmId(src.doc.id),
    title: src.doc.title || spec.titel || 'Dokument',
    kind: zlmKind(content.kind),
    lang: 'de',
    created: created.toISOString(),
    modified: new Date(times.length ? Math.max(...times) : created.getTime()).toISOString(),
    generator: GENERATOR,
  };

  const zip = new AdmZip(undefined, { noSort: true });
  const add = (name: string, data: Buffer) => {
    zip.addFile(name, data);
    const entry = zip.getEntry(name)!;
    entry.header.method = 0; // gespeichert, nicht gepackt
    entry.header.time = ZIP_TIME;
  };
  const json = (v: any) => Buffer.from(JSON.stringify(v, null, 1), 'utf-8');
  add('mimetype', Buffer.from(ZLM_MIME));
  add('manifest.json', json(manifest));
  add('document.json', json({ spec }));
  for (const m of [...modules].sort((a, b) => a.id.localeCompare(b.id))) add(`modules/${m.id}.json`, json(m));
  for (const name of [...media.keys()].sort()) add(`media/${name}`, media.get(name)!);
  const layer = teacherLayer(src.ink?.data);
  if (layer) add('layers/teacher.json', json(layer));
  return zip.toBuffer();
}
