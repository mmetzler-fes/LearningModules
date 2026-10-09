import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { User } from '../core/entities/user.entity';
import { TeacherGroup } from '../core/entities/teacher-group.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { groupIdOf } from '../groups/group-ref';

/**
 * Überführt Bestandsdaten in das Rechtemodell mit Creator je Modul und Shop.
 * Läuft bei jedem Start, tut aber nur etwas, solange es Altlasten gibt.
 *
 * 1. Creator: Module ohne Creator bekommen den Eigentümer ihres Themas –
 *    bei einer Kopie den Eigentümer der Quelle, sofern es ihn noch gibt.
 * 2. Freigaben: Die alten Felder `sharedWith` (kopieren) und `sharedAccess`
 *    (verwenden) werden zu kostenlosen Shop-Angeboten für dieselben
 *    Personen. Wer ein freigegebenes Thema schon in einem eigenen Themen-
 *    oder Quick-Link einsetzt, bekommt das Nutzungsrecht direkt – sonst
 *    liefen seine Links ab morgen ins Leere.
 */
@Injectable()
export class RightsMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RightsMigrationService.name);

  constructor(
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(TeacherGroup) private readonly groupRepo: Repository<TeacherGroup>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(TopicQuickLink) private readonly quickRepo: Repository<TopicQuickLink>,
    @InjectRepository(ShopOffer) private readonly offerRepo: Repository<ShopOffer>,
    @InjectRepository(UseGrant) private readonly grantRepo: Repository<UseGrant>,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.assignCreators();
      await this.convertSharing();
    } catch (err) {
      this.logger.error('Migration des Rechtemodells fehlgeschlagen', err as any);
    }
  }

  private async assignCreators() {
    const orphans = await this.moduleRepo.find({ where: { creatorId: IsNull() } });
    if (orphans.length === 0) return;

    const topics = await this.topicRepo.find();
    const byId = new Map(topics.map((t) => [t.id, t]));
    const userIds = new Set((await this.userRepo.find()).map((u) => u.id));

    for (const m of orphans) {
      const topic = byId.get(m.topicId);
      if (!topic) continue;
      m.creatorId =
        topic.copiedFromOwnerId && userIds.has(topic.copiedFromOwnerId) ? topic.copiedFromOwnerId : topic.ownerId;
    }
    await this.moduleRepo.save(orphans.filter((m) => m.creatorId));
    this.logger.log(`Creator für ${orphans.length} Module gesetzt`);
  }

  private async convertSharing() {
    const topics = (await this.topicRepo.find({ relations: ['modules'] })).filter(
      (t) => (t.sharedWith && t.sharedWith.length) || (t.sharedAccess && t.sharedAccess.length),
    );
    if (topics.length === 0) return;

    const groups = await this.groupRepo.find();
    const links = await this.linkRepo.find();
    const quicks = await this.quickRepo.find();

    const reaches = (entries: string[], userId: string) =>
      entries.includes('*') ||
      entries.includes(userId) ||
      entries.some((e) => {
        const gid = groupIdOf(e);
        return gid ? (groups.find((g) => g.id === gid)?.memberIds || []).includes(userId) : false;
      });

    for (const topic of topics) {
      const copyEntries = (topic.sharedWith || []).map(String);
      const useEntries = (topic.sharedAccess || []).map((e) => String(e?.userId)).filter(Boolean);
      const modules = topic.modules || [];
      const hasOwn = modules.some((m) => m.creatorId === topic.ownerId);
      const hasForeign = modules.some((m) => m.creatorId !== topic.ownerId);

      // Wer das Thema heute schon in eigenen Links einsetzt.
      const users = new Set<string>();
      for (const l of links) if ((l.selection || []).some((s) => s.topicId === topic.id)) users.add(l.ownerId);
      for (const q of quicks) if (q.topicId === topic.id) users.add(q.ownerId);
      users.delete(topic.ownerId);
      const usingNow = [...users].filter((u) => reaches(useEntries, u));

      let creatorOffer: ShopOffer | null = null;
      if (hasOwn) {
        creatorOffer = await this.offerRepo.findOne({ where: { topicId: topic.id, kind: 'creator' } });
        if (!creatorOffer) {
          const audience = [...copyEntries, ...useEntries].includes('*')
            ? ['*']
            : [...new Set([...copyEntries, ...useEntries])];
          creatorOffer = await this.offerRepo.save(
            this.offerRepo.create({
              id: crypto.randomUUID(),
              topicId: topic.id,
              sellerId: topic.ownerId,
              kind: 'creator',
              allowCopy: copyEntries.length > 0,
              allowUse: useEntries.length > 0,
              priceCopy: 0,
              priceUse: 0,
              audience,
              active: true,
            }),
          );
        }
      }

      // Enthält das Thema fremde Module, reicht das Creator-Angebot für die
      // bestehenden Links nicht – sie zeigten dann nur noch einen Teil. Diese
      // Personen bekommen deshalb eine Weitergabe mit allen Modulen.
      let buyerShare: ShopOffer | null = null;
      if (hasForeign && usingNow.length) {
        buyerShare = await this.offerRepo.save(
          this.offerRepo.create({
            id: crypto.randomUUID(),
            topicId: topic.id,
            sellerId: topic.ownerId,
            kind: 'buyer',
            allowCopy: false,
            allowUse: true,
            priceCopy: 0,
            priceUse: 0,
            audience: usingNow,
            active: true,
          }),
        );
      }

      for (const userId of usingNow) {
        const offer = buyerShare || creatorOffer;
        if (!offer) continue;
        const exists = await this.grantRepo.findOne({ where: { userId, topicId: topic.id, offerId: offer.id } });
        if (exists) continue;
        await this.grantRepo.save(
          this.grantRepo.create({
            id: crypto.randomUUID(),
            userId,
            topicId: topic.id,
            offerId: offer.id,
            scope: buyerShare ? 'all' : 'creator',
            creatorId: buyerShare ? null : topic.ownerId,
            pricePaid: 0,
          }),
        );
      }

      topic.sharedWith = null;
      topic.sharedAccess = null;
      await this.topicRepo.save(topic);
    }
    this.logger.log(`${topics.length} alte Freigaben in Shop-Angebote überführt`);
  }
}
