import { BadRequestException } from '@nestjs/common';

/**
 * Zugriff auf einen freigegebenen Ordner in der Nextcloud einer Lehrkraft:
 * WebDAV über den Freigabelink mit Passwort – kein Benutzerkonto, kein
 * App-Passwort. Ohne Abhängigkeiten.
 */

type Fetch = typeof fetch;

export interface DavEntry {
  name: string;
  isFolder: boolean;
  contentType: string;
  size: number;
  modified: string;
}

/**
 * Adresse der Nextcloud aus dem, was eine Lehrkraft einträgt – auch aus einer
 * kopierten Browser-Adresse wie https://cloud.x.de/index.php/apps/files/?dir=/.
 * Nur https. Ergebnis ohne abschließenden Schrägstrich oder null.
 */
export function parseNextcloudBase(input: string): string | null {
  let u: URL;
  try {
    u = new URL(String(input || '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const cut = u.pathname.search(/\/(index\.php|apps|remote\.php|ocs|s|login|f)(\/|$)/);
  const path = (cut >= 0 ? u.pathname.slice(0, cut) : u.pathname).replace(/\/+$/, '');
  return `${u.origin}${path}`;
}

/** Ordnername ohne Schrägstriche und Zeichen, die Nextcloud ablehnt. */
export function safeFolderName(name: string, fallback = 'Ohne-Titel'): string {
  const clean = String(name || '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return clean || fallback;
}

/** Pfad aus Teilen, jeder Teil einzeln kodiert. */
export function encodePath(parts: string[]): string {
  return parts.filter(Boolean).map((p) => encodeURIComponent(p)).join('/');
}

/** Öffentliche Lese-URL einer Datei in der Bilder-Freigabe. */
export function shareFileUrl(base: string, token: string, sub: string, name: string): string {
  return `${base}/s/${token}/download?path=${encodeURIComponent(`/${sub}`)}&files=${encodeURIComponent(name)}`;
}

/** Verkleinerte Vorschau derselben Datei (für die Bildauswahl). */
export function sharePreviewUrl(base: string, token: string, sub: string, name: string, size = 256): string {
  return `${base}/index.php/apps/files_sharing/publicpreview/${token}?file=${encodeURIComponent(`/${sub}/${name}`)}&x=${size}&y=${size}&a=1`;
}

/** Antwort eines PROPFIND (Tiefe 1) in Einträge zerlegen; der Ordner selbst fällt weg. */
export function parsePropfind(xml: string, folderHref: string): DavEntry[] {
  const tag = (block: string, name: string) => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([^<]*)</(?:[\\w-]+:)?${name}>`, 'i').exec(block)?.[1] ?? '';
  const norm = (h: string) => decodeURIComponent(h).replace(/\/+$/, '');
  const self = norm(new URL(folderHref, 'https://x').pathname);
  const out: DavEntry[] = [];
  for (const m of xml.matchAll(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi)) {
    const block = m[0];
    const href = tag(block, 'href');
    if (!href) continue;
    const path = norm(new URL(href, 'https://x').pathname);
    if (path === self) continue;
    out.push({
      name: path.split('/').pop() || '',
      isFolder: /<(?:[\w-]+:)?collection\s*\/>/i.test(block),
      contentType: tag(block, 'getcontenttype'),
      size: Number(tag(block, 'getcontentlength')) || 0,
      modified: tag(block, 'getlastmodified'),
    });
  }
  return out.filter((e) => e.name);
}

const PROPFIND_BODY = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop>'
  + '<d:resourcetype/><d:getcontenttype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>';

/**
 * WebDAV einer Freigabe: klassisch unter /public.php/webdav (Benutzer = Kürzel
 * der Freigabe) oder neuer unter /public.php/dav/files/<Kürzel> (Benutzer
 * "anonymous"). Welcher Weg geht, hängt von der Nextcloud-Version ab.
 */
export type DavMode = 'classic' | 'files';

/**
 * Zugriff über eine Ordnerfreigabe mit Passwort – die App sieht nur diesen
 * Ordner, kein Konto der Lehrkraft. Zum Hochladen braucht die Freigabe
 * „Hochladen und Bearbeiten erlauben“. `fetchImpl` lässt sich in Tests ersetzen.
 */
export class ShareClient {
  /** Fester WebDAV-Ordner samt Benutzer (Admin-Backup mit Konto) statt einer Freigabe. */
  private fixed: { root: string; user: string } | null = null;

  constructor(
    readonly base: string,
    readonly token: string,
    private readonly password: string,
    public mode: DavMode = 'classic',
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  /**
   * Ein WebDAV-Ordner, den das Admin-Backup über ein Konto erreicht
   * (…/remote.php/dav/files/<Benutzer>/<Ordner>/). Nur für den früheren Schulordner.
   */
  static accountFolder(rootUrl: string, user: string, password: string, fetchImpl: Fetch = fetch) {
    const c = new ShareClient(new URL(rootUrl).origin, '', password, 'classic', fetchImpl);
    c.fixed = { root: rootUrl.replace(/\/+$/, ''), user };
    return c;
  }

  private url(parts: string[]) {
    const root = this.fixed ? this.fixed.root
      : this.mode === 'classic' ? `${this.base}/public.php/webdav` : `${this.base}/public.php/dav/files/${this.token}`;
    const path = encodePath(parts);
    return path ? `${root}/${path}` : `${root}/`;
  }

  private auth() {
    const user = this.fixed ? this.fixed.user : this.mode === 'classic' ? this.token : 'anonymous';
    return 'Basic ' + Buffer.from(`${user}:${this.password}`).toString('base64');
  }

  async request(method: string, parts: string[], opts: { body?: any; headers?: Record<string, string> } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      return await this.fetchImpl(this.url(parts), {
        method,
        redirect: 'manual', // keine Weiterleitung auf andere (ggf. interne) Ziele
        signal: ctrl.signal,
        headers: { Authorization: this.auth(), 'X-Requested-With': 'XMLHttpRequest', ...(opts.headers || {}) },
        body: opts.body,
      });
    } catch (err: any) {
      throw new BadRequestException(err?.name === 'AbortError'
        ? 'Die Nextcloud antwortet nicht (Zeitüberschreitung).'
        : 'Die Nextcloud ist nicht erreichbar – stimmt der Freigabelink?');
    } finally {
      clearTimeout(timer);
    }
  }

  private fail(status: number, what: string): never {
    if (status === 401) throw new BadRequestException('Das Passwort der Freigabe stimmt nicht.');
    if (status === 403) throw new BadRequestException(`Die Freigabe erlaubt das nicht (${what}) – in der Nextcloud „Hochladen und Bearbeiten erlauben“ wählen.`);
    if (status === 404) throw new BadRequestException('Die Freigabe wurde nicht gefunden oder ist abgelaufen.');
    if (status === 507) throw new BadRequestException('In der Nextcloud ist kein Speicherplatz mehr frei.');
    if (status >= 300 && status < 400) throw new BadRequestException('Die Nextcloud leitet um – bitte den Freigabelink genau so eintragen, wie die Nextcloud ihn anzeigt.');
    throw new BadRequestException(`Nextcloud antwortet mit Fehler ${status} (${what}).`);
  }

  /**
   * Welcher WebDAV-Weg geht? Erst klassisch, dann der neuere. Wirft mit
   * verständlicher Meldung, wenn keiner geht (Passwort falsch, Link ungültig).
   */
  async detectMode(): Promise<DavMode> {
    let last = 0;
    for (const mode of ['classic', 'files'] as DavMode[]) {
      this.mode = mode;
      const res = await this.request('PROPFIND', [], { body: PROPFIND_BODY, headers: { Depth: '0', 'Content-Type': 'application/xml' } });
      if (res.status === 207) return mode;
      last = res.status;
    }
    this.fail(last || 404, 'Freigabe öffnen');
  }

  async ensureFolder(parts: string[]) {
    for (let i = 1; i <= parts.length; i++) {
      const res = await this.request('MKCOL', parts.slice(0, i));
      if (res.status !== 201 && res.status !== 405) this.fail(res.status, `Ordner ${parts.slice(0, i).join('/')} anlegen`);
    }
  }

  async exists(parts: string[]): Promise<boolean> {
    const res = await this.request('PROPFIND', parts, { headers: { Depth: '0' } });
    if (res.status === 404) return false;
    if (res.status === 207 || res.ok) return true;
    this.fail(res.status, 'Datei prüfen');
  }

  async list(parts: string[]): Promise<DavEntry[]> {
    const res = await this.request('PROPFIND', parts, { body: PROPFIND_BODY, headers: { Depth: '1', 'Content-Type': 'application/xml' } });
    if (res.status === 404) return [];
    if (res.status !== 207) this.fail(res.status, 'Ordner lesen');
    return parsePropfind(await res.text(), this.url(parts));
  }

  async put(parts: string[], data: Buffer, contentType: string) {
    const res = await this.request('PUT', parts, { body: new Uint8Array(data), headers: { 'Content-Type': contentType || 'application/octet-stream' } });
    if (!res.ok) this.fail(res.status, 'Hochladen');
  }

  /** Datei lesen; null, wenn es sie nicht gibt. */
  async get(parts: string[]): Promise<{ type: string; data: Buffer } | null> {
    const res = await this.request('GET', parts);
    if (res.status === 404) return null;
    if (!res.ok) this.fail(res.status, 'Lesen');
    return { type: String(res.headers.get('content-type') || ''), data: Buffer.from(await res.arrayBuffer()) };
  }

  async remove(parts: string[]) {
    await this.request('DELETE', parts).catch(() => undefined);
  }
}
