import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { TopicsService } from '../topics/topics.service';
import { TagsService } from '../tags/tags.service';
import { LinksService } from '../links/links.service';
import { ExportService } from '../core/interchange/export/export.service';
import { ImportService } from '../core/interchange/import/import.service';
import { ShopService, GrantEntry } from '../shop/shop.service';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { User } from '../core/entities/user.entity';
import { NodeKind, NODE_KINDS, KIND_LABEL, canHoldNode, insertAt, initialStructure, inheritTags, subtreeIds } from './notebook-rules';

/**
 * Notebook-Datei (Download eines Books, Bereichs oder Abschnitts): ein ZIP mit
 * `notebook.json` (Struktur) und je Lernthema dem gewohnten JSON-Export unter
 * `topics/` – die lassen sich auch einzeln wieder als Thema einlesen.
 */
export const NOTEBOOK_FORMAT = 'learningmodules-notebook';
const STRUCTURE_FILE = 'notebook.json';
/** Obergrenze beim Entpacken – schützt vor ZIP-Bomben. */
const MAX_UNPACKED = 200 * 1024 * 1024;

/** Book für Themen, die über den Shop zur Nutzung hinzukommen. */
const ACQUIRED_BOOK = 'Erworben';

const MAX_TITLE = 120;

interface ExportedNode {
  kind: NodeKind;
  title: string;
  /** Tag-Namen – IDs gelten nur im eigenen Konto. */
  tags: string[];
  children: ExportedNode[];
  /** Pfade der Themen-Dateien im ZIP. */
  topics: string[];
}

/** Dateiname im ZIP: Nummer + Titel, ohne störende Zeichen. */
function entryName(n: number, title: string): string {
  const clean = String(title || 'Lernthema').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').trim().slice(0, 60) || 'Lernthema';
  return `topics/${String(n).padStart(3, '0')} ${clean}.json`;
}

/**
 * Notebook-Ansicht: Lernthemen einer Lehrkraft in Books, Bereichen und
 * Abschnitten. Die Ordnung ist privat und ändert nichts an Rechten oder
 * Inhalt – verschieben heißt nur, den Platz eines Themas zu ändern.
 */
@Injectable()
export class NotebooksService {
  constructor(
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    @InjectRepository(NotebookPlacement) private readonly placeRepo: Repository<NotebookPlacement>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    private readonly topics: TopicsService,
    private readonly tags: TagsService,
    private readonly links: LinksService,
    private readonly exporter: ExportService,
    private readonly importer: ImportService,
    private readonly shop: ShopService,
    @InjectRepository(ShopOffer) private readonly offerRepo: Repository<ShopOffer>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  /** Platz eines per Use erworbenen Knotens in den eigenen Notebooks. */
  static mirrorKey(offerId: string) {
    return `offer:${offerId}`;
  }

  // ---- Lesen ----

  /**
   * Die ganze Struktur samt Themen. Beim ersten Aufruf entsteht sie aus den
   * Themengebieten; danach kommen neue Themen unter „Unsortiert“ bzw. neu
   * erworbene in das Book „Erworben“, und verschwundene fallen heraus.
   */
  async tree(user: any) {
    const [ownBare, granted, usable] = await Promise.all([
      this.topicRepo.find({ where: { ownerId: user.userId } }),
      this.topics.findGranted(user),
      this.topics.findUsable(user),
    ]);
    const visible = new Map(usable.filter((t: any) => !t.isOwn).map((t: any) => [t.id, t.modules || []]));
    const allGranted = granted.map((g: any) => ({ ...g, isOwn: false, modules: visible.get(g.id) || [] }));
    // Was über ein Recht an einem Book, Bereich oder Abschnitt kommt, steht
    // in dessen Spiegel; einzeln eingeordnet wird nur der Rest.
    const grantedTopics = allGranted.filter((t: any) => t.grants.some((g: any) => g.scopeType !== 'node'));
    const mirrors = await this.mirrors(user, allGranted);

    await this.ensureInitialized(user, ownBare);
    await this.syncPlacements(user, ownBare.map((t) => t.id), [
      ...grantedTopics.map((t: any) => t.id),
      ...mirrors.map((m) => NotebooksService.mirrorKey(m.offerId)),
    ]);
    await this.applyInheritance(user);
    // Erst jetzt laden – die geerbten Tags sollen schon dran sein.
    const own = await this.topics.findAll(user);

    const [nodes, placements] = await Promise.all([
      this.nodeRepo.find({ where: { ownerId: user.userId }, order: { orderIndex: 'ASC' } }),
      this.placeRepo.find({ where: { ownerId: user.userId }, order: { orderIndex: 'ASC' } }),
    ]);
    return {
      nodes: nodes.map(({ id, kind, title, parentId, orderIndex, tagIds }) => ({ id, kind, title, parentId, orderIndex, tagIds: tagIds || [] })),
      placements: placements.map(({ topicId, nodeId, orderIndex, inheritedTagIds }) => ({ topicId, nodeId, orderIndex, inheritedTagIds: inheritedTagIds || [] })),
      topics: own.map((t: any) => ({ ...t, isOwn: true })),
      granted: grantedTopics,
      mirrors,
    };
  }

  /**
   * Spiegel der per Use erworbenen Books, Bereiche und Abschnitte: die
   * Struktur des Anbieters, wie sie jetzt ist, mit den Lernthemen, die das
   * Recht umfasst. Schreibgeschützt; als Ganzes lässt er sich einsortieren.
   */
  private async mirrors(user: any, granted: any[]) {
    const entries: GrantEntry[] = await this.shop.expandGrants(user.userId);
    const byOffer = new Map<string, GrantEntry[]>();
    for (const e of entries) {
      if (e.scopeType !== 'node' || !e.offerId) continue;
      if (!byOffer.has(e.offerId)) byOffer.set(e.offerId, []);
      byOffer.get(e.offerId)!.push(e);
    }
    // Auch ein Recht, das gerade nichts umfasst (leerer Bereich), soll sichtbar bleiben.
    const grantRows = await this.shop.grantsOf(user.userId);
    for (const g of grantRows) if (g.scopeType === 'node' && g.offerId && !byOffer.has(g.offerId)) byOffer.set(g.offerId, []);
    if (!byOffer.size) return [];

    const offers = await this.offerRepo.find({ where: { id: In([...byOffer.keys()]) } });
    const topicById = new Map(granted.map((t) => [t.id, t]));
    const out: any[] = [];
    for (const offer of offers) {
      const [nodes, places, seller] = await Promise.all([
        this.nodeRepo.find({ where: { ownerId: offer.sellerId } }),
        this.placeRepo.find({ where: { ownerId: offer.sellerId } }),
        this.userRepo.findOne({ where: { id: offer.sellerId } }),
      ]);
      const root = nodes.find((n) => n.id === offer.nodeId);
      if (!root) continue;
      const ids = subtreeIds(nodes, root.id);
      const topicIds = new Set((byOffer.get(offer.id) || []).map((e) => e.topicId));
      const myGrants = grantRows.filter((g) => g.offerId === offer.id);
      out.push({
        offerId: offer.id,
        title: root.title,
        kind: root.kind,
        sellerName: seller ? seller.displayName || seller.email : 'Unbekannt',
        onlyForeign: myGrants.every((g) => g.onlyForeign),
        grants: myGrants.map((g) => ({
          id: g.id, pricePaid: g.pricePaid, onlyForeign: g.onlyForeign,
        })),
        nodes: nodes.filter((n) => ids.has(n.id)).map(({ id, kind, title, parentId, orderIndex }) => ({
          id, kind, title, orderIndex, parentId: id === root.id ? null : parentId,
        })),
        placements: places.filter((p) => p.nodeId && ids.has(p.nodeId) && topicIds.has(p.topicId))
          .map(({ topicId, nodeId, orderIndex }) => ({ topicId, nodeId, orderIndex })),
        topics: [...topicIds].map((id) => topicById.get(id)).filter(Boolean),
      });
    }
    return out;
  }

  /**
   * Erstbefüllung aus den Tags (siehe initialStructure): Book je Themengebiet,
   * Bereich je Tag darunter. Book und Bereich tragen ihren Tag – so stimmt
   * die Vererbung von Anfang an.
   */
  private async ensureInitialized(user: any, own: LearningTopic[]) {
    const [nodeCount, placeCount] = await Promise.all([
      this.nodeRepo.count({ where: { ownerId: user.userId } }),
      this.placeRepo.count({ where: { ownerId: user.userId } }),
    ]);
    if (nodeCount > 0 || placeCount > 0 || own.length === 0) return;

    const { books, unsorted } = initialStructure(own, await this.tags.findAll(user));
    const nodes: NotebookNode[] = [];
    const places: NotebookPlacement[] = [];
    const node = (kind: NodeKind, title: string, parentId: string | null, orderIndex: number, tagId: string) => {
      const n = this.nodeRepo.create({ id: crypto.randomUUID(), ownerId: user.userId, kind, title, parentId, orderIndex, tagIds: [tagId] });
      nodes.push(n);
      return n;
    };
    books.forEach((book, i) => {
      const b = node('book', book.title, null, i, book.tagId);
      book.areas.forEach((area, j) => {
        const a = node('area', area.title, b.id, j, area.tagId);
        area.topicIds.forEach((topicId, k) => places.push(this.placement(user, topicId, a.id, k)));
      });
      book.topicIds.forEach((topicId, k) => places.push(this.placement(user, topicId, b.id, k)));
    });
    unsorted.forEach((topicId, j) => places.push(this.placement(user, topicId, null, j)));
    await this.nodeRepo.save(nodes);
    await this.placeRepo.save(places);
  }

  /**
   * Tags nach unten vererben: Jedes eigene Lernthema trägt die Tags aller
   * Knoten über ihm. Was es nur so trägt, steht am Platz – beim Umziehen
   * fällt genau das weg. Gespeichert wird nur, was sich ändert.
   */
  async applyInheritance(user: any) {
    const [nodes, places, tags] = await Promise.all([
      this.nodeRepo.find({ where: { ownerId: user.userId } }),
      this.placeRepo.find({ where: { ownerId: user.userId } }),
      this.tags.findAll(user),
    ]);
    if (!places.length) return;
    const known = new Set(tags.map((t: any) => t.id));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const wanted = new Map<string, string[]>();
    const chainTags = (nodeId: string | null): string[] => {
      if (!nodeId) return [];
      if (wanted.has(nodeId)) return wanted.get(nodeId)!;
      const node = byId.get(nodeId);
      const out = node ? [...chainTags(node.parentId), ...(node.tagIds || []).filter((id) => known.has(id))] : [];
      wanted.set(nodeId, [...new Set(out)]);
      return wanted.get(nodeId)!;
    };

    const topics = await this.topicRepo.find({ where: { id: In(places.map((p) => p.topicId)), ownerId: user.userId } });
    const topicById = new Map(topics.map((t) => [t.id, t]));
    const same = (a: string[] | null | undefined, b: string[] | null | undefined) =>
      JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

    const changedPlaces: NotebookPlacement[] = [];
    for (const place of places) {
      const topic = topicById.get(place.topicId);
      if (!topic) continue;
      const r = inheritTags(topic.tagIds, place.inheritedTagIds, chainTags(place.nodeId));
      if (!same(r.tagIds, topic.tagIds)) {
        await this.topicRepo.createQueryBuilder().update().set({ tagIds: r.tagIds as any }).where('id = :id', { id: topic.id }).updateEntity(false).execute();
      }
      if (!same(r.inherited, place.inheritedTagIds)) {
        place.inheritedTagIds = r.inherited;
        changedPlaces.push(place);
      }
    }
    if (changedPlaces.length) await this.placeRepo.save(changedPlaces);
  }

  /** Plätze an die zugänglichen Themen anpassen. */
  private async syncPlacements(user: any, ownIds: string[], grantedIds: string[]) {
    const places = await this.placeRepo.find({ where: { ownerId: user.userId } });
    const reachable = new Set([...ownIds, ...grantedIds]);
    const gone = places.filter((p) => !reachable.has(p.topicId));
    if (gone.length) await this.placeRepo.remove(gone);

    const placed = new Set(places.map((p) => p.topicId));
    const newOwn = ownIds.filter((id) => !placed.has(id));
    const newGranted = grantedIds.filter((id) => !placed.has(id));
    if (!newOwn.length && !newGranted.length) return;

    const fresh: NotebookPlacement[] = [];
    // Neue eigene Themen stehen oben in „Unsortiert“ – dort sucht man sie zuerst.
    newOwn.forEach((id, i) => fresh.push(this.placement(user, id, null, i - newOwn.length)));
    if (newGranted.length) {
      const book = await this.acquiredBook(user);
      const count = places.filter((p) => p.nodeId === book.id).length;
      newGranted.forEach((id, i) => fresh.push(this.placement(user, id, book.id, count + i)));
    }
    await this.placeRepo.save(fresh);
  }

  private async acquiredBook(user: any): Promise<NotebookNode> {
    const found = await this.nodeRepo.findOne({ where: { ownerId: user.userId, kind: 'book', title: ACQUIRED_BOOK, parentId: null as any } });
    if (found) return found;
    const count = await this.nodeRepo.count({ where: { ownerId: user.userId, kind: 'book' } });
    return this.nodeRepo.save(this.nodeRepo.create({
      id: crypto.randomUUID(), ownerId: user.userId, kind: 'book', title: ACQUIRED_BOOK, parentId: null, orderIndex: count,
    }));
  }

  private placement(user: any, topicId: string, nodeId: string | null, orderIndex: number) {
    return this.placeRepo.create({ id: crypto.randomUUID(), ownerId: user.userId, topicId, nodeId, orderIndex });
  }

  // ---- Knoten ----

  private cleanTitle(title: any): string {
    const clean = String(title ?? '').trim().slice(0, MAX_TITLE);
    if (!clean) throw new BadRequestException('Bitte einen Namen eingeben.');
    return clean;
  }

  private async ownNode(id: string, user: any): Promise<NotebookNode> {
    const node = id ? await this.nodeRepo.findOne({ where: { id } }) : null;
    if (!node || node.ownerId !== user.userId) throw new NotFoundException('Eintrag nicht gefunden.');
    return node;
  }

  private async parentOrNull(parentId: any, user: any): Promise<NotebookNode | null> {
    return parentId ? this.ownNode(String(parentId), user) : null;
  }

  private placeError(kind: NodeKind, parent: NotebookNode | null): string {
    if (kind === 'book') return 'Ein Book steht immer ganz oben.';
    if (!parent) return `Ein ${KIND_LABEL[kind]} gehört in ein Book${kind === 'section' ? ' oder einen Bereich' : ''}.`;
    return `Ein ${KIND_LABEL[kind]} passt nicht in ${parent.kind === 'section' ? 'einen Abschnitt' : parent.kind === 'area' ? 'einen Bereich' : 'ein Book'}.`;
  }

  async createNode(user: any, body: { kind?: string; title?: string; parentId?: string | null; tagIds?: string[] }) {
    const kind = String(body?.kind || '') as NodeKind;
    if (!NODE_KINDS.includes(kind)) throw new BadRequestException('Unbekannte Art.');
    const parent = await this.parentOrNull(body?.parentId, user);
    if (!canHoldNode(parent?.kind ?? null, kind)) throw new BadRequestException(this.placeError(kind, parent));
    const count = await this.nodeRepo.count({ where: { ownerId: user.userId, parentId: (parent?.id ?? null) as any } });
    const node = await this.nodeRepo.save(this.nodeRepo.create({
      id: crypto.randomUUID(), ownerId: user.userId, kind, title: this.cleanTitle(body?.title), parentId: parent?.id ?? null, orderIndex: count,
      tagIds: await this.tags.sanitizeIds(user, body?.tagIds || []),
    }));
    return { id: node.id, kind: node.kind, title: node.title, parentId: node.parentId, orderIndex: node.orderIndex, tagIds: node.tagIds };
  }

  /** Name und/oder Tags ändern. Neue Tags gelten sofort für alle Lernthemen darunter. */
  async updateNode(id: string, user: any, body: { title?: string; tagIds?: string[] }) {
    const node = await this.ownNode(id, user);
    if (body?.title !== undefined) node.title = this.cleanTitle(body.title);
    if (body?.tagIds !== undefined) node.tagIds = await this.tags.sanitizeIds(user, body.tagIds);
    await this.nodeRepo.save(node);
    if (body?.tagIds !== undefined) await this.applyInheritance(user);
    return { success: true };
  }

  /**
   * Löscht den Knoten samt Unterknoten. Lernthemen werden dabei nie
   * gelöscht: Sie rücken in den übergeordneten Knoten (bei einem Book nach
   * „Unsortiert“).
   */
  async deleteNode(id: string, user: any) {
    const node = await this.ownNode(id, user);
    const all = await this.nodeRepo.find({ where: { ownerId: user.userId } });
    const ids = subtreeIds(all, node.id);
    const target = node.parentId;
    const [moving, already] = await Promise.all([
      this.placeRepo.find({ where: { ownerId: user.userId, nodeId: In([...ids]) }, order: { orderIndex: 'ASC' } }),
      this.placeRepo.count({ where: { ownerId: user.userId, nodeId: (target ?? null) as any } }),
    ]);
    // Angebote für diese Knoten werden zu festen Auswahlen mit dem, was jetzt
    // darin liegt – Gekauftes bleibt. Deshalb vor dem Umräumen.
    await this.shop.freezeNodeOffers([...ids]);
    moving.forEach((p, i) => { p.nodeId = target; p.orderIndex = already + i; });
    if (moving.length) await this.placeRepo.save(moving);
    await this.nodeRepo.delete({ id: In([...ids]) });
    await this.applyInheritance(user);
    return { success: true, movedTopics: moving.length };
  }

  // ---- Verschieben ----

  /**
   * Knoten oder Lernthema an einen neuen Platz: `parentId` (null = oben bzw.
   * „Unsortiert“) und Position `index` unter den Geschwistern.
   */
  async move(user: any, body: { type?: string; id?: string; parentId?: string | null; index?: number | null }) {
    const parent = await this.parentOrNull(body?.parentId, user);
    const parentId = parent?.id ?? null;
    const index = Number.isInteger(body?.index) ? Number(body.index) : null;

    if (body?.type === 'node') {
      const node = await this.ownNode(String(body.id || ''), user);
      if (!canHoldNode(parent?.kind ?? null, node.kind)) throw new BadRequestException(this.placeError(node.kind, parent));
      const all = await this.nodeRepo.find({ where: { ownerId: user.userId } });
      if (parentId && subtreeIds(all, node.id).has(parentId)) throw new BadRequestException('Ein Eintrag kann nicht in sich selbst liegen.');
      const previousParent = node.parentId;
      node.parentId = parentId;
      const siblings = all.filter((n) => n.parentId === parentId && n.id !== node.id).sort((a, b) => a.orderIndex - b.orderIndex);
      const order = insertAt(siblings.map((n) => n.id), node.id, index);
      const byId = new Map([...siblings, node].map((n) => [n.id, n]));
      order.forEach((id, i) => { byId.get(id)!.orderIndex = i; });
      await this.nodeRepo.save([...byId.values()]);
      if (parentId !== previousParent) await this.applyInheritance(user);
      return { success: true };
    }

    if (body?.type === 'topic') {
      const topicId = String(body.id || '');
      const places = await this.placeRepo.find({ where: { ownerId: user.userId } });
      let place = places.find((p) => p.topicId === topicId);
      if (!place) {
        // Frisch angelegt oder importiert, noch ohne Platz: zugänglich muss es sein.
        const topic = await this.topics.findOneFor(topicId, user, 'read');
        place = this.placement(user, topic.id, null, 0);
      }
      const previousNode = place.nodeId;
      place.nodeId = parentId;
      const siblings = places.filter((p) => p.nodeId === parentId && p.topicId !== topicId).sort((a, b) => a.orderIndex - b.orderIndex);
      const order = insertAt(siblings.map((p) => p.topicId), topicId, index);
      const byTopic = new Map([...siblings, place].map((p) => [p.topicId, p]));
      order.forEach((id, i) => { byTopic.get(id)!.orderIndex = i; });
      await this.placeRepo.save([...byTopic.values()]);
      if (previousNode !== parentId || !place.inheritedTagIds) await this.applyInheritance(user);
      return { success: true };
    }

    throw new BadRequestException('Unbekannte Art.');
  }

  // ---- Kopieren ----

  /**
   * Eigene Kopie eines eigenen Lernthemas mit allen Modulen, direkt hinter
   * dem Original. Creator und Herkunft bleiben, wie sie sind – eine Kopie im
   * eigenen Konto macht niemanden zum Verfasser fremder Module.
   */
  async copyTopic(user: any, topicId: string, title?: string) {
    const source = await this.topicRepo.findOne({ where: { id: topicId }, relations: ['modules'] });
    if (!source || source.ownerId !== user.userId) {
      throw new ForbiddenException('Kopieren lassen sich nur eigene Lernthemen. Für fremde gibt es im Shop eine Kopie.');
    }
    const copy = await this.duplicateTopic(source, user, title || `${source.title} (Kopie)`);
    const place = await this.placeRepo.findOne({ where: { ownerId: user.userId, topicId } });
    await this.move(user, { type: 'topic', id: copy.id, parentId: place?.nodeId ?? null, index: place ? place.orderIndex + 1 : 0 });
    return { success: true, topicId: copy.id };
  }

  private async duplicateTopic(source: LearningTopic, user: any, title: string): Promise<LearningTopic> {
    const {
      id: _id, modules: _m, createdAt: _c, updatedAt: _u, quickToken: _q, subscribeKey: _k, accessPassword: _p, ...rest
    } = source as any;
    const topic: LearningTopic = await this.topicRepo.save(this.topicRepo.create({
      ...(rest as Partial<LearningTopic>),
      id: crypto.randomUUID(),
      title,
      ownerId: user.userId,
      // Eine Kopie startet gesperrt – freigeben ist eine bewusste Entscheidung.
      selected: false,
      visibility: 'locked',
    }));
    const idMap = new Map<string, string>();
    for (const m of source.modules || []) idMap.set(m.id, crypto.randomUUID());
    const modules = (source.modules || []).map((m) => {
      const { id, topic: _t, subModules: _s, parent: _pa, createdAt: _ca, updatedAt: _ua, ...data } = m as any;
      return Object.assign(new LearningModule(), {
        ...data,
        id: idMap.get(id),
        topicId: topic.id,
        parentId: m.parentId ? idMap.get(m.parentId) || null : null,
        originId: m.originId || m.id,
      });
    });
    if (modules.length) await this.moduleRepo.save(modules);
    return topic;
  }

  /**
   * Knoten samt Unterknoten kopieren, direkt hinter das Original. Eigene
   * Lernthemen werden mitkopiert; Themen mit Nutzungsrecht nicht – sie gehören
   * jemand anderem und haben je Lehrkraft nur einen Platz.
   */
  async copyNode(id: string, user: any) {
    const root = await this.ownNode(id, user);
    const [all, places] = await Promise.all([
      this.nodeRepo.find({ where: { ownerId: user.userId } }),
      this.placeRepo.find({ where: { ownerId: user.userId } }),
    ]);
    let copied = 0;
    const skipped: string[] = [];

    const copyInto = async (node: NotebookNode, parentId: string | null, title: string, orderIndex: number) => {
      const clone = await this.nodeRepo.save(this.nodeRepo.create({
        id: crypto.randomUUID(), ownerId: user.userId, kind: node.kind, title, parentId, orderIndex, tagIds: node.tagIds,
      }));
      const topicPlaces = places.filter((p) => p.nodeId === node.id).sort((a, b) => a.orderIndex - b.orderIndex);
      let i = 0;
      for (const p of topicPlaces) {
        const topic = await this.topicRepo.findOne({ where: { id: p.topicId }, relations: ['modules'] });
        if (!topic) continue;
        if (topic.ownerId !== user.userId) { skipped.push(topic.title); continue; }
        const dup = await this.duplicateTopic(topic, user, topic.title);
        await this.placeRepo.save(this.placement(user, dup.id, clone.id, i++));
        copied++;
      }
      const kids = all.filter((n) => n.parentId === node.id).sort((a, b) => a.orderIndex - b.orderIndex);
      for (let k = 0; k < kids.length; k++) await copyInto(kids[k], clone.id, kids[k].title, k);
      return clone;
    };

    const clone = await copyInto(root, root.parentId, `${root.title} (Kopie)`, root.orderIndex + 1);
    await this.move(user, { type: 'node', id: clone.id, parentId: root.parentId, index: root.orderIndex + 1 });
    await this.applyInheritance(user);
    return { success: true, id: clone.id, copiedTopics: copied, skipped };
  }

  // ---- Inhalt eines Knotens ----

  /** Themen-IDs im Teilbaum, in der Reihenfolge der Anzeige. */
  private async topicIdsBelow(node: NotebookNode, user: any): Promise<string[]> {
    const [all, places] = await Promise.all([
      this.nodeRepo.find({ where: { ownerId: user.userId } }),
      this.placeRepo.find({ where: { ownerId: user.userId } }),
    ]);
    const out: string[] = [];
    const walk = (id: string) => {
      places.filter((p) => p.nodeId === id).sort((a, b) => a.orderIndex - b.orderIndex).forEach((p) => out.push(p.topicId));
      all.filter((n) => n.parentId === id).sort((a, b) => a.orderIndex - b.orderIndex).forEach((n) => walk(n.id));
    };
    walk(node.id);
    return out;
  }

  /** Alle eigenen Lernthemen im Knoten für Schüler freigeben bzw. sperren. */
  async setSelected(id: string, user: any, selected: boolean) {
    const node = await this.ownNode(id, user);
    const ids = await this.topicIdsBelow(node, user);
    const own = ids.length ? await this.topicRepo.find({ where: { id: In(ids), ownerId: user.userId } }) : [];
    let changed = 0;
    for (const topic of own) {
      if (!!topic.selected === selected) continue;
      await this.topics.update(topic.id, user, { selected });
      changed++;
    }
    return { success: true, changed };
  }

  /**
   * Quick-Link für einen Knoten: ein Klassenlink mit allen startbaren
   * Lernthemen darin. Eigene, nicht freigegebene Themen bleiben draußen –
   * die Antwort nennt sie, damit nichts unbemerkt fehlt.
   */
  async quickLink(id: string, user: any, classId: string, req?: any) {
    let node: { id: string; title: string };
    let below: string[];
    if (id.startsWith('offer:')) {
      // Spiegel eines erworbenen Bereichs: alles, was das Recht jetzt umfasst.
      const offerId = id.slice('offer:'.length);
      const entries = (await this.shop.expandGrants(user.userId)).filter((e) => e.offerId === offerId);
      if (!entries.length) throw new NotFoundException('Eintrag nicht gefunden.');
      const offer = await this.offerRepo.findOne({ where: { id: offerId } });
      const root = offer?.nodeId ? await this.nodeRepo.findOne({ where: { id: offer.nodeId } }) : null;
      node = { id, title: root?.title || 'Erworben' };
      below = [...new Set(entries.map((e) => e.topicId))];
    } else {
      const own = await this.ownNode(id, user);
      node = own;
      below = await this.topicIdsBelow(own, user);
    }
    const ids: string[] = [];
    for (const t of below) {
      if (!t.startsWith('offer:')) { ids.push(t); continue; }
      // Ein erworbener Bereich im eigenen: seine Lernthemen gehören dazu.
      const offerId = t.slice('offer:'.length);
      (await this.shop.expandGrants(user.userId)).filter((e) => e.offerId === offerId).forEach((e) => ids.push(e.topicId));
    }
    const usable = await this.topics.findUsable(user);
    const byId = new Map(usable.map((t: any) => [t.id, t]));
    const included: string[] = [];
    const notReleased: string[] = [];
    for (const topicId of ids) {
      const topic: any = byId.get(topicId);
      if (!topic) continue;
      const active = (topic.modules || []).some((m: any) => m.moduleSelected !== false);
      if (!active) continue;
      if (topic.isOwn && !topic.selected) { notReleased.push(topic.title); continue; }
      included.push(topicId);
    }
    if (!included.length) {
      throw new BadRequestException(notReleased.length
        ? `Darin ist kein freigegebenes Lernthema. Nicht freigegeben: ${notReleased.join(', ')}.`
        : 'Darin ist kein Lernthema mit freigegebenen Modulen.');
    }
    const link = await this.links.classLinkForNode(node, included, String(classId || ''), user, req);
    return { ...link, includedCount: included.length, notReleased };
  }

  // ---- Download und Import ----

  /**
   * Knoten als ZIP: `notebook.json` mit der Struktur, je Lernthema der
   * gewohnte JSON-Export. Es gelten dieselben Grenzen wie dort – nur selbst
   * verfasste Module. Themen ohne eigene Module und Themen mit Nutzungsrecht
   * fehlen; `notebook.json` und die Antwort nennen sie.
   */
  async exportNode(id: string, user: any) {
    const root = await this.ownNode(id, user);
    const [all, places, tags] = await Promise.all([
      this.nodeRepo.find({ where: { ownerId: user.userId } }),
      this.placeRepo.find({ where: { ownerId: user.userId } }),
      this.tags.findAll(user),
    ]);
    const tagName = new Map(tags.map((t: any) => [t.id, t.name]));
    const zip = new AdmZip();
    const skipped: string[] = [];
    let count = 0;
    const build = async (node: NotebookNode): Promise<ExportedNode> => {
      const out: ExportedNode = {
        kind: node.kind,
        title: node.title,
        tags: (node.tagIds || []).map((t) => tagName.get(t)).filter(Boolean) as string[],
        children: [],
        topics: [],
      };
      for (const p of places.filter((x) => x.nodeId === node.id).sort((a, b) => a.orderIndex - b.orderIndex)) {
        const topic = await this.topicRepo.findOne({ where: { id: p.topicId } });
        if (!topic) continue;
        if (topic.ownerId !== user.userId) { skipped.push(topic.title); continue; }
        let data: any;
        try {
          data = await this.exporter.exportJson(topic.id, user);
        } catch {
          skipped.push(topic.title);
          continue;
        }
        const name = entryName(++count, topic.title);
        zip.addFile(name, Buffer.from(JSON.stringify(data, null, 2), 'utf-8'));
        out.topics.push(name);
      }
      for (const kid of all.filter((n) => n.parentId === node.id).sort((a, b) => a.orderIndex - b.orderIndex)) {
        out.children.push(await build(kid));
      }
      return out;
    };
    const tree = await build(root);
    const structure = { format: NOTEBOOK_FORMAT, version: 1, exportedAt: new Date().toISOString(), node: tree, skipped };
    zip.addFile(STRUCTURE_FILE, Buffer.from(JSON.stringify(structure, null, 2), 'utf-8'));
    return { title: root.title, buffer: zip.toBuffer(), count, skipped };
  }

  /**
   * Notebook-Datei einlesen, in `parentId` (oder oben). Passt die Art nicht
   * an diese Stelle, wird ein Knoten oben zum Book – sonst gibt es eine
   * Meldung, wohin er gehört. Tags kommen über ihren Namen an, wenn es im
   * Konto einen gleichnamigen gibt.
   */
  async importNode(user: any, buffer: Buffer, parentId: string | null) {
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new BadRequestException('Die Datei ist kein gültiges ZIP.');
    }
    const entries = zip.getEntries();
    const total = entries.reduce((n, e) => n + (e.header.size || 0), 0);
    if (total > MAX_UNPACKED) throw new BadRequestException('Die Datei ist entpackt zu groß.');
    const read = (name: string): any => {
      const entry = zip.getEntry(name);
      if (!entry || entry.isDirectory) return null;
      try { return JSON.parse(entry.getData().toString('utf-8')); } catch { return null; }
    };
    const data = read(STRUCTURE_FILE);
    if (!data || data.format !== NOTEBOOK_FORMAT || !data.node) {
      throw new BadRequestException('Das ist keine Notebook-Datei (notebook.json fehlt oder ist beschädigt).');
    }

    const parent = await this.parentOrNull(parentId, user);
    let kind = data.node.kind as NodeKind;
    if (!NODE_KINDS.includes(kind)) throw new BadRequestException('Die Datei ist beschädigt (unbekannte Art).');
    if (!canHoldNode(parent?.kind ?? null, kind)) {
      if (!parent) kind = 'book';
      else throw new BadRequestException(`${this.placeError(kind, parent)} Bitte an passender Stelle einlesen.`);
    }

    const myTags = await this.tags.findAll(user);
    const tagByName = new Map(myTags.map((t: any) => [String(t.name).toLowerCase(), t.id]));
    const tagIdsOf = (names: any) =>
      (Array.isArray(names) ? names : []).map((n) => tagByName.get(String(n).toLowerCase())).filter(Boolean) as string[];

    let topics = 0;
    const failed: string[] = [];
    const create = async (src: any, kindHere: NodeKind, parentHere: string | null, orderIndex: number) => {
      const node = await this.nodeRepo.save(this.nodeRepo.create({
        id: crypto.randomUUID(), ownerId: user.userId, kind: kindHere, title: this.cleanTitle(src.title || KIND_LABEL[kindHere]),
        parentId: parentHere, orderIndex, tagIds: tagIdsOf(src.tags),
      }));
      let i = 0;
      for (const name of Array.isArray(src.topics) ? src.topics : []) {
        const topicData = typeof name === 'string' ? read(name) : null;
        try {
          if (!topicData) throw new Error('fehlt');
          const res = await this.importer.importTopicFromJson(JSON.stringify(topicData), user);
          await this.placeRepo.save(this.placement(user, res.topicId, node.id, i++));
          topics++;
        } catch {
          failed.push(String(topicData?.topic?.title || name));
        }
      }
      const kids = Array.isArray(src.children) ? src.children : [];
      for (let k = 0; k < kids.length; k++) {
        const kidKind = kids[k]?.kind as NodeKind;
        if (!NODE_KINDS.includes(kidKind) || !canHoldNode(kindHere, kidKind)) continue;
        await create(kids[k], kidKind, node.id, k);
      }
      return node;
    };
    const count = await this.nodeRepo.count({ where: { ownerId: user.userId, parentId: (parent?.id ?? null) as any } });
    const node = await create(data.node, kind, parent?.id ?? null, count);
    await this.applyInheritance(user);
    return { success: true, id: node.id, title: node.title, importedTopics: topics, failed };
  }
}
