import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { NextcloudLink } from '../core/entities/nextcloud-link.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { User } from '../core/entities/user.entity';
import { MasterKeyService } from '../core/crypto/master-key.service';
import { assertPublicHost, parseNextcloudShare, safeFileName } from '../core/share/nextcloud-upload';
import { baseUrl } from '../core/share/link-url';
import { DavEntry, ShareClient, parseNextcloudBase, safeFolderName, shareFileUrl, sharePreviewUrl } from './nextcloud-api';

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

/** Prüfdatei beim Verbinden: zeigt, dass Schreiben und (optional) die Lesefreigabe stimmen. */
const CHECK_FILE = 'lm-verbindungstest.txt';

/** Teil eines Pfads, wie er in einer Bild-URL steht: kein Schrägstrich, kein „..“. */
const safePart = (p: string) => !!p && !/[\\/]/.test(p) && p !== '.' && p !== '..';

/**
 * Nextcloud je Lehrkraft (docs/nextcloud.md) – über einen freigegebenen
 * Ordner mit Passwort, kein Konto: Die App sieht nur diesen Ordner. Darin
 * Bilder/<Thema>/ und Backups/.
 *
 * Ohne eigene Freigabe nutzt die Lehrkraft den Nextcloud-Ordner der Schule
 * (Admin-Backup), wenn der Admin das erlaubt: Bilder/<Lehrkraft>/<Thema>/.
 *
 * Schüler kennen das Passwort nicht. Bilder erreichen sie deshalb über
 * diesen Server (er holt sie mit dem Passwort und reicht sie durch, ohne sie
 * zu speichern) – oder, wenn die Lehrkraft zusätzlich eine offene
 * Lesefreigabe nur für Bilder/ eingetragen hat, direkt aus der Nextcloud.
 */
@Injectable()
export class NextcloudService {
  constructor(
    @InjectRepository(NextcloudLink) private readonly linkRepo: Repository<NextcloudLink>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly masterKey: MasterKeyService,
  ) {}

  private find(userId: string) {
    return this.linkRepo.findOne({ where: { userId } });
  }

  // ---- Nextcloud-Ordner der Schule (Admin-Backup) ----

  /**
   * Der Ordner des automatischen Backups, sofern der Admin ihn für Bilder der
   * Lehrkräfte freigegeben hat – als Client, sonst null. Freigabelink oder
   * WebDAV-Ordner mit Konto, je nachdem, wie das Backup eingerichtet ist.
   */
  private async schoolClient(): Promise<ShareClient | null> {
    const row = await this.configRepo.findOne({ where: { key: 'cloud_backup_config' } });
    const cfg = row?.value || {};
    if (!cfg.teacherImages || !cfg.url) return null;
    let password = '';
    try { password = cfg.passwordSealed ? this.masterKey.unsealSecret(cfg.passwordSealed) : ''; } catch { return null; }
    let share: { base: string; token: string } | null = null;
    try { share = parseNextcloudShare(cfg.url); } catch { /* WebDAV-Ordner mit Konto */ }
    if (share) {
      await assertPublicHost(share.base);
      return new ShareClient(share.base, share.token, password, 'classic');
    }
    if (!cfg.username || !password) return null;
    await assertPublicHost(new URL(cfg.url).origin);
    return ShareClient.accountFolder(cfg.url, cfg.username, password);
  }

  private async schoolAvailable() {
    const row = await this.configRepo.findOne({ where: { key: 'cloud_backup_config' } });
    return !!(row?.value?.teacherImages && row.value.url);
  }

  /** Eintrag der Lehrkraft, angelegt bei Bedarf; legt den Schulordner-Namen einmal fest. */
  private async rowFor(userId: string, appBase?: string) {
    let l = await this.find(userId);
    if (!l) l = this.linkRepo.create({ id: crypto.randomUUID(), userId });
    let dirty = !l.createdAt;
    if (!l.serverFolder) {
      const u = await this.userRepo.findOne({ where: { id: userId } });
      const name = u?.displayName || String(u?.email || '').split('@')[0] || 'Lehrkraft';
      l.serverFolder = `${safeFolderName(name, 'Lehrkraft')} (${userId.slice(0, 8)})`;
      dirty = true;
    }
    if (appBase && l.appBase !== appBase && !l.shareToken) { l.appBase = appBase; dirty = true; }
    if (!l.appBase) { l.appBase = appBase || baseUrl(); dirty = true; }
    if (dirty) l = await this.linkRepo.save(l);
    return l;
  }

  /**
   * Wohin die Bilder einer Lehrkraft gehen: eigene Freigabe (geprüft), sonst
   * der Schulordner. `root`: Pfad des Bilder-Ordners darin.
   */
  private async effective(userId: string, appBase?: string): Promise<{ l: NextcloudLink; nc: ShareClient; root: string[]; school: boolean }> {
    const own = await this.find(userId);
    if (own?.shareToken && own.verifiedAt) return { l: own, nc: await this.client(own), root: [IMAGES], school: false };
    const nc = await this.schoolClient();
    if (!nc) throw new BadRequestException('Keine Nextcloud verbunden – im Home-Menü unter ☁️ Nextcloud eine Freigabe eintragen.');
    const l = await this.rowFor(userId, appBase);
    return { l, nc, root: [IMAGES, l.serverFolder!], school: true };
  }

  /**
   * Vorschlag: die Nextcloud des automatischen Backups, das der Admin
   * eingerichtet hat – meist die Schul-Cloud. Nur die Adresse, nie Zugangsdaten.
   */
  private async suggestedBase(): Promise<string> {
    const row = await this.configRepo.findOne({ where: { key: 'cloud_backup_config' } });
    return parseNextcloudBase(row?.value?.url || '') || '';
  }

  private shareLink(l: NextcloudLink) {
    return l.baseUrl && l.shareToken ? `${l.baseUrl}/s/${l.shareToken}` : '';
  }

  /** Was die Oberfläche sehen darf – ohne Passwort. */
  async status(user: any) {
    const l = await this.find(user.userId);
    const school = await this.schoolAvailable();
    const schoolInfo = school ? { available: true, folder: `${IMAGES}/${l?.serverFolder || '<dein Name>'}` } : { available: false };
    if (!l || !l.shareToken) {
      return {
        configured: false, ready: school, mode: school ? 'school' : null, school: schoolInfo,
        suggestedBase: await this.suggestedBase(), config: { shareUrl: '', readShareUrl: '', hasPassword: false },
      };
    }
    return {
      configured: true,
      ready: !!l.verifiedAt || school,
      mode: l.verifiedAt ? 'own' : school ? 'school' : null,
      school: schoolInfo,
      config: {
        shareUrl: this.shareLink(l),
        readShareUrl: l.imageShareToken ? `${l.baseUrl}/s/${l.imageShareToken}` : '',
        hasPassword: !!l.passwordSealed,
      },
      directImages: !!l.imageShareToken,
      verifiedAt: l.verifiedAt,
      imagesFolder: IMAGES,
      openUrl: this.shareLink(l),
      backup: {
        enabled: l.backupEnabled, hour: l.backupHour, folder: 'Backups',
        lastAttemptAt: l.backupAttemptAt, lastSuccessAt: l.backupSuccessAt, lastStatus: l.backupStatus,
        lastError: l.backupError, lastResult: l.backupResult,
        openUrl: this.shareLink(l),
      },
    };
  }

  /**
   * Speichern und gleich prüfen. `{ shareUrl, password?, readShareUrl? }` –
   * leeres Passwort lässt das gespeicherte. `appBase`: öffentliche Adresse
   * dieser App (für die Bild-Links über den Server).
   */
  async connect(user: any, input: any, appBase: string) {
    const share = parseNextcloudShare(input.shareUrl);
    const base = parseNextcloudBase(share.base);
    if (!base) throw new BadRequestException('Der Freigabelink muss mit https:// beginnen.');
    let readToken: string | null = null;
    if (String(input.readShareUrl || '').trim()) {
      const read = parseNextcloudShare(input.readShareUrl);
      if (parseNextcloudBase(read.base) !== base) throw new BadRequestException('Die Lesefreigabe muss aus derselben Nextcloud stammen.');
      if (read.token === share.token) throw new BadRequestException('Die Lesefreigabe muss ein eigener Link nur für den Ordner „Bilder“ sein – nicht derselbe wie oben.');
      readToken = read.token;
    }
    const l = (await this.find(user.userId)) || this.linkRepo.create({ id: crypto.randomUUID(), userId: user.userId });
    // Noch keine Freigabe gespeichert: Ein altes Passwort (etwa das App-Passwort
    // der Vorversion) gilt nicht als Passwort der Freigabe.
    if (!l.shareToken) l.passwordSealed = null;
    if (l.baseUrl !== base || l.shareToken !== share.token) Object.assign(l, { davMode: null, verifiedAt: null });
    if (input.password !== undefined && input.password !== null && String(input.password) !== '') {
      l.passwordSealed = this.masterKey.sealSecret(String(input.password));
    }
    Object.assign(l, { baseUrl: base, shareToken: share.token, imageShareToken: readToken, appBase });
    await this.linkRepo.save(l);
    return this.verify(user, appBase);
  }

  /**
   * Freigabe prüfen: öffnen (Passwort), Ordner Bilder anlegen, eine Datei
   * schreiben – und, falls eingetragen, über die Lesefreigabe wieder lesen.
   */
  async verify(user: any, appBase?: string) {
    const l = await this.find(user.userId);
    if (!l || !l.shareToken) throw new BadRequestException('Bitte zuerst den Freigabelink eintragen.');
    try {
      const nc = await this.client(l, false);
      l.davMode = await nc.detectMode();
      await nc.ensureFolder([IMAGES]);
      const stamp = `LearningModules-Verbindungstest ${crypto.randomUUID()}`;
      await nc.put([IMAGES, CHECK_FILE], Buffer.from(stamp, 'utf-8'), 'text/plain');
      if (l.imageShareToken) await this.checkReadShare(l, stamp);
      await nc.remove([IMAGES, CHECK_FILE]);
      Object.assign(l, { verifiedAt: new Date(), ...(appBase ? { appBase } : {}) });
      await this.linkRepo.save(l);
    } catch (err) {
      l.verifiedAt = null;
      await this.linkRepo.save(l);
      throw err;
    }
    return {
      ...(await this.status(user)),
      message: `Verbunden – die App sieht nur den freigegebenen Ordner. Bilder kommen ${l.imageShareToken ? 'direkt aus der Nextcloud' : 'über diesen Server'}.`,
    };
  }

  /** Zeigt die Lesefreigabe wirklich auf Bilder/? Die eben geschriebene Prüfdatei muss dort lesbar sein. */
  private async checkReadShare(l: NextcloudLink, stamp: string) {
    let text = '';
    try {
      const res = await fetch(shareFileUrl(l.baseUrl, l.imageShareToken!, '', CHECK_FILE), { redirect: 'manual' });
      text = res.ok ? await res.text() : '';
    } catch { /* unten gemeldet */ }
    if (text !== stamp) {
      throw new BadRequestException('Die Lesefreigabe zeigt nicht auf den Ordner „Bilder“ (oder hat ein Passwort). '
        + 'Bitte in der Nextcloud den Ordner „Bilder“ (im freigegebenen Ordner) ohne Passwort zum Lesen teilen – oder das Feld leer lassen.');
    }
  }

  /**
   * Eigene Freigabe vergessen. In der Nextcloud bleibt alles, wie es ist. Der
   * Eintrag selbst bleibt – seine Kennung steckt in den Bild-Links des
   * Schulordners.
   */
  async disconnect(user: any) {
    const l = await this.find(user.userId);
    if (l) {
      Object.assign(l, { baseUrl: '', shareToken: null, passwordSealed: null, davMode: null, imageShareToken: null, verifiedAt: null, backupEnabled: false });
      await this.linkRepo.save(l);
    }
    return { success: true };
  }

  private async client(l: NextcloudLink | null, needMode = true) {
    if (!l || !l.baseUrl || !l.shareToken) throw new BadRequestException('Bitte zuerst die Nextcloud im Home-Menü verbinden (☁️ Nextcloud).');
    let password = '';
    if (l.passwordSealed) {
      try {
        password = this.masterKey.unsealSecret(l.passwordSealed);
      } catch {
        // Etwa nach dem Umzug auf einen Server mit anderem App-Secret.
        throw new BadRequestException('Das gespeicherte Passwort der Freigabe lässt sich nicht mehr lesen – bitte neu eintragen.');
      }
    }
    await assertPublicHost(l.baseUrl);
    const nc = new ShareClient(l.baseUrl, l.shareToken, password, l.davMode || 'classic');
    if (needMode && !l.davMode) {
      l.davMode = await nc.detectMode();
      await this.linkRepo.save(l);
    }
    return nc;
  }

  /** Verbindung für andere Dienste (Backup): Eintrag und Client, sofern geprüft. */
  async connection(userId: string) {
    const l = await this.find(userId);
    if (!l?.verifiedAt) throw new BadRequestException('Die Nextcloud ist nicht (mehr) verbunden – bitte im Home-Menü unter ☁️ Nextcloud prüfen.');
    return { l, nc: await this.client(l) };
  }

  /** Verbunden und geprüft? */
  async isReady(userId: string) {
    const l = await this.find(userId);
    return !!(l?.shareToken && l.verifiedAt) || (await this.schoolAvailable());
  }

  // ---- Bild-Links ----

  /** Link, unter dem Schüler ein Bild sehen: direkt (Lesefreigabe) oder über diesen Server. */
  imageUrl(l: NextcloudLink, sub: string, name: string, school = false) {
    if (!school && l.imageShareToken) return shareFileUrl(l.baseUrl, l.imageShareToken, sub, name);
    // Getrennte Wege je Quelle: Ein späterer Wechsel macht alte Links nicht kaputt.
    return `${l.appBase || baseUrl()}/api/nextcloud/${school ? 'school' : 'files'}/${l.id}/${encodeURIComponent(sub)}/${encodeURIComponent(name)}`;
  }

  private previewUrl(l: NextcloudLink, sub: string, name: string, school = false) {
    return !school && l.imageShareToken ? sharePreviewUrl(l.baseUrl, l.imageShareToken, sub, name) : this.imageUrl(l, sub, name, school);
  }

  /**
   * Bild für den Abruf über diesen Server (öffentlich, ohne Anmeldung – Schüler
   * haben keine). Nur Bilder unter Bilder/<Ordner>/; null, wenn es das nicht gibt.
   */
  async readImage(linkId: string, sub: string, name: string, school = false): Promise<{ type: string; data: Buffer } | null> {
    if (!safePart(sub) || !safePart(name) || !IMAGE_EXT.test(name)) return null;
    const l = await this.linkRepo.findOne({ where: { id: linkId } });
    if (!l) return null;
    let nc: ShareClient | null;
    let root: string[];
    if (school) {
      nc = l.serverFolder ? await this.schoolClient() : null;
      root = [IMAGES, l.serverFolder || ''];
    } else {
      nc = l.shareToken && l.verifiedAt ? await this.client(l) : null;
      root = [IMAGES];
    }
    if (!nc) return null;
    const file = await nc.get([...root, sub, name]).catch(() => null);
    if (!file) return null;
    const ext = name.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg');
    const type = IMAGE_TYPES[file.type.split(';')[0].trim()] ? file.type.split(';')[0].trim() : (ext === 'svg' ? 'image/svg+xml' : `image/${ext}`);
    return { type, data: file.data };
  }

  /** Erkennt Links „über diesen Server“ und liefert das Bild (für den Export). */
  async readImageByUrl(url: string) {
    const m = /\/api\/nextcloud\/(files|school)\/([0-9a-f-]{36})\/([^/?#]+)\/([^/?#]+)$/i.exec(String(url || ''));
    if (!m) return null;
    return this.readImage(m[2], decodeURIComponent(m[3]), decodeURIComponent(m[4]), m[1] === 'school');
  }

  /** Ordnername eines Themas: sein Titel (lesbar in der Nextcloud). */
  private async topicFolder(topicId?: string) {
    if (!topicId) return 'Ohne Thema';
    const t = await this.topicRepo.findOne({ where: { id: topicId }, select: ['id', 'title'] });
    return safeFolderName(t?.title || '', 'Ohne Thema');
  }

  /**
   * Bild in den Ordner des Themas hochladen; Ergebnis: der Link.
   * `opts.folder` statt des Themas (Bilder für einen KI-Prompt), `opts.name`
   * als Dateiname, `opts.replace`: gleichnamiges Bild ersetzen statt -2 anhängen.
   */
  async uploadImage(
    user: any, topicId: string | undefined,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number },
    appBase?: string, opts: { folder?: string; name?: string; replace?: boolean } = {},
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Keine Datei empfangen.');
    if (!IMAGE_TYPES[file.mimetype]) throw new BadRequestException('Nur Bilder (PNG, JPEG, GIF, WebP, SVG) lassen sich hochladen.');
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('Das Bild ist größer als 15 MB.');
    const { l, nc, root, school } = await this.effective(user.userId, appBase);
    const sub = opts.folder ? safeFolderName(opts.folder) : await this.topicFolder(topicId);
    await nc.ensureFolder([...root, sub]);
    const wanted = imageFileName(opts.name || Buffer.from(file.originalname || '', 'latin1').toString('utf-8'), file.mimetype);
    let name = wanted;
    // Gleicher Name schon da: -2, -3 … anhängen statt überschreiben – ein
    // anderes Modul könnte das alte Bild noch zeigen. Beim Erzeugen für einen
    // KI-Prompt ersetzt eine neue Fassung die alte (noch nicht verwendet).
    for (let n = 2; !opts.replace && await nc.exists([...root, sub, name]); n++) {
      if (n > 99) throw new BadRequestException('Zu viele Dateien mit diesem Namen.');
      name = wanted.replace(/(\.[^.]+)$/, `-${n}$1`);
    }
    await nc.put([...root, sub, name], file.buffer, file.mimetype);
    return { success: true, url: this.imageUrl(l, sub, name, school), name, folder: sub };
  }

  // ---- Vorhandene Bilder auslagern ----

  /** Eigene Module der eigenen Themen – nur die werden verändert (nichts Gekauftes). */
  private async ownTopicsWithModules(userId: string, topicId?: string) {
    const topics = await this.topicRepo.find({ where: topicId ? { id: topicId, ownerId: userId } : { ownerId: userId }, relations: ['modules'] });
    return topics.map((t) => ({ topic: t, modules: (t.modules || []).filter((m) => m.creatorId === userId) }));
  }

  /** Welche eigenen Themen noch Bilder in der Datenbank haben – je Thema Anzahl und Größe. */
  async migrationPlan(user: any) {
    await this.effective(user.userId);
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
  async migrateTopic(user: any, topicId: string, appBase?: string) {
    const { l, nc, root, school } = await this.effective(user.userId, appBase);
    const [entry] = await this.ownTopicsWithModules(user.userId, topicId);
    if (!entry) throw new BadRequestException('Thema nicht gefunden – auslagern lassen sich nur eigene Themen.');
    const sub = safeFolderName(entry.topic.title, 'Ohne Thema');
    const images = new Map<string, { mime: string; b64: string }>();
    for (const m of entry.modules) mapDataImages(m.content, (d, mime, b64) => { images.set(d, { mime, b64 }); return d; });
    if (!images.size) return { success: true, uploaded: 0, reused: 0, modules: 0, folder: sub };

    await nc.ensureFolder([...root, sub]);
    const existing = new Set((await nc.list([...root, sub])).map((e) => e.name));
    const urls = new Map<string, string>();
    let uploaded = 0;
    let reused = 0;
    for (const [dataUrl, { mime, b64 }] of images) {
      const buffer = Buffer.from(b64, 'base64');
      const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
      const name = `bild-${hash}.${IMAGE_TYPES[mime] || 'png'}`;
      if (existing.has(name)) reused++;
      else { await nc.put([...root, sub, name], buffer, mime); uploaded++; }
      urls.set(dataUrl, this.imageUrl(l, sub, name, school));
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

  /**
   * nc:-Verweise in Links auflösen. Ergebnis je Verweis: URL oder null
   * (keine Verbindung, Ordner oder Datei gibt es nicht).
   */
  async resolveRefs(userId: string, refs: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>(refs.map((r) => [r, null]));
    if (!refs.length) return out;
    const eff = await this.effective(userId).catch(() => null);
    if (!eff) return out;
    const { l, nc, root, school } = eff;
    const byFolder = new Map<string, string[]>();
    for (const r of refs) {
      const m = NC_REF.exec(r);
      if (m) byFolder.set(m[1], [...(byFolder.get(m[1]) || []), r]);
    }
    for (const [folder, list] of byFolder) {
      const names = new Set((await nc.list([...root, folder]).catch((): DavEntry[] => [])).filter((e) => !e.isFolder).map((e) => e.name));
      for (const r of list) {
        const name = NC_REF.exec(r)![2];
        if (names.has(name)) out.set(r, this.imageUrl(l, folder, name, school));
      }
    }
    return out;
  }

  /**
   * Bilder eines Ordners für die Auswahl im Editor, dazu alle Ordner unter
   * Bilder. Ohne `folder` der Ordner des Themas.
   */
  async listImages(user: any, opts: { folder?: string; topicId?: string }, appBase?: string) {
    const { l, nc, root, school } = await this.effective(user.userId, appBase);
    const entries = await nc.list(root);
    const folders = entries.filter((e) => e.isFolder).map((e) => e.name).sort((a, b) => a.localeCompare(b, 'de'));
    const current = opts.folder ? safeFolderName(opts.folder) : await this.topicFolder(opts.topicId);
    const files = folders.includes(current) ? await nc.list([...root, current]) : [];
    const images = files
      .filter((e) => !e.isFolder && (IMAGE_TYPES[e.contentType] || IMAGE_EXT.test(e.name)))
      .sort((a, b) => String(b.modified).localeCompare(String(a.modified)) || a.name.localeCompare(b.name, 'de'))
      .map((e) => ({ name: e.name, size: e.size, url: this.imageUrl(l, current, e.name, school), previewUrl: this.previewUrl(l, current, e.name, school) }));
    return { folders, current, images };
  }
}
