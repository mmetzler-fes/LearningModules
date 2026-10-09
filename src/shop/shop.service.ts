import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ShopOffer, OfferScope } from '../core/entities/shop-offer.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { User } from '../core/entities/user.entity';
import { TeacherGroup } from '../core/entities/teacher-group.entity';
import { PointsService } from '../accounts/points.service';
import { groupIdOf } from '../groups/group-ref';
import { offerRoots, splitPrice, visibleFor, withSubmodules } from './offer-rules';

/** Ein Lernthema mit dem, was ein Angebot davon umfasst. */
export interface Covered {
  topic: LearningTopic;
  /** Elternmodule im Angebot */
  roots: LearningModule[];
  /** samt Untermodulen */
  modules: LearningModule[];
}

/** Ein Nutzungsrecht, aufgelöst auf ein Lernthema (siehe expandGrants). */
export interface GrantEntry {
  topicId: string;
  scope: 'creator' | 'all' | 'list';
  creatorId: string | null;
  moduleIds?: string[];
  grantId: string;
  offerId: string | null;
  pricePaid: number;
  createdAt: Date;
  scopeType: OfferScope;
  onlyForeign: boolean;
}

/** Book in den Notebooks des Käufers für Erworbenes (wie NotebooksService). */
const ACQUIRED_BOOK = 'Erworben';

const MAX_PRICE = 100000;

/**
 * Der Lernmodule-Shop: Jede Weitergabe von Inhalten läuft hierüber.
 *
 * Rechte je Modul (siehe docs/shop-und-rechte.md):
 *   Creator – hat das Modul verfasst. Nur er bietet es im Shop an, zum
 *             Kopieren und/oder Verwenden, gegen Punkte oder frei.
 *   Owner   – das Thema gehört ihm (eigene Kopie) oder er hat ein
 *             Nutzungsrecht darauf.
 *   Buyer   – hat eine Kopie erworben. Darf sie bearbeiten und die fremden
 *             Module darin im Shop zur Nutzung anbieten (nicht zum Kopieren).
 *
 * Ein Angebot umfasst ein Lernthema, einen Notebook-Knoten oder eine Auswahl
 * von Modulen (siehe offer-rules.ts). Punkte gehen anteilig an die Creator.
 */
/** Tage nach dem Kauf, in denen ein bezahltes Nutzungsrecht mit Erstattung zurückgegeben werden kann. */
export const REFUND_DAYS = 14;

@Injectable()
export class ShopService {
  constructor(
    @InjectRepository(ShopOffer) private readonly offerRepo: Repository<ShopOffer>,
    @InjectRepository(UseGrant) private readonly grantRepo: Repository<UseGrant>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(TeacherGroup) private readonly groupRepo: Repository<TeacherGroup>,
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    @InjectRepository(NotebookPlacement) private readonly placeRepo: Repository<NotebookPlacement>,
    private readonly points: PointsService,
    private readonly dataSource: DataSource,
  ) {}

  // ---- Hilfen ----

  private async names(): Promise<Map<string, User>> {
    const users = await this.userRepo.find();
    return new Map(users.map((u) => [u.id, u]));
  }

  private label(u: User | undefined) {
    return u ? u.displayName || u.email : 'Unbekannt';
  }

  /** Sieht dieser Benutzer das Angebot? Gruppen zählen über `user.groupIds`. */
  private visibleTo(offer: ShopOffer, user: any): boolean {
    const audience = Array.isArray(offer.audience) ? offer.audience : [];
    if (audience.includes('*') || audience.includes(user.userId)) return true;
    const groupIds: string[] = Array.isArray(user.groupIds) ? user.groupIds : [];
    return audience.some((entry) => {
      const gid = groupIdOf(entry);
      return gid ? groupIds.includes(gid) : false;
    });
  }

  /** Die Personen hinter einer Zielgruppe (ohne '*'). */
  private async expand(audience: string[]): Promise<Set<string>> {
    const out = new Set(audience.filter((e) => e !== '*' && !groupIdOf(e)));
    const groupIds = audience.map(groupIdOf).filter(Boolean) as string[];
    if (groupIds.length) {
      const groups = await this.groupRepo.find({ where: { id: In(groupIds) } });
      for (const g of groups) for (const m of g.memberIds || []) out.add(m);
    }
    return out;
  }

  /** Nur bekannte Personen und Gruppen; '*' schlägt jede Einzelauswahl. */
  private async cleanAudience(input: any, allowAll: boolean): Promise<string[]> {
    const raw = Array.isArray(input) ? [...new Set(input.map(String).filter(Boolean))] : [];
    if (raw.includes('*')) {
      if (!allowAll) throw new BadRequestException('Eine Weitergabe an alle ist hier nicht möglich – bitte Personen oder Gruppen wählen.');
      return ['*'];
    }
    const users = await this.userRepo.find();
    const groups = await this.groupRepo.find();
    const userIds = new Set(users.filter((u) => u.active !== false).map((u) => u.id));
    const groupRefs = new Set(groups.map((g) => `group:${g.id}`));
    return raw.filter((e) => userIds.has(e) || groupRefs.has(e));
  }

  private price(v: any, field: string): number {
    const n = Number(v ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > MAX_PRICE) {
      throw new BadRequestException(`${field}: bitte eine ganze Zahl zwischen 0 und ${MAX_PRICE}.`);
    }
    return n;
  }

  /** Thema laden, das dem Benutzer wirklich gehört – Admin-Rechte zählen hier nicht. */
  private async ownTopic(topicId: string, user: any) {
    const topic = await this.topicRepo.findOne({ where: { id: topicId }, relations: ['modules'] });
    if (!topic) throw new NotFoundException('Thema nicht gefunden.');
    if (topic.ownerId !== user.userId) {
      throw new ForbiddenException('Anbieten kann nur, wem das Thema gehört.');
    }
    return topic;
  }

  // ---- Umfang eines Angebots ----

  /**
   * Was ein Angebot gerade umfasst: je Lernthema des Anbieters die
   * Elternmodule und alle Module samt Untermodulen. Bei einem Knoten zählt,
   * was jetzt darin liegt – das Angebot wächst mit. Nur Themen, die dem
   * Anbieter gehören; Themen, die er selbst nur nutzt, gibt er nicht weiter.
   */
  async coverage(offer: ShopOffer, opts: { onlyForeign?: boolean } = {}): Promise<Covered[]> {
    let topicIds: string[] = [];
    let onlyIds: Set<string> | null = null;
    if (offer.scopeType === 'node') {
      topicIds = await this.topicsInNode(offer.sellerId, offer.nodeId);
    } else if (offer.scopeType === 'modules') {
      onlyIds = new Set(offer.moduleIds || []);
      if (!onlyIds.size) return [];
      const picked = await this.moduleRepo.find({ where: { id: In([...onlyIds]) }, select: ['id', 'topicId'] });
      topicIds = [...new Set(picked.map((m) => m.topicId))];
    } else if (offer.topicId) {
      topicIds = [offer.topicId];
    }
    if (!topicIds.length) return [];

    const topics = await this.topicRepo.find({ where: { id: In(topicIds), ownerId: offer.sellerId } });
    const byId = new Map(topics.map((t) => [t.id, t]));
    const modules = await this.moduleRepo.find({ where: { topicId: In(topics.map((t) => t.id)) }, order: { orderIndex: 'ASC' } });
    const includeForeign = offer.kind === 'buyer' || !!offer.includeForeign;

    const out: Covered[] = [];
    for (const id of topicIds) {
      const topic = byId.get(id);
      if (!topic) continue;
      const own = modules.filter((m) => m.topicId === id);
      const roots = offerRoots(own, offer.sellerId, { includeForeign, onlyForeign: opts.onlyForeign, onlyIds });
      if (!roots.length) continue;
      out.push({ topic, roots, modules: withSubmodules(own, new Set(roots.map((r) => r.id))) });
    }
    return out;
  }

  /** Eigene Lernthemen im Teilbaum eines Knotens, in der Reihenfolge der Notebooks. */
  private async topicsInNode(sellerId: string, nodeId: string | null): Promise<string[]> {
    if (!nodeId) return [];
    const [nodes, places] = await Promise.all([
      this.nodeRepo.find({ where: { ownerId: sellerId } }),
      this.placeRepo.find({ where: { ownerId: sellerId } }),
    ]);
    if (!nodes.some((n) => n.id === nodeId)) return [];
    const out: string[] = [];
    const walk = (id: string) => {
      places.filter((p) => p.nodeId === id).sort((a, b) => a.orderIndex - b.orderIndex).forEach((p) => out.push(p.topicId));
      nodes.filter((n) => n.parentId === id).sort((a, b) => a.orderIndex - b.orderIndex).forEach((n) => walk(n.id));
    };
    walk(nodeId);
    return out;
  }

  /** Anzeigename eines Angebots: Auswahl-Titel, Knoten oder Lernthema. */
  private async offerTitle(offer: ShopOffer, covered?: Covered[]): Promise<string> {
    if (offer.scopeType === 'modules') return offer.title || 'Auswahl von Modulen';
    if (offer.scopeType === 'node') {
      const node = offer.nodeId ? await this.nodeRepo.findOne({ where: { id: offer.nodeId } }) : null;
      return node?.title || offer.title || 'Bereich';
    }
    const topic = covered?.[0]?.topic || (await this.topicRepo.findOne({ where: { id: offer.topicId } }));
    return topic?.title || offer.title || 'Lernthema';
  }

  private async nodeKind(offer: ShopOffer): Promise<string | null> {
    if (offer.scopeType !== 'node' || !offer.nodeId) return null;
    return (await this.nodeRepo.findOne({ where: { id: offer.nodeId } }))?.kind || null;
  }

  /**
   * Nutzungsrechte eines Benutzers, aufgelöst nach Lernthemen – die Form, in
   * der `accessLevel()` und `visibleModules()` sie lesen (`req.user.grants`).
   *
   *   scope 'all'     – alle Module des Themas
   *   scope 'creator' – die Module von `creatorId` (ältere Angebote)
   *   scope 'list'    – genau `moduleIds` (Elternmodule; Untermodule kommen mit)
   */
  async expandGrants(userId: string): Promise<GrantEntry[]> {
    if (!userId) return [];
    const grants = await this.grantRepo.find({ where: { userId } });
    if (!grants.length) return [];
    const offerIds = grants.map((g) => g.offerId).filter(Boolean) as string[];
    const offers = offerIds.length ? await this.offerRepo.find({ where: { id: In(offerIds) } }) : [];
    const byId = new Map(offers.map((o) => [o.id, o]));
    const out: GrantEntry[] = [];
    for (const g of grants) out.push(...(await this.expandGrant(g, g.offerId ? byId.get(g.offerId) : undefined)));
    return out;
  }

  /** Die Nutzungsrechte eines Benutzers mit der Art ihres Angebots (für die Notebooks). */
  async grantsOf(userId: string): Promise<Array<UseGrant & { scopeType: OfferScope }>> {
    const grants = await this.grantRepo.find({ where: { userId } });
    const offerIds = grants.map((g) => g.offerId).filter(Boolean) as string[];
    const offers = offerIds.length ? await this.offerRepo.find({ where: { id: In(offerIds) } }) : [];
    const byId = new Map(offers.map((o) => [o.id, o]));
    return grants.map((g) => Object.assign(g, { scopeType: (byId.get(g.offerId || '')?.scopeType || 'topic') as OfferScope }));
  }

  private async expandGrant(g: UseGrant, offer: ShopOffer | undefined): Promise<GrantEntry[]> {
    const base = {
      grantId: g.id, offerId: g.offerId, pricePaid: g.pricePaid, createdAt: g.createdAt,
      scopeType: (offer?.scopeType || 'topic') as OfferScope, onlyForeign: !!g.onlyForeign,
    };
    // Ältere Rechte ohne Angebot, und Angebote für ein Lernthema: ohne Auflösung.
    if (!offer) return [{ ...base, topicId: g.topicId, scope: g.scope, creatorId: g.creatorId }];
    if (offer.scopeType === 'topic' && !g.onlyForeign) {
      const all = offer.kind === 'buyer' || offer.includeForeign;
      return [{ ...base, topicId: offer.topicId || g.topicId, scope: all ? 'all' : 'creator', creatorId: offer.sellerId }];
    }
    const covered = await this.coverage(offer, { onlyForeign: g.onlyForeign });
    return covered.map((c) => ({ ...base, topicId: c.topic.id, scope: 'list' as const, creatorId: null, moduleIds: c.roots.map((r) => r.id) }));
  }

  /**
   * Für die Themenkarten des Anbieters: wie viele das Thema verwenden und
   * wie viele davon bezahlt haben – über alle seine Angebote.
   */
  async usageOfTopics(sellerId: string): Promise<Map<string, { users: Set<string>; paid: Set<string> }>> {
    const offers = await this.offerRepo.find({ where: { sellerId } });
    const out = new Map<string, { users: Set<string>; paid: Set<string> }>();
    if (!offers.length) return out;
    const grants = await this.grantRepo.find({ where: { offerId: In(offers.map((o) => o.id)) } });
    const byId = new Map(offers.map((o) => [o.id, o]));
    for (const g of grants) {
      for (const e of await this.expandGrant(g, byId.get(g.offerId || ''))) {
        if (!out.has(e.topicId)) out.set(e.topicId, { users: new Set(), paid: new Set() });
        out.get(e.topicId)!.users.add(g.userId);
        if (g.pricePaid > 0) out.get(e.topicId)!.paid.add(g.userId);
      }
    }
    return out;
  }

  // ---- Shop-Ansicht ----

  /**
   * Alle Angebote, die dieser Benutzer sieht: von anderen, aktiv, mit
   * mindestens einem Modul. Was ihm schon gehört, ist markiert.
   */
  async catalog(user: any) {
    const offers = (await this.offerRepo.find({ where: { active: true } })).filter(
      (o) => o.sellerId !== user.userId && this.visibleTo(o, user),
    );
    const users = await this.names();
    const myGrants = await this.grantRepo.find({ where: { userId: user.userId } });
    const topicIds = offers.filter((o) => o.scopeType === 'topic').map((o) => o.topicId);
    const myCopies = topicIds.length
      ? await this.topicRepo.find({ where: { ownerId: user.userId, copiedFromId: In(topicIds) } })
      : [];

    const out: any[] = [];
    for (const offer of offers) {
      const covered = await this.coverage(offer);
      // Eigene Themen des Käufers (etwa eine Weitergabe an den Creator) nicht anbieten.
      const mine = covered.filter((c) => c.topic.ownerId !== user.userId);
      const roots = mine.flatMap((c) => c.roots);
      if (!roots.length) continue;
      const seller = users.get(offer.sellerId);
      const own = roots.filter((m) => m.creatorId === offer.sellerId);
      const grant = myGrants.find((g) => g.offerId === offer.id);
      out.push({
        offerId: offer.id,
        kind: offer.kind,
        scopeType: offer.scopeType,
        nodeKind: await this.nodeKind(offer),
        topicId: offer.scopeType === 'topic' ? offer.topicId : null,
        title: await this.offerTitle(offer, mine),
        description: offer.scopeType === 'topic' ? mine[0]?.topic.description : '',
        topicCount: mine.length,
        sellerName: this.label(seller),
        sellerActive: seller ? seller.active !== false : false,
        creators: [...new Set(roots.map((m) => this.label(users.get(m.creatorId || ''))))],
        modules: mine.flatMap((c) => c.roots.map((m) => ({
          title: m.title, type: m.type, topicTitle: c.topic.title, own: m.creatorId === offer.sellerId,
        }))),
        ownCount: own.length,
        foreignCount: roots.length - own.length,
        // Kopieren geht nur mit eigenen Modulen des Anbieters.
        allowCopy: offer.allowCopy && own.length > 0,
        allowUse: offer.allowUse,
        priceCopy: offer.priceCopy,
        priceUse: offer.priceUse,
        // Für alle angeboten oder gezielt an mich bzw. meine Gruppe geteilt?
        sharedWithMe: !offer.audience.includes('*'),
        hasUse: !!grant && !grant.onlyForeign,
        copies: offer.scopeType === 'topic' ? myCopies.filter((c) => c.copiedFromId === offer.topicId).length : 0,
        updatedAt: offer.updatedAt,
      });
    }
    out.sort((a, b) => a.title.localeCompare(b.title, 'de'));
    const { minBalance } = await this.points.getSettings();
    return { balance: await this.points.balance(user.userId), minBalance, offers: out };
  }

  // ---- Anbieten ----

  /** Das Angebot zu einem Ziel (Thema oder Knoten) dieses Anbieters, falls es eins gibt. */
  private async offerFor(type: OfferScope, targetId: string, user: any): Promise<ShopOffer | null> {
    if (type === 'topic') return this.offerRepo.findOne({ where: { topicId: targetId, kind: 'creator', scopeType: 'topic' } });
    if (type === 'node') return this.offerRepo.findOne({ where: { nodeId: targetId, sellerId: user.userId, scopeType: 'node' } });
    const offer = await this.offerRepo.findOne({ where: { id: targetId } });
    return offer && offer.sellerId === user.userId && offer.scopeType === 'modules' ? offer : null;
  }

  /** Prüft, dass das Ziel dem Benutzer gehört; liefert ein vorläufiges Angebot für die Vorschau. */
  private async draftOffer(type: OfferScope, input: { topicId?: string; nodeId?: string; moduleIds?: string[] }, user: any) {
    const draft = this.offerRepo.create({ sellerId: user.userId, kind: 'creator', scopeType: type, includeForeign: true, topicId: '' });
    if (type === 'topic') {
      await this.ownTopic(String(input.topicId || ''), user);
      draft.topicId = String(input.topicId);
    } else if (type === 'node') {
      const node = await this.nodeRepo.findOne({ where: { id: String(input.nodeId || '') } });
      if (!node || node.ownerId !== user.userId) throw new NotFoundException('Book, Bereich oder Abschnitt nicht gefunden.');
      draft.nodeId = node.id;
    } else if (type === 'modules') {
      const ids = [...new Set((Array.isArray(input.moduleIds) ? input.moduleIds : []).map(String))];
      if (!ids.length) throw new BadRequestException('Bitte mindestens ein Modul auswählen.');
      const mods = await this.moduleRepo.find({ where: { id: In(ids) } });
      const topics = await this.topicRepo.find({ where: { id: In([...new Set(mods.map((m) => m.topicId))]) } });
      if (mods.length !== ids.length || topics.some((t) => t.ownerId !== user.userId)) {
        throw new ForbiddenException('Anbieten lassen sich nur Module aus eigenen Lernthemen.');
      }
      // Untermodule hängen an ihrem Elternmodul – gewählt werden Elternmodule.
      draft.moduleIds = [...new Set(mods.map((m) => m.parentId || m.id))];
    } else {
      throw new BadRequestException('Unbekannte Art des Angebots.');
    }
    return draft;
  }

  /**
   * Alles, was der Dialog „Im Shop anbieten“ braucht: Titel, eigene und
   * fremde Module, das bestehende Angebot mit seinen Inhabern.
   */
  async offerState(type: OfferScope, params: { id?: string; moduleIds?: string[] }, user: any) {
    let offer: ShopOffer | null = null;
    let draft: ShopOffer;
    if (type === 'modules' && params.id) {
      offer = await this.offerFor('modules', params.id, user);
      if (!offer) throw new NotFoundException('Angebot nicht gefunden.');
      draft = this.offerRepo.create({ ...offer, includeForeign: true });
    } else {
      draft = await this.draftOffer(type, { topicId: params.id, nodeId: params.id, moduleIds: params.moduleIds }, user);
      if (type !== 'modules') offer = await this.offerFor(type, params.id || '', user);
    }
    const covered = await this.coverage(draft);
    const roots = covered.flatMap((c) => c.roots);
    const users = await this.names();
    const legacy = type === 'topic' ? await this.offerRepo.findOne({ where: { topicId: params.id, kind: 'buyer' } }) : null;

    return {
      type,
      targetId: type === 'modules' ? offer?.id || null : params.id,
      topicId: type === 'topic' ? params.id : undefined,
      nodeId: type === 'node' ? params.id : undefined,
      moduleIds: draft.moduleIds || undefined,
      nodeKind: await this.nodeKind(draft),
      title: await this.offerTitle(offer || draft, covered),
      topicCount: covered.length,
      ownModules: roots.filter((m) => m.creatorId === user.userId).map((m) => m.title),
      foreignModules: roots.filter((m) => m.creatorId !== user.userId).map((m) => ({
        title: m.title,
        creatorName: this.label(users.get(m.creatorId || '')),
      })),
      copyCount: type === 'topic' ? await this.topicRepo.count({ where: { copiedFromId: params.id } }) : 0,
      offer: offer ? await this.describe(offer, users) : null,
      legacyShare: legacy ? await this.describe(legacy, users) : null,
    };
  }

  private async describe(offer: ShopOffer, users: Map<string, User>) {
    const grants = await this.grantRepo.find({ where: { offerId: offer.id } });
    return {
      id: offer.id,
      kind: offer.kind,
      title: offer.title,
      active: offer.active,
      allowCopy: offer.allowCopy,
      allowUse: offer.allowUse,
      priceCopy: offer.priceCopy,
      priceUse: offer.priceUse,
      includeForeign: offer.kind === 'buyer' || !!offer.includeForeign,
      audience: offer.audience,
      // Namen der eingetragenen Personen – auch aus anderen Schulen, die
      // die Auswahlliste selbst nicht zeigt. Sonst fielen sie beim
      // nächsten Speichern unbemerkt heraus.
      audienceUsers: (offer.audience || [])
        .filter((e) => users.has(e))
        .map((id) => ({ id, label: this.label(users.get(id)), email: users.get(id)!.email })),
      fromDeactivation: offer.fromDeactivation,
      holders: grants.filter((g) => !g.onlyForeign).map((g) => ({
        grantId: g.id,
        name: this.label(users.get(g.userId)),
        pricePaid: g.pricePaid,
        since: g.createdAt,
      })),
    };
  }

  /**
   * Angebot anlegen oder ändern – für ein Lernthema, einen Knoten oder eine
   * Auswahl von Modulen. Eigene Module lassen sich kopieren und nutzen,
   * fremde (mit `includeForeign`) nur nutzen.
   */
  async saveOffer(user: any, body: any) {
    const type = String(body?.type || 'topic') as OfferScope;
    let offer: ShopOffer | null = null;
    if (type === 'modules' && body?.offerId) {
      offer = await this.offerFor('modules', String(body.offerId), user);
      if (!offer) throw new NotFoundException('Angebot nicht gefunden.');
    }
    const draft = await this.draftOffer(type, {
      topicId: body?.topicId, nodeId: body?.nodeId, moduleIds: body?.moduleIds ?? offer?.moduleIds ?? [],
    }, user);
    if (!offer && type !== 'modules') offer = await this.offerFor(type, String(body?.topicId || body?.nodeId || ''), user);

    const includeForeign = body?.includeForeign === undefined ? (offer ? offer.includeForeign : true) : !!body.includeForeign;
    const covered = await this.coverage(Object.assign(this.offerRepo.create(draft), { includeForeign }));
    const roots = covered.flatMap((c) => c.roots);
    const own = roots.filter((m) => m.creatorId === user.userId);

    const allowCopy = !!body?.allowCopy;
    const allowUse = !!body?.allowUse;
    const active = body?.active !== false;
    if (active && !allowCopy && !allowUse) {
      throw new BadRequestException('Bitte mindestens "Copy" oder "Use" anbieten – oder das Angebot zurückziehen.');
    }
    if (active && !roots.length) {
      throw new BadRequestException(own.length || !includeForeign
        ? 'Darin ist nichts, was sich anbieten lässt – nur eigene Module oder, wenn gewünscht, erworbene zur Nutzung.'
        : 'Darin ist kein Modul.');
    }
    if (active && allowCopy && !own.length) {
      throw new BadRequestException('Zum Kopieren lassen sich nur eigene Module anbieten – hier gibt es keine. Bitte nur "Use" wählen.');
    }
    const audience = await this.cleanAudience(body?.audience ?? ['*'], true);
    if (active && audience.length === 0) throw new BadRequestException('Bitte eine Zielgruppe wählen.');

    if (!offer) offer = this.offerRepo.create({ id: crypto.randomUUID(), sellerId: user.userId, kind: 'creator', scopeType: type });
    Object.assign(offer, {
      sellerId: user.userId,
      scopeType: type,
      topicId: draft.topicId || '',
      nodeId: draft.nodeId ?? null,
      moduleIds: type === 'modules' ? draft.moduleIds : null,
      title: type === 'modules' ? String(body?.title || offer.title || '').trim().slice(0, 120) || 'Auswahl von Modulen' : null,
      includeForeign,
      allowCopy,
      allowUse,
      priceCopy: this.price(body?.priceCopy, 'Preis für Copy'),
      priceUse: this.price(body?.priceUse, 'Preis für Use'),
      audience,
      active,
      fromDeactivation: false,
      savedState: null,
    });
    await this.offerRepo.save(offer);
    return { success: true, offerId: offer.id };
  }

  /**
   * Ein Knoten wird gelöscht: Seine Angebote werden zu festen Auswahlen mit
   * dem, was gerade darin liegt – wer schon gekauft hat, behält es.
   */
  async freezeNodeOffers(nodeIds: string[]) {
    if (!nodeIds.length) return 0;
    const offers = await this.offerRepo.find({ where: { nodeId: In(nodeIds), scopeType: 'node' } });
    for (const offer of offers) {
      const covered = await this.coverage(offer);
      offer.title = await this.offerTitle(offer, covered);
      offer.moduleIds = covered.flatMap((c) => c.roots.map((r) => r.id));
      offer.scopeType = 'modules';
      offer.nodeId = null;
      await this.offerRepo.save(offer);
    }
    return offers.length;
  }

  /**
   * Angebot zurückziehen. Gekaufte Rechte bleiben bestehen; bei der
   * kostenlosen Weitergabe eines Buyers verfallen sie mit.
   */
  async withdraw(offerId: string, user: any) {
    const offer = await this.offerRepo.findOne({ where: { id: offerId } });
    if (!offer || offer.sellerId !== user.userId) throw new NotFoundException('Angebot nicht gefunden.');
    if (offer.kind === 'buyer') {
      await this.grantRepo.delete({ offerId: offer.id });
      await this.offerRepo.remove(offer);
      return { success: true, removed: true };
    }
    offer.active = false;
    await this.offerRepo.save(offer);
    return { success: true };
  }

  /** Meine Angebote mit allen, die etwas daraus erworben haben. */
  async myOffers(user: any) {
    const offers = await this.offerRepo.find({ where: { sellerId: user.userId } });
    if (offers.length === 0) return [];
    const users = await this.names();
    const out: any[] = [];
    for (const offer of offers) {
      const covered = await this.coverage(offer);
      // Ein Lernthema, das es nicht mehr gibt, hat auch kein Angebot mehr.
      if (offer.scopeType === 'topic' && !(await this.topicRepo.findOne({ where: { id: offer.topicId } }))) continue;
      const d = await this.describe(offer, users);
      out.push({
        ...d,
        scopeType: offer.scopeType,
        topicId: offer.scopeType === 'topic' ? offer.topicId : null,
        nodeId: offer.nodeId,
        nodeKind: await this.nodeKind(offer),
        title: await this.offerTitle(offer, covered),
        topicCount: covered.length,
        moduleCount: covered.reduce((n, c) => n + c.roots.length, 0),
        copyCount: offer.scopeType === 'topic' ? await this.topicRepo.count({ where: { copiedFromId: offer.topicId } }) : 0,
      });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  }

  // ---- Erwerben ----

  /**
   * Erwirbt ein Angebot im Modus "copy" oder "use".
   *
   * Punkte gehen vom Käufer an die Creator der enthaltenen Module (anteilig,
   * siehe splitPrice), in einer Transaktion mit dem Anlegen von Kopie bzw.
   * Nutzungsrecht – es wird nie bezahlt, ohne dass etwas ankommt, und nichts
   * kommt ohne Bezahlung an.
   *
   * Copy kopiert nur die eigenen Module des Anbieters. Enthält das Angebot
   * auch fremde, bekommt der Käufer sie dazu zur Nutzung – kopieren darf
   * sie niemand weiter.
   */
  async acquire(offerId: string, mode: string, user: any) {
    if (mode !== 'copy' && mode !== 'use') throw new BadRequestException('Bitte "copy" oder "use" wählen.');
    const offer = await this.offerRepo.findOne({ where: { id: offerId } });
    if (!offer || !offer.active || !this.visibleTo(offer, user)) throw new NotFoundException('Angebot nicht gefunden.');
    if (offer.sellerId === user.userId) throw new BadRequestException('Das ist dein eigenes Angebot.');
    if (mode === 'copy' && !offer.allowCopy) throw new ForbiddenException('Dieses Angebot ist nicht zum Kopieren.');
    if (mode === 'use' && !offer.allowUse) throw new ForbiddenException('Dieses Angebot ist nicht zum Verwenden.');

    const covered = (await this.coverage(offer)).filter((c) => c.topic.ownerId !== user.userId);
    if (!covered.length) {
      throw new BadRequestException(offer.scopeType === 'topic' ? 'Das Thema gehört dir bereits oder enthält derzeit keine Module.' : 'Das Angebot enthält derzeit keine Module.');
    }
    const roots = covered.flatMap((c) => c.roots);
    const ownRoots = roots.filter((m) => m.creatorId === offer.sellerId);
    if (mode === 'copy' && !ownRoots.length) throw new BadRequestException('Darin ist nichts zum Kopieren – nur zur Nutzung.');

    const existing = await this.grantRepo.findOne({ where: { userId: user.userId, offerId: offer.id } });
    if (mode === 'use' && existing && !existing.onlyForeign) {
      return { success: true, already: true, balance: await this.points.balance(user.userId) };
    }

    const price = mode === 'copy' ? offer.priceCopy : offer.priceUse;
    const users = await this.names();
    const seller = users.get(offer.sellerId);
    const known = new Set([...users.values()].filter((u) => u.active !== false).map((u) => u.id));
    const shares = splitPrice(price, roots.map((m) => m.creatorId), offer.sellerId, user.userId, known);
    const title = await this.offerTitle(offer, covered);
    const note = `${mode === 'copy' ? 'Copy' : 'Use'}: ${title}`;

    let copyIds: string[] = [];
    await this.dataSource.transaction(async (manager) => {
      if (price > 0) {
        // Ins Minus darf es gehen – bis zur Untergrenze, falls der Admin eine gesetzt hat.
        const balance = await this.points.balance(user.userId, manager);
        const { minBalance } = await this.points.getSettings();
        if (!PointsService.canSpend(balance, price, minBalance)) {
          throw new BadRequestException(
            `Dafür sind ${price} Punkte nötig – auf deinem Konto sind ${balance}, und unter ${minBalance} geht es nicht. Teile selbst etwas, dann kommen Punkte dazu.`,
          );
        }
        await this.points.book(manager, user.userId, -price, 'purchase', note, null);
        for (const [to, amount] of Object.entries(shares)) {
          await this.points.book(manager, to, amount, 'sale', to === offer.sellerId ? note : `${note} (Anteil als Creator)`);
        }
      }

      const grants = manager.getRepository(UseGrant);
      const grantTopicId = offer.scopeType === 'topic' ? offer.topicId : '';
      if (mode === 'use') {
        if (existing) {
          // Bisher nur die fremden Module (aus einer Kopie) – jetzt alles.
          Object.assign(existing, { onlyForeign: false, pricePaid: price, paidTo: price > 0 ? shares : null });
          await grants.save(existing);
        } else {
          await grants.save(grants.create({
            id: crypto.randomUUID(), userId: user.userId, topicId: grantTopicId, offerId: offer.id,
            scope: 'all', creatorId: offer.sellerId, pricePaid: price, paidTo: price > 0 ? shares : null, onlyForeign: false,
          }));
        }
        return;
      }

      copyIds = offer.scopeType === 'node'
        ? await this.copyNodeStructure(manager, offer, covered, user, this.label(seller))
        : await this.copyCovered(manager, covered, offer.sellerId, user, this.label(seller));
      // Fremde Module gibt es zur Kopie dazu – aber nur zur Nutzung.
      if (roots.length > ownRoots.length && !existing) {
        await grants.save(grants.create({
          id: crypto.randomUUID(), userId: user.userId, topicId: grantTopicId, offerId: offer.id,
          scope: 'all', creatorId: offer.sellerId, pricePaid: 0, paidTo: null, onlyForeign: true,
        }));
      }
    });

    return {
      success: true,
      mode,
      topicId: copyIds[0] || null,
      copiedTopics: copyIds.length,
      foreignForUse: mode === 'copy' ? roots.length - ownRoots.length : 0,
      price,
      shares,
      balance: await this.points.balance(user.userId),
    };
  }

  /** Je Lernthema eine Kopie mit den eigenen Modulen des Anbieters. */
  private async copyCovered(manager: any, covered: Covered[], sellerId: string, user: any, sellerName: string): Promise<string[]> {
    const ids: string[] = [];
    for (const c of covered) {
      const own = c.roots.filter((m) => m.creatorId === sellerId);
      if (!own.length) continue;
      ids.push(await this.copyTopic(manager, c.topic, withSubmodules(c.modules, new Set(own.map((m) => m.id))), user, sellerName));
    }
    return ids;
  }

  /**
   * Kopie eines Books, Bereichs oder Abschnitts: Die Struktur entsteht in
   * den Notebooks des Käufers – ein Book oben, alles andere im Book
   * „Erworben“ –, darin die kopierten Lernthemen an ihrem Platz.
   */
  private async copyNodeStructure(manager: any, offer: ShopOffer, covered: Covered[], user: any, sellerName: string): Promise<string[]> {
    const nodeRepo = manager.getRepository(NotebookNode);
    const placeRepo = manager.getRepository(NotebookPlacement);
    const [nodes, places] = await Promise.all([
      this.nodeRepo.find({ where: { ownerId: offer.sellerId } }),
      this.placeRepo.find({ where: { ownerId: offer.sellerId } }),
    ]);
    const root = nodes.find((n) => n.id === offer.nodeId);
    if (!root) return this.copyCovered(manager, covered, offer.sellerId, user, sellerName);
    const byTopic = new Map(covered.map((c) => [c.topic.id, c]));

    let parentId: string | null = null;
    if (root.kind !== 'book') parentId = (await this.acquiredBook(manager, user.userId)).id;
    const siblings = await nodeRepo.count({ where: { ownerId: user.userId, parentId: (parentId ?? null) as any } });

    const ids: string[] = [];
    const build = async (src: NotebookNode, parent: string | null, orderIndex: number) => {
      const node = await nodeRepo.save(nodeRepo.create({
        id: crypto.randomUUID(), ownerId: user.userId, kind: src.kind, title: src.title, parentId: parent, orderIndex, tagIds: null,
      }));
      let i = 0;
      for (const p of places.filter((x) => x.nodeId === src.id).sort((a, b) => a.orderIndex - b.orderIndex)) {
        const c = byTopic.get(p.topicId);
        const own = c ? c.roots.filter((m) => m.creatorId === offer.sellerId) : [];
        if (!c || !own.length) continue;
        const copyId = await this.copyTopic(manager, c.topic, withSubmodules(c.modules, new Set(own.map((m) => m.id))), user, sellerName);
        await placeRepo.save(placeRepo.create({ id: crypto.randomUUID(), ownerId: user.userId, topicId: copyId, nodeId: node.id, orderIndex: i++ }));
        ids.push(copyId);
      }
      const kids = nodes.filter((n) => n.parentId === src.id).sort((a, b) => a.orderIndex - b.orderIndex);
      for (let k = 0; k < kids.length; k++) await build(kids[k], node.id, k);
    };
    await build(root, parentId, siblings);
    return ids;
  }

  /** Das Book „Erworben“ des Käufers (wie in den Notebooks). */
  private async acquiredBook(manager: any, userId: string): Promise<NotebookNode> {
    const repo = manager.getRepository(NotebookNode);
    const found = await repo.findOne({ where: { ownerId: userId, kind: 'book', title: ACQUIRED_BOOK, parentId: IsNull() } });
    if (found) return found;
    const count = await repo.count({ where: { ownerId: userId, kind: 'book' } });
    return repo.save(repo.create({ id: crypto.randomUUID(), ownerId: userId, kind: 'book', title: ACQUIRED_BOOK, parentId: null, orderIndex: count, tagIds: null }));
  }

  /**
   * Vor dem Löschen eines Themas: Wer für die Nutzung bezahlt hat, bekommt
   * eine eigene Kopie dessen, was er darin nutzen durfte – Bezahltes geht
   * nicht verloren. Das gilt auch für Rechte an einem Bereich oder einer
   * Auswahl, die dieses Thema umfassen. Kostenlose Nutzungsrechte verfallen.
   * Liefert die Zahl der angelegten Kopien.
   */
  async preservePaidUse(topicId: string): Promise<number> {
    const topic = await this.topicRepo.findOne({ where: { id: topicId }, relations: ['modules'] });
    if (!topic) return 0;
    const offers = await this.offerRepo.find({ where: { sellerId: topic.ownerId } });
    const byId = new Map(offers.map((o) => [o.id, o]));
    const paid = (await this.grantRepo.find()).filter(
      (g) => g.pricePaid > 0 && ((g.offerId && byId.has(g.offerId)) || g.topicId === topicId),
    );
    if (!paid.length) return 0;
    const owner = await this.userRepo.findOne({ where: { id: topic.ownerId } });
    const all = topic.modules || [];
    let made = 0;
    await this.dataSource.transaction(async (manager) => {
      for (const g of paid) {
        const entries = (await this.expandGrant(g, g.offerId ? byId.get(g.offerId) : undefined)).filter((e) => e.topicId === topicId);
        if (!entries.length) continue;
        const modules = visibleFor(all, entries);
        if (!modules.length) continue;
        await this.copyTopic(manager, topic, modules, { userId: g.userId }, this.label(owner || undefined));
        made++;
      }
    });
    return made;
  }

  /**
   * Legt die Kopie an. Der Käufer wird Owner und Buyer, der Creator jedes
   * Moduls bleibt verzeichnet. Zugangsdaten und Tags des Originals kommen
   * nicht mit; die Kopie startet gesperrt – erst ansehen, dann freigeben.
   */
  private async copyTopic(manager: any, source: LearningTopic, modules: LearningModule[], user: any, sellerName: string) {
    const topicRepo = manager.getRepository(LearningTopic);
    const moduleRepo = manager.getRepository(LearningModule);
    const copy = await topicRepo.save(
      topicRepo.create({
        id: crypto.randomUUID(),
        title: source.title,
        description: source.description,
        ownerId: user.userId,
        selected: false,
        visibility: 'locked',
        accessPassword: null,
        subscribeKey: null,
        quickToken: null,
        sharedWith: null,
        sharedAccess: null,
        copiedFromId: source.id,
        copiedFromOwnerId: source.ownerId,
        copiedFromAuthor: sellerName,
        copiedFromTitle: source.title,
        permissions: source.permissions,
      }),
    );

    const idMap = new Map(modules.map((m) => [m.id, crypto.randomUUID()]));
    const copies = modules.map((m) => {
      const { id, topic: _t, subModules: _s, parent: _p, createdAt: _c, updatedAt: _u, ...rest } = m as any;
      return Object.assign(new LearningModule(), {
        ...rest,
        id: idMap.get(id),
        topicId: copy.id,
        parentId: m.parentId ? idMap.get(m.parentId) || null : null,
        // Tags gehören dem Anbieter und existieren beim Käufer nicht.
        tagIds: null,
      });
    });
    if (copies.length) await moduleRepo.save(copies);
    return copy.id;
  }

  /** Bis wann ein bezahltes Nutzungsrecht mit Erstattung zurückgegeben werden kann (sonst null). */
  static refundUntil(grant: UseGrant): Date | null {
    if (!(grant.pricePaid > 0) || !grant.createdAt) return null;
    return new Date(new Date(grant.createdAt).getTime() + REFUND_DAYS * 24 * 60 * 60 * 1000);
  }

  /**
   * Nutzungsrecht beenden. Der Inhaber kann es jederzeit zurückgeben –
   * innerhalb von REFUND_DAYS Tagen nach dem Kauf mit voller Erstattung (so
   * lässt sich ein Angebot per Use ausprobieren), danach ohne. Die Punkte
   * kommen von dort zurück, wohin sie gegangen sind – notfalls ins Minus.
   * Der Anbieter kann nur kostenlose Rechte entziehen – was bezahlt wurde,
   * bleibt. Das Nutzungsrecht zu einer Kopie (nur fremde Module) gehört zur
   * Kopie und lässt sich nicht einzeln zurückgeben.
   */
  async revokeGrant(grantId: string, user: any) {
    const grant = await this.grantRepo.findOne({ where: { id: grantId } });
    if (!grant) throw new NotFoundException('Nutzungsrecht nicht gefunden.');
    const offer = grant.offerId ? await this.offerRepo.findOne({ where: { id: grant.offerId } }) : null;
    if (grant.userId !== user.userId) {
      if (!offer || offer.sellerId !== user.userId) throw new ForbiddenException('Das ist nicht dein Angebot.');
      if (grant.pricePaid > 0) throw new ForbiddenException('Ein bezahltes Nutzungsrecht lässt sich nicht entziehen.');
      await this.grantRepo.remove(grant);
      return { success: true };
    }

    const until = ShopService.refundUntil(grant);
    const sellerId = offer?.sellerId || grant.creatorId;
    const paidTo: Record<string, number> = grant.paidTo && Object.keys(grant.paidTo).length
      ? grant.paidTo
      : sellerId ? { [sellerId]: grant.pricePaid } : {};
    let refunded = 0;
    await this.dataSource.transaction(async (manager) => {
      if (until && until.getTime() >= Date.now()) {
        const title = offer ? await this.offerTitle(offer) : (await this.topicRepo.findOne({ where: { id: grant.topicId } }))?.title;
        const note = `Rückgabe Use: ${title || 'Thema'}`;
        // Erstattet wird immer voll – wer die Punkte bekommen hat, gibt sie zurück, notfalls ins Minus.
        for (const [from, amount] of Object.entries(paidTo)) {
          if (!(amount > 0) || from === user.userId) continue;
          await this.points.book(manager, from, -amount, 'refund', note, null);
          refunded += amount;
        }
        if (refunded > 0) await this.points.book(manager, user.userId, refunded, 'refund', note);
      }
      await manager.getRepository(UseGrant).remove(grant);
    });
    return { success: true, refunded, pricePaid: grant.pricePaid, balance: await this.points.balance(user.userId) };
  }

  /** Eine gelöschte Gruppe aus allen Zielgruppen nehmen. */
  async dropGroupFromAudiences(groupId: string) {
    const ref = `group:${groupId}`;
    const offers = await this.offerRepo.find();
    const touched = offers.filter((o) => Array.isArray(o.audience) && o.audience.includes(ref));
    for (const o of touched) o.audience = o.audience.filter((e) => e !== ref);
    if (touched.length) await this.offerRepo.save(touched);
    return touched.length;
  }
}
