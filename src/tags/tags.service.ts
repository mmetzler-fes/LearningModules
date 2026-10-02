import { Injectable, NotFoundException, ConflictException, BadRequestException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Tag } from '../core/entities/tag.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { User } from '../core/entities/user.entity';
import { SchoolsService } from '../core/schools/schools.service';
import * as crypto from 'crypto';

/**
 * Wem ein Tag gehört: einer Lehrkraft (ownerId = Benutzer-ID) oder einer
 * Schule (ownerId = "school:<id>", schoolId gesetzt). Der Präfix hält
 * Schul-Tags aus allen Abfragen "Tags der Lehrkraft X" heraus.
 */
interface TagScope {
  ownerId: string;
  schoolId: string | null;
}

type TagData = { name?: string; color?: string; isArea?: boolean; areaIds?: string[] };

const schoolOwner = (schoolId: string) => `school:${schoolId}`;

@Injectable()
export class TagsService implements OnModuleInit {
  private readonly logger = new Logger(TagsService.name);

  constructor(
    @InjectRepository(Tag) private readonly tagRepo: Repository<Tag>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly schools: SchoolsService,
  ) {}

  /**
   * Beim Start verwaiste Verweise aufräumen: Tag-IDs an Themen, Modulen und
   * Links, die es nicht mehr gibt, und Themengebiets-Zuordnungen, die auf
   * gelöschte oder herabgestufte Tags zeigen. Ältere Versionen haben beim
   * Löschen nicht überall aufgeräumt; so wird der Bestand wieder konsistent.
   */
  async onModuleInit() {
    const tags = await this.tagRepo.find();
    const known = new Set(tags.map((t) => t.id));
    const areas = new Set(tags.filter((t) => t.isArea).map((t) => t.id));
    const fixed = {
      topics: await this.prune(this.topicRepo, (id) => known.has(id)),
      links: await this.prune(this.linkRepo, (id) => known.has(id)),
      modules: await this.prune(this.moduleRepo, (id) => known.has(id)),
      tags: 0,
    };
    const dirtyTags = tags.filter((t) => (t.areaIds || []).some((id) => !areas.has(id) || id === t.id) || (t.isArea && t.areaIds?.length));
    for (const t of dirtyTags) {
      const rest = t.isArea ? [] : (t.areaIds || []).filter((id) => areas.has(id) && id !== t.id);
      t.areaIds = rest.length ? rest : null;
    }
    if (dirtyTags.length) await this.tagRepo.save(dirtyTags);
    fixed.tags = dirtyTags.length;
    if (fixed.topics + fixed.links + fixed.modules + fixed.tags > 0) {
      this.logger.log(
        `Verwaiste Tag-Verweise bereinigt: ${fixed.topics} Themen, ${fixed.modules} Module, ${fixed.links} Links, ${fixed.tags} Tags`,
      );
    }
  }

  /** Entfernt aus `tagIds` aller Einträge, was `keep` nicht besteht. Liefert die Zahl geänderter Einträge. */
  private async prune<T extends { tagIds: string[] | null }>(repo: Repository<T>, keep: (id: string) => boolean) {
    const rows = await repo.find();
    const dirty = rows.filter((r) => (r.tagIds || []).some((id) => !keep(id)));
    for (const r of dirty) r.tagIds = (r.tagIds || []).filter(keep);
    if (dirty.length) await repo.save(dirty as any);
    return dirty.length;
  }

  private ownScope(user: any): TagScope {
    return { ownerId: user.userId, schoolId: null };
  }

  /** Die Schul-Tags pflegt nur ein Schuladmin der Schule. */
  private async schoolScope(user: any): Promise<TagScope> {
    const school = await this.schools.requireSchoolAdmin(user);
    return { ownerId: schoolOwner(school.id), schoolId: school.id };
  }

  private inScope(scope: TagScope) {
    return this.tagRepo.find({ where: { ownerId: scope.ownerId } });
  }

  /** Vorgaben der Schule, die eine Lehrkraft sieht und vergeben darf. */
  private schoolTagsOf(user: any): Promise<Tag[]> {
    return user?.schoolId ? this.tagRepo.find({ where: { ownerId: schoolOwner(user.schoolId) } }) : Promise.resolve([]);
  }

  /**
   * Alle Module zu einer Themenliste. Ein Modul kennt keinen Eigentuemer,
   * es haengt am Thema - deshalb der Umweg ueber die Themen.
   */
  private async modulesOf(topics: LearningTopic[]): Promise<LearningModule[]> {
    const topicIds = topics.map((t) => t.id);
    if (topicIds.length === 0) return [];
    return this.moduleRepo.find({ where: { topicId: In(topicIds) } });
  }

  /**
   * Tags mit Verwendungszähler. Der Zähler beantwortet die Frage, die beim
   * Löschen als erstes aufkommt: "Hängt da noch was dran?" Gezählt wird in
   * den Inhalten von `ownerIds` – bei der Lehrkraft die eigenen, bei der
   * Schule die aller ihrer Lehrkräfte.
   */
  private async withUsage(tags: Tag[], ownerIds: string[]) {
    const topics = ownerIds.length ? await this.topicRepo.find({ where: { ownerId: In(ownerIds) } }) : [];
    const links = ownerIds.length ? await this.linkRepo.find({ where: { ownerId: In(ownerIds) } }) : [];
    const modules = await this.modulesOf(topics);
    const areas = new Set(tags.filter((t) => t.isArea).map((t) => t.id));

    return tags
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        isArea: !!tag.isArea,
        isSchoolTag: !!tag.schoolId,
        areaIds: tag.isArea ? [] : (tag.areaIds || []).filter((id) => areas.has(id)),
        topicCount: topics.filter((t) => (t.tagIds || []).includes(tag.id)).length,
        linkCount: links.filter((l) => (l.tagIds || []).includes(tag.id)).length,
        moduleCount: modules.filter((m) => (m.tagIds || []).includes(tag.id)).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  /**
   * Eigene Tags plus die (schreibgeschützten) Vorgaben der eigenen Schule.
   * Themengebiete, die die Lehrkraft ausgeblendet hat, tragen `hidden`.
   */
  async findAll(user: any) {
    const tags = [...(await this.inScope(this.ownScope(user))), ...(await this.schoolTagsOf(user))];
    const me = await this.userRepo.findOne({ where: { id: user.userId } });
    const hidden = new Set(me?.hiddenAreaIds || []);
    return (await this.withUsage(tags, [user.userId])).map((t) => ({ ...t, hidden: t.isArea && hidden.has(t.id) }));
  }

  /** Persönliche Auswahl ausgeblendeter Themengebiete speichern (nur gültige Gebiete). */
  async setHiddenAreas(user: any, areaIds: any) {
    const usable = [...(await this.inScope(this.ownScope(user))), ...(await this.schoolTagsOf(user))];
    const areas = new Set(usable.filter((t) => t.isArea).map((t) => t.id));
    const clean = Array.isArray(areaIds) ? [...new Set(areaIds.map(String).filter((id) => areas.has(id)))] : [];
    await this.userRepo.update(user.userId, { hiddenAreaIds: clean.length ? clean : null });
    return { success: true, hiddenAreaIds: clean };
  }

  /** Die Schul-Tags für den Schuladmin, gezählt über alle Lehrkräfte der Schule. */
  async findSchoolTags(user: any) {
    const scope = await this.schoolScope(user);
    const members = await this.userRepo.find({ where: { schoolId: scope.schoolId! } });
    return this.withUsage(await this.inScope(scope), members.map((m) => m.id));
  }

  private normalize(name: string): string {
    const clean = (name || '').trim().replace(/\s+/g, ' ');
    if (!clean) throw new BadRequestException('Der Tag braucht einen Namen.');
    if (clean.length > 40) throw new BadRequestException('Der Tagname ist zu lang (max. 40 Zeichen).');
    return clean;
  }

  /**
   * Namen sind je Eigentümer eindeutig – sonst stehen zwei "Arduino" im
   * Filter. Eine Lehrkraft darf auch keinen Namen wählen, den ihre Schule
   * schon vorgibt.
   */
  private async assertNameFree(scope: TagScope, name: string, exceptId: string | undefined, user?: any) {
    const existing = [...(await this.inScope(scope)), ...(scope.schoolId ? [] : await this.schoolTagsOf(user))];
    const clash = existing.find(
      (t) => t.id !== exceptId && t.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'),
    );
    if (clash) {
      throw new ConflictException(
        clash.schoolId && !scope.schoolId
          ? `"${clash.name}" gibt eure Schule bereits als Tag vor.`
          : `Es gibt bereits einen Tag "${clash.name}".`,
      );
    }
  }

  /**
   * Gültige Themengebiete für einen Tag: die des eigenen Bereichs, bei
   * Lehrkräften zusätzlich die der Schule – eigene Tags dürfen unter
   * Schul-Themengebieten stehen. Nicht der Tag selbst. Eine tiefere
   * Hierarchie gibt es bewusst nicht: Themengebiet und darunter Tags reicht
   * für den Überblick, mehr Ebenen machten das Zuordnen mühsam.
   */
  private async sanitizeAreaIds(scope: TagScope, areaIds: any, selfId: string, user?: any): Promise<string[] | null> {
    if (!Array.isArray(areaIds)) return null;
    const pool = [...(await this.inScope(scope)), ...(scope.schoolId ? [] : await this.schoolTagsOf(user))];
    const valid = new Set(pool.filter((t) => t.isArea).map((a) => a.id));
    valid.delete(selfId);
    const clean = [...new Set(areaIds.map(String).filter((id) => valid.has(id)))];
    return clean.length ? clean : null;
  }

  /**
   * Entfernt ein Themengebiet aus den Zuordnungen aller Tags. Bei einem
   * Schul-Themengebiet hängen auch eigene Tags der Lehrkräfte darunter.
   */
  private async detachArea(areaId: string) {
    const tags = await this.tagRepo.find();
    const dirty = tags.filter((t) => (t.areaIds || []).includes(areaId));
    for (const t of dirty) {
      const rest = (t.areaIds || []).filter((x) => x !== areaId);
      t.areaIds = rest.length ? rest : null;
    }
    if (dirty.length) await this.tagRepo.save(dirty);
  }

  private async createIn(scope: TagScope, data: TagData, user?: any) {
    const name = this.normalize(data?.name || '');
    await this.assertNameFree(scope, name, undefined, user);
    const id = crypto.randomUUID();
    const isArea = !!data?.isArea;
    const tag = this.tagRepo.create({
      id,
      name,
      color: data?.color || null,
      ownerId: scope.ownerId,
      schoolId: scope.schoolId,
      isArea,
      areaIds: isArea ? null : await this.sanitizeAreaIds(scope, data?.areaIds, id, user),
    });
    return this.tagRepo.save(tag);
  }

  private async findIn(scope: TagScope, id: string) {
    const tag = await this.tagRepo.findOne({ where: { id } });
    if (!tag || tag.ownerId !== scope.ownerId) throw new NotFoundException('Tag nicht gefunden.');
    return tag;
  }

  private async updateIn(scope: TagScope, id: string, data: TagData, user?: any) {
    const tag = await this.findIn(scope, id);
    if (data?.name !== undefined) {
      const name = this.normalize(data.name);
      await this.assertNameFree(scope, name, id, user);
      tag.name = name;
    }
    if (data?.color !== undefined) tag.color = data.color || null;
    if (data?.isArea !== undefined && !!data.isArea !== !!tag.isArea) {
      tag.isArea = !!data.isArea;
      // Kein Themengebiet mehr: Tags, die darunter hingen, stehen danach
      // wieder ohne Themengebiet da, statt auf einen normalen Tag zu zeigen.
      if (!tag.isArea) await this.detachArea(id);
    }
    if (tag.isArea) tag.areaIds = null;
    else if (data?.areaIds !== undefined) tag.areaIds = await this.sanitizeAreaIds(scope, data.areaIds, id, user);
    return this.tagRepo.save(tag);
  }

  /**
   * Löscht den Tag und entfernt ihn zugleich aus allen Themen, Modulen und
   * Links, an denen er hängt – überall, nicht nur bei der Eigentümerin:
   * Auch Themen ehemaliger Schulmitglieder oder anderer Konten sollen keine
   * toten Verweise behalten. Tag-IDs sind eindeutig, das ist also gefahrlos.
   */
  private async removeIn(scope: TagScope, id: string) {
    const tag = await this.findIn(scope, id);
    const gone = (x: string) => x !== id;
    const detachedFromTopics = await this.prune(this.topicRepo, gone);
    const detachedFromLinks = await this.prune(this.linkRepo, gone);
    const detachedFromModules = await this.prune(this.moduleRepo, gone);
    if (tag.isArea) await this.detachArea(id);
    await this.tagRepo.remove(tag);
    return { success: true, detachedFromTopics, detachedFromLinks, detachedFromModules };
  }

  // ---- Eigene Tags der Lehrkraft ----

  create(user: any, data: TagData) {
    return this.createIn(this.ownScope(user), data, user);
  }

  update(id: string, user: any, data: TagData) {
    return this.updateIn(this.ownScope(user), id, data, user);
  }

  remove(id: string, user: any) {
    return this.removeIn(this.ownScope(user), id);
  }

  // ---- Tag-Struktur der Schule (Schuladmin) ----

  async createSchoolTag(user: any, data: TagData) {
    return this.createIn(await this.schoolScope(user), data);
  }

  async updateSchoolTag(id: string, user: any, data: TagData) {
    return this.updateIn(await this.schoolScope(user), id, data);
  }

  async removeSchoolTag(id: string, user: any) {
    return this.removeIn(await this.schoolScope(user), id);
  }

  /** Filtert eine übergebene Tag-Auswahl auf eigene Tags und die der eigenen Schule. */
  async sanitizeIds(user: any, tagIds: any): Promise<string[]> {
    if (!Array.isArray(tagIds)) return [];
    const usable = [...(await this.inScope(this.ownScope(user))), ...(await this.schoolTagsOf(user))];
    const valid = new Set(usable.map((t) => t.id));
    return [...new Set(tagIds.map(String).filter((id) => valid.has(id)))];
  }
}
