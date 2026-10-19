import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { NextcloudLink } from '../core/entities/nextcloud-link.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { MasterKeyService } from '../core/crypto/master-key.service';
import { assertPublicHost, safeFileName } from '../core/share/nextcloud-upload';
import { NextcloudClient, parseNextcloudBase, safeFolderName, shareFileUrl, sharePreviewUrl } from './nextcloud-api';

/** Bildtypen, die hochgeladen werden dürfen – und ihre Dateiendung. */
export const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
};
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGES = 'Bilder';

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
