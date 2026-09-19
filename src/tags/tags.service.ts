import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tag } from '../core/entities/tag.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import * as crypto from 'crypto';

@Injectable()
export class TagsService {
  constructor(
    @InjectRepository(Tag) private readonly tagRepo: Repository<Tag>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
  ) {}

  /**
   * Alle Tags der Lehrkraft mit Verwendungszähler. Der Zähler beantwortet die
   * Frage, die beim Löschen als erstes aufkommt: "Hängt da noch was dran?"
   */
  async findAll(user: any) {
    const tags = await this.tagRepo.find({ where: { ownerId: user.userId } });
    const topics = await this.topicRepo.find({ where: { ownerId: user.userId } });
    const links = await this.linkRepo.find({ where: { ownerId: user.userId } });

    return tags
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        topicCount: topics.filter((t) => (t.tagIds || []).includes(tag.id)).length,
        linkCount: links.filter((l) => (l.tagIds || []).includes(tag.id)).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  private normalize(name: string): string {
    const clean = (name || '').trim().replace(/\s+/g, ' ');
    if (!clean) throw new BadRequestException('Der Tag braucht einen Namen.');
    if (clean.length > 40) throw new BadRequestException('Der Tagname ist zu lang (max. 40 Zeichen).');
    return clean;
  }

  /** Namen sind pro Konto eindeutig – sonst stehen zwei "Arduino" im Filter. */
  private async assertNameFree(ownerId: string, name: string, exceptId?: string) {
    const existing = await this.tagRepo.find({ where: { ownerId } });
    const clash = existing.find(
      (t) => t.id !== exceptId && t.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'),
    );
    if (clash) throw new ConflictException(`Es gibt bereits einen Tag "${clash.name}".`);
  }

  async create(user: any, data: { name: string; color?: string }) {
    const name = this.normalize(data?.name);
    await this.assertNameFree(user.userId, name);
    const tag = this.tagRepo.create({
      id: crypto.randomUUID(),
      name,
      color: data?.color || null,
      ownerId: user.userId,
    });
    return this.tagRepo.save(tag);
  }

  private async own(id: string, user: any) {
    const tag = await this.tagRepo.findOne({ where: { id } });
    if (!tag || tag.ownerId !== user.userId) throw new NotFoundException('Tag nicht gefunden.');
    return tag;
  }

  async update(id: string, user: any, data: { name?: string; color?: string }) {
    const tag = await this.own(id, user);
    if (data?.name !== undefined) {
      const name = this.normalize(data.name);
      await this.assertNameFree(user.userId, name, id);
      tag.name = name;
    }
    if (data?.color !== undefined) tag.color = data.color || null;
    return this.tagRepo.save(tag);
  }

  /**
   * Löscht den Tag und entfernt ihn zugleich aus allen Themen und Links.
   * Ohne dieses Aufräumen blieben verwaiste IDs zurück, die im Filter als
   * unsichtbare Treffer weiterwirken würden.
   */
  async remove(id: string, user: any) {
    const tag = await this.own(id, user);

    const topics = await this.topicRepo.find({ where: { ownerId: user.userId } });
    const dirtyTopics = topics.filter((t) => (t.tagIds || []).includes(id));
    for (const t of dirtyTopics) t.tagIds = (t.tagIds || []).filter((x) => x !== id);
    if (dirtyTopics.length) await this.topicRepo.save(dirtyTopics);

    const links = await this.linkRepo.find({ where: { ownerId: user.userId } });
    const dirtyLinks = links.filter((l) => (l.tagIds || []).includes(id));
    for (const l of dirtyLinks) l.tagIds = (l.tagIds || []).filter((x) => x !== id);
    if (dirtyLinks.length) await this.linkRepo.save(dirtyLinks);

    await this.tagRepo.remove(tag);
    return { success: true, detachedFromTopics: dirtyTopics.length, detachedFromLinks: dirtyLinks.length };
  }

  /** Filtert eine übergebene Tag-Auswahl auf die tatsächlich eigenen Tags. */
  async sanitizeIds(user: any, tagIds: any): Promise<string[]> {
    if (!Array.isArray(tagIds)) return [];
    const own = await this.tagRepo.find({ where: { ownerId: user.userId } });
    const valid = new Set(own.map((t) => t.id));
    return [...new Set(tagIds.map(String).filter((id) => valid.has(id)))];
  }
}
