import AdmZip from 'adm-zip';
import { ZLM_MIME } from '../github-backup/zlm-export';

/**
 * .zlm auf dem Server lesen (Gegenstück zu zlm-export.ts; dieselben Regeln wie
 * readZlm im lm-editor, docs/FORMAT.md dort): für „Aus der Nextcloud
 * übernehmen“ und das Wiederherstellen.
 */
export interface ZlmContent {
  manifest: { kind: string; title: string; module?: string; id?: string; [k: string]: any };
  spec: any;
  modules: Record<string, any>;
  media: Record<string, Buffer>;
  layers: Record<string, any>;
}

const LIMITS = { entries: 2000, entryBytes: 50e6, totalBytes: 200e6 };
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const KINDS = ['worksheet', 'exam', 'text', 'module'];
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

export function readZlmBuffer(buf: Buffer): ZlmContent {
  let zip: AdmZip;
  try { zip = new AdmZip(buf); } catch { throw new Error('Die Datei ist keine gültige .zlm (kein lesbares ZIP).'); }
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length > LIMITS.entries) throw new Error('Die Datei enthält zu viele Einträge.');
  let total = 0;
  for (const e of entries) {
    const size = Number(e.header.size) || 0;
    if (size > LIMITS.entryBytes) throw new Error(`„${e.entryName}“ ist zu groß.`);
    total += size;
    if (total > LIMITS.totalBytes) throw new Error('Die Datei ist ausgepackt zu groß.');
    const p = e.entryName;
    if (p.includes('\\') || p.startsWith('/') || p.split('/').includes('..')) throw new Error(`Unzulässiger Pfad in der Datei: „${p}“.`);
  }
  const byName = new Map(entries.map((e) => [e.entryName, e]));
  const text = (n: string) => byName.get(n)?.getData().toString('utf-8') ?? null;
  const json = (n: string) => {
    const t = text(n);
    if (t === null) return null;
    try { return JSON.parse(t); } catch { throw new Error(`${n} ist kein gültiges JSON.`); }
  };
  if (text('mimetype')?.trim() !== ZLM_MIME) throw new Error('Die Datei ist keine .zlm (mimetype fehlt oder stimmt nicht).');
  const manifest = json('manifest.json');
  if (!manifest || manifest.format !== 'zlm') throw new Error('manifest.json fehlt oder ist keine .zlm-Beschreibung.');
  if (!Number.isInteger(manifest.version) || manifest.version < 1) throw new Error('manifest.json: version fehlt.');
  if (manifest.version > 1) throw new Error(`Die Datei hat Formatversion ${manifest.version} – bitte LearningModules aktualisieren.`);
  if (!KINDS.includes(manifest.kind)) manifest.kind = 'worksheet';
  const document = json('document.json');
  if (!document || typeof document.spec !== 'object' || !document.spec || Array.isArray(document.spec)) throw new Error('document.json fehlt oder enthält kein Dokument.');
  const out: ZlmContent = { manifest, spec: document.spec, modules: {}, media: {}, layers: {} };
  for (const e of entries) {
    const [dir, name, ...rest] = e.entryName.split('/');
    if (rest.length || !name) continue;
    if (!NAME_RE.test(name)) throw new Error(`Unzulässiger Dateiname: „${e.entryName}“.`);
    if (dir === 'modules' && name.endsWith('.json')) out.modules[name.slice(0, -5)] = json(e.entryName);
    else if (dir === 'layers' && name.endsWith('.json')) out.layers[name.slice(0, -5)] = json(e.entryName);
    else if (dir === 'media') out.media[name] = e.getData();
  }
  if (manifest.kind === 'module' && (typeof manifest.module !== 'string' || !out.modules[manifest.module])) {
    throw new Error('Art „module“: manifest.module nennt kein Modul in modules/.');
  }
  return out;
}

/** Bilder aus media/ zurück als data:-Adressen (die App speichert sie so; das Auslagern bringt sie wieder in die Nextcloud). */
export function inlineMedia(spec: any, media: Record<string, Buffer>): any {
  const visit = (v: any): any => {
    if (Array.isArray(v)) return v.map(visit);
    if (!v || typeof v !== 'object') return v;
    const o: any = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'src' && typeof x === 'string' && x.startsWith('media/') && media[x.slice(6)]) {
        const name = x.slice(6);
        o[k] = `data:${MIME[name.split('.').pop()!.toLowerCase()] || 'application/octet-stream'};base64,${media[name].toString('base64')}`;
      } else o[k] = visit(x);
    }
    return o;
  };
  return visit(spec);
}

/** Ebene der Datei → Stand des Stift-Editors (wie editorStateOf im lm-editor). */
export function inkStandOf(layer: any) {
  if (!layer || typeof layer !== 'object') return null;
  const e = layer.editor || {};
  const inserts = Array.isArray(layer.inserts) && layer.inserts.length ? { inserts: layer.inserts } : {};
  return { v: 1, bg: e.bg || 'paper', ruler: e.ruler, pages: e.pages || [{ items: [] }], layer: { blocks: layer.blocks || {}, ...inserts } };
}
