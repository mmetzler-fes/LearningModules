import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Tag } from '../core/entities/tag.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import * as crypto from 'crypto';

@Injectable()
export class TagsService {
  constructor(
    @InjectRepository(Tag) private readonly tagRepo: Repository<Tag>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
  ) {}

  /**
   * Alle Module der Lehrkraft. Ein Modul kennt keinen Eigentuemer, es haengt
   * am Thema - deshalb der Umweg ueber die eigenen Themen.
   */
  private async ownModules(topics: LearningTopic[]): Promise<LearningModule[]> {
    const topicIds = topics.map((t) => t.id);
    if (topicIds.length === 0) return [];
    return this.moduleRepo.find({ where: { topicId: In(topicIds) } });
  }

  /**
   * Alle Tags der Lehrkraft mit Verwendungszähler. Der Zähler beantwortet die
   * Frage, die beim Löschen als erstes aufkommt: "Hängt da noch was dran?"
   */
  async findAll(user: any) {
    const tags = await this.tagRepo.find({ where: { ownerId: user.userId } });
    const topics = await this.topicRepo.find({ where: { ownerId: user.userId } });
    const links = await this.linkRepo.find({ where: { ownerId: user.userId } });
    const modules = await this.ownModules(topics);

    return tags
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        isArea: !!tag.isArea,
        areaIds: tag.isArea ? [] : (tag.areaIds || []).filter((id) => tags.some((a) => a.id === id && a.isArea)),
        topicCount: topics.filter((t) => (t.tagIds || []).includes(tag.id)).length,
        linkCount: links.filter((l) => (l.tagIds || []).includes(tag.id)).length,
        moduleCount: modules.filter((m) => (m.tagIds || []).includes(tag.id)).length,
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

  async create(user: any, data: { name: string; color?: string; isArea?: boolean; areaIds?: string[] }) {
    const name = this.normalize(data?.name);
    await this.assertNameFree(user.userId, name);
    const id = crypto.randomUUID();
    const isArea = !!data?.isArea;
    const tag = this.tagRepo.create({
      id,
      name,
      color: data?.color || null,
      ownerId: user.userId,
      isArea,
      areaIds: isArea ? null : await this.sanitizeAreaIds(user.userId, data?.areaIds, id),
    });
    return this.tagRepo.save(tag);
  }

  /**
   * Nur eigene Themengebiete, nicht der Tag selbst. Eine tiefere Hierarchie
   * gibt es bewusst nicht: Themengebiet und darunter Tags reicht für den
   * Überblick, mehr Ebenen machten das Zuordnen mühsam.
   */
  private async sanitizeAreaIds(ownerId: string, areaIds: any, selfId: string): Promise<string[] | null> {
    if (!Array.isArray(areaIds)) return null;
    const areas = await this.tagRepo.find({ where: { ownerId, isArea: true } });
    const valid = new Set(areas.map((a) => a.id));
    valid.delete(selfId);
    const clean = [...new Set(areaIds.map(String).filter((id) => valid.has(id)))];
    return clean.length ? clean : null;
  }

  /** Entfernt ein Themengebiet aus den Zuordnungen aller anderen Tags. */
  private async detachArea(ownerId: string, areaId: string) {
    const tags = await this.tagRepo.find({ where: { ownerId } });
    const dirty = tags.filter((t) => (t.areaIds || []).includes(areaId));
    for (const t of dirty) {
      const rest = (t.areaIds || []).filter((x) => x !== areaId);
      t.areaIds = rest.length ? rest : null;
    }
    if (dirty.length) await this.tagRepo.save(dirty);
  }

  private async own(id: string, user: any) {
    const tag = await this.tagRepo.findOne({ where: { id } });
    if (!tag || tag.ownerId !== user.userId) throw new NotFoundException('Tag nicht gefunden.');
    return tag;
  }

  async update(
    id: string,
    user: any,
    data: { name?: string; color?: string; isArea?: boolean; areaIds?: string[] },
  ) {
    const tag = await this.own(id, user);
    if (data?.name !== undefined) {
      const name = this.normalize(data.name);
      await this.assertNameFree(user.userId, name, id);
      tag.name = name;
    }
    if (data?.color !== undefined) tag.color = data.color || null;
    if (data?.isArea !== undefined && !!data.isArea !== !!tag.isArea) {
      tag.isArea = !!data.isArea;
      // Kein Themengebiet mehr: Tags, die darunter hingen, stehen danach
      // wieder ohne Themengebiet da, statt auf einen normalen Tag zu zeigen.
      if (!tag.isArea) await this.detachArea(user.userId, id);
    }
    if (tag.isArea) tag.areaIds = null;
    else if (data?.areaIds !== undefined) tag.areaIds = await this.sanitizeAreaIds(user.userId, data.areaIds, id);
    return this.tagRepo.save(tag);
  }

  /**
   * Löscht den Tag und entfernt ihn zugleich aus allen Themen, Modulen und Links.
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

    const modules = await this.ownModules(topics);
    const dirtyModules = modules.filter((m) => (m.tagIds || []).includes(id));
    for (const m of dirtyModules) m.tagIds = (m.tagIds || []).filter((x) => x !== id);
    if (dirtyModules.length) await this.moduleRepo.save(dirtyModules);

    if (tag.isArea) await this.detachArea(user.userId, id);
    await this.tagRepo.remove(tag);
    return {
      success: true,
      detachedFromTopics: dirtyTopics.length,
      detachedFromLinks: dirtyLinks.length,
      detachedFromModules: dirtyModules.length,
    };
  }

  /** Filtert eine übergebene Tag-Auswahl auf die tatsächlich eigenen Tags. */
  async sanitizeIds(user: any, tagIds: any): Promise<string[]> {
    if (!Array.isArray(tagIds)) return [];
    const own = await this.tagRepo.find({ where: { ownerId: user.userId } });
    const valid = new Set(own.map((t) => t.id));
    return [...new Set(tagIds.map(String).filter((id) => valid.has(id)))];
  }
}
