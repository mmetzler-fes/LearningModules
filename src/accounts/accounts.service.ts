import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { User } from '../core/entities/user.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { PointsEntry } from '../core/entities/points-entry.entity';
import { HandoverService } from './handover.service';
import { PointsService } from './points.service';

/**
 * Lebenszyklus eines Kontos: löschen bzw. deaktivieren, reaktivieren,
 * zusammenführen.
 *
 * Die Grundregel: Wer Creator ist – also mindestens ein Modul verfasst hat,
 * das noch irgendwo existiert –, wird nie gelöscht, nur deaktiviert. Seine
 * Inhalte stehen dann für 0 Punkte im Shop. Wer nichts verfasst hat, wird
 * tatsächlich gelöscht; seine erworbenen Rechte verfallen.
 */
@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(TopicQuickLink) private readonly quickRepo: Repository<TopicQuickLink>,
    @InjectRepository(ShopOffer) private readonly offerRepo: Repository<ShopOffer>,
    @InjectRepository(UseGrant) private readonly grantRepo: Repository<UseGrant>,
    @InjectRepository(PointsEntry) private readonly entryRepo: Repository<PointsEntry>,
    private readonly handover: HandoverService,
    private readonly points: PointsService,
  ) {}

  /** Creator ist, wer mindestens ein noch existierendes Modul verfasst hat. */
  async isCreator(userId: string): Promise<boolean> {
    return (await this.moduleRepo.count({ where: { creatorId: userId } })) > 0;
  }

  /** Aktive Admins außer dem genannten – für die Sperre "letzter Admin". */
  async otherActiveAdmins(exceptId: string): Promise<number> {
    const admins = await this.userRepo.find({ where: { role: 'admin', active: true } });
    return admins.filter((a) => a.id !== exceptId).length;
  }

  /**
   * Konto entfernen – durch den Benutzer selbst oder durch einen Admin.
   * Creator werden deaktiviert, alle anderen gelöscht.
   */
  async removeAccount(target: User, actingUserId: string) {
    if (target.role === 'admin' && target.active !== false && (await this.otherActiveAdmins(target.id)) === 0) {
      throw new BadRequestException('Es muss mindestens ein aktiver Admin vorhanden bleiben.');
    }
    if (await this.isCreator(target.id)) {
      const offered = await this.deactivate(target);
      return { success: true, deactivated: true, offeredTopics: offered };
    }
    const successor = await this.handover.pickSuccessor(target, actingUserId);
    if (!successor) throw new BadRequestException('Kein Admin gefunden, der Links und Ergebnisse übernehmen könnte.');
    const moved = await this.deleteHard(target, successor);
    return {
      success: true,
      deactivated: false,
      handedOverTo: successor.displayName || successor.email,
      moved,
    };
  }

  // ---- Deaktivieren / Reaktivieren ----

  /**
   * Deaktiviert ein Konto und stellt seine Inhalte für 0 Punkte in den Shop,
   * zum Kopieren und Verwenden, für alle. Ein bestehendes Angebot wird dabei
   * gesichert, damit eine Reaktivierung es wiederherstellen kann.
   */
  async deactivate(target: User): Promise<number> {
    target.active = false;
    target.deactivatedAt = new Date();
    await this.userRepo.save(target);

    const topics = await this.topicRepo.find({ where: { ownerId: target.id } });
    const own = topics.length
      ? await this.moduleRepo.find({ where: { topicId: In(topics.map((t) => t.id)), creatorId: target.id } })
      : [];
    const withOwn = new Set(own.map((m) => m.topicId));

    let count = 0;
    for (const topic of topics) {
      if (!withOwn.has(topic.id)) continue;
      let offer = await this.offerRepo.findOne({ where: { topicId: topic.id, kind: 'creator' } });
      if (offer && offer.fromDeactivation) continue;
      const savedState = offer
        ? {
            allowCopy: offer.allowCopy,
            allowUse: offer.allowUse,
            priceCopy: offer.priceCopy,
            priceUse: offer.priceUse,
            audience: offer.audience,
            active: offer.active,
          }
        : null;
      if (!offer) {
        offer = this.offerRepo.create({ id: crypto.randomUUID(), topicId: topic.id, sellerId: target.id, kind: 'creator' });
      }
      Object.assign(offer, {
        allowCopy: true,
        allowUse: true,
        priceCopy: 0,
        priceUse: 0,
        audience: ['*'],
        active: true,
        fromDeactivation: true,
        savedState,
      });
      await this.offerRepo.save(offer);
      count++;
    }
    this.logger.log(`Konto ${target.email} deaktiviert, ${count} Themen für 0 Punkte im Shop`);
    return count;
  }

  /** Reaktivieren: Konto frei, Angebote wie vor der Deaktivierung. */
  async reactivate(target: User) {
    target.active = true;
    target.deactivatedAt = null;
    await this.userRepo.save(target);

    const offers = await this.offerRepo.find({ where: { sellerId: target.id, fromDeactivation: true } });
    let restored = 0;
    let removed = 0;
    for (const offer of offers) {
      if (!offer.savedState) {
        // Vorher gab es kein Angebot. Gekaufte Nutzungsrechte bleiben
        // trotzdem bestehen – sie hängen am Thema, nicht am Angebot.
        await this.offerRepo.remove(offer);
        removed++;
        continue;
      }
      Object.assign(offer, offer.savedState, { fromDeactivation: false, savedState: null });
      await this.offerRepo.save(offer);
      restored++;
    }
    return { success: true, restoredOffers: restored, removedOffers: removed };
  }

  // ---- Löschen ----

  /**
   * Löscht ein Konto ohne eigene Inhalte. Links, Ergebnisse, Dateien und Tags
   * gehen an `successor`; erworbene Kopien und Nutzungsrechte verfallen.
   */
  private async deleteHard(target: User, successor: User) {
    const moved = await this.handover.transferBelongings(target, successor, false);

    const topics = await this.topicRepo.find({ where: { ownerId: target.id }, relations: ['modules'] });
    for (const topic of topics) await this.deleteTopicCompletely(topic);

    await this.grantRepo.delete({ userId: target.id });
    await this.offerRepo.delete({ sellerId: target.id });
    await this.entryRepo.delete({ userId: target.id });
    await this.userRepo.delete({ id: target.id });
    return { ...moved, topicsDeleted: topics.length };
  }

  /** Thema samt Modulen, Quick-Links, Angeboten und Nutzungsrechten. */
  async deleteTopicCompletely(topic: LearningTopic) {
    const modules = topic.modules || (await this.moduleRepo.find({ where: { topicId: topic.id } }));
    if (modules.length) await this.moduleRepo.remove(modules);
    await this.quickRepo.delete({ topicId: topic.id });
    await this.offerRepo.delete({ topicId: topic.id });
    await this.grantRepo.delete({ topicId: topic.id });
    await this.topicRepo.delete({ id: topic.id });
  }

  // ---- Zusammenführen ----

  /**
   * Führt `from` in `to` zusammen: Inhalte, Creator-Kennung, Angebote,
   * Rechte, Links, Ergebnisse und Punkte gehen an `to`, danach wird `from`
   * gelöscht. `to` behält Passwort und E-Mail; Admin ist, wer es in einem
   * der beiden Konten war.
   */
  async merge(from: User, to: User) {
    if (from.id === to.id) throw new BadRequestException('Ein Konto lässt sich nicht mit sich selbst zusammenführen.');

    const belongings = await this.handover.transferBelongings(from, to, true);

    await this.topicRepo.update({ ownerId: from.id }, { ownerId: to.id });
    await this.topicRepo.update({ copiedFromOwnerId: from.id }, { copiedFromOwnerId: to.id });
    await this.moduleRepo.update({ creatorId: from.id }, { creatorId: to.id });
    await this.offerRepo.update({ sellerId: from.id }, { sellerId: to.id });
    await this.grantRepo.update({ creatorId: from.id }, { creatorId: to.id });

    // Nutzungsrechte: doppelte entfallen, ebenso Rechte an Themen, die jetzt
    // ohnehin `to` gehören.
    const grants = await this.grantRepo.find({ where: { userId: In([from.id, to.id]) } });
    const ownTopics = new Set((await this.topicRepo.find({ where: { ownerId: to.id } })).map((t) => t.id));
    const seen = new Set<string>();
    for (const g of grants.sort((a, b) => (a.userId === to.id ? -1 : b.userId === to.id ? 1 : 0))) {
      const key = `${g.topicId}|${g.offerId}`;
      if (seen.has(key) || ownTopics.has(g.topicId)) {
        await this.grantRepo.remove(g);
        continue;
      }
      seen.add(key);
      if (g.userId !== to.id) {
        g.userId = to.id;
        await this.grantRepo.save(g);
      }
    }

    // Punkte addieren; die Buchungen des alten Kontos wandern mit.
    const fromPoints = await this.points.balance(from.id);
    await this.entryRepo.update({ userId: from.id }, { userId: to.id });
    if (fromPoints > 0) await this.points.book(undefined, to.id, fromPoints, 'merge', `Übernommen von ${from.email}`);

    const fresh = await this.userRepo.findOne({ where: { id: to.id } });
    if (!fresh) throw new BadRequestException('Zielkonto nicht gefunden.');
    if (from.role === 'admin') fresh.role = 'admin';
    if (!fresh.displayName || fresh.displayName === fresh.email) fresh.displayName = from.displayName || fresh.displayName;
    // Die Schule zieht mit um – bei einem E-Mail-Wechsel bleibt man ja an derselben Schule.
    if (!fresh.schoolId && from.schoolId) {
      fresh.schoolId = from.schoolId;
      fresh.isSchoolAdmin = !!from.isSchoolAdmin;
      fresh.schoolManual = !!from.schoolManual;
    }
    fresh.formerIds = [...new Set([...(fresh.formerIds || []), from.id, ...(from.formerIds || [])])];
    fresh.pendingMergeFrom = null;
    fresh.active = true;
    await this.userRepo.save(fresh);

    await this.userRepo.update({ pendingMergeFrom: from.id }, { pendingMergeFrom: null });
    await this.userRepo.delete({ id: from.id });

    this.logger.log(`Konto ${from.email} in ${fresh.email} zusammengeführt`);
    return { success: true, belongings };
  }
}
