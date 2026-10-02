import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'dns';
import * as net from 'net';

/**
 * Hochladen in eine Nextcloud-Freigabe (am besten Typ "Dateiablage – nur
 * Hochladen": Schüler sehen dort weder eigene noch fremde Dateien).
 *
 * Der Browser kann nicht direkt hochladen – Nextcloud erlaubt keine Zugriffe
 * fremder Seiten (CORS). Deshalb reicht der Server die Datei durch; er
 * speichert sie dabei nicht.
 *
 * Weil der Server damit eine Anfrage an eine von der Lehrkraft eingetragene
 * Adresse stellt, wird streng geprüft: nur https, nur die Form eines
 * Nextcloud-Freigabelinks und nie an interne Adressen (localhost, privates
 * Netz) – sonst ließe sich der Server als Sprungbrett nach innen missbrauchen.
 */

export interface NextcloudShare {
  base: string;   // https://cloud.example.org[/unterordner]
  token: string;
}

export function parseNextcloudShare(url: string): NextcloudShare {
  const u = String(url || '').trim();
  const m = /^(https:\/\/[^/?#\s]+(?:\/[^?#\s]*?)?)\/(?:index\.php\/)?s\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/.exec(u);
  if (!m) {
    throw new BadRequestException('Das ist kein Nextcloud-Freigabelink (https://…/s/…).');
  }
  return { base: m[1], token: m[2] };
}

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  return mapped ? isPrivateAddress(mapped[1]) : false;
}

async function assertPublicHost(base: string) {
  const host = new URL(base).hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$/i.test(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new BadRequestException('Interne Adressen sind als Ablage nicht erlaubt.');
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new BadRequestException(`Der Server „${host}“ ist nicht auffindbar.`);
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new BadRequestException('Interne Adressen sind als Ablage nicht erlaubt.');
  }
}

/** Dateiname ohne Zeichen, die in Nextcloud oder Dateisystemen stören. */
export function safeFileName(name: string): string {
  return String(name || 'aufnahme')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#%{}^~\[\]`]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120) || 'aufnahme';
}

/** Zeitstempel für Dateinamen in Ortszeit (TZ des Servers), z. B. 2026-10-03_14-05. */
export function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

/**
 * Lädt eine Datei hoch. Versucht zuerst die klassische öffentliche
 * WebDAV-Schnittstelle (Benutzer = Freigabe-Kürzel), dann die neuere
 * (/public.php/dav/files/<Kürzel>/). Wirft mit verständlicher Meldung.
 */
export async function uploadToNextcloud(
  shareUrl: string,
  password: string | undefined,
  fileName: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const share = parseNextcloudShare(shareUrl);
  await assertPublicHost(share.base);
  const name = encodeURIComponent(safeFileName(fileName));
  const attempts = [
    { url: `${share.base}/public.php/webdav/${name}`, user: share.token },
    { url: `${share.base}/public.php/dav/files/${share.token}/${name}`, user: 'anonymous' },
  ];
  let last = '';
  for (const a of attempts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(a.url, {
        method: 'PUT',
        redirect: 'manual', // keine Weiterleitung auf andere (ggf. interne) Ziele
        signal: ctrl.signal,
        headers: {
          'Content-Type': contentType || 'application/octet-stream',
          'X-Requested-With': 'XMLHttpRequest',
          Authorization: 'Basic ' + Buffer.from(`${a.user}:${password || ''}`).toString('base64'),
        },
        body: new Uint8Array(data),
      });
      if (res.ok) return;
      if (res.status === 401 || res.status === 403) {
        last = 'Die Freigabe erlaubt kein Hochladen (in Nextcloud „Dateiablage“ oder „Hochladen erlauben“ wählen) – oder das Passwort stimmt nicht.';
        continue;
      }
      if (res.status === 404 || res.status === 405) { last = 'Die Freigabe wurde nicht gefunden oder ist abgelaufen.'; continue; }
      if (res.status === 507) throw new BadRequestException('In der Nextcloud ist kein Speicherplatz mehr frei.');
      last = `Nextcloud antwortet mit Fehler ${res.status}.`;
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      last = err?.name === 'AbortError' ? 'Die Nextcloud antwortet nicht (Zeitüberschreitung).' : 'Die Nextcloud ist nicht erreichbar.';
    } finally {
      clearTimeout(timer);
    }
  }
  throw new BadRequestException(last || 'Hochladen fehlgeschlagen.');
}
