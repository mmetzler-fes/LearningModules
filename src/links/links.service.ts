import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ClassesService } from '../classes/classes.service';
import { StudentClass } from '../core/entities/student-class.entity';
import { TopicLink, LinkMode, LinkTopicSelection, LinkContestSettings } from '../core/entities/topic-link.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { TagsService } from '../tags/tags.service';
import { TopicsService } from '../topics/topics.service';
import { GroupsService } from '../groups/groups.service';
import { CompanionService } from '../companion/companion.service';
import { baseUrl, renderQr } from '../core/share/link-url';
import * as crypto from 'crypto';

const ALL_MODES: LinkMode[] = ['quiz', 'exam', 'learn', 'companion', 'contest'];

const NEEDS_CLASS = 'Links gibt es nur für eine Klasse – bitte über „Link & QR“ eine Klasse wählen.';

/** Modi, zwischen denen Schüler über den Übungslink ("Link & QR") wählen. */
export const PRACTICE_MODES: LinkMode[] = ['quiz', 'learn', 'companion'];

/** Welcher Zugang eines Links: Übung (`token`) oder Klassenarbeit (`examToken`). */
export type LinkAccess = 'practice' | 'exam';

/**
 * Modi, die ein Zugang freischaltet. Der Übungslink bietet nur die
 * Übungsmodi, der Klassenarbeits-Link nur die Klassenarbeit; die Quiz-Arena
 * hat ihren eigenen Ablauf (siehe contest/).
 *
 * Altbestand: Ein Link, der nur die Klassenarbeit (ohne Übungsmodi) hatte,
 * wurde früher über den Übungslink verteilt. Damit ausgeteilte QR-Codes
 * weiter funktionieren, führt sein Übungslink dann in die Klassenarbeit.
 */
export function modesFor(link: TopicLink, access: LinkAccess): LinkMode[] {
  if (access === 'exam') return link.modes.includes('exam') ? ['exam'] : [];
  const practice = PRACTICE_MODES.filter((m) => link.modes.includes(m));
  if (practice.length === 0 && link.modes.includes('exam')) return ['exam'];
  return practice;
}

export const DEFAULT_CONTEST_SETTINGS: LinkContestSettings = {
  maxPoints: 1000,
  defaultSeconds: 30,
  seconds: {},
  sound: true,
};

const clampInt = (v: any, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Quiz-Arena-Einstellungen eines Links, mit Vorgaben aufgefüllt. */
export function contestSettingsOf(link: TopicLink): LinkContestSettings {
  return { ...DEFAULT_CONTEST_SETTINGS, ...(link.contestSettings || {}) };
}

@Injectable()
export class LinksService {
  constructor(
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    private readonly tagsService: TagsService,
    private readonly topicsService: TopicsService,
    private readonly groupsService: GroupsService,
    private readonly companionService: CompanionService,
    private readonly classesService: ClassesService,
  ) {}

  // ---- Eingaben prüfen ----

  private cleanModes(modes: any): LinkMode[] {
    const list = Array.isArray(modes) ? modes.filter((m) => ALL_MODES.includes(m)) : [];
    const unique = [...new Set(list)] as LinkMode[];
    if (unique.length === 0) {
      throw new BadRequestException('Bitte mindestens einen Modus auswählen.');
    }
    // Reihenfolge festhalten, damit die Auswahl beim Schüler immer gleich aussieht.
    return ALL_MODES.filter((m) => unique.includes(m));
  }

  /** Punkte und Zeiten für die Quiz-Arena, in vernünftigen Grenzen. */
  private cleanContestSettings(body: any): LinkContestSettings {
    const d = DEFAULT_CONTEST_SETTINGS;
    const seconds: Record<string, number> = {};
    const raw = body?.seconds && typeof body.seconds === 'object' ? body.seconds : {};
    for (const [id, v] of Object.entries(raw).slice(0, 1000)) {
      if (!/^[\w-]{1,64}$/.test(id) || v === null || v === '' || v === undefined) continue;
      seconds[id] = clampInt(v, 5, 600, d.defaultSeconds);
    }
    return {
      maxPoints: clampInt(body?.maxPoints, 10, 100000, d.maxPoints),
      defaultSeconds: clampInt(body?.defaultSeconds, 5, 600, d.defaultSeconds),
      seconds,
      sound: body?.sound !== false,
    };
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

    // Bei fremden Themen nur die Module, die das Nutzungsrecht umfasst.
    const loaded = ownTopicIds.size
      ? await this.moduleRepo.find({ where: { topicId: In([...ownTopicIds]) } })
      : [];
    const modules = topics.flatMap((t) =>
      this.topicsService.visibleModules(t, loaded.filter((m) => m.topicId === t.id), user),
    );
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

    // Das Nutzungsrecht wird bei jedem Start neu geprüft, nicht nur beim
    // Speichern des Links. Wird es entzogen oder zurückgegeben, wirkt das
    // sofort – sonst liefe ein einmal gespeicherter Link unbegrenzt weiter.
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

      // Mit Nutzungsrecht nur die Module, die es umfasst.
      const ofTopic = this.topicsService
        .visibleModules(topic, allModules.filter((m) => m.topicId === topic.id), linkOwner)
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
    const classes = await this.classesOf(links);

    const base = baseUrl(req);
    return Promise.all(
      links.map(async (link) => {
        const resolved = await this.resolveModules(link);
        return {
          ...this.publicShape(link, classes.get(link.classId || '')),
          url: link.token ? `${base}/?l=${link.token}` : null,
          topicCount: resolved.length,
          moduleCount: resolved.reduce((n, r) => n + r.modules.length, 0),
          unavailableTopics: await this.countUnavailable(link),
          usesForeignContent: resolved.some((r) => r.topic.ownerId !== link.ownerId),
        };
      }),
    );
  }

  /** Klassen der Klassenlinks, nach ID. */
  private async classesOf(links: TopicLink[]): Promise<Map<string, StudentClass>> {
    const ids = [...new Set(links.map((l) => l.classId).filter(Boolean))] as string[];
    const out = new Map<string, StudentClass>();
    for (const id of ids) {
      const klasse = await this.classesService.findById(id);
      if (klasse) out.set(id, klasse);
    }
    return out;
  }

  /** Passwort niemals zurückgeben – nur, ob eines gesetzt ist. */
  private publicShape(link: TopicLink, klasse?: StudentClass | null) {
    const { accessPassword, contestHostToken: _host, examToken, ...rest } = link;
    return {
      ...rest,
      hasPassword: !!accessPassword,
      hasExamLink: !!examToken,
      // Regel aus der Zeit vor den Klassen, deren alter Link noch gilt.
      hasLegacyLink: !link.classId && !!(link.token || examToken || _host),
      className: klasse?.name ?? null,
      schoolYear: klasse?.schoolYear ?? null,
      contestSettings: contestSettingsOf(link),
    };
  }

  async findOne(id: string, user: any, req?: any) {
    const link = await this.own(id, user);
    const resolved = await this.resolveModules(link);
    return {
      ...this.publicShape(link, await this.classesService.findById(link.classId)),
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
      // Eine neue Freigabe ist eine Regel; Links gibt es erst als Klassenlink.
      token: null,
      active: body?.active !== false,
      modes: this.cleanModes(body?.modes),
      selection: await this.cleanSelection(user, body?.selection),
      accessPassword: (body?.accessPassword || '').trim() || null,
      singleAttempt: !!body?.singleAttempt,
      tagIds: await this.tagsService.sanitizeIds(user, body?.tagIds),
      companionSettings: this.companionService.cleanLinkSettings(body?.companionSettings),
      contestSettings: this.cleanContestSettings(body?.contestSettings),
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
    if (body?.companionSettings !== undefined) {
      link.companionSettings = this.companionService.cleanLinkSettings(body.companionSettings);
    }
    if (body?.contestSettings !== undefined) link.contestSettings = this.cleanContestSettings(body.contestSettings);
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

  /**
   * Link zum Versenden: URL und QR-Code. `regenerate` entwertet den alten.
   * `access` wählt den Übungslink oder den eigenen Link der Klassenarbeit.
   */
  async share(id: string, user: any, regenerate = false, req?: any, access: LinkAccess = 'practice') {
    const link = await this.own(id, user);
    if (access === 'exam' && !link.modes.includes('exam')) {
      throw new BadRequestException('Für diese Freigabe ist die Klassenarbeit nicht eingeschaltet.');
    }
    const field = access === 'exam' ? 'examToken' : 'token';
    if (!link.classId && (!link[field] || regenerate)) throw new BadRequestException(NEEDS_CLASS);
    if (!link[field] || regenerate) link[field] = crypto.randomBytes(12).toString('base64url');
    link.lastSharedAt = new Date();
    await this.linkRepo.save(link);
    const token = link[field] as string;
    const url = `${baseUrl(req)}/?l=${token}`;
    const resolved = await this.resolveModules(link);
    return {
      token,
      access,
      url,
      qrSvg: await renderQr(url),
      linkId: link.id,
      name: link.name,
      active: link.active,
      modes: modesFor(link, access),
      moduleCount: resolved.reduce((n, r) => n + r.modules.length, 0),
    };
  }

  /**
   * Quiz-Arena: Leitungs-Link (für die Lehrkraft, z. B. am Beamer) und
   * Schüler-Link mit QR-Code. `regenerate` entwertet den alten Leitungs-Link.
   */
  async contestShare(id: string, user: any, regenerate = false, req?: any) {
    const link = await this.own(id, user);
    if (!link.modes.includes('contest')) {
      throw new BadRequestException('Für diese Freigabe ist die Quiz-Arena nicht eingeschaltet.');
    }
    if (!link.classId && (!link.contestHostToken || !link.token || regenerate)) {
      throw new BadRequestException(NEEDS_CLASS);
    }
    if (!link.contestHostToken || regenerate) link.contestHostToken = crypto.randomBytes(18).toString('base64url');
    if (!link.token) link.token = crypto.randomBytes(12).toString('base64url');
    link.lastSharedAt = new Date();
    await this.linkRepo.save(link);
    const base = baseUrl(req);
    const joinUrl = `${base}/?l=${link.token}&m=contest`;
    return {
      name: link.name,
      active: link.active,
      hostUrl: `${base}/?wh=${link.contestHostToken}`,
      joinUrl,
      qrSvg: await renderQr(joinUrl),
    };
  }

  // ---- Klassenlinks ----

  /**
   * Klassenlink aus einer Regel: eine Kopie mit Klasse und eigenem Token.
   * Je Regel und Klasse gibt es höchstens einen – ein zweiter Aufruf liefert
   * den vorhandenen, damit nicht bei jedem Zeigen ein neuer QR-Code entsteht.
   *
   * `adoptTokens` übergibt die alten Tokens einer Regel aus der Zeit vor den
   * Klassen an den Klassenlink: Ausgeteilte QR-Codes bleiben gültig, ihre
   * Ergebnisse landen ab jetzt unter der Klasse.
   */
  async classLink(ruleId: string, classId: string, user: any, adoptTokens = false, req?: any) {
    const rule = await this.own(ruleId, user);
    if (rule.classId) throw new BadRequestException('Das ist schon ein Klassenlink.');
    const klasse = await this.classesService.ownedClass(classId, user);

    let link = await this.linkRepo.findOne({ where: { ownerId: user.userId, templateId: rule.id, classId: klasse.id } });
    if (!link) {
      link = this.linkRepo.create({
        id: crypto.randomUUID(),
        name: rule.name,
        ownerId: user.userId,
        token: null,
        examToken: null,
        contestHostToken: null,
        active: true,
        modes: rule.modes,
        selection: rule.selection,
        accessPassword: rule.accessPassword,
        singleAttempt: rule.singleAttempt,
        tagIds: rule.tagIds,
        companionSettings: rule.companionSettings,
        contestSettings: rule.contestSettings,
        classId: klasse.id,
        templateId: rule.id,
        quickTopicId: null,
        lastSharedAt: new Date(),
      });
    }
    if (adoptTokens) {
      // Erst die Regel freigeben – die Tokens sind eindeutig.
      const tokens = { token: rule.token, examToken: rule.examToken, contestHostToken: rule.contestHostToken };
      rule.token = null;
      rule.examToken = null;
      rule.contestHostToken = null;
      await this.linkRepo.save(rule);
      for (const [key, value] of Object.entries(tokens)) if (value) (link as any)[key] = value;
    }
    link.lastSharedAt = new Date();
    await this.linkRepo.save(link);
    return this.findOne(link.id, user, req);
  }

  /** Klassenlink über den Quick-Link-Knopf eines Lernthemas. */
  async classLinkForTopic(topicId: string, classId: string, user: any, req?: any) {
    const rule = await this.topicsService.ensureQuickRule(topicId, user);
    return this.classLink(rule.id, classId, user, false, req);
  }

  /**
   * Klassenlinks über den Quick-Link eines Notebook-Knotens: eine Regel mit
   * allen Lernthemen darin (Quiz, Lernbegleitung, Quiz-Arena), je Knoten
   * genau eine. Ihr Inhalt folgt dem Knoten – bei jedem Aufruf wird die
   * Auswahl neu gesetzt, auch im vorhandenen Klassenlink derselben Klasse.
   */
  async classLinkForNode(node: { id: string; title: string }, topicIds: string[], classId: string, user: any, req?: any) {
    if (!topicIds.length) throw new BadRequestException('Darin ist kein Lernthema, das sich freigeben lässt.');
    const selection = topicIds.map((topicId) => ({ topicId, all: true }));
    let rule = await this.linkRepo.findOne({ where: { ownerId: user.userId, quickNodeId: node.id, classId: IsNull() } });
    if (!rule) {
      rule = this.linkRepo.create({
        id: crypto.randomUUID(),
        ownerId: user.userId,
        token: null,
        active: true,
        modes: ['quiz', 'companion', 'contest'],
        accessPassword: null,
        singleAttempt: false,
        tagIds: [],
        companionSettings: null,
        contestSettings: null,
        quickTopicId: null,
        quickNodeId: node.id,
      });
    }
    rule.name = node.title;
    rule.selection = selection;
    await this.linkRepo.save(rule);

    const existing = await this.linkRepo.findOne({ where: { ownerId: user.userId, templateId: rule.id, classId } });
    if (existing) {
      existing.selection = selection;
      existing.name = node.title;
      await this.linkRepo.save(existing);
    }
    return this.classLink(rule.id, classId, user, false, req);
  }

  /** Token entwerten, ohne den Link zu löschen. */
  async revoke(id: string, user: any, access: LinkAccess = 'practice') {
    const link = await this.own(id, user);
    if (access === 'exam') link.examToken = null;
    else link.token = null;
    await this.linkRepo.save(link);
    return { success: true };
  }
}
