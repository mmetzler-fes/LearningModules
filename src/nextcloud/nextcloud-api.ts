import { BadRequestException } from '@nestjs/common';

/**
 * Zugriff auf die Nextcloud einer Lehrkraft mit Benutzer und App-Passwort:
 * WebDAV für Ordner und Dateien, OCS für Benutzerdaten und Freigaben.
 * Ohne Abhängigkeiten; `fetchImpl` lässt sich in Tests ersetzen.
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

export class NextcloudClient {
  constructor(
    readonly base: string,
    private readonly login: string,
    private readonly password: string,
    /** Benutzer-ID für WebDAV; ohne sie gilt der Anmeldename. */
    private davUser: string | null = null,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async request(method: string, url: string, opts: { body?: any; headers?: Record<string, string> } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      return await this.fetchImpl(url, {
        method,
        redirect: 'manual', // keine Weiterleitung auf andere (ggf. interne) Ziele
        signal: ctrl.signal,
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${this.login}:${this.password}`).toString('base64'),
          'X-Requested-With': 'XMLHttpRequest',
          'OCS-APIRequest': 'true',
          ...(opts.headers || {}),
        },
        body: opts.body,
      });
    } catch (err: any) {
      throw new BadRequestException(err?.name === 'AbortError'
        ? 'Die Nextcloud antwortet nicht (Zeitüberschreitung).'
        : 'Die Nextcloud ist nicht erreichbar – stimmt die Adresse?');
    } finally {
      clearTimeout(timer);
    }
  }

  private fail(status: number, what: string): never {
    if (status === 401) throw new BadRequestException('Benutzername oder App-Passwort stimmt nicht.');
    if (status === 403) throw new BadRequestException(`Keine Berechtigung (${what}).`);
    if (status === 507) throw new BadRequestException('In der Nextcloud ist kein Speicherplatz mehr frei.');
    if (status >= 300 && status < 400) throw new BadRequestException('Die Nextcloud leitet um – bitte die Adresse genau so eintragen, wie sie im Browser steht (https://…).');
    throw new BadRequestException(`Nextcloud antwortet mit Fehler ${status} (${what}).`);
  }

  private dav(parts: string[]) {
    return `${this.base}/remote.php/dav/files/${encodeURIComponent(this.davUser || this.login)}/${encodePath(parts)}`;
  }

  /** Anmeldung prüfen; liefert Benutzer-ID und Anzeigename. */
  async userInfo(): Promise<{ id: string; displayName: string }> {
    const res = await this.request('GET', `${this.base}/ocs/v2.php/cloud/user?format=json`, { headers: { Accept: 'application/json' } });
    if (!res.ok) this.fail(res.status, 'Anmeldung');
    let data: any;
    try { data = await res.json(); } catch { throw new BadRequestException('Unter dieser Adresse antwortet keine Nextcloud.'); }
    const id = data?.ocs?.data?.id;
    if (!id) throw new BadRequestException('Unter dieser Adresse antwortet keine Nextcloud.');
    this.davUser = String(id);
    return { id: String(id), displayName: String(data.ocs.data['display-name'] || data.ocs.data.displayname || id) };
  }

  /** Ordner samt aller übergeordneten anlegen, wo sie fehlen. */
  async ensureFolder(parts: string[]) {
    for (let i = 1; i <= parts.length; i++) {
      const res = await this.request('MKCOL', this.dav(parts.slice(0, i)));
      if (res.status !== 201 && res.status !== 405) this.fail(res.status, `Ordner ${parts.slice(0, i).join('/')} anlegen`);
    }
  }

  async exists(parts: string[]): Promise<boolean> {
    const res = await this.request('PROPFIND', this.dav(parts), { headers: { Depth: '0' } });
    if (res.status === 404) return false;
    if (res.status === 207 || res.ok) return true;
    this.fail(res.status, 'Datei prüfen');
  }

  async list(parts: string[]): Promise<DavEntry[]> {
    const url = this.dav(parts);
    const res = await this.request('PROPFIND', url, { body: PROPFIND_BODY, headers: { Depth: '1', 'Content-Type': 'application/xml' } });
    if (res.status === 404) return [];
    if (res.status !== 207) this.fail(res.status, 'Ordner lesen');
    return parsePropfind(await res.text(), url);
  }

  async put(parts: string[], data: Buffer, contentType: string) {
    const res = await this.request('PUT', this.dav(parts), { body: new Uint8Array(data), headers: { 'Content-Type': contentType || 'application/octet-stream' } });
    if (!res.ok) this.fail(res.status, 'Hochladen');
  }

  /**
   * Öffentliche Freigabe des Ordners, die nur lesen darf – vorhandene
   * wiederverwenden, sonst anlegen. Ergebnis: das Kürzel aus …/s/<Kürzel>.
   * Eine Freigabe mit Schreibrecht kommt nicht in Frage: Ihr Link steckt in
   * jeder Bild-URL, die Schüler sehen.
   */
  async ensureReadShare(parts: string[]): Promise<string> {
    const path = `/${parts.join('/')}`;
    const ocs = `${this.base}/ocs/v2.php/apps/files_sharing/api/v1/shares`;
    const res = await this.request('GET', `${ocs}?format=json&reshares=false&path=${encodeURIComponent(path)}`, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const list = ((await res.json())?.ocs?.data || []) as any[];
      // Nur Lesen (1), allenfalls Weiterteilen (16); kein Passwort, kein Ablaufdatum.
      const ok = list.find((s) => Number(s.share_type) === 3 && (Number(s.permissions) & ~17) === 0 && !s.password && !s.expiration);
      if (ok?.token) return String(ok.token);
    } else if (res.status !== 404) {
      this.fail(res.status, 'Freigaben lesen');
    }
    const made = await this.request('POST', `${ocs}?format=json`, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ path, shareType: '3', permissions: '1' }).toString(),
    });
    if (!made.ok) {
      if (made.status === 403) throw new BadRequestException('Die Nextcloud erlaubt keine öffentlichen Links – bitte die Nextcloud-Verwaltung fragen.');
      this.fail(made.status, 'Lesefreigabe anlegen');
    }
    const token = (await made.json())?.ocs?.data?.token;
    if (!token) throw new BadRequestException('Die Lesefreigabe ließ sich nicht anlegen.');
    return String(token);
  }
}
