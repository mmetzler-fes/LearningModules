import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../core/entities/user.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { Tag } from '../core/entities/tag.entity';
import { Result } from '../core/entities/result.entity';
import { UploadedFile } from '../core/entities/uploaded-file.entity';
import { TeacherGroup } from '../core/entities/teacher-group.entity';

/**
 * Übergabe der Hinterlassenschaft einer ausscheidenden Lehrkraft.
 *
 * Vorher wurde der Benutzer einfach gelöscht. Seine Themen blieben mit einer
 * ownerId zurück, die auf niemanden mehr zeigte – für alle unsichtbar, von
 * niemandem zu bearbeiten, zu löschen oder neu freizugeben. Kolleginnen mit
 * einer Nutzungsfreigabe behielten sie sogar, weil accessLevel() nur IDs
 * vergleicht: Ihre Links liefen weiter, die Inhalte dahinter waren aber für
 * immer eingefroren.
 *
 * Jetzt übernimmt ein Admin das Eigentum. Nichts geht verloren, nichts stirbt
 * mitten im Schuljahr, und jemand ist wieder zuständig. Aufräumen kann der
 * Admin danach in Ruhe – das ist eine Entscheidung, keine Nebenwirkung des
 * Löschens.
 */
@Injectable()
export class HandoverService {
  private readonly logger = new Logger(HandoverService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(TopicQuickLink) private readonly quickRepo: Repository<TopicQuickLink>,
    @InjectRepository(Tag) private readonly tagRepo: Repository<Tag>,
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    @InjectRepository(UploadedFile) private readonly uploadRepo: Repository<UploadedFile>,
    @InjectRepository(TeacherGroup) private readonly groupRepo: Repository<TeacherGroup>,
  ) {}

  /**
   * Schreibt alles, was `from` gehört, auf `to` um und entfernt `from` aus
   * den Freigabelisten der anderen.
   *
   * Bewusst *nicht* angefasst wird die Herkunft von Kopien
   * (`copiedFrom*`): Sie hält fest, wer etwas verfasst hat, und das ändert
   * sich durch das Ausscheiden nicht. Genau dafür stehen dort Name und Titel
   * als Text und nicht nur als Verweis.
   */
  async transferOwnership(from: User, to: User) {
    const fromLabel = from.displayName || from.email;
    const counts = {
      topics: await this.reassign(this.topicRepo, 'ownerId', from.id, to.id),
      links: await this.reassign(this.linkRepo, 'ownerId', from.id, to.id),
      quickLinks: await this.reassign(this.quickRepo, 'ownerId', from.id, to.id),
      results: await this.reassign(this.resultRepo, 'teacherId', from.id, to.id),
      uploads: await this.reassign(this.uploadRepo, 'ownerId', from.id, to.id),
      tags: await this.transferTags(from.id, to.id, fromLabel),
      sharingEntriesRemoved: await this.dropFromSharing(from.id),
      groupsLeft: await this.dropFromGroups(from.id),
    };

    this.logger.log(
      `Übergabe ${fromLabel} → ${to.displayName || to.email}: ` +
        `${counts.topics} Themen, ${counts.links} Links, ${counts.quickLinks} Quick-Links, ` +
        `${counts.results} Ergebnisse, ${counts.tags} Tags, ${counts.uploads} Dateien, ` +
        `${counts.sharingEntriesRemoved} Freigabe-Einträge und ${counts.groupsLeft} Gruppen bereinigt`,
    );
    return counts;
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
   * Tags wandern mit, damit die übernommenen Themen ihre Einordnung behalten.
   *
   * Innerhalb eines Kontos ist der Name eindeutig (TagsService). Trägt der
   * Admin schon ein gleichnamiges Schlagwort, bekommt das übernommene einen
   * Zusatz statt still zu verschmelzen – zwei Lehrkräfte meinen mit
   * "Projekt" selten dasselbe.
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

  /**
   * Entfernt den ausscheidenden Benutzer aus den Freigabelisten aller
   * anderen. Sonst bliebe er dort als ID stehen und die Abzeichen zählten
   * jemanden mit, den es nicht mehr gibt.
   */
  private async dropFromSharing(userId: string) {
    const topics = await this.topicRepo.find();
    const touched: LearningTopic[] = [];

    for (const topic of topics) {
      let changed = false;

      if (Array.isArray(topic.sharedWith) && topic.sharedWith.includes(userId)) {
        topic.sharedWith = topic.sharedWith.filter((id) => id !== userId);
        changed = true;
      }
      if (Array.isArray(topic.sharedAccess) && topic.sharedAccess.some((e) => e?.userId === userId)) {
        topic.sharedAccess = topic.sharedAccess.filter((e) => e?.userId !== userId);
        changed = true;
      }
      if (changed) touched.push(topic);
    }

    if (touched.length) await this.topicRepo.save(touched);
    return touched.length;
  }

  /** Nimmt den ausscheidenden Benutzer aus allen Gruppen heraus. */
  private async dropFromGroups(userId: string) {
    const groups = await this.groupRepo.find();
    const touched = groups.filter((g) => Array.isArray(g.memberIds) && g.memberIds.includes(userId));
    for (const g of touched) g.memberIds = (g.memberIds || []).filter((id) => id !== userId);
    if (touched.length) await this.groupRepo.save(touched);
    return touched.length;
  }

  /**
   * Wer übernimmt? Der handelnde Admin, sofern er nicht selbst gelöscht
   * wird; sonst der dienstälteste andere Admin. Ein Konto ohne Nachfolger
   * kann es nicht geben – deleteUser lässt den letzten Admin nicht löschen.
   */
  async pickSuccessor(target: User, actingAdminId: string): Promise<User | null> {
    if (actingAdminId !== target.id) {
      const acting = await this.userRepo.findOne({ where: { id: actingAdminId } });
      if (acting) return acting;
    }
    const admins = await this.userRepo.find({ where: { role: 'admin' } });
    return admins
      .filter((a) => a.id !== target.id)
      .sort((a, b) => (a.createdAt as any) - (b.createdAt as any))[0] || null;
  }
}
