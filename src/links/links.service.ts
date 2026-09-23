import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TopicLink, LinkMode, LinkTopicSelection } from '../core/entities/topic-link.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { TagsService } from '../tags/tags.service';
import { TopicsService } from '../topics/topics.service';
import { GroupsService } from '../groups/groups.service';
import { baseUrl, renderQr } from '../core/share/link-url';
import * as crypto from 'crypto';

const ALL_MODES: LinkMode[] = ['quiz', 'exam', 'learn'];

@Injectable()
export class LinksService {
  constructor(
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    private readonly tagsService: TagsService,
    private readonly topicsService: TopicsService,
    private readonly groupsService: GroupsService,
  ) {}

  // ---- Eingaben prüfen ----

  private cleanModes(modes: any): LinkMode[] {
    const list = Array.isArray(modes) ? modes.filter((m) => ALL_MODES.includes(m)) : [];
    const unique = [...new Set(list)] as LinkMode[];
    if (unique.length === 0) {
      throw new BadRequestException('Bitte mindestens einen Modus auswählen (Quiz, Klassenarbeit oder Lernen mit Lösungen).');
    }
    // Reihenfolge festhalten, damit die Auswahl beim Schüler immer gleich aussieht.
    return ALL_MODES.filter((m) => unique.includes(m));
  }

  /**
   * Übernimmt nur Themen, die der Lehrkraft gehören, und nur Modul-IDs, die
   * wirklich in diesen Themen liegen. So kann kein Link auf fremde Inhalte
   * zeigen, auch nicht durch eine manipulierte Anfrage.
   */
  private async cleanSelection(user: any, selection: any): Promise<LinkTopicSelection[]> {
    const raw: any[] = Array.isArray(selection) ? selection : [];
    if (raw.length === 0) throw new BadRequestException('Bitte mindestens ein Thema auswählen.');

    const topicIds = [...new Set(raw.map((e) => String(e?.topicId || '')).filter(Boolean))];
    const found = topicIds.length ? await this.topicRepo.find({ where: { id: In(topicIds) } }) : [];
    // Eigene Themen und solche, die mir jemand zur Nutzung freigegeben hat.
    // Alles andere fällt hier heraus, auch bei manipulierter Anfrage.
    const topics = found.filter((t) => this.topicsService.accessLevel(t, user) !== 'none');
    const ownTopicIds = new Set(topics.map((t) => t.id));

    const modules = ownTopicIds.size
      ? await this.moduleRepo.find({ where: { topicId: In([...ownTopicIds]) } })
      : [];
    const modulesByTopic = new Map<string, Set<string>>();
    for (const m of modules) {
      if (!modulesByTopic.has(m.topicId)) modulesByTopic.set(m.topicId, new Set());
      modulesByTopic.get(m.topicId)!.add(m.id);
    }

    const result: LinkTopicSelection[] = [];
    for (const entry of raw) {
      const topicId = String(entry?.topicId || '');
      if (!ownTopicIds.has(topicId)) continue;

      const all = !!entry?.all;
      if (all) {
        result.push({ topicId, all: true });
        continue;
      }
      const valid = modulesByTopic.get(topicId) || new Set<string>();
      const requested: string[] = (Array.isArray(entry?.moduleIds) ? entry.moduleIds : []).map((x: any) => String(x));
      const moduleIds = [...new Set(requested)].filter((id) => valid.has(id));
      // Ein Thema ohne gewähltes Modul trüge nichts bei und würde den Schüler
      // nur mit einer leeren Überschrift verwirren.
      if (moduleIds.length) result.push({ topicId, all: false, moduleIds });
    }

    if (result.length === 0) {
      throw new BadRequestException('Die Auswahl enthält keine gültigen Themen oder Module.');
    }
    return result;
  }

  // ---- Auflösen der Auswahl in eine Modulliste ----

  /**
   * Baut aus der gespeicherten Auswahl die tatsächliche Modulliste.
   *
   * Regeln:
   *  - `all` nimmt alle freigegebenen Module des Themas (samt Submodulen).
   *  - sonst zählt die explizite Auswahl; ein gewähltes Elternmodul zieht
   *    nur die ebenfalls gewählten Submodule nach sich.
   *  - Ein Elternmodul, von dem kein Submodul gewählt ist, bleibt draußen –
   *    es gäbe nichts zu beantworten.
   */
  async resolveModules(link: TopicLink): Promise<Array<{ topic: LearningTopic; modules: LearningModule[] }>> {
    const selection = link.selection || [];
    const topicIds = selection.map((s) => s.topicId);
    if (topicIds.length === 0) return [];

    const found = await this.topicRepo.find({ where: { id: In(topicIds) } });

    // Die Freigabe wird bei jedem Start neu geprüft, nicht nur beim Speichern
    // des Links. Zieht der Eigentümer sie zurück, wirkt das sofort – sonst
    // liefe ein einmal gespeicherter Link unbegrenzt weiter. Das gilt auch
    // für Freigaben an eine Gruppe: Wer aus der Fachschaft ausscheidet,
    // verliert den Zugriff mit dem nächsten Schülerstart.
    const linkOwner = await this.groupsService.asUser(link.ownerId);
    const topics = found.filter((t) => this.topicsService.accessLevel(t, linkOwner) !== 'none');
    const byId = new Map(topics.map((t) => [t.id, t]));
    const allModules = topics.length
      ? await this.moduleRepo.find({ where: { topicId: In(topics.map((t) => t.id)) } })
      : [];

    const out: Array<{ topic: LearningTopic; modules: LearningModule[] }> = [];

    for (const entry of selection) {
      const topic = byId.get(entry.topicId);
      if (!topic) continue;

      const ofTopic = allModules
        .filter((m) => m.topicId === topic.id)
        .sort((a, b) => a.orderIndex - b.orderIndex);

      const chosen = new Set(entry.all ? ofTopic.map((m) => m.id) : entry.moduleIds || []);

      const roots = ofTopic.filter((m) => !m.parentId);
      const childrenOf = (id: string) =>
        ofTopic.filter((m) => m.parentId === id).sort((a, b) => a.orderIndex - b.orderIndex);

      const picked: LearningModule[] = [];
      for (const root of roots) {
        const allKids = childrenOf(root.id);

        if (allKids.length === 0) {
          if (chosen.has(root.id)) picked.push(root);
          continue;
        }

        const pickedKids = allKids.filter((k) => chosen.has(k.id));
        // Ist nur das Elternmodul angehakt, ist das ganze Modul gemeint.
        const kids = pickedKids.length > 0 ? pickedKids : chosen.has(root.id) ? allKids : [];
        if (kids.length > 0) {
          picked.push(Object.assign(new LearningModule(), root, { subModules: kids }));
        }
      }

      if (picked.length) out.push({ topic, modules: picked });
    }

    return out;
  }

  /**
   * Themen im Link, auf die der Eigentümer keinen Zugriff (mehr) hat –
   * weil sie gelöscht wurden oder die Freigabe zurückgezogen wurde.
   * Der Link funktioniert weiter, aber die Lehrkraft soll es merken.
   */
  private async countUnavailable(link: TopicLink): Promise<number> {
    const ids = (link.selection || []).map((s) => s.topicId);
    if (ids.length === 0) return 0;

    const found = await this.topicRepo.find({ where: { id: In(ids) } });
    const linkOwner = await this.groupsService.asUser(link.ownerId);
    const ok = new Set(
      found.filter((t) => this.topicsService.accessLevel(t, linkOwner) !== 'none').map((t) => t.id),
    );
    return ids.filter((id) => !ok.has(id)).length;
  }

  // ---- CRUD ----

  private async own(id: string, user: any): Promise<TopicLink> {
    const link = await this.linkRepo.findOne({ where: { id } });
    if (!link || link.ownerId !== user.userId) throw new NotFoundException('Link nicht gefunden.');
    return link;
  }

  async findAll(user: any, req?: any) {
    const links = await this.linkRepo.find({ where: { ownerId: user.userId } });
    links.sort((a, b) => a.name.localeCompare(b.name, 'de'));

    const base = baseUrl(req);
    return Promise.all(
      links.map(async (link) => {
        const resolved = await this.resolveModules(link);
        return {
          ...this.publicShape(link),
          url: link.token ? `${base}/?l=${link.token}` : null,
          topicCount: resolved.length,
          moduleCount: resolved.reduce((n, r) => n + r.modules.length, 0),
          unavailableTopics: await this.countUnavailable(link),
          usesForeignContent: resolved.some((r) => r.topic.ownerId !== link.ownerId),
        };
      }),
    );
  }

  /** Passwort niemals zurückgeben – nur, ob eines gesetzt ist. */
  private publicShape(link: TopicLink) {
    const { accessPassword, ...rest } = link;
    return { ...rest, hasPassword: !!accessPassword };
  }

  async findOne(id: string, user: any, req?: any) {
    const link = await this.own(id, user);
    const resolved = await this.resolveModules(link);
    return {
      ...this.publicShape(link),
      url: link.token ? `${baseUrl(req)}/?l=${link.token}` : null,
      topicCount: resolved.length,
      moduleCount: resolved.reduce((n, r) => n + r.modules.length, 0),
      unavailableTopics: await this.countUnavailable(link),
      usesForeignContent: resolved.some((r) => r.topic.ownerId !== link.ownerId),
    };
  }

  async create(user: any, body: any, req?: any) {
    const name = (body?.name || '').trim();
    if (!name) throw new BadRequestException('Der Link braucht einen Namen, z. B. "TG12 Informatik Arduino".');

    const link = this.linkRepo.create({
      id: crypto.randomUUID(),
      name,
      ownerId: user.userId,
      token: crypto.randomBytes(12).toString('base64url'),
      active: body?.active !== false,
      modes: this.cleanModes(body?.modes),
      selection: await this.cleanSelection(user, body?.selection),
      accessPassword: (body?.accessPassword || '').trim() || null,
      singleAttempt: !!body?.singleAttempt,
      tagIds: await this.tagsService.sanitizeIds(user, body?.tagIds),
    });
    await this.linkRepo.save(link);
    return this.findOne(link.id, user, req);
  }

  async update(id: string, user: any, body: any, req?: any) {
    const link = await this.own(id, user);

    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new BadRequestException('Der Link braucht einen Namen.');
      link.name = name;
    }
    if (body?.modes !== undefined) link.modes = this.cleanModes(body.modes);
    if (body?.selection !== undefined) link.selection = await this.cleanSelection(user, body.selection);
    if (body?.active !== undefined) link.active = !!body.active;
    if (body?.singleAttempt !== undefined) link.singleAttempt = !!body.singleAttempt;
    if (body?.tagIds !== undefined) link.tagIds = await this.tagsService.sanitizeIds(user, body.tagIds);
    // Leerer String löscht das Passwort, `undefined` lässt es unangetastet.
    if (body?.accessPassword !== undefined) {
      link.accessPassword = String(body.accessPassword).trim() || null;
    }

    await this.linkRepo.save(link);
    return this.findOne(id, user, req);
  }

  async remove(id: string, user: any) {
    const link = await this.own(id, user);
    await this.linkRepo.remove(link);
    return { success: true };
  }

  /** Link zum Versenden: URL und QR-Code. `regenerate` entwertet den alten. */
  async share(id: string, user: any, regenerate = false, req?: any) {
    const link = await this.own(id, user);
    if (!link.token || regenerate) {
      link.token = crypto.randomBytes(12).toString('base64url');
      await this.linkRepo.save(link);
    }
    const url = `${baseUrl(req)}/?l=${link.token}`;
    const resolved = await this.resolveModules(link);
    return {
      token: link.token,
      url,
      qrSvg: await renderQr(url),
      linkId: link.id,
      name: link.name,
      active: link.active,
      modes: link.modes,
      moduleCount: resolved.reduce((n, r) => n + r.modules.length, 0),
    };
  }

  /** Token entwerten, ohne den Link zu löschen. */
  async revoke(id: string, user: any) {
    const link = await this.own(id, user);
    link.token = null;
    await this.linkRepo.save(link);
    return { success: true };
  }
}
