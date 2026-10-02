import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { User } from '../core/entities/user.entity';
import { TeacherGroup } from '../core/entities/teacher-group.entity';
import { PointsService } from '../accounts/points.service';
import { groupIdOf } from '../groups/groups.service';

const MAX_PRICE = 100000;

/**
 * Der Lernmodule-Shop: Jede Weitergabe von Inhalten läuft hierüber.
 *
 * Rechte je Modul (siehe docs/shop-und-rechte.md):
 *   Creator – hat das Modul verfasst. Nur er bietet es im Shop an, zum
 *             Kopieren und/oder Verwenden, gegen Punkte oder frei.
 *   Owner   – das Thema gehört ihm (eigene Kopie) oder er hat ein
 *             Nutzungsrecht darauf.
 *   Buyer   – hat eine Kopie erworben. Darf sie bearbeiten und kostenlos zur
 *             Nutzung weitergeben, an höchstens N Personen.
 */
@Injectable()
export class ShopService {
  constructor(
    @InjectRepository(ShopOffer) private readonly offerRepo: Repository<ShopOffer>,
    @InjectRepository(UseGrant) private readonly grantRepo: Repository<UseGrant>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(TeacherGroup) private readonly groupRepo: Repository<TeacherGroup>,
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

  /**
   * Die Module, die ein Angebot umfasst: beim Creator-Angebot nur seine
   * eigenen (samt Untermodulen), bei der Weitergabe eines Buyers alle.
   */
  private scopeModules(offer: ShopOffer, modules: LearningModule[]): LearningModule[] {
    if (offer.kind === 'buyer') return modules;
    const direct = new Set(modules.filter((m) => m.creatorId === offer.sellerId).map((m) => m.id));
    return modules.filter((m) => direct.has(m.id) || (!!m.parentId && direct.has(m.parentId)));
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

  // ---- Shop-Ansicht ----

  /**
   * Alle Angebote, die dieser Benutzer sieht: von anderen, aktiv, mit
   * mindestens einem Modul. Was ihm schon gehört, ist markiert.
   */
  async catalog(user: any) {
    const offers = (await this.offerRepo.find({ where: { active: true } })).filter(
      (o) => o.sellerId !== user.userId && this.visibleTo(o, user),
    );
    const topicIds = [...new Set(offers.map((o) => o.topicId))];
    const topics = topicIds.length
      ? await this.topicRepo.find({ where: { id: In(topicIds) }, relations: ['modules'] })
      : [];
    const byId = new Map(topics.map((t) => [t.id, t]));
    const users = await this.names();
    const myGrants = await this.grantRepo.find({ where: { userId: user.userId } });
    const myCopies = topicIds.length
      ? await this.topicRepo.find({ where: { ownerId: user.userId, copiedFromId: In(topicIds) } })
      : [];

    const out: any[] = [];
    for (const offer of offers) {
      const topic = byId.get(offer.topicId);
      if (!topic || topic.ownerId === user.userId) continue;
      const modules = this.scopeModules(offer, topic.modules || []).sort((a, b) => a.orderIndex - b.orderIndex);
      const roots = modules.filter((m) => !m.parentId);
      if (roots.length === 0) continue;
      const seller = users.get(offer.sellerId);
      out.push({
        offerId: offer.id,
        kind: offer.kind,
        topicId: topic.id,
        title: topic.title,
        description: topic.description,
        sellerName: this.label(seller),
        sellerActive: seller ? seller.active !== false : false,
        creators: [...new Set(modules.map((m) => this.label(users.get(m.creatorId || ''))))],
        modules: roots.map((m) => ({ title: m.title, type: m.type })),
        allowCopy: offer.allowCopy,
        allowUse: offer.allowUse,
        priceCopy: offer.priceCopy,
        priceUse: offer.priceUse,
        // Für alle angeboten oder gezielt an mich bzw. meine Gruppe geteilt?
        sharedWithMe: !offer.audience.includes('*'),
        hasUse: myGrants.some((g) => g.topicId === topic.id && g.offerId === offer.id),
        copies: myCopies.filter((c) => c.copiedFromId === topic.id).length,
        updatedAt: topic.updatedAt,
      });
    }
    out.sort((a, b) => a.title.localeCompare(b.title, 'de'));
    return { balance: await this.points.balance(user.userId), offers: out };
  }

  // ---- Anbieten ----

  /** Alles, was der Dialog "Im Shop anbieten" für ein Thema braucht. */
  async topicOfferState(topicId: string, user: any) {
    const topic = await this.ownTopic(topicId, user);
    const modules = (topic.modules || []).filter((m) => !m.parentId);
    const own = modules.filter((m) => m.creatorId === user.userId);
    const offers = await this.offerRepo.find({ where: { topicId } });
    const users = await this.names();
    const settings = await this.points.getSettings();

    const describe = async (offer: ShopOffer | undefined) => {
      if (!offer) return null;
      const grants = await this.grantRepo.find({ where: { offerId: offer.id } });
      return {
        id: offer.id,
        active: offer.active,
        allowCopy: offer.allowCopy,
        allowUse: offer.allowUse,
        priceCopy: offer.priceCopy,
        priceUse: offer.priceUse,
        audience: offer.audience,
        // Namen der eingetragenen Personen – auch aus anderen Schulen, die
        // die Auswahlliste selbst nicht zeigt. Sonst fielen sie beim
        // nächsten Speichern unbemerkt heraus.
        audienceUsers: (offer.audience || [])
          .filter((e) => users.has(e))
          .map((id) => ({ id, label: this.label(users.get(id)), email: users.get(id)!.email })),
        fromDeactivation: offer.fromDeactivation,
        holders: grants.map((g) => ({
          grantId: g.id,
          name: this.label(users.get(g.userId)),
          pricePaid: g.pricePaid,
          since: g.createdAt,
        })),
      };
    };

    return {
      topicId: topic.id,
      title: topic.title,
      ownModules: own.map((m) => m.title),
      foreignModules: modules.filter((m) => m.creatorId !== user.userId).map((m) => ({
        title: m.title,
        creatorName: this.label(users.get(m.creatorId || '')),
      })),
      canOfferAsCreator: own.length > 0,
      canShareAsBuyer: modules.length > own.length,
      buyerShareMax: settings.buyerShareMax,
      copyCount: await this.topicRepo.count({ where: { copiedFromId: topic.id } }),
      creatorOffer: await describe(offers.find((o) => o.kind === 'creator')),
      buyerShare: await describe(offers.find((o) => o.kind === 'buyer')),
    };
  }

  /**
   * Angebot als Creator anlegen oder ändern. Angeboten werden nur die selbst
   * verfassten Module des Themas – auch wenn es fremde enthält.
   */
  async saveCreatorOffer(topicId: string, user: any, body: any) {
    const topic = await this.ownTopic(topicId, user);
    if (!(topic.modules || []).some((m) => m.creatorId === user.userId)) {
      throw new ForbiddenException('Nur der Creator kann Module im Shop anbieten – dieses Thema enthält keine von dir verfassten.');
    }

    const allowCopy = !!body?.allowCopy;
    const allowUse = !!body?.allowUse;
    const active = body?.active !== false;
    if (active && !allowCopy && !allowUse) {
      throw new BadRequestException('Bitte mindestens "Copy" oder "Use" anbieten – oder das Angebot zurückziehen.');
    }
    const audience = await this.cleanAudience(body?.audience ?? ['*'], true);
    if (active && audience.length === 0) throw new BadRequestException('Bitte eine Zielgruppe wählen.');

    let offer = await this.offerRepo.findOne({ where: { topicId, kind: 'creator' } });
    if (!offer) offer = this.offerRepo.create({ id: crypto.randomUUID(), topicId, sellerId: user.userId, kind: 'creator' });
    Object.assign(offer, {
      sellerId: user.userId,
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
   * Weitergabe als Buyer: nur "Use", nur kostenlos, an höchstens N Personen.
   * Wer aus der Zielgruppe fällt, verliert sein Nutzungsrecht sofort – es war
   * geschenkt, und nur so bleibt die Obergrenze eine.
   */
  async saveBuyerShare(topicId: string, user: any, body: any) {
    const topic = await this.ownTopic(topicId, user);
    if (!(topic.modules || []).some((m) => m.creatorId !== user.userId)) {
      throw new BadRequestException('Alle Module dieses Themas stammen von dir – biete sie als Creator an.');
    }
    const audience = await this.cleanAudience(body?.audience, false);
    const people = await this.expand(audience);
    people.delete(user.userId);
    const { buyerShareMax } = await this.points.getSettings();
    if (people.size > buyerShareMax) {
      throw new BadRequestException(
        `Erworbene Inhalte dürfen an höchstens ${buyerShareMax} Personen weitergegeben werden – gewählt sind ${people.size}.`,
      );
    }

    let offer = await this.offerRepo.findOne({ where: { topicId, kind: 'buyer' } });
    if (audience.length === 0) {
      if (offer) {
        await this.grantRepo.delete({ offerId: offer.id });
        await this.offerRepo.remove(offer);
      }
      return { success: true, removed: true };
    }

    if (!offer) offer = this.offerRepo.create({ id: crypto.randomUUID(), topicId, sellerId: user.userId, kind: 'buyer' });
    Object.assign(offer, {
      sellerId: user.userId,
      allowCopy: false,
      allowUse: true,
      priceCopy: 0,
      priceUse: 0,
      audience,
      active: true,
    });
    await this.offerRepo.save(offer);

    const grants = await this.grantRepo.find({ where: { offerId: offer.id } });
    const gone = grants.filter((g) => !people.has(g.userId));
    if (gone.length) await this.grantRepo.remove(gone);
    return { success: true, offerId: offer.id, revoked: gone.length };
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
    const topics = await this.topicRepo.find({ where: { id: In(offers.map((o) => o.topicId)) } });
    const byId = new Map(topics.map((t) => [t.id, t]));
    const users = await this.names();
    const out: any[] = [];
    for (const offer of offers) {
      const topic = byId.get(offer.topicId);
      if (!topic) continue;
      const grants = await this.grantRepo.find({ where: { offerId: offer.id } });
      out.push({
        id: offer.id,
        kind: offer.kind,
        topicId: topic.id,
        title: topic.title,
        active: offer.active,
        allowCopy: offer.allowCopy,
        allowUse: offer.allowUse,
        priceCopy: offer.priceCopy,
        priceUse: offer.priceUse,
        audience: offer.audience,
        copyCount: await this.topicRepo.count({ where: { copiedFromId: topic.id } }),
        holders: grants.map((g) => ({
          grantId: g.id,
          name: this.label(users.get(g.userId)),
          pricePaid: g.pricePaid,
          since: g.createdAt,
        })),
      });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  }

  // ---- Erwerben ----

  /**
   * Erwirbt ein Angebot im Modus "copy" oder "use".
   *
   * Punkte gehen vom Käufer an den Anbieter, in einer Transaktion mit dem
   * Anlegen von Kopie bzw. Nutzungsrecht – es wird nie bezahlt, ohne dass
   * etwas ankommt, und nichts kommt ohne Bezahlung an.
   */
  async acquire(offerId: string, mode: string, user: any) {
    if (mode !== 'copy' && mode !== 'use') throw new BadRequestException('Bitte "copy" oder "use" wählen.');
    const offer = await this.offerRepo.findOne({ where: { id: offerId } });
    if (!offer || !offer.active || !this.visibleTo(offer, user)) throw new NotFoundException('Angebot nicht gefunden.');
    if (offer.sellerId === user.userId) throw new BadRequestException('Das ist dein eigenes Angebot.');
    if (mode === 'copy' && !offer.allowCopy) throw new ForbiddenException('Dieses Angebot ist nicht zum Kopieren.');
    if (mode === 'use' && !offer.allowUse) throw new ForbiddenException('Dieses Angebot ist nicht zum Verwenden.');

    const topic = await this.topicRepo.findOne({ where: { id: offer.topicId }, relations: ['modules'] });
    if (!topic) throw new NotFoundException('Das Thema gibt es nicht mehr.');
    if (topic.ownerId === user.userId) throw new BadRequestException('Das Thema gehört dir bereits.');
    const modules = this.scopeModules(offer, topic.modules || []);
    if (modules.length === 0) throw new BadRequestException('Das Angebot enthält derzeit keine Module.');

    if (mode === 'use') {
      const existing = await this.grantRepo.findOne({ where: { userId: user.userId, topicId: topic.id, offerId: offer.id } });
      if (existing) return { success: true, already: true, balance: await this.points.balance(user.userId) };
    }
    if (offer.kind === 'buyer') {
      const people = await this.expand(offer.audience);
      if (!people.has(user.userId)) throw new ForbiddenException('Diese Weitergabe gilt nicht für dich.');
      const { buyerShareMax } = await this.points.getSettings();
      const taken = await this.grantRepo.count({ where: { offerId: offer.id } });
      if (taken >= buyerShareMax) throw new ForbiddenException('Die Weitergabe ist bereits ausgeschöpft.');
    }

    const price = mode === 'copy' ? offer.priceCopy : offer.priceUse;
    const seller = await this.userRepo.findOne({ where: { id: offer.sellerId } });

    let copyId: string | null = null;
    await this.dataSource.transaction(async (manager) => {
      if (price > 0) {
        const balance = await this.points.balance(user.userId, manager);
        if (balance < price) {
          throw new BadRequestException(`Dafür brauchst du ${price} Punkte – auf deinem Konto sind ${balance}.`);
        }
        await this.points.book(manager, user.userId, -price, 'purchase', `${mode === 'copy' ? 'Copy' : 'Use'}: ${topic.title}`);
        await this.points.book(manager, offer.sellerId, price, 'sale', `${mode === 'copy' ? 'Copy' : 'Use'}: ${topic.title}`);
      }

      if (mode === 'use') {
        await manager.getRepository(UseGrant).save(
          manager.getRepository(UseGrant).create({
            id: crypto.randomUUID(),
            userId: user.userId,
            topicId: topic.id,
            offerId: offer.id,
            scope: offer.kind === 'buyer' ? 'all' : 'creator',
            creatorId: offer.kind === 'buyer' ? null : offer.sellerId,
            pricePaid: price,
          }),
        );
        return;
      }

      copyId = await this.copyTopic(manager, topic, modules, user, this.label(seller || undefined));
    });

    return {
      success: true,
      mode,
      topicId: copyId,
      price,
      balance: await this.points.balance(user.userId),
    };
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

  /**
   * Nutzungsrecht beenden. Der Inhaber kann es jederzeit zurückgeben (ohne
   * Erstattung). Der Anbieter kann nur kostenlose Rechte entziehen – was
   * bezahlt wurde, bleibt.
   */
  async revokeGrant(grantId: string, user: any) {
    const grant = await this.grantRepo.findOne({ where: { id: grantId } });
    if (!grant) throw new NotFoundException('Nutzungsrecht nicht gefunden.');
    if (grant.userId !== user.userId) {
      const offer = grant.offerId ? await this.offerRepo.findOne({ where: { id: grant.offerId } }) : null;
      if (!offer || offer.sellerId !== user.userId) throw new ForbiddenException('Das ist nicht dein Angebot.');
      if (grant.pricePaid > 0) throw new ForbiddenException('Ein bezahltes Nutzungsrecht lässt sich nicht entziehen.');
    }
    await this.grantRepo.remove(grant);
    return { success: true };
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
