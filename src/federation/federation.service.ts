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
  canonical, fingerprint, freshDate, mapCategories, newKeyPair, normalizeUrl, remoteRef, sign, verify,
  HEADER_DATE, HEADER_SERVER, HEADER_SIGNATURE, MAX_REMOTE_OFFERS,
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
}

/**
 * Vernetzung mehrerer LearningModules-Server (docs/vernetzung.md).
 *
 * Jeder Server hat eine Kennung und ein Ed25519-Schlüsselpaar. Zwei Server
 * verbinden sich, indem der Admin des einen die Adresse des anderen einträgt
 * und der Admin des anderen annimmt. Danach ist jeder Aufruf zwischen ihnen
 * signiert. Ausgetauscht werden Kataloge und, bei einem Copy, die eigenen
 * Module des Anbieters – nie Schülerdaten, nie fremde Module.
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
        this.cached = { serverId: v.serverId, name: v.name || APP, url: v.url || this.defaultUrl(), publicKey: v.publicKey, privateKey: this.masterKey.unsealSecret(v.privateKeySealed) };
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
      value: { serverId: id.serverId, name: id.name, url: id.url, publicKey: id.publicKey, privateKeySealed: this.masterKey.sealSecret(id.privateKey) },
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
      peers: peers.map((p) => ({
        id: p.id, url: p.url, name: p.name, status: p.status, fingerprint: fingerprint(p.publicKey),
        lastSyncAt: p.lastSyncAt, lastError: p.lastError, offerCount: p.offerCount, since: p.createdAt,
      })),
    };
  }

  /** `{ name?, url? }` – Anzeigename und öffentliche Adresse dieses Servers. */
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
    await this.saveIdentity(next);
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

  async serveCatalog(req: any) {
    await this.verifyRequest(req);
    const me = await this.identity();
    return { server: { serverId: me.serverId, name: me.name }, ...(await this.shop.federatedCatalog()) };
  }

  /** Ein anderer Server holt ein Copy für eine seiner Lehrkräfte. */
  async serveCopy(req: any, offerId: string) {
    const peer = await this.verifyRequest(req);
    const person = req.body?.person || {};
    const personId = String(person.id || '').slice(0, 64);
    if (!personId) throw new BadRequestException('Wer kopiert, fehlt.');
    const payload = await this.shop.federatedCopyPayload(offerId);
    if (!payload) throw new NotFoundException('Dieses Angebot gibt es für verbundene Server nicht (mehr).');
    const ref = remoteRef(peer.id, personId);
    await this.personRepo.save(this.personRepo.create({ id: ref, peerId: peer.id, name: String(person.name || 'Lehrkraft').slice(0, 80) }));
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
      const data = await this.call(peer, 'GET', '/api/federation/catalog');
      const offers: any[] = Array.isArray(data?.offers) ? data.offers.slice(0, MAX_REMOTE_OFFERS) : [];
      const theirs = Array.isArray(data?.categories) ? data.categories : [];
      const known = new Set((await this.categories.all()).filter((c) => c.status !== 'hidden').map((c) => c.id));
      const now = new Date();
      const rows = offers
        .filter((o) => o && typeof o.offerId === 'string' && typeof o.title === 'string')
        .map((o) => this.remoteRepo.create({
          id: `${peer.id}:${o.offerId}`,
          peerId: peer.id,
          offerId: o.offerId,
          fetchedAt: now,
          data: {
            ...o,
            title: String(o.title).slice(0, 200),
            description: String(o.description || '').slice(0, 2000),
            categoryIds: mapCategories(Array.isArray(o.categoryIds) ? o.categoryIds.map(String) : [], theirs, known),
          },
        }));
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
    const rows = await this.remoteRepo.find({ where: { peerId: In(peers.map((p) => p.id)) } });
    const mine = await this.topicRepo.find({ where: { ownerId: user.userId, copiedFromId: Like('remote:%') }, select: ['id', 'copiedFromId'] });
    const copied = new Set(mine.map((t) => t.copiedFromId));
    return {
      peers: peers.length,
      offers: rows.map((r) => {
        const peer = byPeer.get(r.peerId)!;
        const d = r.data || {};
        const topicRefs = (d.topicIds || []).map((id: string) => remoteRef(peer.id, id));
        return {
          ...d,
          remote: true,
          peerId: peer.id,
          peerName: peer.name,
          sellerName: `${d.seller?.name || 'Unbekannt'}`,
          copies: topicRefs.filter((ref: string) => copied.has(ref)).length,
          fetchedAt: r.fetchedAt,
        };
      }),
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
        const ownerRef = remoteRef(peer.id, String(t.ownerId || ''));
        const topic = await m.getRepository(LearningTopic).save(m.getRepository(LearningTopic).create({
          id: crypto.randomUUID(),
          title: String(t.title || 'Lernthema').slice(0, 200),
          description: String(t.description || '').slice(0, 5000),
          ownerId: user.userId,
          selected: false,
          visibility: 'locked',
          copiedFromId: remoteRef(peer.id, String(t.id)),
          copiedFromOwnerId: ownerRef,
          copiedFromAuthor: `${String(t.ownerName || 'Unbekannt').slice(0, 80)} @ ${peer.name}`,
          copiedFromTitle: String(t.title || '').slice(0, 200),
          categoryIds: (() => { const c = mapCategories((t.categoryIds || []).map(String), theirs, known); return c.length ? c : null; })(),
        }));
        const mods: any[] = Array.isArray(t.modules) ? t.modules : [];
        const idMap = new Map(mods.map((x) => [String(x.id), crypto.randomUUID()]));
        const rows = mods.map((x) => {
          const creator = remoteRef(peer.id, String(x.creatorId || t.ownerId || ''));
          if (!persons.has(creator)) {
            persons.set(creator, m.getRepository(RemotePerson).create({ id: creator, peerId: peer.id, name: String(x.creatorName || t.ownerName || 'Lehrkraft').slice(0, 80) }));
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
            originId: remoteRef(peer.id, String(x.originId || x.id)),
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
