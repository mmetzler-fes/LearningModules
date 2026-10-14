import {
  Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Like, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { SystemConfig } from '../core/entities/system-config.entity';
import { FederationPeer } from '../core/entities/federation-peer.entity';
import { RemoteOffer } from '../core/entities/remote-offer.entity';
import { RemotePerson } from '../core/entities/remote-person.entity';
import { FederationCopy } from '../core/entities/federation-copy.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { User } from '../core/entities/user.entity';
import { MasterKeyService } from '../core/crypto/master-key.service';
import { ShopService } from '../shop/shop.service';
import { CategoriesService } from '../categories/categories.service';
import {
  canonical, cleanPath, fingerprint, freshDate, mapCategories, networkMembers, newKeyPair, normalizeUrl, pseudonym, remoteRef, shortestRoutes, sign, verify,
  HEADER_DATE, HEADER_SERVER, HEADER_SIGNATURE, LICENSES, MAX_PATH, MAX_REMOTE_OFFERS, NetworkServer, PathEntry,
} from './federation-rules';

const IDENTITY_KEY = 'federation_identity';
const APP = 'LearningModules';
const PROTOCOL = 1;
const TIMEOUT_MS = 20000;
const SYNC_EVERY_MS = 60 * 60 * 1000;
const MAX_TOPICS_PER_COPY = 200;
const MAX_MODULES_PER_COPY = 5000;

interface Identity {
  serverId: string;
  name: string;
  url: string;
  publicKey: string;
  privateKey: string;
  /** Erklärung des Admins: Der Server steht in einem Rechenzentrum in der EU. */
  eu: boolean;
  /** Teilnahme am Vertrauensnetzwerk – nur mit `eu`. */
  network: boolean;
  /** Seit wann, mit der vom Admin bestätigten Erlaubnis der Schulleitung. */
  networkSince: string | null;
}

/** Höchstens so viele Server im Vertrauensnetzwerk merkt sich ein Abgleich. */
const MAX_NETWORK_SERVERS = 500;

/**
 * Vernetzung mehrerer LearningModules-Server (docs/vernetzung.md).
 *
 * Jeder Server hat eine Kennung und ein Ed25519-Schlüsselpaar. Zwei Server
 * verbinden sich, indem der Admin des einen die Adresse des anderen einträgt
 * und der Admin des anderen annimmt. Danach ist jeder Aufruf zwischen ihnen
 * signiert. Ausgetauscht werden Kataloge und, bei einem Copy, die eigenen
 * Module des Anbieters – nie Schülerdaten, nie fremde Module.
 *
 * Vertrauensnetzwerk: Nehmen zwei verbundene Server teil, reicht jeder auch
 * die Angebote weiter, die er von anderen Teilnehmern bekommen hat – sofern
 * die Lehrkraft dort eingewilligt hat. Ein Copy läuft dann über dieselben
 * Stationen zurück; der Ursprung erfährt statt des Namens nur „Lehrkraft @
 * Server“ mit einer Pseudonym-Kennung.
 */
@Injectable()
export class FederationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FederationService.name);
  private timer: NodeJS.Timeout | null = null;
  private cached: Identity | null = null;

  constructor(
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(FederationPeer) private readonly peerRepo: Repository<FederationPeer>,
    @InjectRepository(RemoteOffer) private readonly remoteRepo: Repository<RemoteOffer>,
    @InjectRepository(RemotePerson) private readonly personRepo: Repository<RemotePerson>,
    @InjectRepository(FederationCopy) private readonly copyRepo: Repository<FederationCopy>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly masterKey: MasterKeyService,
    private readonly shop: ShopService,
    private readonly categories: CategoriesService,
    private readonly dataSource: DataSource,
  ) {}

  private get allowHttp() {
    return process.env.FEDERATION_ALLOW_HTTP === '1';
  }

  // ---- Zeitplan ----

  onApplicationBootstrap() {
    this.timer = setInterval(() => this.syncAll().catch(() => undefined), SYNC_EVERY_MS);
    this.timer.unref?.();
    // Gleich nach dem Start einmal abgleichen, ohne den Start aufzuhalten.
    setTimeout(() => this.syncAll().catch(() => undefined), 5000).unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---- Eigene Identität ----

  /**
   * Kennung und Schlüssel dieses Servers; beim ersten Aufruf erzeugt. Der
   * private Schlüssel liegt mit dem App-Secret verschlüsselt in der
   * Datenbank. Lässt er sich nicht entschlüsseln – etwa, weil ein Backup auf
   * einem anderen Server eingespielt wurde –, entsteht eine neue Identität.
   * So gibt es nie zwei Server mit derselben.
   */
  async identity(): Promise<Identity> {
    if (this.cached) return this.cached;
    const row = await this.configRepo.findOne({ where: { key: IDENTITY_KEY } });
    const v = row?.value;
    if (v?.serverId && v?.privateKeySealed) {
      try {
        this.cached = {
          serverId: v.serverId, name: v.name || APP, url: v.url || this.defaultUrl(), publicKey: v.publicKey, privateKey: this.masterKey.unsealSecret(v.privateKeySealed),
          eu: !!v.eu, network: !!v.network && !!v.eu, networkSince: v.networkSince || null,
        };
        return this.cached;
      } catch {
        this.logger.warn('Schlüssel der Vernetzung lässt sich nicht lesen (anderes App-Secret?) – dieser Server bekommt eine neue Kennung.');
        await this.peerRepo.update({}, { status: 'ended' });
      }
    }
    const keys = newKeyPair();
    const fresh: Identity = {
      serverId: crypto.randomUUID(),
      name: v?.name || APP,
      url: v?.url || this.defaultUrl(),
      ...keys,
      eu: !!v?.eu,
      // Eine neue Kennung ist im Netz unbekannt – die Teilnahme wird neu eingeschaltet.
      network: false,
      networkSince: null,
    };
    await this.saveIdentity(fresh);
    return fresh;
  }

  /** Vorgabe für die öffentliche Adresse: APP_URL, wie sie auch in Mails steht. */
  private defaultUrl(): string {
    return normalizeUrl(process.env.APP_URL, this.allowHttp) || '';
  }

  private async saveIdentity(id: Identity) {
    await this.configRepo.save(this.configRepo.create({
      key: IDENTITY_KEY,
      value: {
        serverId: id.serverId, name: id.name, url: id.url, publicKey: id.publicKey, privateKeySealed: this.masterKey.sealSecret(id.privateKey),
        eu: id.eu, network: id.network, networkSince: id.networkSince,
      },
    }));
    this.cached = id;
  }

  /** Öffentlich: wer dieser Server ist. */
  async info() {
    const me = await this.identity();
    return { app: APP, protocol: PROTOCOL, serverId: me.serverId, name: me.name, url: me.url, publicKey: me.publicKey };
  }

  // ---- Admin ----

  private requireAdmin(user: any) {
    if (user?.role !== 'admin') throw new ForbiddenException('Nur für Admins.');
  }

  async overview(user: any) {
    this.requireAdmin(user);
    const me = await this.identity();
    const peers = await this.peerRepo.find({ order: { name: 'ASC' } });
    return {
      serverId: me.serverId,
      name: me.name,
      url: me.url,
      fingerprint: fingerprint(me.publicKey),
      allowHttp: this.allowHttp,
      eu: me.eu,
      network: me.network,
      networkSince: me.networkSince,
      networkServers: me.network ? this.members(peers, me) : [],
      peers: peers.map((p) => ({
        id: p.id, url: p.url, name: p.name, status: p.status, fingerprint: fingerprint(p.publicKey),
        lastSyncAt: p.lastSyncAt, lastError: p.lastError, offerCount: p.offerCount, since: p.createdAt, network: p.network,
      })),
    };
  }

  /** Bekannte Server im Vertrauensnetzwerk – über die verbundenen Teilnehmer, ohne `except`. */
  private members(peers: FederationPeer[], me: Identity, except?: string): NetworkServer[] {
    const direct = peers.filter((p) => p.status === 'active' && p.network && p.id !== except);
    return networkMembers(direct.map((p) => ({ id: p.id, name: p.name, servers: p.networkServers })), me.serverId);
  }

  /**
   * `{ name?, url?, eu?, network?, permission? }` – Anzeigename und
   * öffentliche Adresse dieses Servers; Standort in der EU und Teilnahme am
   * Vertrauensnetzwerk. Einschalten geht nur mit EU-Standort und der
   * Bestätigung, dass die Schulleitung es erlaubt hat.
   */
  async saveSettings(user: any, body: any) {
    this.requireAdmin(user);
    const me = await this.identity();
    const next = { ...me };
    if (body?.name !== undefined) {
      const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!name) throw new BadRequestException('Bitte einen Namen, z. B. den der Schule.');
      next.name = name;
    }
    if (body?.url !== undefined) {
      const url = normalizeUrl(body.url, this.allowHttp);
      if (!url) throw new BadRequestException('Bitte die öffentliche Adresse dieses Servers, z. B. https://lm.schule.de');
      next.url = url;
    }
    if (body?.eu !== undefined) next.eu = !!body.eu;
    if (body?.network !== undefined) next.network = !!body.network;
    if (next.network && !me.network) {
      if (!next.eu) throw new BadRequestException('Am Vertrauensnetzwerk nehmen nur Server teil, die in der EU stehen.');
      if (!next.url) throw new BadRequestException('Bitte zuerst die öffentliche Adresse dieses Servers eintragen.');
      if (body?.permission !== true) throw new BadRequestException('Bitte bestätigen, dass die Schulleitung die Teilnahme am Vertrauensnetzwerk erlaubt hat.');
      next.networkSince = new Date().toISOString();
    }
    if (!next.eu) next.network = false;
    if (!next.network) next.networkSince = null;
    await this.saveIdentity(next);
    // Ausgestiegen: weitergereichte Angebote verschwinden sofort aus dem Shop.
    if (me.network && !next.network) await this.dropRelayed();
    // Die Verbundenen erfahren es beim nächsten Abgleich; wir holen ihre Kataloge gleich neu.
    if (me.network !== next.network) this.syncAll().catch(() => undefined);
    return this.overview(user);
  }

  /** Anfrage an einen anderen Server: `{ url }`. */
  async requestPeer(user: any, body: any) {
    this.requireAdmin(user);
    const me = await this.identity();
    if (!me.url) throw new BadRequestException('Bitte zuerst oben die öffentliche Adresse dieses Servers eintragen – der andere Server muss sie erreichen.');
    const url = normalizeUrl(body?.url, this.allowHttp);
    if (!url) throw new BadRequestException('Bitte eine Adresse mit https://, z. B. https://lm.andere-schule.de');
    if (url === me.url) throw new BadRequestException('Das ist die Adresse dieses Servers.');
    const info = await this.fetchInfo(url);
    if (info.serverId === me.serverId) throw new BadRequestException('Das ist dieser Server.');

    let peer = await this.peerRepo.findOne({ where: { id: info.serverId } });
    if (peer?.status === 'active' && peer.publicKey === info.publicKey) return { success: true, status: 'active', peer: peer.name };
    peer = this.peerRepo.create({ ...(peer || {}), id: info.serverId, url, name: info.name || url, publicKey: info.publicKey, status: 'outgoing', lastError: null });
    await this.peerRepo.save(peer);
    const res = await this.call(peer, 'POST', '/api/federation/hello', { serverId: me.serverId, name: me.name, url: me.url, publicKey: me.publicKey }, true);
    // Hatte der andere uns schon angefragt, sind beide jetzt verbunden.
    if (res?.status === 'active') {
      peer.status = 'active';
      await this.peerRepo.save(peer);
      this.sync(peer).catch(() => undefined);
    }
    return { success: true, status: peer.status, peer: peer.name };
  }

  async accept(user: any, peerId: string) {
    this.requireAdmin(user);
    const peer = await this.getPeer(peerId);
    if (peer.status !== 'incoming') throw new BadRequestException('Es liegt keine Anfrage dieses Servers vor.');
    await this.call(peer, 'POST', '/api/federation/accept', {});
    peer.status = 'active';
    peer.lastError = null;
    await this.peerRepo.save(peer);
    this.sync(peer).catch(() => undefined);
    return { success: true };
  }

  /** Ablehnen, Anfrage zurückziehen oder Verbindung trennen – der andere erfährt es, wenn er erreichbar ist. */
  async end(user: any, peerId: string) {
    this.requireAdmin(user);
    const peer = await this.getPeer(peerId);
    if (peer.status !== 'ended') await this.call(peer, 'POST', '/api/federation/goodbye', {}).catch(() => undefined);
    await this.endPeer(peer);
    return { success: true };
  }

  async syncNow(user: any, peerId: string) {
    this.requireAdmin(user);
    const peer = await this.getPeer(peerId);
    if (peer.status !== 'active') throw new BadRequestException('Der Server ist nicht verbunden.');
    await this.sync(peer);
    return { success: true, offerCount: peer.offerCount, lastError: peer.lastError };
  }

  private async getPeer(id: string) {
    const peer = await this.peerRepo.findOne({ where: { id } });
    if (!peer) throw new NotFoundException('Server nicht gefunden.');
    return peer;
  }

  private async endPeer(peer: FederationPeer) {
    peer.status = 'ended';
    await this.peerRepo.save(peer);
    await this.remoteRepo.delete({ peerId: peer.id });
  }

  /** Angebote, die über andere Server weitergereicht wurden, entfernen. */
  private async dropRelayed() {
    const relayed = (await this.remoteRepo.find()).filter((r) => Array.isArray(r.data?.path) && r.data.path.length > 1);
    if (relayed.length) await this.remoteRepo.delete({ id: In(relayed.map((r) => r.id)) });
  }

  // ---- Aufrufe an andere Server ----

  private async fetchInfo(url: string) {
    let res: Response;
    try {
      res = await fetch(`${url}/api/federation/info`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new BadRequestException(`${url} ist nicht erreichbar (${(err as Error).message}).`);
    }
    const info: any = await res.json().catch(() => null);
    if (!res.ok || info?.app !== APP || !info?.serverId || !info?.publicKey) {
      throw new BadRequestException(`Unter ${url} antwortet kein LearningModules-Server mit Vernetzung.`);
    }
    return info as { serverId: string; name: string; url: string; publicKey: string };
  }

  /** Signierter Aufruf; liefert die Antwort als JSON oder wirft mit der Meldung des anderen. */
  async call(peer: FederationPeer, method: string, path: string, body?: any, allowNotActive = false): Promise<any> {
    if (!allowNotActive && peer.status === 'ended') throw new BadRequestException('Der Server ist nicht verbunden.');
    const me = await this.identity();
    const raw = body === undefined ? '' : JSON.stringify(body);
    const date = new Date().toISOString();
    let res: Response;
    try {
      res = await fetch(peer.url + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          [HEADER_SERVER]: me.serverId,
          [HEADER_DATE]: date,
          [HEADER_SIGNATURE]: sign(me.privateKey, canonical(method, path, date, raw)),
        },
        body: method === 'GET' ? undefined : raw,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new BadRequestException(`${peer.name} ist nicht erreichbar (${(err as Error).message}).`);
    }
    const data: any = await res.json().catch(() => null);
    if (!res.ok) throw new BadRequestException(`${peer.name}: ${data?.message || `Fehler ${res.status}`}`);
    return data;
  }

  // ---- Aufrufe von anderen Servern ----

  /**
   * Prüft einen signierten Aufruf: bekannter Server im erlaubten Status,
   * frischer Zeitpunkt, Signatur über Methode, Pfad, Zeit und Inhalt.
   */
  async verifyRequest(req: any, statuses: string[] = ['active']): Promise<FederationPeer> {
    const serverId = String(req.headers[HEADER_SERVER] || '');
    const date = String(req.headers[HEADER_DATE] || '');
    const signature = String(req.headers[HEADER_SIGNATURE] || '');
    if (!serverId || !date || !signature) throw new UnauthorizedException('Nicht signiert.');
    if (!freshDate(date)) throw new UnauthorizedException('Zeitstempel zu alt oder Uhr falsch gestellt.');
    const peer = await this.peerRepo.findOne({ where: { id: serverId } });
    if (!peer || !statuses.includes(peer.status)) throw new ForbiddenException('Dieser Server ist hier nicht verbunden.');
    if (!verify(peer.publicKey, canonical(req.method, req.originalUrl, date, req.rawBody), signature)) {
      throw new UnauthorizedException('Signatur ungültig.');
    }
    return peer;
  }

  /**
   * Ein anderer Server fragt an. Signiert ist mit dem mitgeschickten
   * Schlüssel; dass Adresse und Schlüssel zusammengehören, prüfen wir, indem
   * wir unter der genannten Adresse selbst nachfragen.
   */
  async receiveHello(req: any) {
    const body = req.body || {};
    const date = String(req.headers[HEADER_DATE] || '');
    const signature = String(req.headers[HEADER_SIGNATURE] || '');
    if (!freshDate(date) || !body.publicKey || !verify(body.publicKey, canonical(req.method, req.originalUrl, date, req.rawBody), signature)) {
      throw new UnauthorizedException('Signatur ungültig.');
    }
    if (String(req.headers[HEADER_SERVER] || '') !== body.serverId) throw new UnauthorizedException('Kennung passt nicht zur Signatur.');
    const url = normalizeUrl(body.url, this.allowHttp);
    if (!url) throw new BadRequestException('Adresse fehlt oder ist nicht https.');
    const info = await this.fetchInfo(url);
    if (info.serverId !== body.serverId || info.publicKey !== body.publicKey) {
      throw new ForbiddenException('Unter der angegebenen Adresse antwortet ein anderer Server.');
    }
    const me = await this.identity();
    if (info.serverId === me.serverId) throw new BadRequestException('Das ist dieser Server.');

    let peer = await this.peerRepo.findOne({ where: { id: info.serverId } });
    const sameKey = peer?.publicKey === info.publicKey;
    // Wir hatten selbst schon angefragt → beide wollen es: verbunden.
    const status = peer && sameKey && (peer.status === 'outgoing' || peer.status === 'active') ? 'active' : 'incoming';
    peer = this.peerRepo.create({ ...(peer || {}), id: info.serverId, url, name: String(info.name || url).slice(0, 80), publicKey: info.publicKey, status, lastError: null });
    await this.peerRepo.save(peer);
    if (status === 'active') this.sync(peer).catch(() => undefined);
    return { success: true, status };
  }

  async receiveAccept(req: any) {
    const peer = await this.verifyRequest(req, ['outgoing', 'active']);
    peer.status = 'active';
    peer.lastError = null;
    await this.peerRepo.save(peer);
    this.sync(peer).catch(() => undefined);
    return { success: true };
  }

  async receiveGoodbye(req: any) {
    const peer = await this.verifyRequest(req, ['outgoing', 'incoming', 'active']);
    await this.endPeer(peer);
    return { success: true };
  }

  /**
   * Katalog für einen verbundenen Server: die eigenen Angebote mit 🌐 und –
   * wenn beide am Vertrauensnetzwerk teilnehmen – die weitergereichten der
   * anderen Teilnehmer, je Angebot über den kürzesten Weg. Jedes Angebot
   * trägt seinen Weg (`path`), Ursprung zuerst, dieser Server zuletzt.
   */
  async serveCatalog(req: any) {
    const peer = await this.verifyRequest(req);
    const me = await this.identity();
    const self: PathEntry = { serverId: me.serverId, name: me.name };
    const own = await this.shop.federatedCatalog();
    const offers: any[] = own.offers.map((o) => ({ ...o, origin: { ...self, offerId: o.offerId }, path: [self] }));
    const categories = new Map<string, any>(own.categories.map((c) => [c.id, c]));
    let network: { servers: NetworkServer[] } | undefined;

    if (me.network && peer.network) {
      const peers = await this.peerRepo.find({ where: { status: 'active', network: true } });
      const via = new Set(peers.filter((p) => p.id !== peer.id).map((p) => p.id));
      const candidates = (await this.remoteRepo.find({ where: { peerId: In([...via]) } }))
        .map((r) => ({ r, path: Array.isArray(r.data?.path) ? r.data.path : [], origin: `${r.data?.origin?.serverId}:${r.data?.origin?.offerId}` }))
        .filter(({ r, path }) => r.data?.network === true && r.data?.origin?.offerId
          && path.length && path.length < MAX_PATH && !path.some((p: PathEntry) => p.serverId === peer.id || p.serverId === me.serverId));
      const byId = await this.categories.byId();
      for (const { r, path } of shortestRoutes(candidates)) {
        // Angeboten wird unter der hiesigen Kennung `<Server>:<Angebot dort>` – ein Copy findet so seinen Weg.
        offers.push({ ...this.catalogEntry(r.data), offerId: r.id, origin: r.data.origin, path: [...path, self] });
        for (const id of r.data.categoryIds || []) {
          let c = byId.get(id);
          while (c && !categories.has(c.id)) { categories.set(c.id, { id: c.id, facet: c.facet, parentId: c.parentId, label: c.label }); c = c.parentId ? byId.get(c.parentId) : undefined; }
        }
      }
      // Wen wir im Netz kennen – ohne, was wir nur von diesem Server selbst wissen.
      network = { servers: this.members(peers, me, peer.id) };
    }
    return {
      server: { serverId: me.serverId, name: me.name, network: me.network },
      offers: offers.slice(0, MAX_REMOTE_OFFERS),
      categories: [...categories.values()],
      ...(network ? { network } : {}),
    };
  }

  /** Nur die bekannten Felder eines Katalogeintrags – was ein Server sonst mitschickt, bleibt draußen. */
  private catalogEntry(o: any) {
    const str = (v: any, n: number) => String(v ?? '').slice(0, n);
    return {
      offerId: str(o.offerId, 200),
      title: str(o.title, 200),
      description: str(o.description, 2000),
      scopeType: str(o.scopeType || 'topic', 10),
      nodeKind: o.nodeKind ? str(o.nodeKind, 20) : null,
      topicCount: Number.isInteger(o.topicCount) ? o.topicCount : 1,
      topicIds: Array.isArray(o.topicIds) ? o.topicIds.slice(0, 200).map((x: any) => str(x, 64)) : [],
      modules: Array.isArray(o.modules) ? o.modules.slice(0, 500).map((m: any) => ({ title: str(m?.title, 300), type: str(m?.type, 60), topicTitle: str(m?.topicTitle, 200) })) : [],
      seller: { id: str(o.seller?.id, 64), name: str(o.seller?.name || 'Lehrkraft', 80) },
      allowCopy: !!o.allowCopy,
      allowUse: false,
      categoryIds: Array.isArray(o.categoryIds) ? o.categoryIds.map(String) : [],
      rating: o.rating && typeof o.rating === 'object'
        ? Object.fromEntries(Object.entries(o.rating).filter(([, v]) => typeof v === 'number' || v === null))
        : null,
      updatedAt: o.updatedAt ? str(o.updatedAt, 40) : null,
      network: o.network === true,
      license: LICENSES[String(o.license)] ? String(o.license) : null,
    };
  }

  /**
   * Ein anderer Server holt ein Copy für eine seiner Lehrkräfte – oder, im
   * Vertrauensnetzwerk, für eine Lehrkraft weiter weg (`person.relayed`).
   * Eine Kennung `<Server>:<Angebot>` ist ein weitergereichtes Angebot: Dann
   * geht die Anfrage eine Station weiter, statt des Namens nur mit
   * „Lehrkraft“, dem Namen des anfragenden Servers und einem Pseudonym.
   */
  async serveCopy(req: any, offerId: string) {
    const peer = await this.verifyRequest(req);
    const me = await this.identity();
    const person = req.body?.person || {};
    const personId = String(person.id || '').slice(0, 64);
    if (!personId) throw new BadRequestException('Wer kopiert, fehlt.');
    const relayed = person.relayed === true;
    if ((relayed || offerId.includes(':')) && !(me.network && peer.network)) {
      throw new ForbiddenException('Dieser Server reicht für euch nichts im Vertrauensnetzwerk weiter.');
    }

    if (offerId.includes(':')) {
      const row = await this.remoteRepo.findOne({ where: { id: offerId } });
      const next = row ? await this.peerRepo.findOne({ where: { id: row.peerId } }) : null;
      const path: PathEntry[] = Array.isArray(row?.data?.path) ? row!.data.path : [];
      if (!row || !next || next.status !== 'active' || !next.network || row.data?.network !== true || !row.data?.allowCopy
        || path.some((p) => p.serverId === peer.id)) {
        throw new NotFoundException('Dieses Angebot gibt es im Vertrauensnetzwerk nicht (mehr).');
      }
      const forward = relayed
        ? { id: personId, name: 'Lehrkraft', server: String(person.server || 'anderer Server').slice(0, 80), relayed: true }
        : { id: pseudonym(peer.id, personId), name: 'Lehrkraft', server: peer.name, relayed: true };
      // Was der Ursprung liefert, geht unverändert zurück – prüfen tut es der Server, der kopiert.
      return this.call(next, 'POST', `/api/federation/serve/${encodeURIComponent(row.offerId)}/copy`, { person: forward });
    }

    const payload = await this.shop.federatedCopyPayload(offerId, relayed);
    if (!payload) throw new NotFoundException('Dieses Angebot gibt es für verbundene Server nicht (mehr).');
    const ref = remoteRef(peer.id, personId);
    await this.personRepo.save(this.personRepo.create({
      id: ref,
      peerId: peer.id,
      name: relayed ? 'Lehrkraft' : String(person.name || 'Lehrkraft').slice(0, 80),
      serverName: relayed ? String(person.server || 'anderer Server').slice(0, 80) : null,
    }));
    await this.copyRepo.save(this.copyRepo.create({ id: crypto.randomUUID(), peerId: peer.id, offerId, personId: ref, topicIds: payload.topics.map((t) => t.id) }));
    const byId = await this.categories.byId();
    const used = new Set<string>();
    for (const t of payload.topics) for (const id of t.categoryIds) {
      let c = byId.get(id);
      while (c && !used.has(c.id)) { used.add(c.id); c = c.parentId ? byId.get(c.parentId) : undefined; }
    }
    return { ...payload, categories: [...used].map((id) => byId.get(id)!).map((c) => ({ id: c.id, facet: c.facet, parentId: c.parentId, label: c.label })) };
  }

  // ---- Katalogabgleich ----

  async syncAll() {
    for (const peer of await this.peerRepo.find({ where: { status: 'active' } })) await this.sync(peer).catch(() => undefined);
  }

  /** Katalog eines Servers holen und die Angebote hier ablegen (die alten ersetzt). */
  async sync(peer: FederationPeer) {
    try {
      const me = await this.identity();
      const data = await this.call(peer, 'GET', '/api/federation/catalog');
      peer.network = data?.server?.network === true;
      peer.networkServers = peer.network && Array.isArray(data?.network?.servers)
        ? data.network.servers.slice(0, MAX_NETWORK_SERVERS).map((x: any) => ({
          serverId: String(x?.serverId || '').slice(0, 64), name: String(x?.name || 'anderer Server').slice(0, 80), hops: Number(x?.hops) || MAX_PATH,
        })).filter((x: NetworkServer) => x.serverId && x.serverId !== me.serverId)
        : null;
      const offers: any[] = Array.isArray(data?.offers) ? data.offers.slice(0, MAX_REMOTE_OFFERS) : [];
      const theirs = Array.isArray(data?.categories) ? data.categories : [];
      const known = new Set((await this.categories.all()).filter((c) => c.status !== 'hidden').map((c) => c.id));
      const now = new Date();
      const from: PathEntry = { serverId: peer.id, name: peer.name };
      const rows = offers
        .filter((o) => o && typeof o.offerId === 'string' && typeof o.title === 'string')
        .map((o) => {
          const path = cleanPath(o.path, from);
          // Kaputter Weg, ein Kreis über uns, oder weitergereicht ohne Einwilligung bzw. ohne Teilnahme beider.
          if (!path || path.some((p) => p.serverId === me.serverId)) return null;
          const relayed = path.length > 1;
          if (relayed && (!me.network || !peer.network || o.network !== true || !o.origin?.offerId)) return null;
          const entry = this.catalogEntry(o);
          return this.remoteRepo.create({
            id: `${peer.id}:${entry.offerId}`,
            peerId: peer.id,
            offerId: entry.offerId,
            fetchedAt: now,
            data: {
              ...entry,
              categoryIds: mapCategories(entry.categoryIds, theirs, known),
              origin: { ...path[0], offerId: relayed ? String(o.origin.offerId).slice(0, 200) : entry.offerId },
              path,
            },
          });
        })
        .filter((r): r is RemoteOffer => !!r);
      await this.dataSource.transaction(async (m) => {
        await m.getRepository(RemoteOffer).delete({ peerId: peer.id });
        for (let i = 0; i < rows.length; i += 100) await m.getRepository(RemoteOffer).save(rows.slice(i, i + 100));
      });
      if (data?.server?.name) peer.name = String(data.server.name).slice(0, 80);
      peer.lastSyncAt = now;
      peer.offerCount = rows.length;
      peer.lastError = null;
    } catch (err) {
      peer.lastError = (err as Error).message.slice(0, 300);
    }
    await this.peerRepo.save(peer);
  }

  // ---- Für Lehrkräfte ----

  /** Angebote verbundener Server, wie sie der Shop zeigt. */
  async remoteOffers(user: any) {
    const peers = await this.peerRepo.find({ where: { status: 'active' } });
    if (!peers.length) return { peers: 0, offers: [] };
    const byPeer = new Map(peers.map((p) => [p.id, p]));
    const rows = (await this.remoteRepo.find({ where: { peerId: In(peers.map((p) => p.id)) } }))
      .map((r) => ({ r, ...this.originOf(r, byPeer.get(r.peerId)!) }));
    const mine = await this.topicRepo.find({ where: { ownerId: user.userId, copiedFromId: Like('remote:%') }, select: ['id', 'copiedFromId'] });
    const copied = new Set(mine.map((t) => t.copiedFromId));
    // Dasselbe Angebot über zwei Wege: nur der kürzere.
    const unique = shortestRoutes(rows.map((x) => ({ ...x, origin: `${x.originId}:${x.originOfferId}` })));
    return {
      peers: peers.length,
      offers: unique.map(({ r, path, originId, originName }) => {
        const peer = byPeer.get(r.peerId)!;
        const d = r.data || {};
        const topicRefs = (d.topicIds || []).map((id: string) => remoteRef(originId, id));
        return {
          ...d,
          remote: true,
          peerId: peer.id,
          // Wo das Angebot herkommt – und über welche Server, wenn nicht direkt.
          peerName: originName,
          via: path.slice(1).map((p) => p.name),
          sellerName: `${d.seller?.name || 'Unbekannt'}`,
          copies: topicRefs.filter((ref: string) => copied.has(ref)).length,
          fetchedAt: r.fetchedAt,
        };
      }),
    };
  }

  /** Ursprung und Weg eines abgeglichenen Angebots (ältere Einträge: direkt vom Lieferanten). */
  private originOf(r: RemoteOffer, peer: FederationPeer) {
    const path: PathEntry[] = Array.isArray(r.data?.path) && r.data.path.length ? r.data.path : [{ serverId: peer.id, name: peer.name }];
    const relayed = path.length > 1;
    return {
      path,
      originId: relayed ? path[0].serverId : peer.id,
      originName: relayed ? path[0].name : peer.name,
      originOfferId: relayed ? String(r.data?.origin?.offerId || r.offerId) : r.offerId,
    };
  }

  /**
   * Copy von einem verbundenen Server: Inhalt holen und als eigene Lernthemen
   * anlegen. Creator bleibt die Lehrkraft dort (`remote:<server>:<id>`), jedes
   * Modul merkt sich sein Original dort.
   */
  async acquireCopy(user: any, peerId: string, offerId: string) {
    const peer = await this.getPeer(peerId);
    if (peer.status !== 'active') throw new BadRequestException('Dieser Server ist nicht (mehr) verbunden.');
    const listed = await this.remoteRepo.findOne({ where: { id: `${peer.id}:${offerId}` } });
    if (!listed?.data?.allowCopy) throw new NotFoundException('Dieses Angebot gibt es nicht zum Kopieren.');
    // Im Vertrauensnetzwerk ist der Ursprung ein anderer Server als der, über den es kommt.
    const { originId, originName } = this.originOf(listed, peer);
    const relayed = originId !== peer.id;
    const name = await this.displayName(user);
    const payload = await this.call(peer, 'POST', `/api/federation/serve/${encodeURIComponent(offerId)}/copy`, { person: { id: user.userId, name } });
    const topics: any[] = Array.isArray(payload?.topics) ? payload.topics.slice(0, MAX_TOPICS_PER_COPY) : [];
    if (!topics.length) throw new BadRequestException('Das Angebot enthält derzeit nichts zum Kopieren.');
    if (topics.reduce((n, t) => n + (Array.isArray(t.modules) ? t.modules.length : 0), 0) > MAX_MODULES_PER_COPY) {
      throw new BadRequestException('Das Angebot ist zu groß für eine Kopie.');
    }
    const known = new Set((await this.categories.all()).filter((c) => c.status !== 'hidden').map((c) => c.id));
    const theirs = Array.isArray(payload.categories) ? payload.categories : [];

    const ids: string[] = [];
    await this.dataSource.transaction(async (m) => {
      const persons = new Map<string, RemotePerson>();
      for (const t of topics) {
        const ownerRef = remoteRef(originId, String(t.ownerId || ''));
        const topic = await m.getRepository(LearningTopic).save(m.getRepository(LearningTopic).create({
          id: crypto.randomUUID(),
          title: String(t.title || 'Lernthema').slice(0, 200),
          description: String(t.description || '').slice(0, 5000),
          ownerId: user.userId,
          selected: false,
          visibility: 'locked',
          copiedFromId: remoteRef(originId, String(t.id)),
          copiedFromOwnerId: ownerRef,
          copiedFromAuthor: `${String(t.ownerName || 'Unbekannt').slice(0, 80)} @ ${originName}`,
          copiedFromTitle: String(t.title || '').slice(0, 200),
          categoryIds: (() => { const c = mapCategories((t.categoryIds || []).map(String), theirs, known); return c.length ? c : null; })(),
        }));
        const mods: any[] = Array.isArray(t.modules) ? t.modules : [];
        const idMap = new Map(mods.map((x) => [String(x.id), crypto.randomUUID()]));
        const rows = mods.map((x) => {
          const creator = remoteRef(originId, String(x.creatorId || t.ownerId || ''));
          if (!persons.has(creator)) {
            persons.set(creator, m.getRepository(RemotePerson).create({
              id: creator, peerId: originId, name: String(x.creatorName || t.ownerName || 'Lehrkraft').slice(0, 80), serverName: relayed ? originName : null,
            }));
          }
          // Nur bekannte Felder – nichts, was der andere Server sonst noch mitschickt.
          return Object.assign(new LearningModule(), {
            id: idMap.get(String(x.id)),
            topicId: topic.id,
            parentId: x.parentId ? idMap.get(String(x.parentId)) || null : null,
            type: String(x.type || '').slice(0, 60),
            title: String(x.title || '').slice(0, 300),
            description: x.description ? String(x.description).slice(0, 20000) : null,
            content: x.content ?? null,
            orderIndex: Number.isInteger(x.orderIndex) ? x.orderIndex : 0,
            moduleSelected: x.moduleSelected !== false,
            tagIds: null,
            creatorId: creator,
            originId: remoteRef(originId, String(x.originId || x.id)),
          });
        }).filter((x) => x.type && x.id);
        // Erst Elternmodule, dann Untermodule.
        rows.sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId));
        for (let i = 0; i < rows.length; i += 100) await m.getRepository(LearningModule).save(rows.slice(i, i + 100));
        ids.push(topic.id);
      }
      if (persons.size) await m.getRepository(RemotePerson).save([...persons.values()]);
    });
    return { success: true, mode: 'copy', topicId: ids[0] || null, copiedTopics: ids.length };
  }

  /** Name, unter dem eine Lehrkraft beim anderen Server erscheint – nie die E-Mail-Adresse. */
  private async displayName(user: any): Promise<string> {
    const u = await this.userRepo.findOne({ where: { id: user.userId } });
    const name = (u?.displayName || '').trim();
    return (name && name !== u?.email && !name.includes('@') ? name : 'Lehrkraft').slice(0, 80);
  }
}
