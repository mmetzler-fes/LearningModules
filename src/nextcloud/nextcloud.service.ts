import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { NextcloudLink } from '../core/entities/nextcloud-link.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { MasterKeyService } from '../core/crypto/master-key.service';
import { assertPublicHost, safeFileName } from '../core/share/nextcloud-upload';
import { DavEntry, NextcloudClient, parseNextcloudBase, safeFolderName, shareFileUrl, sharePreviewUrl } from './nextcloud-api';

/** Bildtypen, die hochgeladen werden dürfen – und ihre Dateiendung. */
export const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
};
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGES = 'Bilder';

/**
 * Verweis auf ein Bild in der Nextcloud der Lehrkraft, wie ihn der KI-Prompt
 * vorgibt: "nc:<Ordner unter Bilder>/<Datei>". Der Import macht daraus die
 * Lese-URL (resolveRefs).
 */
export const NC_REF = /^nc:([^/]+)\/([^/]+)$/;

/** Alle nc:-Verweise in einem Modulinhalt (beliebig verschachtelt) ersetzen. */
export function mapNcRefs(value: any, fn: (ref: string) => string): any {
  if (typeof value === 'string') return NC_REF.test(value.trim()) ? fn(value.trim()) : value;
  if (Array.isArray(value)) return value.map((v) => mapNcRefs(v, fn));
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) value[k] = mapNcRefs(value[k], fn);
  }
  return value;
}

/**
 * In der Datenbank gespeicherte Bilder (data:-URLs) – als ganzer Feldwert
 * oder mitten im HTML eines Arbeitsblatts (<img src="data:…">).
 */
const DATA_IMAGE = /data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)/g;

/** Jedes data:-Bild in einem Inhalt (beliebig verschachtelt) durch fn(...) ersetzen. */
export function mapDataImages(value: any, fn: (dataUrl: string, mime: string, base64: string) => string): any {
  if (typeof value === 'string') {
    return value.includes('data:image/') ? value.replace(DATA_IMAGE, (m, mime: string, b64: string) => fn(m, mime, b64)) : value;
  }
  if (Array.isArray(value)) return value.map((v) => mapDataImages(v, fn));
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapDataImages(v, fn);
    return out;
  }
  return value;
}

/** Dateiname mit passender Endung; Endung des Typs gewinnt. */
export function imageFileName(original: string, mime: string): string {
  const ext = IMAGE_TYPES[mime] || 'png';
  const stem = safeFileName(String(original || 'bild').replace(/\.[^.]*$/, '')) || 'bild';
  return `${stem}.${ext}`;
}

/**
 * Nextcloud je Lehrkraft (docs/nextcloud.md). Bilder der Module liegen in
 * <Hauptordner>/Bilder/<Thema>/; im Modul steht nur die Lese-URL der
 * Freigabe des Bilder-Ordners. Hochgeladen wird über den Server – die
 * Nextcloud erlaubt dem Browser keine Zugriffe von fremden Seiten (CORS).
 */
@Injectable()
export class NextcloudService {
  constructor(
    @InjectRepository(NextcloudLink) private readonly linkRepo: Repository<NextcloudLink>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    private readonly masterKey: MasterKeyService,
  ) {}

  private find(userId: string) {
    return this.linkRepo.findOne({ where: { userId } });
  }

  /**
   * Vorschlag für die Adresse: die Nextcloud des automatischen Backups, das
   * der Admin eingerichtet hat (Freigabelink oder WebDAV-Adresse) – meist
   * die Schul-Cloud. Nur die Adresse, nie Zugangsdaten.
   */
  private async suggestedBase(): Promise<string> {
    const row = await this.configRepo.findOne({ where: { key: 'cloud_backup_config' } });
    return parseNextcloudBase(row?.value?.url || '') || '';
  }

  /** Was die Oberfläche sehen darf – ohne Passwort. */
  async status(user: any) {
    const l = await this.find(user.userId);
    if (!l) {
      const suggested = await this.suggestedBase();
      return { configured: false, ready: false, suggested: !!suggested, config: { baseUrl: suggested, username: '', folder: 'LearningModules', hasPassword: false } };
    }
    return {
      configured: true,
      ready: !!(l.verifiedAt && l.imageShareToken),
      config: { baseUrl: l.baseUrl, username: l.username, folder: l.folder, hasPassword: !!l.passwordSealed },
      displayName: l.displayName,
      verifiedAt: l.verifiedAt,
      imagesFolder: `${l.folder}/${IMAGES}`,
      backup: {
        enabled: l.backupEnabled, hour: l.backupHour, folder: `${l.folder}/Backups`,
        lastAttemptAt: l.backupAttemptAt, lastSuccessAt: l.backupSuccessAt, lastStatus: l.backupStatus,
        lastError: l.backupError, lastResult: l.backupResult,
        openUrl: l.baseUrl ? `${l.baseUrl}/index.php/apps/files/?dir=${encodeURIComponent(`/${l.folder}/Backups`)}` : null,
      },
      openUrl: l.baseUrl ? `${l.baseUrl}/index.php/apps/files/?dir=${encodeURIComponent(`/${l.folder}/${IMAGES}`)}` : null,
    };
  }

  /**
   * Speichern und gleich prüfen: anmelden, Bilder-Ordner anlegen,
   * Lesefreigabe holen oder anlegen. `{ baseUrl, username, password?, folder? }`
   * – leeres Passwort lässt das gespeicherte.
   */
  async connect(user: any, input: any) {
    const base = parseNextcloudBase(input.baseUrl);
    if (!base) throw new BadRequestException('Bitte die Adresse der Nextcloud mit https:// angeben, z. B. https://cloud.meine-schule.de');
    const username = String(input.username || '').trim();
    if (!username) throw new BadRequestException('Bitte den Benutzernamen angeben.');
    const folder = safeFolderName(input.folder || 'LearningModules', 'LearningModules');
    const l = (await this.find(user.userId)) || this.linkRepo.create({ id: crypto.randomUUID(), userId: user.userId });
    const changed = l.baseUrl !== base || l.username !== username || l.folder !== folder;
    if (input.password) l.passwordSealed = this.masterKey.sealSecret(String(input.password).trim());
    if (!l.passwordSealed) throw new BadRequestException('Bitte ein App-Passwort angeben.');
    Object.assign(l, { baseUrl: base, username, folder });
    if (changed) Object.assign(l, { imageShareToken: null, davUser: null, verifiedAt: null });
    await this.linkRepo.save(l);
    return this.verify(user);
  }

  /** Verbindung prüfen und die Lesefreigabe sicherstellen. */
  async verify(user: any) {
    const l = await this.find(user.userId);
    const nc = await this.client(l);
    try {
      const me = await nc.userInfo();
      await nc.ensureFolder([l!.folder, IMAGES]);
      const token = await nc.ensureReadShare([l!.folder, IMAGES]);
      Object.assign(l!, { davUser: me.id, displayName: me.displayName, imageShareToken: token, verifiedAt: new Date() });
      await this.linkRepo.save(l!);
    } catch (err) {
      l!.verifiedAt = null;
      await this.linkRepo.save(l!);
      throw err;
    }
    return { ...(await this.status(user)), message: `Verbunden als ${l!.displayName} – Bilder landen in „${l!.folder}/${IMAGES}/<Thema>“.` };
  }

  /** Zugangsdaten vergessen. In der Nextcloud bleibt alles, wie es ist. */
  async disconnect(user: any) {
    await this.linkRepo.delete({ userId: user.userId });
    return { success: true };
  }

  private async client(l: NextcloudLink | null) {
    if (!l || !l.baseUrl || !l.passwordSealed) throw new BadRequestException('Bitte zuerst die Nextcloud im Home-Menü verbinden (☁️ Nextcloud).');
    let password: string;
    try {
      password = this.masterKey.unsealSecret(l.passwordSealed);
    } catch {
      // Etwa nach dem Umzug auf einen Server mit anderem App-Secret.
      throw new BadRequestException('Das gespeicherte App-Passwort lässt sich nicht mehr lesen – bitte neu eintragen.');
    }
    await assertPublicHost(l.baseUrl);
    return new NextcloudClient(l.baseUrl, l.username, password, l.davUser);
  }

  /** Verbindung für andere Dienste (Backup): Eintrag und Client, sofern geprüft. */
  async connection(userId: string) {
    const l = await this.find(userId);
    if (!l?.verifiedAt) throw new BadRequestException('Die Nextcloud ist nicht (mehr) verbunden – bitte im Home-Menü unter ☁️ Nextcloud prüfen.');
    return { l, nc: await this.client(l) };
  }

  private async ready(userId: string) {
    const l = await this.find(userId);
    if (!l?.verifiedAt || !l.imageShareToken) throw new BadRequestException('Die Nextcloud ist nicht (mehr) verbunden – bitte im Home-Menü unter ☁️ Nextcloud prüfen.');
    return { l, nc: await this.client(l) };
  }

  /** Ordnername eines Themas: sein Titel (lesbar in der Nextcloud). */
  private async topicFolder(topicId?: string) {
    if (!topicId) return 'Ohne Thema';
    const t = await this.topicRepo.findOne({ where: { id: topicId }, select: ['id', 'title'] });
    return safeFolderName(t?.title || '', 'Ohne Thema');
  }

  /** Bild in den Ordner des Themas hochladen; Ergebnis: die Lese-URL. */
  async uploadImage(user: any, topicId: string | undefined, file: { originalname: string; mimetype: string; buffer: Buffer; size: number }) {
    if (!file?.buffer?.length) throw new BadRequestException('Keine Datei empfangen.');
    if (!IMAGE_TYPES[file.mimetype]) throw new BadRequestException('Nur Bilder (PNG, JPEG, GIF, WebP, SVG) lassen sich hochladen.');
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('Das Bild ist größer als 15 MB.');
    const { l, nc } = await this.ready(user.userId);
    const sub = await this.topicFolder(topicId);
    await nc.ensureFolder([l.folder, IMAGES, sub]);
    // Gleicher Name schon da: -2, -3 … anhängen statt überschreiben – ein
    // anderes Modul könnte das alte Bild noch zeigen.
    const wanted = imageFileName(Buffer.from(file.originalname || '', 'latin1').toString('utf-8'), file.mimetype);
    let name = wanted;
    for (let n = 2; await nc.exists([l.folder, IMAGES, sub, name]); n++) {
      if (n > 99) throw new BadRequestException('Zu viele Dateien mit diesem Namen.');
      name = wanted.replace(/(\.[^.]+)$/, `-${n}$1`);
    }
    await nc.put([l.folder, IMAGES, sub, name], file.buffer, file.mimetype);
    return { success: true, url: shareFileUrl(l.baseUrl, l.imageShareToken!, sub, name), name, folder: sub };
  }

  // ---- Vorhandene Bilder auslagern ----

  /** Eigene Module der eigenen Themen – nur die werden verändert (nichts Gekauftes). */
  private async ownTopicsWithModules(userId: string, topicId?: string) {
    const topics = await this.topicRepo.find({ where: topicId ? { id: topicId, ownerId: userId } : { ownerId: userId }, relations: ['modules'] });
    return topics.map((t) => ({ topic: t, modules: (t.modules || []).filter((m) => m.creatorId === userId) }));
  }

  /** Welche eigenen Themen noch Bilder in der Datenbank haben – je Thema Anzahl und Größe. */
  async migrationPlan(user: any) {
    await this.ready(user.userId);
    const out: Array<{ topicId: string; title: string; images: number; bytes: number }> = [];
    for (const { topic, modules } of await this.ownTopicsWithModules(user.userId)) {
      const seen = new Map<string, number>();
      for (const m of modules) {
        mapDataImages(m.content, (d, _mime, b64) => { seen.set(d, Math.floor((b64.length * 3) / 4)); return d; });
      }
      if (seen.size) out.push({ topicId: topic.id, title: topic.title, images: seen.size, bytes: [...seen.values()].reduce((a, b) => a + b, 0) });
    }
    return { topics: out.sort((a, b) => b.bytes - a.bytes) };
  }

  /**
   * Bilder eines Themas in seinen Nextcloud-Ordner hochladen und in den
   * Modulen durch Links ersetzen. Gleiche Bilder gehen nur einmal hoch; der
   * Dateiname enthält eine Prüfsumme, ein zweiter Lauf lädt nichts doppelt.
   */
  async migrateTopic(user: any, topicId: string) {
    const { l, nc } = await this.ready(user.userId);
    const [entry] = await this.ownTopicsWithModules(user.userId, topicId);
    if (!entry) throw new BadRequestException('Thema nicht gefunden – auslagern lassen sich nur eigene Themen.');
    const sub = safeFolderName(entry.topic.title, 'Ohne Thema');
    const images = new Map<string, { mime: string; b64: string }>();
    for (const m of entry.modules) mapDataImages(m.content, (d, mime, b64) => { images.set(d, { mime, b64 }); return d; });
    if (!images.size) return { success: true, uploaded: 0, reused: 0, modules: 0, folder: sub };

    await nc.ensureFolder([l.folder, IMAGES, sub]);
    const existing = new Set((await nc.list([l.folder, IMAGES, sub])).map((e) => e.name));
    const urls = new Map<string, string>();
    let uploaded = 0;
    let reused = 0;
    for (const [dataUrl, { mime, b64 }] of images) {
      const buffer = Buffer.from(b64, 'base64');
      const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
      const name = `bild-${hash}.${IMAGE_TYPES[mime] || 'png'}`;
      if (existing.has(name)) reused++;
      else { await nc.put([l.folder, IMAGES, sub, name], buffer, mime); uploaded++; }
      urls.set(dataUrl, shareFileUrl(l.baseUrl, l.imageShareToken!, sub, name));
    }
    let changed = 0;
    for (const m of entry.modules) {
      const next = mapDataImages(m.content, (d) => urls.get(d) || d);
      if (JSON.stringify(next) !== JSON.stringify(m.content)) {
        await this.moduleRepo.update({ id: m.id }, { content: next });
        changed++;
      }
    }
    return { success: true, uploaded, reused, modules: changed, folder: sub };
  }

  /** Verbunden und geprüft? */
  async isReady(userId: string) {
    const l = await this.find(userId);
    return !!(l?.verifiedAt && l.imageShareToken);
  }

  /**
   * nc:-Verweise in Lese-URLs auflösen. Ergebnis je Verweis: URL oder null
   * (keine Verbindung, Ordner oder Datei gibt es nicht).
   */
  async resolveRefs(userId: string, refs: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>(refs.map((r) => [r, null]));
    if (!refs.length) return out;
    const l = await this.find(userId);
    if (!l?.verifiedAt || !l.imageShareToken) return out;
    const nc = await this.client(l);
    const byFolder = new Map<string, string[]>();
    for (const r of refs) {
      const m = NC_REF.exec(r);
      if (m) byFolder.set(m[1], [...(byFolder.get(m[1]) || []), r]);
    }
    for (const [folder, list] of byFolder) {
      const names = new Set((await nc.list([l.folder, IMAGES, folder]).catch((): DavEntry[] => [])).filter((e) => !e.isFolder).map((e) => e.name));
      for (const r of list) {
        const name = NC_REF.exec(r)![2];
        if (names.has(name)) out.set(r, shareFileUrl(l.baseUrl, l.imageShareToken, folder, name));
      }
    }
    return out;
  }

  /**
   * Bilder eines Ordners für die Auswahl im Editor, dazu alle Ordner unter
   * Bilder. Ohne `folder` der Ordner des Themas.
   */
  async listImages(user: any, opts: { folder?: string; topicId?: string }) {
    const { l, nc } = await this.ready(user.userId);
    const entries = await nc.list([l.folder, IMAGES]);
    const folders = entries.filter((e) => e.isFolder).map((e) => e.name).sort((a, b) => a.localeCompare(b, 'de'));
    const current = opts.folder ? safeFolderName(opts.folder) : await this.topicFolder(opts.topicId);
    const files = folders.includes(current) ? await nc.list([l.folder, IMAGES, current]) : [];
    const images = files
      .filter((e) => !e.isFolder && (IMAGE_TYPES[e.contentType] || IMAGE_EXT.test(e.name)))
      .sort((a, b) => String(b.modified).localeCompare(String(a.modified)) || a.name.localeCompare(b.name, 'de'))
      .map((e) => ({
        name: e.name,
        size: e.size,
        url: shareFileUrl(l.baseUrl, l.imageShareToken!, current, e.name),
        previewUrl: sharePreviewUrl(l.baseUrl, l.imageShareToken!, current, e.name),
      }));
    return { folders, current, images };
  }
}
