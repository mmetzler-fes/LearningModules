import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { User } from '../core/entities/user.entity';
import { ContentFeedback } from '../core/entities/content-feedback.entity';
import { FederationCopy } from '../core/entities/federation-copy.entity';
import { ShopService } from '../shop/shop.service';
import { visibleFor } from '../shop/offer-rules';
import { UsageService } from './usage.service';
import { cleanStars, MAX_COMMENT, originOf, summarizeRatings, summarizeUsage, RatingSummary } from './impact-rules';

/** Wirkung eines Lernthemas (bzw. der eigenen Module darin) für seinen Creator. */
export interface TopicImpact {
  topicId: string;
  title: string;
  /** Das Original gibt es nicht mehr; gezählt wird über die Kopien weiter. */
  gone: boolean;
  modules: number;
  offered: boolean;
  copiedBy: number;
  usedBy: number;
  runs: number;
  runsByOthers: number;
  classes: number;
  teachers: number;
  rating: RatingSummary;
}

/**
 * Sichtbare Wirkung statt Punkte (docs/nutzung-und-bewertung.md).
 *
 * Gezählt wird für jedes Modul, das jemand verfasst hat (`creatorId`) – egal,
 * in wessen Lernthema es heute liegt. Kopien führen über `originId` zum
 * Original; so kommt auch an, was in Kopien bei anderen geschieht, und es
 * bleibt sichtbar, wenn das Original längst gelöscht ist.
 */
@Injectable()
export class ImpactService {
  constructor(
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(UseGrant) private readonly grantRepo: Repository<UseGrant>,
    @InjectRepository(ShopOffer) private readonly offerRepo: Repository<ShopOffer>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(ContentFeedback) private readonly feedbackRepo: Repository<ContentFeedback>,
    @InjectRepository(FederationCopy) private readonly fedCopyRepo: Repository<FederationCopy>,
    private readonly shop: ShopService,
    private readonly usage: UsageService,
  ) {}

  private label(u: User | undefined) {
    return u ? u.displayName || u.email : 'Unbekannt';
  }

  // ---- Wirkung ----

  /** Meine Wirkung: je Lernthema und insgesamt, dazu die Rückmeldungen und Geben/Nehmen. */
  async mine(user: any) {
    const [impact, giveAndTake, settings] = await Promise.all([
      this.compute(user.userId, true),
      this.shop.giveAndTake(user.userId),
      this.usage.getSettings(),
    ]);
    return { ...impact, giveAndTake, shareHintAfter: settings.shareHintAfter };
  }

  /** Kurzfassung für den Shop: was ein Creator teilt und wen es erreicht – ohne Namen. */
  async creatorSummary(creatorId: string) {
    const user = await this.userRepo.findOne({ where: { id: creatorId } });
    if (!user) throw new NotFoundException('Creator nicht gefunden.');
    const { totals } = await this.compute(creatorId, false);
    const offers = await this.offerRepo.count({ where: { sellerId: creatorId, active: true } });
    return { id: creatorId, name: this.label(user), active: user.active !== false, offers, ...totals };
  }

  private async compute(creatorId: string, withFeedback: boolean) {
    const mods = await this.moduleRepo.find({
      where: { creatorId },
      select: ['id', 'originId', 'parentId', 'topicId', 'title'],
    });
    const roots = mods.filter((m) => !m.parentId);
    const topicIds = [...new Set(roots.map((m) => m.topicId))];
    const topics = topicIds.length ? await this.topicRepo.find({ where: { id: In(topicIds) } }) : [];
    const topicById = new Map(topics.map((t) => [t.id, t]));

    // Jedes Original gehört zu einem „Heimat“-Lernthema: dem des Originals,
    // oder – wenn es das nicht mehr gibt – dem ersten, in dem eine Kopie liegt.
    const home = new Map<string, string>();
    for (const m of roots) if (!m.originId) home.set(m.id, m.topicId);
    for (const m of roots) {
      const o = originOf(m);
      if (!home.has(o)) home.set(o, m.topicId);
    }
    const groups = new Map<string, TopicImpact & { _origins: Set<string>; _copiers: Set<string>; _users: Set<string>; _teachers: Set<string> }>();
    const groupOf = (origin: string) => {
      const topicId = home.get(origin);
      if (!topicId) return null;
      let g = groups.get(topicId);
      if (!g) {
        const t = topicById.get(topicId);
        const gone = !roots.some((m) => !m.originId && m.topicId === topicId);
        g = {
          topicId, title: gone ? t?.copiedFromTitle || t?.title || 'Lernthema' : t?.title || 'Lernthema', gone,
          modules: 0, offered: false, copiedBy: 0, usedBy: 0, runs: 0, runsByOthers: 0, classes: 0, teachers: 0,
          rating: { avg: null, count: 0, thanks: 0 },
          _origins: new Set(), _copiers: new Set(), _users: new Set(), _teachers: new Set(),
        };
        groups.set(topicId, g);
      }
      return g;
    };
    for (const o of home.keys()) groupOf(o)!._origins.add(o);

    // Kopien bei anderen: Lernthemen anderer Lehrkräfte mit meinen Modulen.
    for (const m of roots) {
      const t = topicById.get(m.topicId);
      if (t && t.ownerId !== creatorId) groupOf(originOf(m))?._copiers.add(t.ownerId);
    }

    // Kopien auf verbundenen Servern (die kopierten Lernthemen von hier).
    const peersReached = new Set<string>();
    if (topicIds.length) {
      for (const c of await this.fedCopyRepo.find()) {
        const hit = (c.topicIds || []).filter((id) => groups.has(id));
        for (const id of hit) groups.get(id)!._copiers.add(c.personId);
        if (hit.length) peersReached.add(c.peerId);
      }
    }

    // Nutzungsrechte anderer, die meine Module sichtbar machen.
    await this.collectUses(creatorId, (origin, userId) => groupOf(origin)?._users.add(userId));

    // Bearbeitungen im Unterricht.
    const counts = await this.usage.countsFor([...home.keys()]);
    for (const g of groups.values()) {
      const s = summarizeUsage(counts.filter((c) => g._origins.has(c.originId)), creatorId);
      Object.assign(g, { runs: s.runs, runsByOthers: s.runsByOthers, classes: s.classes });
      s.teachers.forEach((t) => g._teachers.add(t));
    }

    // Im Shop? Was meine aktiven Angebote gerade umfassen.
    const offered = new Set<string>();
    for (const offer of await this.offerRepo.find({ where: { sellerId: creatorId, active: true } })) {
      for (const c of await this.shop.coverage(offer)) offered.add(c.topic.id);
    }

    // Bewertungen: an jedem Lernthema, in dem meine Module liegen.
    const feedback = topicIds.length ? await this.feedbackRepo.find({ where: { topicId: In(topicIds), userId: Not(creatorId) } }) : [];
    const groupsOfTopic = (topicId: string) =>
      [...new Set(roots.filter((m) => m.topicId === topicId).map((m) => home.get(originOf(m))).filter(Boolean) as string[])];

    const users = await this.userRepo.find({ select: ['id', 'displayName', 'email', 'schoolId'] });
    const userById = new Map(users.map((u) => [u.id, u]));
    const reached = new Set<string>();
    const list: TopicImpact[] = [];
    for (const g of groups.values()) {
      const rows = feedback.filter((f) => groupsOfTopic(f.topicId).includes(g.topicId));
      const people = new Set([...g._copiers, ...g._users, ...g._teachers]);
      people.delete(creatorId);
      people.forEach((p) => reached.add(p));
      const { _origins, _copiers, _users, _teachers, ...rest } = g;
      list.push({
        ...rest,
        modules: _origins.size,
        offered: offered.has(g.topicId),
        copiedBy: _copiers.size,
        usedBy: _users.size,
        teachers: people.size,
        rating: summarizeRatings(rows),
      });
    }
    list.sort((a, b) => b.teachers - a.teachers || b.runs - a.runs || a.title.localeCompare(b.title, 'de'));

    // Schulen hier im Haus, dazu jeder verbundene Server, auf dem kopiert wurde.
    const schools = new Set([...[...reached].map((id) => userById.get(id)?.schoolId).filter(Boolean), ...[...peersReached].map((p) => `peer:${p}`)]);
    const totals = {
      topics: list.filter((t) => !t.gone).length,
      modules: home.size,
      teachers: reached.size,
      schools: schools.size,
      copiedBy: new Set([...groups.values()].flatMap((g) => [...g._copiers])).size,
      usedBy: new Set([...groups.values()].flatMap((g) => [...g._users])).size,
      runs: list.reduce((n, t) => n + t.runs, 0),
      runsByOthers: list.reduce((n, t) => n + t.runsByOthers, 0),
      classes: list.reduce((n, t) => n + t.classes, 0),
      rating: summarizeRatings(feedback),
    };

    const comments = withFeedback
      ? feedback
          .filter((f) => f.comment)
          .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
          .map((f) => ({
            topicTitle: topicById.get(f.topicId)?.title || 'Lernthema',
            name: this.label(userById.get(f.userId) as User | undefined),
            stars: f.stars,
            thanks: f.thanks,
            comment: f.comment,
            date: f.updatedAt,
          }))
      : [];
    return { totals, topics: list, comments };
  }

  /**
   * Ruft `add(origin, userId)` für jedes meiner Module, das eine andere
   * Lehrkraft über ein Nutzungsrecht verwendet.
   */
  private async collectUses(creatorId: string, add: (origin: string, userId: string) => void) {
    const holders = [...new Set((await this.grantRepo.find({ select: ['userId'] })).map((g) => g.userId))].filter((u) => u !== creatorId);
    const modsByTopic = new Map<string, LearningModule[]>();
    for (const userId of holders) {
      const entries = await this.shop.expandGrants(userId);
      const ids = [...new Set(entries.map((e) => e.topicId))].filter((id) => id && !modsByTopic.has(id));
      if (ids.length) {
        const mods = await this.moduleRepo.find({ where: { topicId: In(ids) }, select: ['id', 'originId', 'parentId', 'topicId', 'creatorId'] });
        for (const id of ids) modsByTopic.set(id, mods.filter((m) => m.topicId === id));
      }
      for (const topicId of new Set(entries.map((e) => e.topicId))) {
        const visible = visibleFor(modsByTopic.get(topicId) || [], entries.filter((e) => e.topicId === topicId));
        for (const m of visible) if (!m.parentId && m.creatorId === creatorId) add(originOf(m), userId);
      }
    }
  }

  // ---- Bewertung ----

  /**
   * Welches Lernthema bewertet wird, und ob der Benutzer es darf: Bewertet
   * wird immer das Original. Erlaubt ist es, wer es über ein Nutzungsrecht
   * verwendet oder eine Kopie davon hat – nicht dem Eigentümer selbst.
   */
  private async target(topicId: string, user: any): Promise<LearningTopic> {
    let topic = await this.topicRepo.findOne({ where: { id: topicId } });
    if (!topic) throw new NotFoundException('Lernthema nicht gefunden.');
    if (topic.ownerId === user.userId) {
      if (!topic.copiedFromId || topic.copiedFromOwnerId === user.userId) {
        throw new ForbiddenException('Eigene Lernthemen lassen sich nicht bewerten.');
      }
      const source = await this.topicRepo.findOne({ where: { id: topic.copiedFromId } });
      if (!source) throw new NotFoundException('Das Original dieser Kopie gibt es nicht mehr.');
      topic = source;
    }
    if (topic.ownerId === user.userId) throw new ForbiddenException('Eigene Lernthemen lassen sich nicht bewerten.');
    const [entries, copies] = await Promise.all([
      this.shop.expandGrants(user.userId),
      this.topicRepo.count({ where: { ownerId: user.userId, copiedFromId: topic.id } }),
    ]);
    if (!copies && !entries.some((e) => e.topicId === topic!.id)) {
      throw new ForbiddenException('Bewerten kann, wer das Lernthema nutzt oder kopiert hat.');
    }
    return topic;
  }

  async getFeedback(topicId: string, user: any) {
    const topic = await this.target(topicId, user);
    const [mine, all, owner] = await Promise.all([
      this.feedbackRepo.findOne({ where: { userId: user.userId, topicId: topic.id } }),
      this.feedbackRepo.find({ where: { topicId: topic.id } }),
      this.userRepo.findOne({ where: { id: topic.ownerId } }),
    ]);
    return {
      topicId: topic.id,
      title: topic.title,
      ownerName: this.label(owner || undefined),
      mine: mine ? { stars: mine.stars, thanks: mine.thanks, comment: mine.comment } : null,
      summary: summarizeRatings(all),
    };
  }

  /** `{ stars?: 1–5 | null, thanks?: boolean, comment?: string }` – alles leer löscht die Rückmeldung. */
  async saveFeedback(topicId: string, user: any, body: any) {
    const topic = await this.target(topicId, user);
    if (body?.stars !== undefined && body.stars !== null && body.stars !== '' && cleanStars(body.stars) === null) {
      throw new BadRequestException('Bitte 1 bis 5 Sterne.');
    }
    const stars = cleanStars(body?.stars);
    const thanks = !!body?.thanks;
    const comment = String(body?.comment || '').trim().slice(0, MAX_COMMENT) || null;
    let row = await this.feedbackRepo.findOne({ where: { userId: user.userId, topicId: topic.id } });
    if (stars === null && !thanks && !comment) {
      if (row) await this.feedbackRepo.remove(row);
      return { success: true, removed: true, summary: summarizeRatings(await this.feedbackRepo.find({ where: { topicId: topic.id } })) };
    }
    if (!row) row = this.feedbackRepo.create({ id: crypto.randomUUID(), userId: user.userId, topicId: topic.id });
    Object.assign(row, { stars, thanks, comment });
    await this.feedbackRepo.save(row);
    return { success: true, summary: summarizeRatings(await this.feedbackRepo.find({ where: { topicId: topic.id } })) };
  }
}
