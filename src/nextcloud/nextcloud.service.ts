import { Injectable, BadRequestException, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { NextcloudLink } from '../core/entities/nextcloud-link.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { ModuleDraft } from '../core/entities/module-draft.entity';
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

/**
 * Bilder in der App (data:-URLs) – Größe je verschiedenem Bild. Schlüssel ist
 * eine Prüfsumme, damit dasselbe Bild in mehreren Modulen nur einmal zählt.
 */
export function dataImageSizes(contents: any[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of contents) {
    mapDataImages(c, (d, _mime, b64) => {
      const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
      out.set(crypto.createHash('sha1').update(b64).digest('hex'), Math.floor((b64.length * 3) / 4) - pad);
      return d;
    });
  }
  return out;
}

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

/** Grenzen für Bilder in der App je Lehrkraft (MB, 0 = keine) – der Admin stellt sie ein. */
export const IMAGE_QUOTA_KEY = 'image_quota';
export const DEFAULT_IMAGE_QUOTA = { warnMb: 20, limitMb: 50 };
const MB = 1024 * 1024;

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
 * Ohne eigene Freigabe bleiben Bilder in der App. Früher konnten Bilder im
 * Ordner des Admin-Backups liegen (Bilder/<Lehrkraft>/<Thema>/); deren Links
 * funktionieren weiter, und sobald die Lehrkraft eine eigene Freigabe
 * verbindet, wandern sie dorthin (adoptSchoolImages).
 *
 * Schüler kennen das Passwort nicht. Bilder erreichen sie deshalb über
 * diesen Server (er holt sie mit dem Passwort und reicht sie durch, ohne sie
 * zu speichern) – oder, wenn die Lehrkraft zusätzlich eine offene
 * Lesefreigabe nur für Bilder/ eingetragen hat, direkt aus der Nextcloud.
 */
@Injectable()
export class NextcloudService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NextcloudService.name);

  constructor(
    @InjectRepository(NextcloudLink) private readonly linkRepo: Repository<NextcloudLink>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(ModuleDraft) private readonly draftRepo: Repository<ModuleDraft>,
    private readonly masterKey: MasterKeyService,
  ) {}

  private find(userId: string) {
    return this.linkRepo.findOne({ where: { userId } });
  }

  // ---- Früherer Bilder-Ordner im Admin-Backup ----

  /**
   * Der Ordner des automatischen Backups, in dem früher Bilder der Lehrkräfte
   * lagen (Bilder/<serverFolder>/<Thema>/) – als Client, sonst null. Nur noch
   * zum Lesen alter Links und zum Übernehmen in die eigene Freigabe.
   */
  private async schoolClient(): Promise<ShareClient | null> {
    const row = await this.configRepo.findOne({ where: { key: 'cloud_backup_config' } });
    const cfg = row?.value || {};
    if (!cfg.url) return null;
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

  /** Wohin die Bilder einer Lehrkraft gehen: nur die eigene, geprüfte Freigabe. */
  private async effective(userId: string): Promise<{ l: NextcloudLink; nc: ShareClient; root: string[] }> {
    const own = await this.find(userId);
    if (!own?.shareToken || !own.verifiedAt) throw new BadRequestException('Keine Nextcloud verbunden – im Home-Menü unter ☁️ Nextcloud eine Freigabe eintragen.');
    return { l: own, nc: await this.client(own), root: [IMAGES] };
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
    // Bilder im früheren Ordner der Schule: werden nach dem Verbinden übernommen.
    const legacy = l?.serverFolder
      ? { pending: !l.legacyMovedAt, running: this.adopting.has(l.userId), movedAt: l.legacyMovedAt, result: l.legacyResult }
      : null;
    if (!l || !l.shareToken) {
      return {
        configured: false, ready: false, mode: null, legacy,
        suggestedBase: await this.suggestedBase(), config: { shareUrl: '', readShareUrl: '', hasPassword: false },
      };
    }
    if (l.verifiedAt && l.serverFolder && !l.legacyMovedAt) this.startAdopt(l, false);
    if (l.imageShareToken) void this.checkReadShareAlive(l).catch(() => undefined);
    return {
      configured: true,
      ready: !!l.verifiedAt,
      mode: l.verifiedAt ? 'own' : null,
      legacy: legacy && { ...legacy, running: this.adopting.has(l.userId) },
      config: {
        shareUrl: this.shareLink(l),
        readShareUrl: l.imageShareToken ? `${l.baseUrl}/s/${l.imageShareToken}` : '',
        hasPassword: !!l.passwordSealed,
      },
      directImages: !!l.imageShareToken,
      readShareLostAt: l.readShareLostAt,
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
    const oldRead = l.imageShareToken && l.baseUrl ? { base: l.baseUrl, token: l.imageShareToken } : null;
    // Noch keine Freigabe gespeichert: Ein altes Passwort (etwa das App-Passwort
    // der Vorversion) gilt nicht als Passwort der Freigabe.
    if (!l.shareToken) l.passwordSealed = null;
    if (l.baseUrl !== base || l.shareToken !== share.token) Object.assign(l, { davMode: null, verifiedAt: null });
    if (input.password !== undefined && input.password !== null && String(input.password) !== '') {
      l.passwordSealed = this.masterKey.sealSecret(String(input.password));
    }
    Object.assign(l, { baseUrl: base, shareToken: share.token, imageShareToken: readToken, appBase, readShareLostAt: null });
    await this.linkRepo.save(l);
    const res: any = await this.verify(user, appBase);
    // Lesefreigabe entfernt oder gewechselt: direkte Links auf die alte umhängen,
    // damit die alte Freigabe danach gelöscht werden kann.
    if (oldRead && oldRead.token !== readToken) {
      const n = await this.relinkReadShare(l, oldRead.base, oldRead.token);
      if (n) res.message += ` ${n} Modul(e) zeigen jetzt ${readToken ? 'auf die neue Lesefreigabe' : 'auf den Weg über diesen Server'} – die alte Lesefreigabe kann in der Nextcloud gelöscht werden.`;
    }
    return res;
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
      // Eigene Bilder aus dem früheren Schulordner übernehmen – das hängt auch
      // die Links um; sonst nur umhängen (etwa Bilder, die der Admin hochlud).
      if (l.serverFolder && !l.legacyMovedAt) this.startAdopt(l, true);
      else void this.relinkAll().catch(() => undefined);
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
   * Eintrag selbst bleibt – seine Kennung steckt in alten Bild-Links.
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
    return !!(l?.shareToken && l.verifiedAt);
  }

  // ---- Bild-Links ----

  /**
   * Link, unter dem Schüler ein Bild sehen: direkt (Lesefreigabe) oder über
   * diesen Server. /school/… gibt es nur noch für alte Bilder im früheren
   * Ordner der Schule – getrennte Wege, damit sie gültig bleiben.
   */
  imageUrl(l: NextcloudLink, sub: string, name: string) {
    if (l.imageShareToken) return shareFileUrl(l.baseUrl, l.imageShareToken, sub, name);
    return `${l.appBase || baseUrl()}/api/nextcloud/files/${l.id}/${encodeURIComponent(sub)}/${encodeURIComponent(name)}`;
  }

  private previewUrl(l: NextcloudLink, sub: string, name: string) {
    return l.imageShareToken ? sharePreviewUrl(l.baseUrl, l.imageShareToken, sub, name) : this.imageUrl(l, sub, name);
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

  // ---- Grenze für Bilder in der App ----

  async quotaSettings(): Promise<{ warnMb: number; limitMb: number }> {
    const row = await this.configRepo.findOne({ where: { key: IMAGE_QUOTA_KEY } });
    return { ...DEFAULT_IMAGE_QUOTA, ...(row?.value || {}) };
  }

  /** Admin: `{ warnMb, limitMb }` – ganze MB, 0 = keine Grenze. */
  async saveQuotaSettings(input: any) {
    const int = (v: any, what: string) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 100000) throw new BadRequestException(`${what}: bitte eine ganze Zahl ab 0 (MB).`);
      return n;
    };
    const cur = await this.quotaSettings();
    const next = {
      warnMb: input.warnMb !== undefined ? int(input.warnMb, 'Hinweis ab') : cur.warnMb,
      limitMb: input.limitMb !== undefined ? int(input.limitMb, 'Grenze') : cur.limitMb,
    };
    if (next.warnMb && next.limitMb && next.warnMb > next.limitMb) throw new BadRequestException('Der Hinweis muss vor der Grenze kommen.');
    await this.configRepo.save(this.configRepo.create({ key: IMAGE_QUOTA_KEY, value: next }));
    return next;
  }

  /**
   * Bilder in der App aus selbst verfassten Modulen der eigenen Themen – was
   * „Vorhandene Bilder auslagern“ in die Nextcloud bringen kann. Gekauftes
   * und Übernommenes zählt nicht. `except`: dieses Modul auslassen.
   */
  private async appImages(userId: string, except?: string) {
    const qb = this.moduleRepo.createQueryBuilder('m')
      .innerJoin('m.topic', 't')
      .select(['m.id', 'm.content'])
      .where('m.creatorId = :u AND t.ownerId = :u AND m.content LIKE :d', { u: userId, d: '%data:image/%' });
    const rows = await qb.getMany();
    return dataImageSizes(rows.filter((m) => m.id !== except).map((m) => m.content));
  }

  /** Stand für die Oberfläche: belegt, Hinweis ab, Grenze (Bytes, 0 = keine), Nextcloud verbunden? */
  async quota(user: any) {
    const q = await this.quotaSettings();
    const ready = await this.isReady(user.userId);
    const used = sum(await this.appImages(user.userId));
    const warn = q.warnMb * MB;
    const limit = q.limitMb * MB;
    return {
      usedBytes: used, warnBytes: warn, limitBytes: limit, nextcloud: ready,
      state: ready ? 'nextcloud' : limit && used >= limit ? 'full' : warn && used >= warn ? 'warn' : 'ok',
    };
  }

  /**
   * Beim Speichern eines Moduls: Kommen Bilder in der App dazu, obwohl die
   * Grenze erreicht ist, wird abgelehnt. Ohne neue Bilder geht Speichern
   * immer – auch über der Grenze. Mit Nextcloud gibt es keine Grenze.
   */
  async assertAppImagesAllowed(user: any, module: { id?: string; topicOwnerId?: string; creatorId?: string | null }, oldContent: any, newContent: any) {
    const before = dataImageSizes([oldContent]);
    const after = dataImageSizes([newContent]);
    const added = [...after.keys()].filter((k) => !before.has(k));
    if (!added.length) return;
    // Nur, was zählt: selbst verfasst im eigenen Thema.
    if (module.creatorId !== user.userId || module.topicOwnerId !== user.userId) return;
    const { limitMb } = await this.quotaSettings();
    if (!limitMb || (await this.isReady(user.userId))) return;
    const others = await this.appImages(user.userId, module.id);
    for (const [k, v] of after) others.set(k, v);
    if (sum(others) > limitMb * MB) {
      throw new BadRequestException(`Deine Bilder in der App haben die Grenze von ${limitMb} MB erreicht – neue Bilder lassen sich nicht mehr in der App speichern. `
        + 'Bitte im Home-Menü unter ☁️ Nextcloud eine Freigabe verbinden (dort lassen sich auch die vorhandenen Bilder auslagern) – oder das neue Bild wieder entfernen.');
    }
  }

  // ---- Bilder aus dem früheren Ordner der Schule übernehmen ----

  /** Laufende Übernahmen (Benutzer-ID) – nie zwei gleichzeitig für dieselbe Lehrkraft. */
  private readonly adopting = new Set<string>();

  /**
   * Übernahme im Hintergrund starten – sie kann bei vielen Bildern länger
   * dauern als eine Anfrage. Nach einem Fehler erst eine Stunde später wieder,
   * außer beim Verbinden (`force`).
   */
  private startAdopt(l: NextcloudLink, force: boolean) {
    if (this.adopting.has(l.userId)) return;
    const last = l.legacyResult?.attemptAt ? new Date(l.legacyResult.attemptAt).getTime() : 0;
    if (!force && Date.now() - last < 60 * 60 * 1000) return;
    void this.adoptSchoolImages(l.userId).catch(() => undefined);
  }

  /**
   * Bilder aus Bilder/<serverFolder>/<Thema>/ im Ordner des Admin-Backups in
   * die eigene Freigabe (Bilder/<Thema>/) kopieren und die Links in allen
   * Modulen und Entwürfen umstellen. Die alten Dateien bleiben liegen, alte
   * Links (etwa in exportierten Dateien) funktionieren also weiter. Ein
   * gleichnamiges, gleiches Bild wird wiederverwendet, ein anderes bekommt
   * -2, -3 … angehängt.
   */
  async adoptSchoolImages(userId: string) {
    // Vor dem ersten await sperren: Wer gleich danach den Status holt, sieht „läuft“.
    if (this.adopting.has(userId)) return null;
    this.adopting.add(userId);
    try {
      return await this.adopt(userId);
    } finally {
      this.adopting.delete(userId);
    }
  }

  private async adopt(userId: string) {
    const l = await this.find(userId);
    if (!l?.serverFolder || l.legacyMovedAt || !l.shareToken || !l.verifiedAt) return l?.legacyResult || null;
    const result: any = { attemptAt: new Date().toISOString(), copied: 0, reused: 0, missing: 0, modules: 0, drafts: 0 };
    try {
      const school = await this.schoolClient();
      if (!school) throw new Error('Der frühere Ordner der Schule (Admin-Backup) ist nicht erreichbar.');
      const nc = await this.client(l);
      const oldRoot = [IMAGES, l.serverFolder];
      const folders = (await school.list(oldRoot).catch((): DavEntry[] => [])).filter((e) => e.isFolder);
      for (const folder of folders) {
        const sub = folder.name;
        if (!safePart(sub)) continue;
        const files = (await school.list([...oldRoot, sub])).filter((e) => !e.isFolder && IMAGE_EXT.test(e.name) && safePart(e.name));
        for (const f of files) {
          const file = await school.get([...oldRoot, sub, f.name]);
          const placed = file ? await this.placeImage(nc, sub, f.name, file) : null;
          if (!placed) result.missing++;
          else result[placed.copied ? 'copied' : 'reused']++;
        }
      }
      // Links umhängen: in allem Material, nicht nur in eigenen Modulen.
      const r = await this.relinkAll();
      Object.assign(result, { modules: r.modules, drafts: r.drafts });
      Object.assign(l, { legacyMovedAt: new Date(), legacyResult: result });
    } catch (err: any) {
      Object.assign(l, { legacyResult: { ...result, error: String(err?.message || err) } });
    }
    // Nur die eigenen Spalten schreiben – der Eintrag kann sich inzwischen geändert haben.
    await this.linkRepo.update({ id: l.id }, { legacyMovedAt: l.legacyMovedAt, legacyResult: l.legacyResult });
    return l.legacyResult;
  }

  // ---- Alte Links auf den Schulordner umhängen (alles Material) ----

  private relinking: Promise<any> | null = null;

  /** Beim Start einmal alles Material durchgehen – im Hintergrund, der Start wartet nicht. */
  onApplicationBootstrap() {
    setTimeout(() => {
      void this.relinkAll().then((r) => {
        if (r && (r.modules || r.drafts || r.missing)) {
          this.logger.log(`Alte Bilder-Links umgehängt: ${r.modules} Module, ${r.drafts} Entwürfe, ${r.copied} Bilder kopiert, ${r.reused} schon da, ${r.missing} nicht gefunden, ${r.skipped} ohne Freigabe der Lehrkraft`);
        }
      }).catch((err) => this.logger.warn(`Alte Bilder-Links umhängen fehlgeschlagen: ${err?.message || err}`));
      void this.linkRepo.find().then(async (links) => {
        for (const l of links) if (l.imageShareToken) await this.checkReadShareAlive(l).catch(() => undefined);
      }).catch(() => undefined);
    }, 5000);
  }

  /**
   * Alle Links /api/nextcloud/school/<Eintrag>/<Ordner>/<Datei> in Modulen und
   * Entwürfen auf die Freigabe einer Lehrkraft umhängen – bei Modulen der
   * Lehrkraft, der das Thema gehört (sonst Verfasser, sonst wer das Bild
   * hochgeladen hat), bei Entwürfen ihrer Lehrkraft. Nur, wer eine geprüfte
   * eigene Freigabe hat; die anderen bleiben, bis sie verbinden.
   *
   * Das Bild kommt aus dem Schulordner in Bilder/<Ordner>/ der Freigabe;
   * liegt dort schon ein gleiches (oder ist es im Schulordner schon gelöscht,
   * dort aber gleichnamig vorhanden), wird es wiederverwendet. Läuft nie
   * doppelt; ein zweiter Aufruf wartet auf den laufenden.
   */
  relinkAll(): Promise<any> {
    if (!this.relinking) this.relinking = this.doRelinkAll().finally(() => { this.relinking = null; });
    return this.relinking;
  }

  private async doRelinkAll() {
    const result = { modules: 0, drafts: 0, copied: 0, reused: 0, missing: 0, skipped: 0 };
    const needle = '%/api/nextcloud/school/%';
    const mods = await this.moduleRepo.createQueryBuilder('m')
      .select(['m.id', 'm.content', 'm.topicId', 'm.parentId', 'm.creatorId'])
      .where('m.content LIKE :n', { n: needle }).getMany();
    const drafts = await this.draftRepo.createQueryBuilder('d')
      .select(['d.id', 'd.data', 'd.userId'])
      .where('d.data LIKE :n', { n: needle }).getMany();
    if (!mods.length && !drafts.length) return result;

    const school = await this.schoolClient();
    // Themen-Eigentümer, auch für Untermodule (Thema über das Elternmodul).
    const parentIds = [...new Set(mods.filter((m) => !m.topicId && m.parentId).map((m) => m.parentId))];
    const parents = parentIds.length ? await this.moduleRepo.find({ where: { id: In(parentIds) }, select: ['id', 'topicId'] }) : [];
    const topicOf = (m: LearningModule) => m.topicId || parents.find((p) => p.id === m.parentId)?.topicId || null;
    const topicIds = [...new Set(mods.map(topicOf).filter(Boolean))] as string[];
    const topics = topicIds.length ? await this.topicRepo.find({ where: { id: In(topicIds) }, select: ['id', 'ownerId'] }) : [];
    const ownerOfTopic = new Map(topics.map((t) => [t.id, t.ownerId]));

    // Je Lehrkraft ihre Freigabe (nur geprüfte) – einmal geöffnet.
    const targets = new Map<string, Promise<{ l: NextcloudLink; nc: ShareClient } | null>>();
    const target = (userId: string | null | undefined) => {
      if (!userId) return Promise.resolve(null);
      if (!targets.has(userId)) {
        targets.set(userId, (async () => {
          const l = await this.find(userId);
          return l?.shareToken && l.verifiedAt ? { l, nc: await this.client(l) } : null;
        })().catch(() => null));
      }
      return targets.get(userId)!;
    };
    const sources = new Map<string, Promise<NextcloudLink | null>>();
    const source = (linkId: string) => {
      if (!sources.has(linkId)) sources.set(linkId, this.linkRepo.findOne({ where: { id: linkId } }));
      return sources.get(linkId)!;
    };

    // Ein Bild in die Freigabe bringen; Ergebnis: neuer Link oder null. Je Ziel nur einmal.
    const done = new Map<string, Promise<string | null>>();
    const move = (owners: Array<string | null | undefined>, linkId: string, sub: string, name: string) => {
      const key = `${owners.join(',')}|${linkId}|${sub}|${name}`;
      if (!done.has(key)) done.set(key, (async () => {
        const src = await source(linkId);
        let t: { l: NextcloudLink; nc: ShareClient } | null = null;
        for (const o of [...owners, src?.userId]) if (!t) t = await target(o);
        if (!t) { result.skipped++; return null; }
        if (!safePart(sub) || !safePart(name) || !IMAGE_EXT.test(name)) { result.missing++; return null; }
        const file = school && src?.serverFolder ? await school.get([IMAGES, src.serverFolder, sub, name]).catch(() => null) : null;
        const placed = await this.placeImage(t.nc, sub, name, file);
        if (!placed) { result.missing++; return null; }
        result[placed.copied ? 'copied' : 'reused']++;
        return this.imageUrl(t.l, sub, placed.name);
      })());
      return done.get(key)!;
    };

    for (const m of mods) {
      const owners = [ownerOfTopic.get(topicOf(m) || ''), m.creatorId];
      const next = await this.swapSchoolUrls(m.content, (linkId, sub, name) => move(owners, linkId, sub, name));
      if (JSON.stringify(next) !== JSON.stringify(m.content)) { await this.moduleRepo.update({ id: m.id }, { content: next }); result.modules++; }
    }
    for (const d of drafts) {
      const next = await this.swapSchoolUrls(d.data, (linkId, sub, name) => move([d.userId], linkId, sub, name));
      if (JSON.stringify(next) !== JSON.stringify(d.data)) { await this.draftRepo.update({ id: d.id }, { data: next }); result.drafts++; }
    }
    return result;
  }

  /**
   * Bild nach Bilder/<sub>/ der Freigabe: gleichnamig und gleich → wiederverwenden,
   * gleichnamig und anders → -2, -3 …; ohne Quelle (im Schulordner gelöscht)
   * gilt ein gleichnamiges vorhandenes Bild. null, wenn es nichts gibt.
   */
  private async placeImage(nc: ShareClient, sub: string, name: string, file: { type: string; data: Buffer } | null) {
    const present = new Set((await nc.list([IMAGES, sub]).catch((): DavEntry[] => [])).map((e) => e.name));
    if (!file) return present.has(name) ? { name, copied: false } : null;
    let target = name;
    for (let n = 2; present.has(target); n++) {
      const mine = await nc.get([IMAGES, sub, target]);
      if (mine && mine.data.equals(file.data)) return { name: target, copied: false };
      if (n > 99) throw new Error(`Zu viele Dateien mit dem Namen ${name}.`);
      target = name.replace(/(\.[^.]+)$/, `-${n}$1`);
    }
    await nc.ensureFolder([IMAGES, sub]);
    const type = file.type.split(';')[0].trim();
    await nc.put([IMAGES, sub, target], file.data, IMAGE_TYPES[type] ? type : 'application/octet-stream');
    return { name: target, copied: true };
  }

  /**
   * Jeden Link auf den Schulordner in einem Inhalt (beliebig verschachtelt,
   * auch mitten im HTML) durch fn(...) ersetzen; null lässt ihn stehen.
   * Ordner- und Dateinamen dürfen ( ) ' enthalten – encodeURIComponent lässt
   * sie stehen. Endet ein Name mitten im HTML auf ' oder ), wird das zur Not
   * abgeschnitten.
   */
  private async swapSchoolUrls(value: any, fn: (linkId: string, sub: string, name: string) => Promise<string | null>): Promise<any> {
    if (typeof value === 'string') {
      if (!value.includes('/api/nextcloud/school/')) return value;
      const re = /(?:https?:\/\/[^\s"'<>]*?)?\/api\/nextcloud\/school\/([0-9a-f-]{36})\/([^/?#"\s<>]+)\/([^/?#"\s<>]+)/gi;
      let out = '';
      let last = 0;
      for (const m of value.matchAll(re)) {
        let name = m[3];
        let tail = '';
        let url: string | null = null;
        const dec = (x: string) => { try { return decodeURIComponent(x); } catch { return null; } };
        for (;;) {
          const sub = dec(m[2]);
          const file = dec(name);
          if (sub && file && IMAGE_EXT.test(file)) url = await fn(m[1].toLowerCase(), sub, file);
          if (url || !/['")]$/.test(name)) break;
          tail = name.slice(-1) + tail;
          name = name.slice(0, -1);
        }
        out += value.slice(last, m.index) + (url ? url + tail : m[0]);
        last = m.index! + m[0].length;
      }
      return out + value.slice(last);
    }
    if (Array.isArray(value)) return Promise.all(value.map((v) => this.swapSchoolUrls(v, fn)));
    if (value && typeof value === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(value)) out[k] = await this.swapSchoolUrls(v, fn);
      return out;
    }
    return value;
  }

  // ---- Lesefreigabe: zurückgezogen oder verschwunden ----

  /**
   * Gibt es die Lesefreigabe noch? Höchstens alle 6 Stunden geprüft. Ist sie
   * in der Nextcloud gelöscht (404), laufen die Bilder ab jetzt über diesen
   * Server: Kürzel vergessen, direkte Links umhängen, Hinweis im Dialog.
   * Netzfehler zählen nicht – nur eine klare Antwort „gibt es nicht“.
   */
  async checkReadShareAlive(l: NextcloudLink, force = false) {
    if (!l.imageShareToken || !l.baseUrl || !l.verifiedAt) return true;
    if (!force && l.readShareCheckedAt && Date.now() - new Date(l.readShareCheckedAt).getTime() < 6 * 3600 * 1000) return true;
    l.readShareCheckedAt = new Date();
    await this.linkRepo.update({ id: l.id }, { readShareCheckedAt: l.readShareCheckedAt });
    await assertPublicHost(l.baseUrl);
    const res = await fetch(`${l.baseUrl}/s/${encodeURIComponent(l.imageShareToken)}`, { redirect: 'manual' });
    if (res.status !== 404) return true;
    const token = l.imageShareToken;
    Object.assign(l, { imageShareToken: null, readShareLostAt: new Date() });
    await this.linkRepo.update({ id: l.id }, { imageShareToken: null, readShareLostAt: l.readShareLostAt });
    const n = await this.relinkReadShare(l, l.baseUrl, token);
    this.logger.warn(`Lesefreigabe von ${l.userId} nicht mehr vorhanden – ${n} Modul(e) auf den Weg über den Server umgestellt`);
    return false;
  }

  /**
   * Direkte Links einer (alten) Lesefreigabe – …/s/<Kürzel>/download?path=/<Ordner>&files=<Datei>,
   * im HTML auch mit &amp; – auf den aktuellen Weg umhängen (neue
   * Lesefreigabe oder über diesen Server). Liefert die Zahl geänderter Module
   * und Entwürfe. Die Dateien liegen ja weiter in Bilder/ der Freigabe.
   */
  async relinkReadShare(l: NextcloudLink, base: string, token: string) {
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${esc(base)}/s/${esc(token)}/download\\?path=([^&"'\\s<>#]*)&(?:amp;)?files=([^&"'\\s<>#]+)`, 'g');
    const swap = (v: any): any => {
      if (typeof v === 'string') {
        return v.includes(`/s/${token}/`) ? v.replace(re, (m, path: string, file: string) => {
          try {
            const sub = decodeURIComponent(path).replace(/^\/+|\/+$/g, '');
            const name = decodeURIComponent(file);
            return sub && safePart(sub) && safePart(name) ? this.imageUrl(l, sub, name) : m;
          } catch { return m; }
        }) : v;
      }
      if (Array.isArray(v)) return v.map(swap);
      if (v && typeof v === 'object') {
        const out: any = {};
        for (const [k, x] of Object.entries(v)) out[k] = swap(x);
        return out;
      }
      return v;
    };
    const needle = `%/s/${token}/download%`;
    let n = 0;
    const mods = await this.moduleRepo.createQueryBuilder('m').select(['m.id', 'm.content']).where('m.content LIKE :n', { n: needle }).getMany();
    for (const m of mods) {
      const next = swap(m.content);
      if (JSON.stringify(next) !== JSON.stringify(m.content)) { await this.moduleRepo.update({ id: m.id }, { content: next }); n++; }
    }
    const drafts = await this.draftRepo.createQueryBuilder('d').select(['d.id', 'd.data']).where('d.data LIKE :n', { n: needle }).getMany();
    for (const d of drafts) {
      const next = swap(d.data);
      if (JSON.stringify(next) !== JSON.stringify(d.data)) { await this.draftRepo.update({ id: d.id }, { data: next }); n++; }
    }
    return n;
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
    opts: { folder?: string; name?: string; replace?: boolean } = {},
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Keine Datei empfangen.');
    if (!IMAGE_TYPES[file.mimetype]) throw new BadRequestException('Nur Bilder (PNG, JPEG, GIF, WebP, SVG) lassen sich hochladen.');
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('Das Bild ist größer als 15 MB.');
    const { l, nc, root } = await this.effective(user.userId);
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
    return { success: true, url: this.imageUrl(l, sub, name), name, folder: sub };
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
  async migrateTopic(user: any, topicId: string) {
    const { l, nc, root } = await this.effective(user.userId);
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
      urls.set(dataUrl, this.imageUrl(l, sub, name));
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
    const { l, nc, root } = eff;
    const byFolder = new Map<string, string[]>();
    for (const r of refs) {
      const m = NC_REF.exec(r);
      if (m) byFolder.set(m[1], [...(byFolder.get(m[1]) || []), r]);
    }
    for (const [folder, list] of byFolder) {
      const names = new Set((await nc.list([...root, folder]).catch((): DavEntry[] => [])).filter((e) => !e.isFolder).map((e) => e.name));
      for (const r of list) {
        const name = NC_REF.exec(r)![2];
        if (names.has(name)) out.set(r, this.imageUrl(l, folder, name));
      }
    }
    return out;
  }

  /**
   * Bilder eines Ordners für die Auswahl im Editor, dazu alle Ordner unter
   * Bilder. Ohne `folder` der Ordner des Themas.
   */
  async listImages(user: any, opts: { folder?: string; topicId?: string }) {
    const { l, nc, root } = await this.effective(user.userId);
    const entries = await nc.list(root);
    const folders = entries.filter((e) => e.isFolder).map((e) => e.name).sort((a, b) => a.localeCompare(b, 'de'));
    const current = opts.folder ? safeFolderName(opts.folder) : await this.topicFolder(opts.topicId);
    const files = folders.includes(current) ? await nc.list([...root, current]) : [];
    const images = files
      .filter((e) => !e.isFolder && (IMAGE_TYPES[e.contentType] || IMAGE_EXT.test(e.name)))
      .sort((a, b) => String(b.modified).localeCompare(String(a.modified)) || a.name.localeCompare(b.name, 'de'))
      .map((e) => ({ name: e.name, size: e.size, url: this.imageUrl(l, current, e.name), previewUrl: this.previewUrl(l, current, e.name) }));
    return { folders, current, images };
  }
}
