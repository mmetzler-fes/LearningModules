import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../core/entities/user.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { Tag } from '../core/entities/tag.entity';
import { Result } from '../core/entities/result.entity';
import { TeacherGroup } from '../core/entities/teacher-group.entity';
import { ShopOffer } from '../core/entities/shop-offer.entity';

/**
 * Was beim Löschen oder Zusammenführen eines Kontos an jemand anderen geht:
 * Themen-Links, Quick-Links, Ergebnisse und Tags.
 *
 * Die Inhalte selbst (Themen, Module) behandelt der AccountsService – dort
 * entscheidet das Rechtemodell, was mit ihnen geschieht. Hier geht es nur um
 * das, was einer Lehrkraft gehört, ohne Inhalt im Sinne des Shops zu sein.
 */
@Injectable()
export class HandoverService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(TopicQuickLink) private readonly quickRepo: Repository<TopicQuickLink>,
    @InjectRepository(Tag) private readonly tagRepo: Repository<Tag>,
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    @InjectRepository(TeacherGroup) private readonly groupRepo: Repository<TeacherGroup>,
    @InjectRepository(ShopOffer) private readonly offerRepo: Repository<ShopOffer>,
  ) {}

  /**
   * Schreibt Links, Quick-Links, Ergebnisse und Tags von `from` auf
   * `to` um. Mit `replaceInGroups` tritt `to` in den Gruppen und
   * Angebots-Zielgruppen an die Stelle von `from` (Zusammenführen); sonst
   * fällt `from` dort nur heraus (Löschen).
   */
  async transferBelongings(from: User, to: User, replaceInGroups: boolean) {
    const fromLabel = from.displayName || from.email;
    return {
      links: await this.reassign(this.linkRepo, 'ownerId', from.id, to.id),
      quickLinks: await this.transferQuickLinks(from.id, to.id),
      results: await this.reassign(this.resultRepo, 'teacherId', from.id, to.id),
      tags: await this.transferTags(from.id, to.id, fromLabel),
      groups: await this.updateGroups(from.id, replaceInGroups ? to.id : null),
      audiences: await this.updateAudiences(from.id, replaceInGroups ? to.id : null),
    };
  }

  /** Eine Spalte in einer Tabelle umschreiben; liefert die Anzahl der Zeilen. */
  private async reassign(repo: Repository<any>, column: string, fromId: string, toId: string) {
    const rows = await repo.find({ where: { [column]: fromId } });
    if (rows.length === 0) return 0;
    for (const row of rows) row[column] = toId;
    await repo.save(rows);
    return rows.length;
  }

  /**
   * Quick-Links sind je Thema und Lehrkraft eindeutig. Hat `to` schon einen
   * auf dasselbe Thema, bleibt seiner, und der von `from` entfällt.
   */
  private async transferQuickLinks(fromId: string, toId: string) {
    const mine = await this.quickRepo.find({ where: { ownerId: fromId } });
    if (mine.length === 0) return 0;
    const theirs = await this.quickRepo.find({ where: { ownerId: toId } });
    const taken = new Set(theirs.map((q) => q.topicId));
    const move = mine.filter((q) => !taken.has(q.topicId));
    const drop = mine.filter((q) => taken.has(q.topicId));
    for (const q of move) q.ownerId = toId;
    if (move.length) await this.quickRepo.save(move);
    if (drop.length) await this.quickRepo.remove(drop);
    return move.length;
  }

  /**
   * Tags wandern mit, damit die übernommenen Inhalte ihre Einordnung
   * behalten. Innerhalb eines Kontos ist der Name eindeutig; ein gleichnamiges
   * Schlagwort bekommt deshalb einen Zusatz statt still zu verschmelzen.
   */
  private async transferTags(fromId: string, toId: string, fromLabel: string) {
    const mine = await this.tagRepo.find({ where: { ownerId: fromId } });
    if (mine.length === 0) return 0;

    const existing = await this.tagRepo.find({ where: { ownerId: toId } });
    const taken = new Set(existing.map((t) => t.name.toLowerCase()));

    for (const tag of mine) {
      if (taken.has(tag.name.toLowerCase())) tag.name = `${tag.name} (von ${fromLabel})`;
      taken.add(tag.name.toLowerCase());
      tag.ownerId = toId;
    }
    await this.tagRepo.save(mine);
    return mine.length;
  }

  /** Gruppenmitgliedschaft: ersetzen (Zusammenführen) oder streichen (Löschen). */
  private async updateGroups(userId: string, replacement: string | null) {
    const groups = await this.groupRepo.find();
    const touched = groups.filter((g) => Array.isArray(g.memberIds) && g.memberIds.includes(userId));
    for (const g of touched) {
      const ids = (g.memberIds || []).map((id) => (id === userId ? replacement : id)).filter(Boolean) as string[];
      g.memberIds = [...new Set(ids)];
    }
    if (touched.length) await this.groupRepo.save(touched);
    return touched.length;
  }

  /** Dasselbe für die Zielgruppen der Shop-Angebote. */
  private async updateAudiences(userId: string, replacement: string | null) {
    const offers = await this.offerRepo.find();
    const touched = offers.filter((o) => Array.isArray(o.audience) && o.audience.includes(userId));
    for (const o of touched) {
      const ids = o.audience.map((id) => (id === userId ? replacement : id)).filter(Boolean) as string[];
      o.audience = [...new Set(ids)];
    }
    if (touched.length) await this.offerRepo.save(touched);
    return touched.length;
  }

  /**
   * Wer übernimmt beim Löschen? Der handelnde Admin, sofern er nicht selbst
   * gelöscht wird; sonst der dienstälteste andere aktive Admin.
   */
  async pickSuccessor(target: User, actingUserId: string): Promise<User | null> {
    if (actingUserId !== target.id) {
      const acting = await this.userRepo.findOne({ where: { id: actingUserId } });
      if (acting && acting.role === 'admin') return acting;
    }
    const admins = await this.userRepo.find({ where: { role: 'admin', active: true } });
    return (
      admins
        .filter((a) => a.id !== target.id)
        .sort((a, b) => (a.createdAt as any) - (b.createdAt as any))[0] || null
    );
  }
}
