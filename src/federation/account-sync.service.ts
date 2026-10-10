import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { AccountLink } from '../core/entities/account-link.entity';
import { LinkCode } from '../core/entities/link-code.entity';
import { FederationPeer } from '../core/entities/federation-peer.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { User } from '../core/entities/user.entity';
import { CategoriesService } from '../categories/categories.service';
import { FederationService } from './federation.service';
import { mapCategories } from './federation-rules';
import { cleanCode, decide, newLinkCode, planModules, topicHash, SyncModule } from './sync-rules';

const CODE_MINUTES = 15;
const AUTO_SYNC_MS = 60 * 60 * 1000;
const MAX_TOPICS = 2000;

/**
 * Das eigene Konto auf einem verbundenen Server verknüpfen und die eigenen
 * Inhalte von dort hierher abgleichen (docs/uebergabe.md).
 *
 * Abgeglichen wird in eine Richtung: Dieser Server holt vom anderen, was das
 * Konto dort selbst verfasst hat, und legt es hier als eigenes an. Was hier
 * seit dem letzten Abgleich geändert wurde, wird nie überschrieben. Was von
 * hier stammt, kommt nicht zurück – so entstehen keine Schleifen.
 */
@Injectable()
export class AccountSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AccountSyncService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(AccountLink) private readonly linkRepo: Repository<AccountLink>,
    @InjectRepository(LinkCode) private readonly codeRepo: Repository<LinkCode>,
    @InjectRepository(FederationPeer) private readonly peerRepo: Repository<FederationPeer>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    @InjectRepository(NotebookPlacement) private readonly placeRepo: Repository<NotebookPlacement>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly federation: FederationService,
    private readonly categories: CategoriesService,
    private readonly dataSource: DataSource,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => this.autoSyncAll().catch(() => undefined), AUTO_SYNC_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async displayName(userId: string) {
    const u = await this.userRepo.findOne({ where: { id: userId } });
    const name = (u?.displayName || '').trim();
    return name && !name.includes('@') ? name.slice(0, 80) : 'Lehrkraft';
  }

  private async activePeer(peerId: string) {
    const peer = await this.peerRepo.findOne({ where: { id: peerId } });
    if (!peer || peer.status !== 'active') throw new BadRequestException('Dieser Server ist nicht (mehr) verbunden.');
    return peer;
  }

  // ---- Übersicht ----

  async mine(user: any) {
    const [links, peers] = await Promise.all([
      this.linkRepo.find({ where: { localUserId: user.userId } }),
      this.peerRepo.find({ where: { status: 'active' }, order: { name: 'ASC' } }),
    ]);
    const code = await this.codeRepo.findOne({ where: { userId: user.userId }, order: { createdAt: 'DESC' } });
    const synced = await this.topicRepo.count({ where: { ownerId: user.userId } });
    return {
      peers: peers.map((p) => ({ id: p.id, name: p.name, url: p.url })),
      code: code && code.expiresAt.getTime() > Date.now() ? { code: code.code, peerId: code.peerId, expiresAt: code.expiresAt } : null,
      links: links.map((l) => ({
        id: l.id, peerId: l.peerId, peerName: peers.find((p) => p.id === l.peerId)?.name || 'getrennter Server',
        peerActive: peers.some((p) => p.id === l.peerId), remoteName: l.remoteName, autoSync: l.autoSync,
        lastSyncAt: l.lastSyncAt, lastResult: l.lastResult, since: l.createdAt,
      })),
      ownTopics: synced,
    };
  }

  // ---- Verknüpfen ----

  /** Schritt 1 (auf diesem Server): Code erzeugen, der auf dem anderen eingegeben wird. */
  async createCode(user: any, body: any) {
    const peer = await this.activePeer(String(body?.peerId || ''));
    await this.codeRepo.delete({ userId: user.userId });
    await this.codeRepo.delete({ expiresAt: LessThan(new Date()) });
    const row = await this.codeRepo.save(this.codeRepo.create({
      code: newLinkCode(), userId: user.userId, peerId: peer.id, expiresAt: new Date(Date.now() + CODE_MINUTES * 60000),
    }));
    return { code: row.code, expiresAt: row.expiresAt, peerName: peer.name };
  }

  /** Schritt 2 (auf dem anderen Server): Code eingeben; der fragt hier nach. */
  async enterCode(user: any, body: any) {
    const peer = await this.activePeer(String(body?.peerId || ''));
    const code = cleanCode(body?.code);
    if (!code) throw new BadRequestException('Bitte den Code mit 8 Zeichen eingeben, z. B. ABCD-EF23.');
    const res = await this.federation.call(peer, 'POST', '/api/federation/link/confirm', {
      code, userId: user.userId, name: await this.displayName(user.userId),
    });
    if (!res?.userId) throw new BadRequestException('Der andere Server hat den Code nicht bestätigt.');
    await this.saveLink(user.userId, peer.id, String(res.userId), String(res.name || ''));
    return { success: true, peerName: peer.name, remoteName: res.name };
  }

  /** Vom anderen Server: Stimmt der Code? Dann sind die Konten verknüpft. */
  async receiveConfirm(req: any) {
    const peer = await this.federation.verifyRequest(req);
    const code = cleanCode(req.body?.code);
    const row = code ? await this.codeRepo.findOne({ where: { code } }) : null;
    if (!row || row.peerId !== peer.id || row.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException('Code unbekannt oder abgelaufen – bitte einen neuen erzeugen.');
    }
    const remoteUserId = String(req.body?.userId || '').slice(0, 64);
    if (!remoteUserId) throw new BadRequestException('Konto fehlt.');
    await this.codeRepo.delete({ code });
    await this.saveLink(row.userId, peer.id, remoteUserId, String(req.body?.name || '').slice(0, 80));
    return { userId: row.userId, name: await this.displayName(row.userId) };
  }

  private async saveLink(localUserId: string, peerId: string, remoteUserId: string, remoteName: string) {
    const existing = await this.linkRepo.findOne({ where: { localUserId, peerId } });
    await this.linkRepo.save(this.linkRepo.create({
      ...(existing || { id: crypto.randomUUID(), autoSync: false }),
      localUserId, peerId, remoteUserId, remoteName: remoteName || 'Lehrkraft',
    }));
  }

  private async ownLink(id: string, user: any) {
    const link = await this.linkRepo.findOne({ where: { id } });
    if (!link || link.localUserId !== user.userId) throw new NotFoundException('Verknüpfung nicht gefunden.');
    return link;
  }

  async update(id: string, user: any, body: any) {
    const link = await this.ownLink(id, user);
    if (body?.autoSync !== undefined) link.autoSync = !!body.autoSync;
    await this.linkRepo.save(link);
    return { success: true, autoSync: link.autoSync };
  }

  /** Verknüpfung lösen – hier, und drüben, wenn erreichbar. Abgeglichenes bleibt. */
  async unlink(id: string, user: any) {
    const link = await this.ownLink(id, user);
    const peer = await this.peerRepo.findOne({ where: { id: link.peerId } });
    if (peer?.status === 'active') {
      await this.federation.call(peer, 'POST', '/api/federation/link/unlink', { userId: link.remoteUserId, remoteUserId: link.localUserId }).catch(() => undefined);
    }
    await this.linkRepo.remove(link);
    return { success: true };
  }

  async receiveUnlink(req: any) {
    const peer = await this.federation.verifyRequest(req);
    await this.linkRepo.delete({ peerId: peer.id, localUserId: String(req.body?.userId || ''), remoteUserId: String(req.body?.remoteUserId || '') });
    return { success: true };
  }

  // ---- Ausliefern (auf dem Server, von dem geholt wird) ----

  /**
   * Was das verknüpfte Konto hier selbst verfasst hat: Lernthemen mit den
   * eigenen Modulen, die Notebook-Struktur und die Kategorien. Nicht dabei:
   * was ursprünglich vom anfragenden Server kam, und fremde Module.
   */
  async serveExport(req: any) {
    const peer = await this.federation.verifyRequest(req);
    const userId = String(req.body?.userId || '');
    const link = await this.linkRepo.findOne({ where: { localUserId: userId, peerId: peer.id } });
    if (!link || link.remoteUserId !== String(req.body?.remoteUserId || '')) throw new ForbiddenException('Diese Konten sind nicht verknüpft.');
    const back = `remote:${peer.id}:`;
    const topics = (await this.topicRepo.find({ where: { ownerId: userId } })).filter((t) => !(t.syncSource || '').startsWith(back)).slice(0, MAX_TOPICS);
    const modules = topics.length ? await this.moduleRepo.find({ where: { topicId: In(topics.map((t) => t.id)) } }) : [];
    const out: any[] = [];
    for (const t of topics) {
      const mine = modules.filter((m) => m.topicId === t.id);
      const roots = new Set(mine.filter((m) => !m.parentId && m.creatorId === userId).map((m) => m.id));
      const own = mine.filter((m) => roots.has(m.id) || (m.parentId && roots.has(m.parentId)));
      if (!own.length) continue;
      const mods: SyncModule[] = own.map((m) => ({
        key: m.id, parentKey: m.parentId || null, type: m.type, title: m.title, description: m.description || null,
        content: m.content, orderIndex: m.orderIndex, moduleSelected: m.moduleSelected !== false,
      }));
      out.push({ id: t.id, title: t.title, description: t.description || '', categoryIds: t.categoryIds || [], hash: topicHash(t.title, t.description || '', mods), modules: mods });
    }
    const ids = new Set(out.map((t) => t.id));
    const places = (await this.placeRepo.find({ where: { ownerId: userId } })).filter((p) => ids.has(p.topicId));
    // Nur Books, Bereiche und Abschnitte auf dem Weg zu einem dieser Lernthemen –
    // leere Ordner und „Erworben“ bleiben hier.
    const allNodes = await this.nodeRepo.find({ where: { ownerId: userId } });
    const needed = new Set<string>();
    for (const p of places) {
      let cur = p.nodeId ? allNodes.find((n) => n.id === p.nodeId) : undefined;
      while (cur && !needed.has(cur.id)) { needed.add(cur.id); cur = cur.parentId ? allNodes.find((n) => n.id === cur!.parentId) : undefined; }
    }
    const nodes = allNodes.filter((n) => needed.has(n.id) && !(n.syncSource || '').startsWith(back));
    const byId = await this.categories.byId();
    const used = new Set<string>();
    for (const t of out) for (const id of t.categoryIds) {
      let c = byId.get(id);
      while (c && !used.has(c.id)) { used.add(c.id); c = c.parentId ? byId.get(c.parentId) : undefined; }
    }
    return {
      topics: out,
      nodes: nodes.map((n) => ({ id: n.id, kind: n.kind, title: n.title, parentId: n.parentId, orderIndex: n.orderIndex })),
      placements: places.map((p) => ({ topicId: p.topicId, nodeId: p.nodeId, orderIndex: p.orderIndex })),
      categories: [...used].map((id) => byId.get(id)!).map((c) => ({ id: c.id, facet: c.facet, parentId: c.parentId, label: c.label })),
    };
  }

  // ---- Holen (auf diesem Server) ----

  async syncNow(id: string, user: any) {
    const link = await this.ownLink(id, user);
    return this.sync(link);
  }

  private async autoSyncAll() {
    for (const link of await this.linkRepo.find({ where: { autoSync: true } })) await this.sync(link).catch(() => undefined);
  }

  /** Inhalte vom verknüpften Konto drüben holen und hier abgleichen. */
  async sync(link: AccountLink) {
    let result: any;
    try {
      const peer = await this.activePeer(link.peerId);
      const data = await this.federation.call(peer, 'POST', '/api/federation/link/export', { userId: link.remoteUserId, remoteUserId: link.localUserId });
      result = await this.importFrom(peer, link.localUserId, data);
    } catch (err) {
      result = { error: (err as Error).message.slice(0, 300) };
    }
    link.lastSyncAt = new Date();
    link.lastResult = result;
    await this.linkRepo.save(link);
    if (result.error) throw new BadRequestException(result.error);
    return { success: true, ...result };
  }

  /** Hier vorhandene Fassung eines abgeglichenen Lernthemas als Module mit Kennung (für Prüfsumme und Abgleich). */
  private asSync(prefix: string, mods: LearningModule[]) {
    const keyOf = (m: LearningModule) => (m.originId && m.originId.startsWith(prefix) ? m.originId.slice(prefix.length) : m.id);
    const byId = new Map(mods.map((m) => [m.id, m]));
    return mods.map((m) => ({
      row: m,
      key: keyOf(m),
      parentKey: m.parentId && byId.get(m.parentId) ? keyOf(byId.get(m.parentId)!) : null,
      type: m.type, title: m.title, description: m.description || null, content: m.content,
      orderIndex: m.orderIndex, moduleSelected: m.moduleSelected !== false,
    }));
  }

  private async importFrom(peer: FederationPeer, userId: string, data: any) {
    const topics: any[] = Array.isArray(data?.topics) ? data.topics.slice(0, MAX_TOPICS) : [];
    const prefix = `remote:${peer.id}:`;
    const known = new Set((await this.categories.all()).filter((c) => c.status !== 'hidden').map((c) => c.id));
    const theirs = Array.isArray(data?.categories) ? data.categories : [];
    const counts = { created: 0, updated: 0, unchanged: 0, conflicts: [] as string[], gone: [] as string[], nodes: 0 };

    await this.dataSource.transaction(async (m) => {
      const topicRepo = m.getRepository(LearningTopic);
      const moduleRepo = m.getRepository(LearningModule);
      const nodeRepo = m.getRepository(NotebookNode);
      const placeRepo = m.getRepository(NotebookPlacement);

      // Notebook-Struktur: fehlende Knoten anlegen, vorhandene lassen (vielleicht hier umsortiert).
      const theirNodes: any[] = Array.isArray(data?.nodes) ? data.nodes : [];
      const mine = await nodeRepo.find({ where: { ownerId: userId } });
      const nodeMap = new Map(mine.filter((n) => (n.syncSource || '').startsWith(prefix)).map((n) => [n.syncSource!.slice(prefix.length), n.id]));
      const depth = (n: any): number => { let d = 0; let p = n.parentId; const seen = new Set(); while (p && !seen.has(p)) { seen.add(p); d++; p = theirNodes.find((x) => x.id === p)?.parentId; } return d; };
      const books = mine.filter((n) => n.kind === 'book' && !n.parentId).length;
      let bookIndex = books;
      for (const n of [...theirNodes].sort((a, b) => depth(a) - depth(b))) {
        if (nodeMap.has(n.id) || !['book', 'area', 'section'].includes(n.kind)) continue;
        const parentId = n.parentId ? nodeMap.get(n.parentId) || null : null;
        if (n.parentId && !parentId) continue;
        const row = await nodeRepo.save(nodeRepo.create({
          id: crypto.randomUUID(), ownerId: userId, kind: n.kind, parentId,
          title: (n.parentId ? String(n.title) : `${n.title} (${peer.name})`).slice(0, 200),
          orderIndex: n.parentId ? Number(n.orderIndex) || 0 : bookIndex++, tagIds: null, syncSource: prefix + n.id,
        }));
        nodeMap.set(n.id, row.id);
        counts.nodes++;
      }
      const placeOf = new Map((Array.isArray(data?.placements) ? data.placements : []).map((p: any) => [p.topicId, p]));

      const here = await topicRepo.find({ where: { ownerId: userId } });
      const bySource = new Map(here.filter((t) => (t.syncSource || '').startsWith(prefix)).map((t) => [t.syncSource!.slice(prefix.length), t]));
      const seen = new Set<string>();
      for (const t of topics) {
        const key = String(t.id);
        seen.add(key);
        const mods: SyncModule[] = (Array.isArray(t.modules) ? t.modules : []).map((x: any) => ({
          key: String(x.key), parentKey: x.parentKey ? String(x.parentKey) : null, type: String(x.type || '').slice(0, 60),
          title: String(x.title || '').slice(0, 300), description: x.description ? String(x.description).slice(0, 20000) : null,
          content: x.content ?? null, orderIndex: Number.isInteger(x.orderIndex) ? x.orderIndex : 0, moduleSelected: x.moduleSelected !== false,
        })).filter((x: SyncModule) => x.type);
        const incomingHash = topicHash(String(t.title || ''), String(t.description || ''), mods);
        const existing = bySource.get(key);
        const local = existing ? this.asSync(prefix, await moduleRepo.find({ where: { topicId: existing.id } })) : [];
        const localHash = existing ? topicHash(existing.title, existing.description || '', local) : '';
        const decision = decide(existing ? { syncHash: existing.syncHash, localHash } : null, incomingHash);
        if (decision === 'unchanged') { counts.unchanged++; continue; }
        if (decision === 'conflict') { counts.conflicts.push(existing!.title); continue; }

        const cats = mapCategories((t.categoryIds || []).map(String), theirs, known);
        const topic = existing || topicRepo.create({ id: crypto.randomUUID(), ownerId: userId, selected: false, visibility: 'locked', syncSource: prefix + key });
        Object.assign(topic, {
          title: String(t.title || 'Lernthema').slice(0, 200),
          description: String(t.description || '').slice(0, 5000),
          categoryIds: cats.length ? cats : topic.categoryIds || null,
        });
        await topicRepo.save(topic);

        // Module über ihre Kennung abgleichen – vorhandene behalten ihre ID,
        // damit Links und Ergebnisse hier weiter auf sie zeigen.
        const plan = planModules(local, mods);
        const idByKey = new Map(local.map((l) => [l.key, l.row.id]));
        for (const c of plan.create) idByKey.set(c.key, crypto.randomUUID());
        const rows: LearningModule[] = [];
        for (const u of plan.update) {
          rows.push(Object.assign(u.here.row, this.fields(u.next), { parentId: u.next.parentKey ? idByKey.get(u.next.parentKey) || null : null }));
        }
        for (const c of plan.create) {
          rows.push(Object.assign(new LearningModule(), this.fields(c), {
            id: idByKey.get(c.key), topicId: topic.id, parentId: c.parentKey ? idByKey.get(c.parentKey) || null : null,
            creatorId: userId, originId: prefix + c.key, tagIds: null,
          }));
        }
        rows.sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId));
        for (let i = 0; i < rows.length; i += 100) await moduleRepo.save(rows.slice(i, i + 100));
        if (plan.remove.length) await moduleRepo.remove(plan.remove.map((r) => r.row));

        const after = this.asSync(prefix, await moduleRepo.find({ where: { topicId: topic.id } }));
        topic.syncHash = topicHash(topic.title, topic.description || '', after);
        topic.syncedAt = new Date();
        await topicRepo.save(topic);

        if (!existing) {
          const p: any = placeOf.get(key);
          const nodeId = p?.nodeId ? nodeMap.get(p.nodeId) || null : null;
          await placeRepo.delete({ ownerId: userId, topicId: topic.id });
          await placeRepo.save(placeRepo.create({ id: crypto.randomUUID(), ownerId: userId, topicId: topic.id, nodeId, orderIndex: Number(p?.orderIndex) || 0 }));
          counts.created++;
        } else counts.updated++;
      }
      // Drüben nicht mehr da: hier bleibt es, wird aber genannt.
      for (const [key, t] of bySource) if (!seen.has(key)) counts.gone.push(t.title);
    });
    return counts;
  }

  /** Nur bekannte Felder eines Moduls. */
  private fields(x: SyncModule) {
    return { type: x.type, title: x.title, description: x.description, content: x.content, orderIndex: x.orderIndex, moduleSelected: x.moduleSelected };
  }
}
