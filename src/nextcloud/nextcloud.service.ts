import { Injectable, BadRequestException, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { NextcloudLink } from '../core/entities/nextcloud-link.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { ModuleDraft } from '../core/entities/module-draft.entity';
import { SchoolNextcloud } from '../core/entities/school-nextcloud.entity';
import { User } from '../core/entities/user.entity';
import { MasterKeyService } from '../core/crypto/master-key.service';
import { assertPublicHost, parseNextcloudShare, safeFileName } from '../core/share/nextcloud-upload';
import { baseUrl } from '../core/share/link-url';
import { DavEntry, OPEN_SHARE_MESSAGE, ShareClient, parseNextcloudBase, safeFolderName, shareIsOpen } from './nextcloud-api';

/** Bildtypen, die hochgeladen werden dürfen – und ihre Dateiendung. */
export const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
};
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGES = 'Bilder';
/** So lange dient eine frühere Freigabe als Quelle für fehlende Bilder. */
const PREVIOUS_SHARE_DAYS = 180;

/** Eintrag mit Freigabe und früheren Freigaben: NextcloudLink oder SchoolNextcloud. */
type SharedRow = Pick<NextcloudLink, 'baseUrl' | 'shareToken' | 'passwordSealed' | 'davMode' | 'previousShares'>;

/**
 * Die Bild-Links tragen nur die Kennung des Eintrags, nicht die Freigabe.
 * Wird eine andere eingetragen oder getrennt, zeigen sie auf die neue (oder
 * ins Leere). Damit nichts fehlt, merkt sich der Eintrag die bisherige
 * Freigabe, solange noch Links (`references`) daran hängen: Fehlende Bilder
 * liefert der Server dann aus ihr, und followOwners kopiert sie in die jetzige.
 */
export function rememberShare(row: SharedRow, references: number) {
  if (!row.baseUrl || !row.shareToken || !references) return;
  const cutoff = Date.now() - PREVIOUS_SHARE_DAYS * 24 * 3600 * 1000;
  const rest = (row.previousShares || []).filter((p) =>
    !(p.baseUrl === row.baseUrl && p.shareToken === row.shareToken) && new Date(p.at).getTime() > cutoff);
  row.previousShares = [
    { baseUrl: row.baseUrl, shareToken: row.shareToken, passwordSealed: row.passwordSealed, davMode: row.davMode, at: new Date().toISOString() },
    ...rest,
  ].slice(0, 5);
}

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

/**
 * Kennungsdatei im Wurzelordner einer Ablage: wer den Ordner nutzt – eine
 * Lehrkraft (eigene Freigabe) oder eine Schule. So erkennt die App denselben
 * Ordner auch hinter einem anderen Freigabelink.
 */
export const OWNER_FILE = '.lm-ablage.json';
/** `school`: Nextcloud einer Schule oder des Servers (Eintrag in school_nextcloud). */
export type ShareOwner = { kind: 'own' | 'school'; id: string };

/**
 * Nextcloud des Servers für Bilder, eingerichtet vom Admin: ein Eintrag in
 * school_nextcloud mit dieser Kennung statt einer Schule. Sie nimmt die
 * Bilder aller Lehrkräfte auf, deren Schule keine Nextcloud hat.
 */
export const SERVER_SCOPE = '__server__';

/** Teilen dürfen sich einen Ordner nur Lehrkräfte – Schulen und Server räumen auf. */
const clashes = (me: ShareOwner, o: ShareOwner) => !(o.kind === me.kind && o.id === me.id) && !(o.kind === 'own' && me.kind === 'own');

const separateMessage = (other: ShareOwner['kind']) => (other === 'school'
  ? 'Diesen Ordner nutzt schon eine Schule (oder der Server) als Nextcloud für die Bilder ihrer Lehrkräfte – bitte einen eigenen Ordner freigeben.'
  : 'Diesen Ordner nutzt schon eine Lehrkraft als eigene Ablage – bitte einen eigenen Ordner freigeben.');

async function readOwner(nc: ShareClient): Promise<ShareOwner | null> {
  const f = await nc.get([OWNER_FILE]).catch(() => null);
  if (!f) return null;
  try {
    const o = JSON.parse(f.data.toString('utf-8'));
    return (o?.kind === 'own' || o?.kind === 'school') && typeof o.id === 'string' ? o : null;
  } catch { return null; }
}

/** Teil eines Pfads, wie er in einer Bild-URL steht: kein Schrägstrich, kein „..“. */
const safePart = (p: string) => !!p && !/[\\/]/.test(p) && p !== '.' && p !== '..';

/** String.replace mit asynchronem Ersatz – der Reihe nach, nicht parallel. */
async function replaceAsync(text: string, re: RegExp, fn: (...m: any[]) => Promise<string>): Promise<string> {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += text.slice(last, m.index) + (await fn(...m));
    last = m.index! + m[0].length;
  }
  return out + text.slice(last);
}

/**
 * Wohin die Bilder einer Lehrkraft gehen („Ablage“): ihre eigene Freigabe
 * (Bilder/<Thema>/) oder – ohne eigene – die Nextcloud ihrer Schule
 * (Bilder/<Lehrkraft>/<Thema>/). `url` baut den Link für ein Bild darin.
 */
export interface ImageStore {
  kind: 'own' | 'school';
  l: NextcloudLink;
  snc?: SchoolNextcloud;
  nc: ShareClient;
  root: string[];
  url: (sub: string, name: string) => string;
}

/** Ein Bild-Link, zerlegt: wo das Bild liegt. */
interface ImageRef {
  kind: 'files' | 'school' | 'sch' | 'direct';
  linkId?: string;
  sncId?: string;
  folder?: string;
  sub: string;
  name: string;
}

/**
 * Nextcloud je Lehrkraft (docs/nextcloud.md) – über einen freigegebenen
 * Ordner mit Passwort, kein Konto: Die App sieht nur diesen Ordner. Darin
 * Bilder/<Thema>/ und Backups/. Ohne eigene Freigabe die Nextcloud der
 * Schule, falls der Schuladmin eine eingerichtet hat; sonst bleiben Bilder in
 * der App.
 *
 * Bilder folgen dem Thema (followOwners): Liegt ein Bild nicht in der Ablage
 * der Lehrkraft, der das Thema gehört – nach einem Schulwechsel, einer neuen
 * eigenen Freigabe, bei einer Kopie aus dem Shop –, kopiert die App es dorthin
 * und hängt den Link um. Die alte Datei bleibt; aufräumen kann man danach.
 *
 * Früher konnten Bilder im Ordner des Admin-Backups liegen (/school/…); auch
 * die wandern so in die Ablage der Lehrkraft.
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
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(SchoolNextcloud) private readonly schoolNcRepo: Repository<SchoolNextcloud>,
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

  // ---- Ablage: eigene Freigabe, Nextcloud der Schule oder des Servers ----

  /**
   * Nextcloud der Schule dieser Lehrkraft, sonst die des Servers – die erste,
   * die eingerichtet und geprüft ist. Ist sie gerade nicht erreichbar, scheitert
   * das Hochladen mit Meldung; ausgewichen wird nicht (sonst lägen die Bilder
   * verstreut).
   */
  async schoolShareOf(userId: string): Promise<{ user: User; snc: SchoolNextcloud } | null> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return null;
    for (const schoolId of [user.schoolId, SERVER_SCOPE]) {
      if (!schoolId) continue;
      const snc = await this.schoolNcRepo.findOne({ where: { schoolId } });
      if (snc?.shareToken && snc.verifiedAt) return { user, snc };
    }
    return null;
  }

  /** Client für die Freigabe einer Schule. */
  async schoolNcClient(snc: SchoolNextcloud, needMode = true) {
    if (!snc.baseUrl || !snc.shareToken) throw new BadRequestException('Die Schule hat keine Nextcloud verbunden.');
    let password = '';
    try { password = snc.passwordSealed ? this.masterKey.unsealSecret(snc.passwordSealed) : ''; } catch {
      throw new BadRequestException('Das gespeicherte Passwort der Schul-Freigabe lässt sich nicht mehr lesen – bitte neu eintragen.');
    }
    await assertPublicHost(snc.baseUrl);
    const nc = new ShareClient(snc.baseUrl, snc.shareToken, password, snc.davMode || 'classic');
    if (needMode && !snc.davMode) {
      snc.davMode = await nc.detectMode();
      await this.schoolNcRepo.update({ id: snc.id }, { davMode: snc.davMode });
    }
    return nc;
  }

  /**
   * Jede Ablage einer Schule (oder des Servers) braucht einen eigenen Ordner –
   * getrennt von den eigenen Freigaben der Lehrkräfte und von den anderen
   * Schulen: Alle legen unter Bilder/ an, und das Aufräumen einer Schule hielte
   * fremde Ordner für Ordner ohne Verweise. Prüft den Link und – mit `nc` –
   * die Kennungsdatei (derselbe Ordner hinter einem anderen Link). Ein
   * Schuladmin wählt so als Lehrkraft einen anderen Ordner als für die Schule.
   */
  async assertSeparate(me: ShareOwner, base: string, token: string, nc?: ShareClient) {
    const where = { baseUrl: base, shareToken: token };
    const school = await this.schoolNcRepo.findOne({ where });
    if (school?.verifiedAt && clashes(me, { kind: 'school', id: school.id })) throw new BadRequestException(separateMessage('school'));
    if (me.kind === 'school' && (await this.linkRepo.findOne({ where }))?.verifiedAt) throw new BadRequestException(separateMessage('own'));
    const owner = nc ? await readOwner(nc) : null;
    if (owner && clashes(me, owner) && (await this.ownerConnected(owner))) {
      throw new BadRequestException(`${separateMessage(owner.kind)} (Wird er dort nicht mehr gebraucht: die Datei ${OWNER_FILE} im Ordner löschen.)`);
    }
  }

  /** Kennungsdatei schreiben – nicht über die einer anderen Ablage, solange die den Ordner nutzt. */
  async claimShare(me: ShareOwner, nc: ShareClient) {
    const owner = await readOwner(nc);
    if (owner && owner.kind === me.kind && owner.id === me.id) return;
    if (owner && clashes(me, owner) && (await this.ownerConnected(owner))) return;
    await nc.put([OWNER_FILE], Buffer.from(JSON.stringify(me), 'utf-8'), 'application/json');
  }

  private async ownerConnected(o: ShareOwner) {
    const row = o.kind === 'own'
      ? await this.linkRepo.findOne({ where: { id: o.id } })
      : await this.schoolNcRepo.findOne({ where: { id: o.id } });
    return !!(row?.shareToken && row.verifiedAt);
  }

  /** Verbundene Ablagen ohne Kennungsdatei (von vor ihrer Einführung) bekommen eine. */
  async claimAll() {
    for (const l of await this.linkRepo.find()) {
      if (!l.shareToken || !l.verifiedAt) continue;
      await this.claimShare({ kind: 'own', id: l.id }, await this.client(l)).catch(() => undefined);
    }
    for (const r of await this.schoolNcRepo.find()) {
      if (!r.shareToken || !r.verifiedAt) continue;
      await this.claimShare({ kind: 'school', id: r.id }, await this.schoolNcClient(r)).catch(() => undefined);
    }
  }

  /** Link auf ein Bild in der Nextcloud einer Schule (immer über diesen Server). */
  schoolUrl(snc: SchoolNextcloud, folder: string, sub: string, name: string) {
    const e = encodeURIComponent;
    return `${snc.appBase || baseUrl()}/api/nextcloud/sch/${snc.id}/${e(folder)}/${e(sub)}/${e(name)}`;
  }

  /** Eintrag der Lehrkraft, angelegt bei Bedarf; legt ihren Ordner in Schul-Freigaben einmal fest. */
  private async rowFor(userId: string, user?: User | null) {
    let l = await this.find(userId);
    if (!l) l = this.linkRepo.create({ id: crypto.randomUUID(), userId });
    if (!l.schoolFolder) {
      const u = user || await this.userRepo.findOne({ where: { id: userId } });
      const name = u?.displayName || String(u?.email || '').split('@')[0] || 'Lehrkraft';
      // Wer schon im früheren Schulordner einen hatte, behält den Namen.
      l.schoolFolder = l.serverFolder || `${safeFolderName(name, 'Lehrkraft')} (${userId.slice(0, 8)})`;
      l = await this.linkRepo.save(l);
    }
    return l;
  }

  /**
   * Ablage einer Lehrkraft: eigene geprüfte Freigabe, sonst die Nextcloud der
   * Schule, sonst null (Bilder bleiben in der App). `skipOwn`: nur die Schule.
   */
  async storeFor(userId: string, opts: { skipOwn?: boolean } = {}): Promise<ImageStore | null> {
    const own = await this.find(userId);
    if (!opts.skipOwn && own?.shareToken && own.verifiedAt) {
      return { kind: 'own', l: own, nc: await this.client(own), root: [IMAGES], url: (sub, name) => this.imageUrl(own, sub, name) };
    }
    const school = await this.schoolShareOf(userId);
    if (!school) return null;
    const { snc } = school;
    const l = await this.rowFor(userId, school.user);
    const folder = l.schoolFolder!;
    return { kind: 'school', l, snc, nc: await this.schoolNcClient(snc), root: [IMAGES, folder], url: (sub, name) => this.schoolUrl(snc, folder, sub, name) };
  }

  /** Wie storeFor, aber mit Fehlermeldung statt null. */
  private async effective(userId: string): Promise<ImageStore> {
    const store = await this.storeFor(userId);
    if (!store) throw new BadRequestException('Keine Nextcloud verbunden – im Home-Menü unter ☁️ Nextcloud eine Freigabe eintragen.');
    return store;
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
    // Nextcloud der Schule – greift, solange keine eigene Freigabe verbunden ist.
    const school = await this.schoolShareOf(user.userId);
    const schoolInfo = school
      ? { available: true, server: school.snc.schoolId === SERVER_SCOPE, folder: `${IMAGES}/${l?.schoolFolder || l?.serverFolder || '<dein Name>'}` }
      : { available: false };
    if (!l || !l.shareToken) {
      return {
        configured: false, ready: !!school, mode: school ? 'school' : null, legacy, school: schoolInfo,
        imageCheck: (school && l?.imageCheck) || null,
        suggestedBase: await this.suggestedBase(), config: { shareUrl: '', hasPassword: false },
      };
    }
    if (l.verifiedAt && l.serverFolder && !l.legacyMovedAt) this.startAdopt(l, false);
    return {
      configured: true,
      ready: !!l.verifiedAt || !!school,
      mode: l.verifiedAt ? 'own' : school ? 'school' : null,
      school: schoolInfo,
      legacy: legacy && { ...legacy, running: this.adopting.has(l.userId) },
      config: {
        shareUrl: this.shareLink(l),
        hasPassword: !!l.passwordSealed,
      },
      insecure: !!l.insecureAt,
      readShareLostAt: l.readShareLostAt,
      move: this.moves.get(l.userId) || (l.moveResult ? { ...l.moveResult, running: false } : null),
      // Verlinkte Bilder, die in der Freigabe fehlen (followOwners, stündlich und nach dem Prüfen).
      imageCheck: l.imageCheck || null,
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
   * Speichern und gleich prüfen. `{ shareUrl, password? }` – leeres Passwort
   * lässt das gespeicherte (nur bei derselben Freigabe). Freigaben ohne
   * Passwort nimmt die App nicht an. `appBase`: öffentliche Adresse dieser App
   * (für die Bild-Links über den Server).
   */
  async connect(user: any, input: any, appBase: string) {
    const share = parseNextcloudShare(input.shareUrl);
    const base = parseNextcloudBase(share.base);
    if (!base) throw new BadRequestException('Der Freigabelink muss mit https:// beginnen.');
    const l = (await this.find(user.userId)) || this.linkRepo.create({ id: crypto.randomUUID(), userId: user.userId });
    const same = l.baseUrl === base && l.shareToken === share.token;
    // Eine andere Freigabe einfach eintragen ließe alle Bilder ins Leere zeigen
    // (die Links bleiben, die Dateien liegen in der alten) – dafür gibt es „Umziehen“.
    if (l.verifiedAt && l.shareToken && !same && (await this.countReferences(l)) > 0) {
      throw new BadRequestException('In deinen Modulen stecken Bilder aus der bisherigen Freigabe. Für eine andere Nextcloud bitte „🚚 Umziehen“ verwenden – das kopiert die Bilder mit.');
    }
    const given = input.password !== undefined && input.password !== null && String(input.password) !== '';
    if (!given && !(same && l.passwordSealed)) {
      throw new BadRequestException('Bitte das Passwort der Freigabe angeben – Freigaben ohne Passwort nimmt die App nicht an.');
    }
    if (!same) await this.assertSeparate({ kind: 'own', id: l.id }, base, share.token);
    await assertPublicHost(base);
    if (await shareIsOpen(base, share.token)) throw new BadRequestException(OPEN_SHARE_MESSAGE);
    // Auch eine kaputte oder getrennte bisherige Freigabe merken: Fehlende
    // Bilder holt die App beim Prüfen aus ihr in die neue.
    if (!same) { await this.rememberShare(l); Object.assign(l, { davMode: null, verifiedAt: null }); }
    if (given) l.passwordSealed = this.masterKey.sealSecret(String(input.password));
    Object.assign(l, { baseUrl: base, shareToken: share.token, appBase });
    await this.linkRepo.save(l);
    return this.verify(user, appBase, !same);
  }

  /**
   * Freigabe prüfen: öffnen (Passwort), Ordner Bilder anlegen, eine Datei
   * schreiben – und, falls eingetragen, über die Lesefreigabe wieder lesen.
   * `fresh`: neu eingetragen – dann darf der Ordner nicht der einer Schule sein.
   */
  async verify(user: any, appBase?: string, fresh = false) {
    const l = await this.find(user.userId);
    if (!l || !l.shareToken) throw new BadRequestException('Bitte zuerst den Freigabelink eintragen.');
    try {
      const nc = await this.client(l, false);
      l.davMode = await nc.detectMode();
      await nc.ensureFolder([IMAGES]);
      const stamp = `LearningModules-Verbindungstest ${crypto.randomUUID()}`;
      await nc.put([IMAGES, CHECK_FILE], Buffer.from(stamp, 'utf-8'), 'text/plain');
      await nc.remove([IMAGES, CHECK_FILE]);
      if (fresh) await this.assertSeparate({ kind: 'own', id: l.id }, l.baseUrl, l.shareToken, nc);
      await this.claimShare({ kind: 'own', id: l.id }, nc);
      // Ohne Passwort offen? Nicht abschalten (sonst fehlen alle Bilder), aber warnen.
      const open = await shareIsOpen(l.baseUrl, l.shareToken);
      Object.assign(l, { verifiedAt: new Date(), insecureAt: open ? new Date() : null, ...(appBase ? { appBase } : {}) });
      await this.linkRepo.save(l);
      // Eigene Bilder aus dem früheren Schulordner übernehmen – das hängt auch
      // die Links um; sonst nur umhängen (etwa Bilder, die der Admin hochlud).
      if (l.serverFolder && !l.legacyMovedAt) this.startAdopt(l, true);
      else void this.followOwners().catch(() => undefined);
    } catch (err) {
      l.verifiedAt = null;
      await this.linkRepo.save(l);
      throw err;
    }
    return {
      ...(await this.status(user)),
      message: l.insecureAt ? OPEN_SHARE_MESSAGE : 'Verbunden – die App sieht nur den freigegebenen Ordner; die Bilder kommen über diesen Server zu den Schülern.',
    };
  }

  /**
   * Eigene Freigabe vergessen. In der Nextcloud bleibt alles, wie es ist. Der
   * Eintrag selbst bleibt – seine Kennung steckt in alten Bild-Links.
   */
  async disconnect(user: any, force = false) {
    const l = await this.find(user.userId);
    if (l?.verifiedAt && !force && (await this.countReferences(l)) > 0) {
      throw new BadRequestException('In Modulen stecken noch Bilder aus dieser Freigabe – erst zurückholen, umziehen oder ausdrücklich trotzdem trennen.');
    }
    if (l) {
      // Hängen noch Links daran, bleibt sie Quelle für diese Bilder (rememberShare).
      await this.rememberShare(l);
      Object.assign(l, { baseUrl: '', shareToken: null, passwordSealed: null, davMode: null, imageShareToken: null, verifiedAt: null, insecureAt: null, backupEnabled: false });
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

  // ---- Frühere Freigaben: Bilder gehen beim Wechseln nicht verloren ----

  /** Bisherige Freigabe merken, falls noch Links daran hängen (siehe rememberShare oben). */
  private async rememberShare(l: NextcloudLink) {
    rememberShare(l, await this.countReferences(l));
  }

  /**
   * Bild <root>/<sub>/<name> aus einer früheren Freigabe (eigene: root Bilder,
   * Schule: Bilder/<Lehrkraft>) – null, wenn keine es hat.
   */
  async fromPrevious(row: SharedRow, root: string[], sub: string, name: string): Promise<{ type: string; data: Buffer } | null> {
    const cutoff = Date.now() - PREVIOUS_SHARE_DAYS * 24 * 3600 * 1000;
    for (const p of row.previousShares || []) {
      if ((p.baseUrl === row.baseUrl && p.shareToken === row.shareToken) || new Date(p.at).getTime() <= cutoff) continue;
      try {
        const password = p.passwordSealed ? this.masterKey.unsealSecret(p.passwordSealed) : '';
        await assertPublicHost(p.baseUrl);
        const nc = new ShareClient(p.baseUrl, p.shareToken, password, p.davMode || 'classic');
        if (!p.davMode) p.davMode = await nc.detectMode();
        const file = await nc.get([...root, sub, name]);
        if (file) return file;
      } catch { /* nicht (mehr) erreichbar – nächste */ }
    }
    return null;
  }

  /** Verbindung für andere Dienste (Backup): Eintrag und Client, sofern geprüft. */
  async connection(userId: string) {
    const l = await this.find(userId);
    if (!l?.verifiedAt) throw new BadRequestException('Die Nextcloud ist nicht (mehr) verbunden – bitte im Home-Menü unter ☁️ Nextcloud prüfen.');
    return { l, nc: await this.client(l) };
  }

  /** Gibt es eine Ablage (eigene Freigabe oder Nextcloud der Schule)? */
  async isReady(userId: string) {
    const l = await this.find(userId);
    return !!(l?.shareToken && l.verifiedAt) || !!(await this.schoolShareOf(userId));
  }

  // ---- Bild-Links ----

  /**
   * Link, unter dem Schüler ein Bild sehen – immer über diesen Server, der es
   * mit dem Passwort holt. /school/… gibt es nur noch für alte Bilder im
   * früheren Ordner des Admin-Backups – getrennte Wege, damit sie gültig bleiben.
   */
  imageUrl(l: NextcloudLink, sub: string, name: string) {
    return `${l.appBase || baseUrl()}/api/nextcloud/files/${l.id}/${encodeURIComponent(sub)}/${encodeURIComponent(name)}`;
  }

  /**
   * Bild für den Abruf über diesen Server (öffentlich, ohne Anmeldung – Schüler
   * haben keine). Nur Bilder unter Bilder/<Ordner>/; null, wenn es das nicht gibt.
   */
  async readImage(linkId: string, sub: string, name: string, school = false): Promise<{ type: string; data: Buffer } | null> {
    return this.readRef({ kind: school ? 'school' : 'files', linkId, sub, name });
  }

  /** Bild in der Nextcloud einer Schule: Bilder/<Ordner>/<Thema>/<Datei>. */
  async readSchoolImage(sncId: string, folder: string, sub: string, name: string) {
    return this.readRef({ kind: 'sch', sncId, folder, sub, name });
  }

  /** Bild zu einem zerlegten Link lesen – null, wenn es (dort) nicht zu haben ist. */
  private async readRef(ref: ImageRef): Promise<{ type: string; data: Buffer } | null> {
    const { sub, name } = ref;
    if (!safePart(sub) || !safePart(name) || !IMAGE_EXT.test(name)) return null;
    let nc: ShareClient | null = null;
    let root: string[] = [];
    let row: SharedRow | null = null;
    if (ref.kind === 'sch') {
      if (!ref.folder || !safePart(ref.folder)) return null;
      const snc = await this.schoolNcRepo.findOne({ where: { id: ref.sncId } });
      if (!snc) return null;
      row = snc;
      nc = snc.shareToken && snc.verifiedAt ? await this.schoolNcClient(snc).catch(() => null) : null;
      root = [IMAGES, ref.folder];
    } else {
      const l = await this.linkRepo.findOne({ where: { id: ref.linkId } });
      if (!l) return null;
      if (ref.kind === 'school') {
        nc = l.serverFolder ? await this.schoolClient() : null;
        root = [IMAGES, l.serverFolder || ''];
      } else {
        row = l;
        nc = l.shareToken && l.verifiedAt ? await this.client(l).catch(() => null) : null;
        root = [IMAGES];
      }
    }
    let file = nc ? await nc.get([...root, sub, name]).catch(() => null) : null;
    // Fehlt es in der jetzigen Freigabe, liegt es vielleicht noch in einer früheren.
    if (!file && row) file = await this.fromPrevious(row, root, sub, name);
    if (!file) return null;
    const ext = name.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg');
    const type = IMAGE_TYPES[file.type.split(';')[0].trim()] ? file.type.split(';')[0].trim() : (ext === 'svg' ? 'image/svg+xml' : `image/${ext}`);
    return { type, data: file.data };
  }

  /** Erkennt Links „über diesen Server“ und liefert das Bild (für den Export). */
  async readImageByUrl(url: string) {
    const u = String(url || '');
    const d = (x: string) => { try { return decodeURIComponent(x); } catch { return ''; } };
    const sch = /\/api\/nextcloud\/sch\/([0-9a-f-]{36})\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)$/i.exec(u);
    if (sch) return this.readRef({ kind: 'sch', sncId: sch[1], folder: d(sch[2]), sub: d(sch[3]), name: d(sch[4]) });
    const m = /\/api\/nextcloud\/(files|school)\/([0-9a-f-]{36})\/([^/?#]+)\/([^/?#]+)$/i.exec(u);
    if (!m) return null;
    return this.readRef({ kind: m[1] as 'files' | 'school', linkId: m[2], sub: d(m[3]), name: d(m[4]) });
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
          const placed = file ? await this.placeImage(nc, [IMAGES], sub, f.name, file) : null;
          if (!placed) result.missing++;
          else result[placed.copied ? 'copied' : 'reused']++;
        }
      }
      // Links umhängen: in allem Material, nicht nur in eigenen Modulen.
      const r = await this.followOwners();
      Object.assign(result, { modules: r.modules, drafts: r.drafts });
      Object.assign(l, { legacyMovedAt: new Date(), legacyResult: result });
    } catch (err: any) {
      Object.assign(l, { legacyResult: { ...result, error: String(err?.message || err) } });
    }
    // Nur die eigenen Spalten schreiben – der Eintrag kann sich inzwischen geändert haben.
    await this.linkRepo.update({ id: l.id }, { legacyMovedAt: l.legacyMovedAt, legacyResult: l.legacyResult });
    return l.legacyResult;
  }

  /**
   * Inhalt eines Moduls oder Entwurfs frisch lesen, mit fn umschreiben und
   * speichern. Die Läufe hier lesen alles am Anfang und brauchen dann für
   * Nextcloud-Zugriffe Minuten – schrieben sie den Stand vom Anfang zurück,
   * wäre weg, was die Lehrkraft inzwischen gespeichert hat (etwa neu
   * eingefügte Bilder: Datei in der Nextcloud, Link im Modul verloren).
   * true, wenn sich etwas geändert hat.
   */
  private async rewrite(kind: 'module' | 'draft', id: string, fn: (value: any) => any): Promise<boolean> {
    const repo: Repository<any> = kind === 'module' ? this.moduleRepo : this.draftRepo;
    const field = kind === 'module' ? 'content' : 'data';
    const row = await repo.findOne({ where: { id }, select: ['id', field] });
    if (!row) return false;
    const next = await fn(row[field]);
    if (JSON.stringify(next) === JSON.stringify(row[field])) return false;
    await repo.update({ id }, { [field]: next });
    return true;
  }

  // ---- Bilder folgen dem Thema (alles Material) ----

  private following: Promise<any> | null = null;

  /**
   * Beim Start einmal alles Material durchgehen und danach stündlich – im
   * Hintergrund, der Start wartet nicht. Dazu die Lesefreigaben prüfen.
   */
  onApplicationBootstrap() {
    const run = () => void this.followOwners().then((r) => {
      if (r && (r.modules || r.drafts || r.missing || r.restored)) {
        this.logger.log(`Bilder umgehängt: ${r.modules} Module, ${r.drafts} Entwürfe, ${r.copied} Bilder kopiert, ${r.reused} schon da, ${r.restored} aus früherer Freigabe zurückgeholt, ${r.missing} nicht gefunden, ${r.skipped} ohne Ablage der Lehrkraft`);
      }
      if (r?.offloaded) {
        this.logger.log(`Bilder aus der App ausgelagert: ${r.offloaded} Module, ${(r.offloadedBytes / 1024 / 1024).toFixed(1)} MB`);
      }
    }).catch((err) => this.logger.warn(`Bilder umhängen fehlgeschlagen: ${err?.message || err}`));
    setTimeout(() => {
      void this.dropReadShares().catch((err) => this.logger.warn(`Lesefreigaben umstellen fehlgeschlagen: ${err?.message || err}`))
        .then(() => this.checkProtection()).catch(() => undefined)
        .then(() => this.claimAll()).catch(() => undefined)
        .then(run);
    }, 5000).unref?.();
    setInterval(run, 60 * 60 * 1000).unref?.();
  }

  /** Früherer Name – hängt jetzt alles um, nicht nur die alten Schul-Links. */
  relinkAll(): Promise<any> {
    return this.followOwners();
  }

  /**
   * Jedes Bild in einem Modul gehört in die Ablage der Lehrkraft, der das
   * Thema gehört (bei einem Entwurf: dessen Lehrkraft). Liegt es woanders –
   * in einer anderen Freigabe, der Nextcloud einer anderen Schule, im Ordner
   * einer Kollegin oder im früheren Ordner des Admin-Backups –, kopiert die
   * App es in Bilder/<Thema>/ der Ablage und hängt den Link um. Hat die
   * Lehrkraft keine Ablage, bleibt der Link. Gleiche Bilder werden
   * wiederverwendet; ist die Quelle weg, gilt ein gleichnamiges in der Ablage.
   * Läuft nie doppelt; ein zweiter Aufruf wartet auf den laufenden.
   */
  followOwners(): Promise<any> {
    if (!this.following) this.following = this.doFollowOwners().finally(() => { this.following = null; });
    return this.following;
  }

  private async doFollowOwners() {
    const result = { modules: 0, drafts: 0, copied: 0, reused: 0, missing: 0, restored: 0, skipped: 0, offloaded: 0, offloadedBytes: 0 };
    const links = await this.linkRepo.find();
    const byToken = new Map(links.filter((l) => l.imageShareToken).map((l) => [l.imageShareToken!, l]));
    const needles = ['%/api/nextcloud/%', ...(byToken.size ? ['%/download?path=%'] : [])];
    const params = Object.fromEntries(needles.map((n, i) => [`n${i}`, n]));
    const mods = await this.moduleRepo.createQueryBuilder('m')
      .select(['m.id', 'm.content', 'm.topicId', 'm.parentId', 'm.creatorId'])
      .where(`(${needles.map((_, i) => `m.content LIKE :n${i}`).join(' OR ')})`, params).getMany();
    const drafts = await this.draftRepo.createQueryBuilder('d')
      .select(['d.id', 'd.data', 'd.userId'])
      .where(`(${needles.map((_, i) => `d.data LIKE :n${i}`).join(' OR ')})`, params).getMany();

    const stores = new Map<string, Promise<ImageStore | null>>();
    const store = (userId: string | null | undefined) => {
      if (!userId) return Promise.resolve(null);
      if (!stores.has(userId)) stores.set(userId, this.storeFor(userId).catch(() => null));
      return stores.get(userId)!;
    };
    // Bilder, die noch in der App liegen, ebenfalls in die Ablage bringen.
    if (!mods.length && !drafts.length) {
      await this.offloadAppImages(result, store);
      return result;
    }

    const { topicOf, ownerOfTopic } = await this.topicsOf(mods);
    const linkById = new Map(links.map((l) => [l.id, l]));
    const isHome = (ref: ImageRef, s: ImageStore) => s.kind === 'own'
      ? (ref.kind === 'files' || ref.kind === 'direct') && ref.linkId === s.l.id
      : ref.kind === 'sch' && ref.sncId === s.snc!.id && ref.folder === s.root[1];

    // Liegt ein Bild, das schon in der Ablage sein sollte (eigene Freigabe oder
    // Ordner in der Nextcloud der Schule), auch da?
    // Sonst aus einer früheren Freigabe holen (gleicher Name – der Link bleibt).
    const listed = new Map<string, Promise<Set<string> | null>>();
    const checks = new Map<string, { missing: Map<string, { sub: string; name: string; path: string }>; restored: number }>();
    const checkHome = async (s: ImageStore, ref: ImageRef) => {
      if (!checks.has(s.l.id)) checks.set(s.l.id, { missing: new Map(), restored: 0 });
      const check = checks.get(s.l.id)!;
      const key = `${s.root.join('/')}|${s.snc?.id || s.l.id}|${ref.sub}`;
      if (!listed.has(key)) {
        listed.set(key, s.nc.list([...s.root, ref.sub]).then((es) => new Set(es.map((e) => e.name))).catch(() => null));
      }
      const names = await listed.get(key)!;
      // Freigabe gerade nicht erreichbar: nichts behaupten.
      if (!names || names.has(ref.name)) return;
      const file = await this.fromPrevious(s.kind === 'own' ? s.l : s.snc!, s.root, ref.sub, ref.name);
      if (file) {
        try {
          await s.nc.ensureFolder([...s.root, ref.sub]);
          const type = file.type.split(';')[0].trim();
          await s.nc.put([...s.root, ref.sub, ref.name], file.data, IMAGE_TYPES[type] ? type : 'application/octet-stream');
          names.add(ref.name);
          check.restored++;
          result.restored++;
          return;
        } catch { /* zählt als fehlend */ }
      }
      check.missing.set(`${ref.sub}/${ref.name}`, { sub: ref.sub, name: ref.name, path: [...s.root, ref.sub, ref.name].join('/') });
      result.missing++;
    };

    const done = new Map<string, Promise<string | null>>();
    const move = (owners: Array<string | null | undefined>, ref: ImageRef) => {
      // Alte Links aufs Admin-Backup retten auch Verfasser oder Hochladende, falls
      // die Eigentümerin keine Ablage hat – sonst gehört das Bild zum Thema.
      const chain = ref.kind === 'school' ? [...owners, linkById.get(ref.linkId!)?.userId] : owners.slice(0, 1);
      const key = `${chain.join(',')}|${JSON.stringify(ref)}`;
      if (!done.has(key)) done.set(key, (async () => {
        let s: ImageStore | null = null;
        for (const o of chain) if (!s) s = await store(o);
        if (!s) { result.skipped++; return null; }
        if (isHome(ref, s)) {
          await checkHome(s, ref);
          return null;
        }
        const file = await this.readRef(ref).catch(() => null);
        const placed = await this.placeImage(s.nc, s.root, ref.sub, ref.name, file);
        if (!placed) { result.missing++; return null; }
        result[placed.copied ? 'copied' : 'reused']++;
        return s.url(ref.sub, placed.name);
      })());
      return done.get(key)!;
    };

    // Erst am gelesenen Stand kopieren (das dauert), dann am frischen umhängen –
    // move merkt sich die Ergebnisse, der zweite Durchgang geht schnell.
    for (const m of mods) {
      const owners = [ownerOfTopic.get(topicOf(m) || ''), m.creatorId];
      const swap = (v: any) => this.swapRefs(v, byToken, (ref) => move(owners, ref));
      if (JSON.stringify(await swap(m.content)) === JSON.stringify(m.content)) continue;
      if (await this.rewrite('module', m.id, swap)) result.modules++;
    }
    for (const d of drafts) {
      const swap = (v: any) => this.swapRefs(v, byToken, (ref) => move([d.userId], ref));
      if (JSON.stringify(await swap(d.data)) === JSON.stringify(d.data)) continue;
      if (await this.rewrite('draft', d.id, swap)) result.drafts++;
    }
    // Ergebnis je Freigabe für den Dialog.
    const at = new Date().toISOString();
    for (const [id, c] of checks) {
      const missing = [...c.missing.values()].sort((a, b) => `${a.sub}/${a.name}`.localeCompare(`${b.sub}/${b.name}`, 'de'));
      await this.linkRepo.update({ id }, { imageCheck: { at, count: missing.length, missing: missing.slice(0, 50), restored: c.restored } as any });
    }
    // Hängt nichts mehr an einer Freigabe, fehlt dort auch nichts.
    for (const l of links) {
      if (l.imageCheck?.count && !checks.has(l.id)) await this.linkRepo.update({ id: l.id }, { imageCheck: null as any });
    }
    await this.offloadAppImages(result, store);
    return result;
  }

  /** Thema (auch über das Elternmodul) und dessen Eigentümerin und Titel je Modul. */
  private async topicsOf(mods: LearningModule[]) {
    const parentIds = [...new Set(mods.filter((m) => !m.topicId && m.parentId).map((m) => m.parentId))];
    const parents = parentIds.length ? await this.moduleRepo.find({ where: { id: In(parentIds) }, select: ['id', 'topicId'] }) : [];
    const topicOf = (m: LearningModule) => m.topicId || parents.find((p) => p.id === m.parentId)?.topicId || null;
    const topicIds = [...new Set(mods.map(topicOf).filter(Boolean))] as string[];
    const topics = topicIds.length ? await this.topicRepo.find({ where: { id: In(topicIds) }, select: ['id', 'ownerId', 'title'] }) : [];
    return {
      topicOf,
      ownerOfTopic: new Map(topics.map((t) => [t.id, t.ownerId])),
      titleOfTopic: new Map(topics.map((t) => [t.id, t.title])),
    };
  }

  /** Höchstens so viele Module je Lauf auslagern – der erste Durchgang soll den Server nicht blockieren. */
  static OFFLOAD_PER_RUN = 300;

  /**
   * Bilder, die noch in der App liegen (data:-URLs, auch mitten im HTML eines
   * Arbeitsblatts), in die Ablage der Lehrkraft bringen, der das Thema gehört
   * – auch in gekauften und übernommenen Modulen. Ziel: Bilder/<Thema>/ der
   * Ablage, Dateiname mit Prüfsumme (bild-<…>), gleiche Bilder nur einmal.
   * Ohne Ablage bleibt alles in der App.
   */
  private async offloadAppImages(result: any, store: (userId: string | null | undefined) => Promise<ImageStore | null>) {
    const mods = await this.moduleRepo.createQueryBuilder('m')
      .select(['m.id', 'm.content', 'm.topicId', 'm.parentId'])
      .where('m.content LIKE :d', { d: '%data:image/%' }).getMany();
    if (!mods.length) return;
    const { topicOf, ownerOfTopic, titleOfTopic } = await this.topicsOf(mods);
    const present = new Map<string, Promise<Set<string>>>();
    let n = 0;
    for (const m of mods) {
      if (n >= NextcloudService.OFFLOAD_PER_RUN) break;
      const topicId = topicOf(m);
      const s = await store(ownerOfTopic.get(topicId || ''));
      if (!s) continue;
      const sub = safeFolderName(titleOfTopic.get(topicId || '') || '', 'Ohne Thema');
      const images = new Map<string, { mime: string; b64: string }>();
      mapDataImages(m.content, (d, mime, b64) => { images.set(d, { mime, b64 }); return d; });
      if (!images.size) continue;
      n++;
      const key = `${s.kind}:${s.snc?.id || s.l.id}:${s.root.join('/')}/${sub}`;
      if (!present.has(key)) {
        present.set(key, (async () => {
          await s.nc.ensureFolder([...s.root, sub]);
          return new Set((await s.nc.list([...s.root, sub])).map((e) => e.name));
        })());
      }
      // Jeder Fehler gilt nur für dieses Modul: Eine Ablage, die gerade nicht
      // mitspielt (Ordner anlegen, Liste, Hochladen, Datenbank belegt), darf die
      // Module der anderen Lehrkräfte nicht aufhalten. Beim nächsten Lauf wieder.
      try {
        const names = await present.get(key)!;
        const urls = new Map<string, string>();
        for (const [dataUrl, { mime, b64 }] of images) {
          const buffer = Buffer.from(b64, 'base64');
          const name = `bild-${crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12)}.${IMAGE_TYPES[mime] || 'png'}`;
          if (!names.has(name)) { await s.nc.put([...s.root, sub, name], buffer, mime); names.add(name); result.offloadedBytes += buffer.length; }
          urls.set(dataUrl, s.url(sub, name));
        }
        // Bilder, die inzwischen dazukamen, bleiben bis zum nächsten Lauf in der App.
        if (await this.rewrite('module', m.id, (c) => mapDataImages(c, (d) => urls.get(d) || d))) result.offloaded++;
      } catch (err: any) {
        this.logger.warn(`Bilder auslagern (Modul ${m.id}) fehlgeschlagen: ${err?.message || err}`);
      }
    }
  }

  /**
   * Bild nach <root>/<sub>/ einer Ablage: gleichnamig und gleich → wiederverwenden,
   * gleichnamig und anders → -2, -3 …; ohne Quelle (dort gelöscht) gilt ein
   * gleichnamiges vorhandenes Bild. null, wenn es nichts gibt.
   */
  private async placeImage(nc: ShareClient, root: string[], sub: string, name: string, file: { type: string; data: Buffer } | null) {
    const present = new Set((await nc.list([...root, sub]).catch((): DavEntry[] => [])).map((e) => e.name));
    if (!file) return present.has(name) ? { name, copied: false } : null;
    let target = name;
    for (let n = 2; present.has(target); n++) {
      const mine = await nc.get([...root, sub, target]);
      if (mine && mine.data.equals(file.data)) return { name: target, copied: false };
      if (n > 99) throw new Error(`Zu viele Dateien mit dem Namen ${name}.`);
      target = name.replace(/(\.[^.]+)$/, `-${n}$1`);
    }
    await nc.ensureFolder([...root, sub]);
    const type = file.type.split(';')[0].trim();
    await nc.put([...root, sub, target], file.data, IMAGE_TYPES[type] ? type : 'application/octet-stream');
    return { name: target, copied: true };
  }

  /**
   * Jeden Bild-Link in einem Inhalt (beliebig verschachtelt, auch mitten im
   * HTML) zerlegen und durch fn(ref) ersetzen; null lässt ihn stehen. Erkannt
   * werden …/api/nextcloud/files|school/<Eintrag>/<Ordner>/<Datei>,
   * …/api/nextcloud/sch/<Schule>/<Lehrkraft>/<Ordner>/<Datei> und direkte
   * Links bekannter Lesefreigaben. Namen dürfen ( ) ' enthalten –
   * encodeURIComponent lässt sie stehen; endet einer mitten im HTML darauf,
   * wird das zur Not abgeschnitten.
   */
  private async swapRefs(value: any, byToken: Map<string, NextcloudLink>, fn: (ref: ImageRef) => Promise<string | null>): Promise<any> {
    if (typeof value === 'string') {
      let out = value;
      const dec = (x: string) => { try { return decodeURIComponent(x); } catch { return null; } };
      const seg = '([^/?#"\\s<>]+)';
      if (out.includes('/api/nextcloud/')) {
        const re = new RegExp(`(?:https?://[^\\s"'<>]*?)?/api/nextcloud/(?:(files|school)/([0-9a-f-]{36})|sch/([0-9a-f-]{36})/${seg})/${seg}/${seg}`, 'gi');
        out = await replaceAsync(out, re, async (m: string, kind: string, linkId: string, sncId: string, folder: string, sub: string, rawName: string) => {
          let name = rawName;
          let tail = '';
          for (;;) {
            const d = { sub: dec(sub), name: dec(name), folder: folder ? dec(folder) : undefined };
            if (d.sub && d.name && IMAGE_EXT.test(d.name) && (!folder || d.folder)) {
              const ref: ImageRef = sncId
                ? { kind: 'sch', sncId: sncId.toLowerCase(), folder: d.folder!, sub: d.sub, name: d.name }
                : { kind: kind.toLowerCase() as 'files' | 'school', linkId: linkId.toLowerCase(), sub: d.sub, name: d.name };
              const url = await fn(ref);
              return url ? url + tail : m;
            }
            if (!/['")]$/.test(name)) return m;
            tail = name.slice(-1) + tail;
            name = name.slice(0, -1);
          }
        });
      }
      if (byToken.size && out.includes('/download?path=')) {
        const re = /https?:\/\/[^\s"'<>]+?\/s\/([A-Za-z0-9]+)\/download\?path=([^&"'\s<>#]*)&(?:amp;)?files=([^&"'\s<>#]+)/g;
        out = await replaceAsync(out, re, async (m: string, token: string, path: string, file: string) => {
          const l = byToken.get(token);
          const sub = dec(path)?.replace(/^\/+|\/+$/g, '');
          const name = dec(file);
          if (!l || !sub || !name) return m;
          return (await fn({ kind: 'direct', linkId: l.id, sub, name })) || m;
        });
      }
      return out;
    }
    if (Array.isArray(value)) return Promise.all(value.map((v) => this.swapRefs(v, byToken, fn)));
    if (value && typeof value === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(value)) out[k] = await this.swapRefs(v, byToken, fn);
      return out;
    }
    return value;
  }

  // ---- Nur Freigaben mit Passwort ----

  /**
   * Lesefreigaben (ohne Passwort, Schüler luden direkt aus der Nextcloud) gibt
   * es nicht mehr: Ihre Links laufen ab jetzt über diesen Server, das Kürzel
   * wird vergessen. Im Dialog steht danach, dass sie gelöscht werden kann.
   */
  async dropReadShares() {
    let n = 0;
    for (const l of await this.linkRepo.find()) {
      if (!l.imageShareToken) continue;
      const token = l.imageShareToken;
      Object.assign(l, { imageShareToken: null, readShareLostAt: new Date() });
      await this.linkRepo.update({ id: l.id }, { imageShareToken: null, readShareLostAt: l.readShareLostAt });
      if (l.baseUrl) n += await this.relinkReadShare(l, l.baseUrl, token);
    }
    if (n) this.logger.log(`Lesefreigaben entfallen: ${n} Module/Entwürfe laufen jetzt über den Server`);
    return n;
  }

  /** Verbundene Freigaben (Lehrkräfte und Schulen), die sich ohne Passwort öffnen lassen, markieren. */
  async checkProtection() {
    for (const l of await this.linkRepo.find()) {
      if (!l.shareToken || !l.verifiedAt || !l.baseUrl) continue;
      const open = await shareIsOpen(l.baseUrl, l.shareToken);
      if (open !== !!l.insecureAt) await this.linkRepo.update({ id: l.id }, { insecureAt: open ? new Date() : null });
    }
    for (const r of await this.schoolNcRepo.find()) {
      if (!r.shareToken || !r.verifiedAt || !r.baseUrl) continue;
      const open = await shareIsOpen(r.baseUrl, r.shareToken);
      if (open !== !!r.insecureAt) await this.schoolNcRepo.update({ id: r.id }, { insecureAt: open ? new Date() : null });
    }
  }

  /**
   * Direkte Links einer (alten) Lesefreigabe – …/s/<Kürzel>/download?path=/<Ordner>&files=<Datei>,
   * im HTML auch mit &amp; – auf den Weg über diesen Server umhängen. Liefert
   * die Zahl geänderter Module und Entwürfe. Die Dateien liegen ja weiter in
   * Bilder/ der Freigabe.
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
    for (const m of mods) if (await this.rewrite('module', m.id, swap)) n++;
    const drafts = await this.draftRepo.createQueryBuilder('d').select(['d.id', 'd.data']).where('d.data LIKE :n', { n: needle }).getMany();
    for (const d of drafts) if (await this.rewrite('draft', d.id, swap)) n++;
    return n;
  }

  // ---- Trennen: Überblick und Bilder zurückholen ----

  /** Suchmuster für Links auf diese Freigabe: über den Server und direkt (Lesefreigabe). */
  private ownNeedles(l: NextcloudLink) {
    const out = [`%/api/nextcloud/files/${l.id}/%`];
    if (l.imageShareToken) out.push(`%/s/${l.imageShareToken}/download%`);
    return out;
  }

  /** Module und Entwürfe mit Links auf diese Freigabe. */
  private async referencing(l: NextcloudLink) {
    const needles = this.ownNeedles(l);
    const where = needles.map((_, i) => `m.content LIKE :n${i}`).join(' OR ');
    const params = Object.fromEntries(needles.map((n, i) => [`n${i}`, n]));
    const mods = await this.moduleRepo.createQueryBuilder('m')
      .select(['m.id', 'm.content', 'm.topicId', 'm.parentId']).where(`(${where})`, params).getMany();
    const dwhere = needles.map((_, i) => `d.data LIKE :n${i}`).join(' OR ');
    const drafts = await this.draftRepo.createQueryBuilder('d')
      .select(['d.id', 'd.data', 'd.userId']).where(`(${dwhere})`, params).getMany();
    return { mods, drafts };
  }

  private async countReferences(l: NextcloudLink) {
    const { mods, drafts } = await this.referencing(l);
    return mods.length + drafts.length;
  }

  /**
   * Jeden Link auf diese Freigabe in einem Inhalt durch fn(sub, name) ersetzen
   * (null lässt ihn stehen): …/api/nextcloud/files/<Eintrag>/<Ordner>/<Datei>
   * und, bei Lesefreigabe, …/s/<Kürzel>/download?path=/<Ordner>&files=<Datei>.
   */
  private swapOwnUrls(value: any, l: NextcloudLink, fn: (sub: string, name: string) => string | null): any {
    if (typeof value === 'string') {
      let out = value;
      if (out.includes(`/api/nextcloud/files/${l.id}/`)) {
        const re = new RegExp(`(?:https?://[^\\s"'<>]*?)?/api/nextcloud/files/${l.id}/([^/?#"\\s<>]+)/([^/?#"\\s<>]+)`, 'gi');
        out = out.replace(re, (m, sub: string, name: string) => {
          // Endet der Name mitten im HTML auf ' oder ), das zur Not abschneiden.
          for (let tail = ''; name; tail = name.slice(-1) + tail, name = name.slice(0, -1)) {
            try {
              const file = decodeURIComponent(name);
              if (IMAGE_EXT.test(file)) { const url = fn(decodeURIComponent(sub), file); return url ? url + tail : m; }
            } catch { return m; }
            if (!/['")]$/.test(name)) break;
          }
          return m;
        });
      }
      if (l.imageShareToken && out.includes(`/s/${l.imageShareToken}/download`)) {
        const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`${esc(l.baseUrl)}/s/${esc(l.imageShareToken)}/download\\?path=([^&"'\\s<>#]*)&(?:amp;)?files=([^&"'\\s<>#]+)`, 'g');
        out = out.replace(re, (m, path: string, file: string) => {
          try { return fn(decodeURIComponent(path).replace(/^\/+|\/+$/g, ''), decodeURIComponent(file)) || m; } catch { return m; }
        });
      }
      return out;
    }
    if (Array.isArray(value)) return value.map((v) => this.swapOwnUrls(v, l, fn));
    if (value && typeof value === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.swapOwnUrls(v, l, fn);
      return out;
    }
    return value;
  }

  /**
   * Was an der Freigabe hängt – für „Freigabe trennen“: Bilder (mit Größe und
   * einem Abruf-Link über diesen Server), Themen, Entwürfe, dazu Stand und
   * Grenze der Bilder in der App. `fits`: passt alles zurück in die App?
   */
  async usage(user: any) {
    const l = await this.find(user.userId);
    if (!l?.shareToken || !l.verifiedAt) return { count: 0, bytes: 0, images: [], topics: [], drafts: 0, fits: true };
    const nc = await this.client(l);
    const { mods, drafts } = await this.referencing(l);
    const images = new Map<string, { sub: string; name: string; size: number; missing: boolean; fetchUrl: string }>();
    const collect = (v: any) => this.swapOwnUrls(v, l, (sub, name) => {
      if (safePart(sub) && safePart(name)) {
        images.set(`${sub}/${name}`, { sub, name, size: 0, missing: true, fetchUrl: `/api/nextcloud/files/${l.id}/${encodeURIComponent(sub)}/${encodeURIComponent(name)}` });
      }
      return null;
    });
    mods.forEach((m) => collect(m.content));
    drafts.forEach((d) => collect(d.data));
    for (const sub of new Set([...images.values()].map((i) => i.sub))) {
      const entries = await nc.list([IMAGES, sub]).catch((): DavEntry[] => []);
      for (const e of entries) {
        const img = images.get(`${sub}/${e.name}`);
        if (img) Object.assign(img, { size: e.size, missing: false });
      }
    }
    // Themen – auch über Untermodule; „mine“: gehört der Lehrkraft selbst.
    const parentIds = [...new Set(mods.filter((m) => !m.topicId && m.parentId).map((m) => m.parentId))];
    const parents = parentIds.length ? await this.moduleRepo.find({ where: { id: In(parentIds) }, select: ['id', 'topicId'] }) : [];
    const topicIds = [...new Set(mods.map((m) => m.topicId || parents.find((p) => p.id === m.parentId)?.topicId).filter(Boolean))] as string[];
    const topics = topicIds.length ? await this.topicRepo.find({ where: { id: In(topicIds) }, select: ['id', 'title', 'ownerId'] }) : [];
    const list = [...images.values()];
    const bytes = list.reduce((a, i) => a + i.size, 0);
    const q = await this.quotaSettings();
    const used = sum(await this.appImages(user.userId));
    const shared = await this.schoolShareOf(user.userId);
    return {
      count: list.length, bytes, missing: list.filter((i) => i.missing).length, images: list,
      topics: topics.map((t) => ({ id: t.id, title: t.title, mine: t.ownerId === user.userId })).sort((a, b) => a.title.localeCompare(b.title, 'de')),
      drafts: drafts.length,
      appUsedBytes: used, limitBytes: q.limitMb * MB,
      // Obergrenze: ungekürzt. Der Browser verkleinert beim Zurückholen, das wird meist deutlich weniger.
      fits: !q.limitMb || used + bytes <= q.limitMb * MB,
      // Hat die Schule (oder der Server) eine Nextcloud? Dann können die Bilder dorthin.
      school: !!shared,
      schoolServer: shared?.snc.schoolId === SERVER_SCOPE,
    };
  }

  /**
   * Eigene Freigabe trennen und die Bilder dabei in die Nextcloud der Schule
   * (ohne sie: des Servers) übernehmen – etwa vor der Pensionierung: jedes
   * Bild, das in einem Modul oder Entwurf steckt, nach Bilder/<Lehrkraft>/<Thema>/
   * kopieren, die Links umhängen, dann trennen.
   * Fehlt ein Bild, bleibt sein Link (und fehlt nach dem Trennen).
   */
  async handOverToSchool(user: any) {
    const l = await this.find(user.userId);
    if (!l?.shareToken || !l.verifiedAt) throw new BadRequestException('Keine eigene Freigabe verbunden.');
    const target = await this.storeFor(user.userId, { skipOwn: true });
    if (!target) throw new BadRequestException('Weder deine Schule noch der Server haben eine Nextcloud eingerichtet.');
    const nc = await this.client(l);
    const { mods, drafts } = await this.referencing(l);
    const wanted = new Map<string, { sub: string; name: string }>();
    const collect = (v: any) => this.swapOwnUrls(v, l, (sub, name) => { wanted.set(`${sub}/${name}`, { sub, name }); return null; });
    mods.forEach((m) => collect(m.content));
    drafts.forEach((d) => collect(d.data));
    const map = new Map<string, string>();
    let missing = 0;
    for (const [key, { sub, name }] of wanted) {
      if (!safePart(sub) || !safePart(name)) { missing++; continue; }
      const file = await nc.get([IMAGES, sub, name]).catch(() => null);
      const placed = await this.placeImage(target.nc, target.root, sub, name, file);
      if (placed) map.set(key, target.url(sub, placed.name)); else missing++;
    }
    const swap = (v: any) => this.swapOwnUrls(v, l, (sub, name) => map.get(`${sub}/${name}`) || null);
    let modules = 0;
    let dr = 0;
    for (const m of mods) if (await this.rewrite('module', m.id, swap)) modules++;
    for (const d of drafts) if (await this.rewrite('draft', d.id, swap)) dr++;
    await this.disconnect(user, true);
    return { success: true, images: map.size, missing, modules, drafts: dr };
  }

  /**
   * Bilder zurück in die App: `items` = [{ sub, name, dataUrl }] (im Browser
   * verkleinert). Ersetzt die Links in allen Modulen und Entwürfen. Strikt:
   * Liegt die Lehrkraft damit über der Grenze, wird nichts geändert.
   */
  async returnImages(user: any, items: Array<{ sub: string; name: string; dataUrl: string }>) {
    const l = await this.find(user.userId);
    if (!l?.shareToken || !l.verifiedAt) throw new BadRequestException('Keine Freigabe verbunden.');
    const map = new Map<string, string>();
    for (const it of Array.isArray(items) ? items : []) {
      const d = String(it?.dataUrl || '');
      if (!/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(d)) throw new BadRequestException(`Kein gültiges Bild: ${it?.name}`);
      map.set(`${it.sub}/${it.name}`, d);
    }
    if (!map.size) return { modules: 0, drafts: 0, images: 0 };
    const { limitMb } = await this.quotaSettings();
    if (limitMb) {
      const usage = await this.appImages(user.userId);
      for (const [k, v] of dataImageSizes([[...map.values()]])) usage.set(k, v);
      if (sum(usage) > limitMb * MB) {
        throw new BadRequestException(`Zusammen mit diesen Bildern lägen deine Bilder in der App über der Grenze von ${limitMb} MB – zurückholen geht nicht. Bitte stattdessen umziehen.`);
      }
    }
    const { mods, drafts } = await this.referencing(l);
    const swap = (v: any) => this.swapOwnUrls(v, l, (sub, name) => map.get(`${sub}/${name}`) || null);
    let modules = 0;
    let dr = 0;
    for (const m of mods) if (await this.rewrite('module', m.id, swap)) modules++;
    for (const d of drafts) if (await this.rewrite('draft', d.id, swap)) dr++;
    return { modules, drafts: dr, images: map.size };
  }

  // ---- Umziehen in eine andere Freigabe ----

  /** Laufende Umzüge je Lehrkraft (Fortschritt für den Dialog). */
  private readonly moves = new Map<string, { running: boolean; copied: number; total: number; from: string; error?: string }>();

  /**
   * In eine andere Freigabe umziehen: Die neue wird gleich geprüft (Passwort,
   * Schreibprobe); dann kopiert die App im Hintergrund den Ordner Bilder
   * hinüber und schaltet erst danach um. Die Links in den Modulen bleiben
   * gleich – sie zeigen ab dann auf die neue Freigabe. Direkte Links einer
   * Lesefreigabe laufen danach über den Server (die gehört zur alten).
   * Die alte Freigabe bleibt unangetastet.
   */
  async startMove(user: any, input: any, appBase: string) {
    const l = await this.find(user.userId);
    if (!l?.shareToken || !l.verifiedAt) throw new BadRequestException('Erst eine Freigabe verbinden – umziehen geht nur von einer verbundenen aus.');
    if (this.moves.get(l.userId)?.running) throw new BadRequestException('Der Umzug läuft schon.');
    const share = parseNextcloudShare(input?.shareUrl);
    const base = parseNextcloudBase(share.base);
    if (!base) throw new BadRequestException('Der Freigabelink muss mit https:// beginnen.');
    if (base === l.baseUrl && share.token === l.shareToken) throw new BadRequestException('Das ist die bisherige Freigabe.');
    const password = String(input?.password || '');
    if (!password) throw new BadRequestException('Bitte das Passwort der neuen Freigabe angeben – Freigaben ohne Passwort nimmt die App nicht an.');
    await assertPublicHost(base);
    if (await shareIsOpen(base, share.token)) throw new BadRequestException(OPEN_SHARE_MESSAGE);
    const target = new ShareClient(base, share.token, password, 'classic');
    const mode = await target.detectMode();
    await target.ensureFolder([IMAGES]);
    await target.put([IMAGES, CHECK_FILE], Buffer.from('LearningModules-Umzug', 'utf-8'), 'text/plain');
    await target.remove([IMAGES, CHECK_FILE]);
    await this.assertSeparate({ kind: 'own', id: l.id }, base, share.token, target);

    const job = { running: true, copied: 0, total: 0, from: this.shareLink(l) };
    this.moves.set(l.userId, job);
    void (async () => {
      try {
        const old = await this.client(l);
        const folders = (await old.list([IMAGES])).filter((e) => e.isFolder && safePart(e.name));
        const files: Array<[string, string]> = [];
        for (const f of folders) {
          for (const e of await old.list([IMAGES, f.name])) if (!e.isFolder && safePart(e.name)) files.push([f.name, e.name]);
        }
        job.total = files.length;
        const made = new Set<string>();
        for (const [sub, name] of files) {
          const file = await old.get([IMAGES, sub, name]);
          if (file) {
            if (!made.has(sub)) { await target.ensureFolder([IMAGES, sub]); made.add(sub); }
            const type = file.type.split(';')[0].trim();
            await target.put([IMAGES, sub, name], file.data, type || 'application/octet-stream');
          }
          job.copied++;
        }
        const fresh = (await this.find(l.userId))!;
        const oldRead = fresh.imageShareToken ? { base: fresh.baseUrl, token: fresh.imageShareToken } : null;
        await this.rememberShare(fresh);
        Object.assign(fresh, {
          baseUrl: base, shareToken: share.token, passwordSealed: password ? this.masterKey.sealSecret(password) : null,
          davMode: mode, verifiedAt: new Date(), imageShareToken: null, insecureAt: null, appBase,
          moveResult: { at: new Date().toISOString(), from: job.from, copied: job.copied },
        });
        await this.linkRepo.save(fresh);
        await this.claimShare({ kind: 'own', id: fresh.id }, target).catch(() => undefined);
        if (oldRead) await this.relinkReadShare(fresh, oldRead.base, oldRead.token);
      } catch (err: any) {
        const moveResult: any = { at: new Date().toISOString(), from: job.from, copied: job.copied, error: String(err?.message || err) };
        await this.linkRepo.update({ id: l.id }, { moveResult });
      } finally {
        this.moves.delete(l.userId);
      }
    })();
    return { success: true, message: 'Neue Freigabe geprüft – die Bilder werden jetzt hinüberkopiert. Erst danach schaltet die App um.' };
  }

  /** Für Tests: auf einen laufenden Umzug warten. */
  async waitForMove(userId: string) {
    while (this.moves.get(userId)?.running) await new Promise((r) => setTimeout(r, 5));
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
    const { nc, root, url } = await this.effective(user.userId);
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
    return { success: true, url: url(sub, name), name, folder: sub };
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
    const { nc, root, url } = await this.effective(user.userId);
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
      urls.set(dataUrl, url(sub, name));
    }
    let changed = 0;
    for (const m of entry.modules) {
      if (await this.rewrite('module', m.id, (c) => mapDataImages(c, (d) => urls.get(d) || d))) changed++;
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
    const { nc, root, url } = eff;
    const byFolder = new Map<string, string[]>();
    for (const r of refs) {
      const m = NC_REF.exec(r);
      if (m) byFolder.set(m[1], [...(byFolder.get(m[1]) || []), r]);
    }
    for (const [folder, list] of byFolder) {
      const names = new Set((await nc.list([...root, folder]).catch((): DavEntry[] => [])).filter((e) => !e.isFolder).map((e) => e.name));
      for (const r of list) {
        const name = NC_REF.exec(r)![2];
        if (names.has(name)) out.set(r, url(folder, name));
      }
    }
    return out;
  }

  /**
   * Bilder eines Ordners für die Auswahl im Editor, dazu alle Ordner unter
   * Bilder. Ohne `folder` der Ordner des Themas.
   */
  async listImages(user: any, opts: { folder?: string; topicId?: string }) {
    const { nc, root, url } = await this.effective(user.userId);
    const entries = await nc.list(root);
    const folders = entries.filter((e) => e.isFolder).map((e) => e.name).sort((a, b) => a.localeCompare(b, 'de'));
    const current = opts.folder ? safeFolderName(opts.folder) : await this.topicFolder(opts.topicId);
    const files = folders.includes(current) ? await nc.list([...root, current]) : [];
    const images = files
      .filter((e) => !e.isFolder && (IMAGE_TYPES[e.contentType] || IMAGE_EXT.test(e.name)))
      .sort((a, b) => String(b.modified).localeCompare(String(a.modified)) || a.name.localeCompare(b.name, 'de'))
      .map((e) => ({ name: e.name, size: e.size, url: url(current, e.name), previewUrl: url(current, e.name) }));
    return { folders, current, images };
  }
}
