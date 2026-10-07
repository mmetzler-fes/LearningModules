import { Injectable, Logger, BadRequestException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from '../core/entities/system-config.entity';
import { User } from '../core/entities/user.entity';
import { MasterKeyService } from '../core/crypto/master-key.service';
import { MailService } from '../core/mail/mail.service';
import { BackupService } from './backup.service';
import { parseNextcloudShare } from '../core/share/nextcloud-upload';

/**
 * Automatisches Backup in einen WebDAV-Ordner, typischerweise Nextcloud.
 *
 * Je Lauf: Backup erzeugen (verschlüsselt mit dem Masterkey), hochladen,
 * prüfen, dass es angekommen ist – und erst dann die ältesten löschen, bis
 * nur noch `keep` übrig sind. Schlägt etwas fehl, wird nichts gelöscht.
 * Angefasst werden ausschließlich Dateien mit dem eigenen Namensmuster.
 *
 * Als Ziel taugt auch ein Nextcloud-Freigabelink (https://…/s/KÜRZEL) mit
 * Bearbeitungsrecht: Er wird zur öffentlichen WebDAV-Adresse der Freigabe
 * (Benutzer = Kürzel, Passwort = Freigabepasswort oder leer). Dann braucht
 * es kein Nextcloud-Konto und kein App-Passwort.
 *
 * Der Zeitplan rechnet mit "Slots": dem letzten planmäßigen Zeitpunkt vor
 * jetzt. Liegt der letzte Versuch davor, ist ein Lauf fällig. Damit holt ein
 * Server, der zum Termin aus war, das Backup beim nächsten Start nach.
 * Nach einem Fehler wird stündlich erneut versucht; die Admins bekommen nur
 * beim ersten Fehler einer Serie eine Mail.
 */
export interface CloudBackupConfig {
  enabled: boolean;
  /** WebDAV-Adresse des Ordners (https://cloud/remote.php/dav/files/USER/Backups/) oder Nextcloud-Freigabelink */
  url: string;
  username: string;
  /** App-Passwort, verschlüsselt mit dem App-Secret. Wird nie ausgegeben. */
  passwordSealed: string | null;
  interval: 'weekly' | 'daily';
  /** 0 = Sonntag … 6 = Samstag (nur wöchentlich). */
  weekday: number;
  hour: number;
  keep: number;
}

interface CloudBackupState {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: 'ok' | 'error' | null;
  lastError: string | null;
  lastFile: string | null;
  failureNotified: boolean;
}

const CONFIG_KEY = 'cloud_backup_config';
const STATE_KEY = 'cloud_backup_state';
const FILE_PATTERN = /^lernmodule-backup-\d{4}-\d{2}-\d{2}-\d{4}\.lmbak$/;
const TEST_FILE = 'lernmodule-verbindungstest.txt';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const DEFAULT_CONFIG: CloudBackupConfig = {
  enabled: false,
  url: '',
  username: '',
  passwordSealed: null,
  interval: 'weekly',
  weekday: 0,
  hour: 3,
  keep: 4,
};

const EMPTY_STATE: CloudBackupState = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastStatus: null,
  lastError: null,
  lastFile: null,
  failureNotified: false,
};

@Injectable()
export class CloudBackupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CloudBackupService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly masterKey: MasterKeyService,
    private readonly mail: MailService,
    private readonly backup: BackupService,
  ) {}

  // ---- Einstellungen ----

  private async config(): Promise<CloudBackupConfig> {
    const row = await this.configRepo.findOne({ where: { key: CONFIG_KEY } });
    return { ...DEFAULT_CONFIG, ...(row?.value || {}) };
  }

  private async state(): Promise<CloudBackupState> {
    const row = await this.configRepo.findOne({ where: { key: STATE_KEY } });
    return { ...EMPTY_STATE, ...(row?.value || {}) };
  }

  private async saveState(patch: Partial<CloudBackupState>) {
    const next = { ...(await this.state()), ...patch };
    await this.configRepo.save(this.configRepo.create({ key: STATE_KEY, value: next }));
    return next;
  }

  /** Was die Oberfläche sehen darf – ohne Passwort. */
  async status() {
    const cfg = await this.config();
    const { passwordSealed, ...rest } = cfg;
    const st = await this.state();
    const { failureNotified: _f, ...state } = st;
    return {
      config: { ...rest, hasPassword: !!passwordSealed },
      state,
      nextRunAt: cfg.enabled ? new Date(this.lastSlot(cfg, new Date()).getTime() + this.period(cfg)).toISOString() : null,
      serverTime: new Date().toString(),
    };
  }

  async saveConfig(input: any) {
    const cfg = await this.config();
    if (input.url !== undefined) {
      const url = String(input.url || '').trim();
      if (url) {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new BadRequestException('Die WebDAV-Adresse ist keine gültige URL.');
        }
        // Benutzer und Passwort gehen bei jeder Anfrage mit – unverschlüsselt
        // nur zum eigenen Rechner.
        const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
        if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
          throw new BadRequestException('Die WebDAV-Adresse muss mit https:// beginnen.');
        }
      }
      // Freigabelinks bleiben, wie sie sind; Ordneradressen enden mit "/".
      cfg.url = !url ? '' : this.share(url) ? url : url.endsWith('/') ? url : `${url}/`;
    }
    if (input.username !== undefined) cfg.username = String(input.username || '').trim();
    if (input.password) cfg.passwordSealed = this.masterKey.sealSecret(String(input.password));
    if (input.interval !== undefined) cfg.interval = input.interval === 'daily' ? 'daily' : 'weekly';
    if (input.weekday !== undefined) cfg.weekday = this.int(input.weekday, 0, 6, 'Wochentag');
    if (input.hour !== undefined) cfg.hour = this.int(input.hour, 0, 23, 'Uhrzeit');
    if (input.keep !== undefined) cfg.keep = this.int(input.keep, 1, 100, 'Anzahl der Backups');
    if (input.enabled !== undefined) cfg.enabled = !!input.enabled;
    if (cfg.enabled && !this.ready(cfg)) {
      throw new BadRequestException('Zum Einschalten braucht es Adresse, Benutzer und App-Passwort – oder einen Nextcloud-Freigabelink.');
    }
    await this.configRepo.save(this.configRepo.create({ key: CONFIG_KEY, value: cfg }));
    return this.status();
  }

  private int(v: any, min: number, max: number, field: string) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new BadRequestException(`${field}: bitte eine ganze Zahl zwischen ${min} und ${max}.`);
    }
    return n;
  }

  // ---- Zeitplan ----

  private period(cfg: CloudBackupConfig) {
    return cfg.interval === 'daily' ? DAY : 7 * DAY;
  }

  /** Der letzte planmäßige Zeitpunkt, der nicht in der Zukunft liegt. */
  private lastSlot(cfg: CloudBackupConfig, now: Date): Date {
    const slot = new Date(now);
    slot.setHours(cfg.hour, 0, 0, 0);
    if (cfg.interval === 'weekly') {
      slot.setDate(slot.getDate() - ((slot.getDay() - cfg.weekday + 7) % 7));
    }
    if (slot > now) slot.setDate(slot.getDate() - (cfg.interval === 'daily' ? 1 : 7));
    return slot;
  }

  onApplicationBootstrap() {
    const tick = () => this.tick().catch((err) => this.logger.error('Prüfung des Cloud-Backups fehlgeschlagen', err));
    // Kurz warten, damit der Start nicht mit einem großen Backup beginnt.
    setTimeout(tick, 30 * 1000).unref?.();
    this.timer = setInterval(tick, 10 * 60 * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    const cfg = await this.config();
    if (!cfg.enabled || !this.ready(cfg)) return;
    const st = await this.state();
    const now = new Date();
    const slot = this.lastSlot(cfg, now);
    const lastAttempt = st.lastAttemptAt ? new Date(st.lastAttemptAt) : null;
    const lastSuccess = st.lastSuccessAt ? new Date(st.lastSuccessAt) : null;

    const due = !lastAttempt || lastAttempt < slot;
    const retry = st.lastStatus === 'error' && (!lastSuccess || lastSuccess < slot) && !!lastAttempt
      && now.getTime() - lastAttempt.getTime() >= HOUR;
    if (due || retry) await this.run();
  }

  // ---- WebDAV ----

  /** Nextcloud-Freigabe hinter der Adresse, sonst null. */
  private share(url: string) {
    try {
      return parseNextcloudShare(url);
    } catch {
      return null;
    }
  }

  /** Genug eingetragen, um loszulegen? Eine Freigabe braucht weder Benutzer noch Passwort. */
  private ready(cfg: CloudBackupConfig) {
    if (!cfg.url) return false;
    return !!this.share(cfg.url) || (!!cfg.username && !!cfg.passwordSealed);
  }

  /** WebDAV-Adresse des Zielordners, mit "/" am Ende. */
  private folder(cfg: CloudBackupConfig) {
    const share = this.share(cfg.url);
    return share ? `${share.base}/public.php/webdav/` : cfg.url;
  }

  private async auth(cfg: CloudBackupConfig) {
    if (!this.ready(cfg)) {
      throw new BadRequestException('Bitte zuerst Adresse, Benutzer und App-Passwort speichern – oder einen Nextcloud-Freigabelink.');
    }
    const password = cfg.passwordSealed ? this.masterKey.unsealSecret(cfg.passwordSealed) : '';
    const share = this.share(cfg.url);
    // Öffentliches WebDAV einer Freigabe: Benutzer ist das Kürzel des Links.
    const user = share ? share.token : cfg.username;
    return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
  }

  /** Anfrage an eine Datei im Zielordner ("" = der Ordner selbst). */
  private async dav(cfg: CloudBackupConfig, method: string, file: string, body?: Buffer | string, headers: Record<string, string> = {}) {
    let res: Response;
    try {
      res = await fetch(this.folder(cfg) + file, {
        method,
        // Nextcloud verlangt den Kopf bei öffentlichen Freigaben (CSRF-Schutz).
        headers: { Authorization: await this.auth(cfg), 'X-Requested-With': 'XMLHttpRequest', ...headers },
        body: body as any,
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
    } catch (err: any) {
      const code = err?.cause?.code || err?.name || err?.message;
      throw new BadRequestException(`Der WebDAV-Server ist nicht erreichbar (${code}).`);
    }
    return res;
  }

  private explain(cfg: CloudBackupConfig, res: Response, what: string): never {
    const share = !!this.share(cfg.url);
    const reasons: Record<number, string> = {
      401: share
        ? 'Anmeldung abgelehnt – hat die Freigabe ein Passwort? Dann im Feld Passwort eintragen'
        : 'Anmeldung abgelehnt – Benutzername und App-Passwort prüfen',
      403: share ? 'die Freigabe erlaubt kein Bearbeiten (in Nextcloud „Bearbeiten“ erlauben)' : 'keine Schreibrechte in diesem Ordner',
      404: share ? 'Freigabe nicht gefunden – Link abgelaufen oder gelöscht?' : 'Ordner nicht gefunden – Adresse prüfen',
      405: 'die Adresse ist kein WebDAV-Ordner',
      507: 'kein Speicherplatz mehr frei',
    };
    throw new BadRequestException(`${what}: ${reasons[res.status] || `HTTP ${res.status}`}.`);
  }

  /** Legt den Zielordner an, falls es ihn noch nicht gibt (eine Ebene). */
  private async ensureFolder(cfg: CloudBackupConfig) {
    const res = await this.dav(cfg, 'PROPFIND', '', undefined, { Depth: '0' });
    if (res.status === 207 || res.ok) return;
    if (res.status !== 404) this.explain(cfg, res, 'Ordner nicht lesbar');
    const made = await this.dav(cfg, 'MKCOL', '');
    if (!made.ok) this.explain(cfg, made, 'Ordner konnte nicht angelegt werden');
  }

  /** Die eigenen Backups im Ordner, neueste zuerst. */
  async list(cfgIn?: CloudBackupConfig) {
    const cfg = cfgIn || (await this.config());
    const res = await this.dav(cfg, 'PROPFIND', '', undefined, { Depth: '1' });
    if (res.status !== 207 && !res.ok) this.explain(cfg, res, 'Ordner nicht lesbar');
    const xml = await res.text();
    const files: Array<{ name: string; size: number | null }> = [];
    for (const block of xml.split(/<(?:[a-z0-9]+:)?response[\s>]/i).slice(1)) {
      const href = /<(?:[a-z0-9]+:)?href>([^<]+)</i.exec(block)?.[1] || '';
      const name = decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() || '');
      if (!FILE_PATTERN.test(name)) continue;
      const size = /<(?:[a-z0-9]+:)?getcontentlength>(\d+)</i.exec(block)?.[1];
      files.push({ name, size: size ? Number(size) : null });
    }
    // Der Zeitstempel im Namen sortiert zugleich nach Alter.
    return files.sort((a, b) => b.name.localeCompare(a.name));
  }

  /** Schreiben und wieder löschen – prüft Adresse, Anmeldung und Rechte. */
  async test() {
    const cfg = await this.config();
    await this.ensureFolder(cfg);
    const put = await this.dav(cfg, 'PUT', TEST_FILE, `Verbindungstest ${new Date().toISOString()}`);
    if (!put.ok) this.explain(cfg, put, 'Schreiben fehlgeschlagen');
    const del = await this.dav(cfg, 'DELETE', TEST_FILE);
    if (!del.ok && del.status !== 404) this.explain(cfg, del, 'Löschen fehlgeschlagen');
    const files = await this.list(cfg);
    return { success: true, message: `Verbindung in Ordnung – ${files.length} Backup${files.length === 1 ? '' : 's'} im Ordner.` };
  }

  // ---- Lauf ----

  private fileName(now: Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `lernmodule-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.lmbak`;
  }

  async run() {
    if (this.running) throw new BadRequestException('Es läuft bereits ein Backup.');
    this.running = true;
    const cfg = await this.config();
    const now = new Date();
    await this.saveState({ lastAttemptAt: now.toISOString() });
    try {
      const name = this.fileName(now);
      const buffer = await this.backup.create();
      await this.ensureFolder(cfg);
      const put = await this.dav(cfg, 'PUT', encodeURIComponent(name), buffer, {
        'Content-Type': 'application/octet-stream',
      });
      if (!put.ok) this.explain(cfg, put, 'Hochladen fehlgeschlagen');

      // Erst prüfen, dann aufräumen: Ein Backup, das nicht angekommen ist,
      // darf kein älteres verdrängen.
      const files = await this.list(cfg);
      const arrived = files.find((f) => f.name === name);
      if (!arrived || (arrived.size !== null && arrived.size !== buffer.length)) {
        throw new BadRequestException('Das Backup ist nach dem Hochladen nicht vollständig im Ordner zu finden.');
      }
      const removed: string[] = [];
      for (const old of files.slice(cfg.keep)) {
        const del = await this.dav(cfg, 'DELETE', encodeURIComponent(old.name));
        if (del.ok || del.status === 404) removed.push(old.name);
      }

      await this.saveState({
        lastSuccessAt: now.toISOString(),
        lastStatus: 'ok',
        lastError: null,
        lastFile: name,
        failureNotified: false,
      });
      this.logger.log(`Cloud-Backup ${name} (${Math.round(buffer.length / 1024)} KB) hochgeladen, ${removed.length} alte gelöscht`);
      return { success: true, file: name, size: buffer.length, removed };
    } catch (err: any) {
      const message = err?.response?.message || err?.message || String(err);
      const st = await this.saveState({ lastStatus: 'error', lastError: message });
      this.logger.error(`Cloud-Backup fehlgeschlagen: ${message}`);
      if (!st.failureNotified) {
        await this.notifyAdmins(message);
        await this.saveState({ failureNotified: true });
      }
      throw new BadRequestException(message);
    } finally {
      this.running = false;
    }
  }

  private async notifyAdmins(message: string) {
    const admins = await this.userRepo.find({ where: { role: 'admin', active: true } });
    for (const a of admins) {
      await this.mail.sendNotice({
        to: a.email,
        subject: 'Automatisches Backup fehlgeschlagen',
        text:
          `Das automatische Backup in den Cloud-Ordner ist fehlgeschlagen:\n\n${message}\n\n` +
          'Die App versucht es stündlich erneut. Ältere Backups wurden nicht gelöscht.\n' +
          'Einstellungen: Administration → Shop & Sicherheit → Automatisches Backup.',
      }).catch(() => undefined);
    }
  }

  /** Ein Backup aus der Cloud holen und einspielen. */
  async restoreFromCloud(name: string) {
    if (!FILE_PATTERN.test(String(name || ''))) throw new BadRequestException('Unbekannte Backup-Datei.');
    const cfg = await this.config();
    const res = await this.dav(cfg, 'GET', encodeURIComponent(name));
    if (!res.ok) this.explain(cfg, res, 'Herunterladen fehlgeschlagen');
    return this.backup.restore(Buffer.from(await res.arrayBuffer()));
  }
}
