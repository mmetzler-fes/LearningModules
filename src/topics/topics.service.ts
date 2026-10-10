import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { User } from '../core/entities/user.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { TagsService } from '../tags/tags.service';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { ShopService } from '../shop/shop.service';
import { visibleFor } from '../shop/offer-rules';
import { School } from '../core/entities/school.entity';
import { baseUrl, renderQr } from '../core/share/link-url';
import * as crypto from 'crypto';

/** Audio Recorder ohne Ablage-Link und Passwort (siehe visibleModules). */
function withoutUploadTarget<T>(m: T): T {
  const mod = m as any;
  if (mod?.type !== 'audioRecorder' || !mod.content) return m;
  let content = mod.content;
  if (typeof content === 'string') { try { content = JSON.parse(content); } catch { return m; } }
  const { uploadUrl, uploadPassword: _pw, ...rest } = content;
  return { ...mod, content: { ...rest, uploadConfigured: !!uploadUrl } };
}

@Injectable()
export class TopicsService {
  constructor(
    private readonly shop: ShopService,
    @InjectRepository(LearningTopic)
    private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule)
    private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(TopicQuickLink)
    private readonly quickRepo: Repository<TopicQuickLink>,
    @InjectRepository(TopicLink)
    private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(ShopOffer)
    private readonly offerRepo: Repository<ShopOffer>,
    @InjectRepository(UseGrant)
    private readonly grantRepo: Repository<UseGrant>,
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
    private readonly tagsService: TagsService,
  ) {}

  async findAll(user: any) {
    // Lehrkräfte und Admins sehen hier nur die eigenen Themen.
    const topics = await this.topicRepo.find({ where: { ownerId: user.userId }, order: { id: 'ASC' } });
    await this.attachModuleSummaries(topics);
    return this.withRights(topics, user);
  }

  /**
   * Felder, die Themenlisten von einem Modul brauchen. Inhalt und Beschreibung
   * fehlen bewusst: Sie können eingebettete Bilder enthalten und machten die
   * Liste schnell zig Megabyte schwer – geladen werden sie erst, wenn ein
   * Modul geöffnet wird (GET /topics/:id/modules).
   */
  private static readonly MODULE_SUMMARY_FIELDS: (keyof LearningModule)[] = [
    'id', 'type', 'title', 'moduleSelected', 'topicId', 'parentId', 'orderIndex', 'tagIds', 'creatorId',
    'createdAt', 'updatedAt',
  ];

  /** Hängt jedem Thema seine Module als schlanke Zusammenfassung an (sortiert). */
  private async attachModuleSummaries(topics: LearningTopic[]) {
    const ids = topics.map((t) => t.id);
    const modules = ids.length
      ? await this.moduleRepo.find({
          where: { topicId: In(ids) },
          select: TopicsService.MODULE_SUMMARY_FIELDS,
          order: { orderIndex: 'ASC' },
        })
      : [];
    const byTopic = new Map<string, LearningModule[]>();
    for (const m of modules) {
      if (!byTopic.has(m.topicId)) byTopic.set(m.topicId, []);
      byTopic.get(m.topicId)!.push(m);
    }
    for (const t of topics) t.modules = byTopic.get(t.id) || [];
  }

  // ---- Herkunft und Rechte für die Themenkarten ----

  /**
   * Hängt an jedes eigene Thema, was die Karte über Rechte und Shop wissen
   * muss: wie viele Module selbst verfasst sind, von wem die übrigen stammen,
   * welche Angebote laufen und wie viele das Thema per "Use" verwenden.
   */
  private async withRights(topics: LearningTopic[], user: any) {
    const ids = topics.map((t) => t.id);
    const [copies, offers, usage, names] = await Promise.all([
      ids.length ? this.topicRepo.find({ where: { copiedFromId: In(ids) } }) : ([] as LearningTopic[]),
      ids.length ? this.offerRepo.find({ where: { topicId: In(ids) } }) : ([] as ShopOffer[]),
      // Wer das Thema verwendet – auch über Angebote für einen Bereich oder eine Auswahl.
      this.shop.usageOfTopics(user.userId),
      this.userNames(),
    ]);

    const count = new Map<string, number>();
    for (const c of copies) {
      if (!c.copiedFromId) continue;
      count.set(c.copiedFromId, (count.get(c.copiedFromId) || 0) + 1);
    }

    return topics.map((t) => {
      const modules = (t.modules || []).map((m) => this.withCreator(m, user, names));
      const own = modules.filter((m) => m.isMine).length;
      const foreignCreators = [...new Set(modules.filter((m) => !m.isMine).map((m) => m.creatorName))];
      const offerOf = (kind: string) => {
        const o = offers.find((x) => x.topicId === t.id && x.kind === kind && x.scopeType === 'topic');
        return o
          ? {
              id: o.id, active: o.active, allowCopy: o.allowCopy, allowUse: o.allowUse,
              audience: o.audience,
            }
          : null;
      };
      return {
        ...t,
        modules,
        copyCount: count.get(t.id) || 0,
        origin: this.originOf(t),
        ownModuleCount: own,
        foreignModuleCount: modules.length - own,
        foreignCreators,
        useCount: usage.get(t.id)?.users.size || 0,
        paidUseCount: usage.get(t.id)?.paid.size || 0,
        creatorOffer: offerOf('creator'),
        buyerShare: offerOf('buyer'),
      };
    });
  }

  /** Anzeigenamen aller Konten, für die Nennung der Creator. */
  async userNames(): Promise<Map<string, string>> {
    const users = await this.userRepo.find();
    return new Map(users.map((u) => [u.id, u.displayName || u.email]));
  }

  /** Ein Modul mit Name seines Creators und der Angabe, ob es mein eigenes ist. */
  withCreator<T extends LearningModule>(m: T, user: any, names: Map<string, string>) {
    return {
      ...m,
      isMine: m.creatorId === user.userId,
      creatorName: m.creatorId ? names.get(m.creatorId) || 'Unbekannt' : 'Unbekannt',
    };
  }

  /**
   * Die Herkunftsangabe einer Kopie, oder null bei einem eigenen Thema.
   * Gelesen wird aus den mitkopierten Textfeldern, damit die Nennung auch
   * dann noch steht, wenn Quelle oder Verfasser gelöscht sind.
   */
  private originOf(topic: LearningTopic) {
    if (!topic.copiedFromAuthor && !topic.copiedFromTitle) return null;
    return {
      topicId: topic.copiedFromId,
      ownerId: topic.copiedFromOwnerId,
      author: topic.copiedFromAuthor || 'Unbekannt',
      title: topic.copiedFromTitle || '',
    };
  }

  // ---- Zugriffsstufen ----
  //
  // Der gesamte Zugriff auf ein Thema hängt an dieser einen Stelle. Das
  // Rechtemodell (siehe docs/shop-und-rechte.md) kennt am Thema nur zwei
  // Arten von Zugriff:
  //
  //   owner – das Thema gehört mir. Ich darf alles daran ändern, auch die
  //           fremden Module darin (dann bin ich deren Buyer); deren Creator
  //           bleibt trotzdem verzeichnet.
  //   read  – ich habe ein Nutzungsrecht ("Use") aus dem Shop. Ich darf die
  //           sichtbaren Module in eigenen Links verwenden, sonst nichts.
  //
  // Welche Module bei 'read' sichtbar sind, entscheidet `visibleModules()`.

  /**
   * Zugriffsstufe eines Benutzers auf ein Thema.
   *
   * Bewusst synchron und ohne Datenbankzugriff: Die Nutzungsrechte stehen als
   * `user.grants` bereit – geladen einmal pro Anfrage in der JWT-Strategie,
   * außerhalb einer Anfrage über `GroupsService.asUser()`.
   */
  accessLevel(topic: LearningTopic, user: any): 'owner' | 'write' | 'read' | 'none' {
    if (topic.ownerId === user.userId) return 'owner';
    // Admins sehen und bearbeiten alles – wie bisher.
    if (user.role === 'admin') return 'owner';
    const grants: any[] = Array.isArray(user.grants) ? user.grants : [];
    return grants.some((g) => g && g.topicId === topic.id) ? 'read' : 'none';
  }

  /**
   * Die Module eines Themas, die dieser Benutzer sehen darf.
   *
   * Der Eigentümer sieht alle. Ein Nutzungsrecht aus dem Angebot eines
   * Creators zeigt nur dessen Module (samt Untermodulen) – fremde Module im
   * selben Thema hat er nicht angeboten. Ein Nutzungsrecht aus der
   * Weitergabe eines Buyers zeigt alle.
   */
  visibleModules<T extends { id: string; parentId?: string | null; creatorId?: string | null }>(
    topic: LearningTopic,
    modules: T[],
    user: any,
  ): T[] {
    if (this.accessLevel(topic, user) === 'owner') return modules;
    const grants: any[] = (Array.isArray(user.grants) ? user.grants : []).filter((g: any) => g && g.topicId === topic.id);
    // Die Nextcloud-Ablage eines Audio Recorders (Link, Passwort) gehört dem
    // Eigentümer und geht niemanden sonst etwas an.
    return visibleFor(modules, grants).map(withoutUploadTarget);
  }

  private static readonly RANK = { none: 0, read: 1, write: 2, owner: 3 };

  /**
   * Lädt ein Thema und prüft dabei die geforderte Mindeststufe. Bei bloßem
   * Lesezugriff kommen nur die sichtbaren Module mit.
   */
  async findOneFor(id: string, user: any, need: 'read' | 'write' | 'owner') {
    const topic = await this.topicRepo.createQueryBuilder('topic')
      .where('topic.id = :id', { id })
      .leftJoinAndSelect('topic.modules', 'modules')
      .orderBy('modules.orderIndex', 'ASC')
      .getOne();

    if (!topic) throw new NotFoundException('Thema nicht gefunden');

    const have = this.accessLevel(topic, user);
    if (TopicsService.RANK[have] < TopicsService.RANK[need]) {
      // Die Meldung nennt den Grund, damit nicht nach einem Fehler gesucht wird.
      throw new ForbiddenException(
        need === 'read'
          ? 'Keine Berechtigung für dieses Thema.'
          : 'Das kann nur der Eigentümer des Themas. Mit einem Nutzungsrecht lässt es sich verwenden, aber nicht ändern.',
      );
    }
    if (have !== 'owner') topic.modules = this.visibleModules(topic, topic.modules || [], user);
    return topic;
  }

  async findOne(id: string, user: any) {
    return this.findOneFor(id, user, 'read');
  }

  /** Module eines Themas mit Creator-Angabe – für die Modulverwaltung. */
  async findModules(id: string, user: any) {
    const topic = await this.findOneFor(id, user, 'read');
    const names = await this.userNames();
    return (topic.modules || []).map((m) => this.withCreator(m, user, names));
  }

  /**
   * Ein Thema mit Nutzungsrecht zum Ansehen: sichtbare Module inklusive,
   * aber ohne alles, was dem Eigentümer gehört (Passwort, Subscribe-Key,
   * Quick-Link).
   */
  async findSharedForViewing(id: string, user: any) {
    const topic = await this.findOneFor(id, user, 'read');
    const names = await this.userNames();
    const { accessPassword, subscribeKey, quickToken, sharedWith, sharedAccess, ...safe } = topic;
    return {
      ...safe,
      modules: (topic.modules || []).map((m) => this.withCreator(m, user, names)),
      ownerName: names.get(topic.ownerId) || 'Unbekannt',
      accessLevel: this.accessLevel(topic, user),
      origin: this.originOf(topic),
      readOnly: true,
    };
  }

  /**
   * Themen, auf die ich ein Nutzungsrecht habe – für den Bereich
   * "Zur Nutzung erworben" unter den eigenen Themen.
   */
  async findGranted(user: any) {
    const entries = await this.shop.expandGrants(user.userId);
    if (entries.length === 0) return [];
    const topics = await this.topicRepo.find({ where: { id: In([...new Set(entries.map((e) => e.topicId))]) } });
    await this.attachModuleSummaries(topics);
    const names = await this.userNames();
    const offers = await this.offerRepo.find({ where: { id: In(entries.map((e) => e.offerId).filter(Boolean) as string[]) } });
    const asUser = { ...user, grants: entries };

    return topics
      .filter((t) => t.ownerId !== user.userId)
      .map((t) => {
        const mine = entries.filter((e) => e.topicId === t.id);
        const visible = this.visibleModules(t, t.modules || [], asUser);
        return {
          id: t.id,
          title: t.title,
          description: t.description,
          ownerId: t.ownerId,
          ownerName: names.get(t.ownerId) || 'Unbekannt',
          moduleCount: visible.filter((m) => !m.parentId).length,
          creators: [...new Set(visible.map((m) => (m.creatorId && names.get(m.creatorId)) || 'Unbekannt'))],
          origin: this.originOf(t),
          grants: [...new Map(mine.map((e) => [e.grantId, e])).values()].map((e) => {
            const offer = offers.find((o) => o.id === e.offerId);
            return {
              id: e.grantId,
              pricePaid: e.pricePaid,
              viaBuyer: offer?.kind === 'buyer',
              // Recht an einem Bereich oder einer Auswahl: Zurückgeben gilt für das Ganze.
              scopeType: e.scopeType,
              offerId: e.offerId,
              // Gehört zu einer Kopie – lässt sich nicht einzeln zurückgeben.
              onlyForeign: e.onlyForeign,
              since: e.createdAt,
            };
          }),
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  }

  /**
   * Themen, die in einem eigenen Themen-Link verwendet werden dürfen:
   * die eigenen und die mit Nutzungsrecht – jeweils nur mit den sichtbaren
   * Modulen.
   *
   * Fremde Themen kommen entschärft zurück – Zugangsdaten des Eigentümers
   * gehen niemanden sonst etwas an.
   */
  async findUsable(user: any) {
    const grantedIds = (Array.isArray(user.grants) ? user.grants : []).map((g: any) => g.topicId);
    const all = await this.topicRepo.find({
      where: [{ ownerId: user.userId }, ...(grantedIds.length ? [{ id: In(grantedIds) }] : [])],
    });
    await this.attachModuleSummaries(all);
    const names = await this.userNames();

    const usable: any[] = [];
    for (const topic of all) {
      const level = this.accessLevel(topic, user);
      if (level === 'none') continue;

      const isOwn = topic.ownerId === user.userId;
      if (isOwn) {
        usable.push({ ...topic, accessLevel: level, isOwn: true, ownerName: null, origin: this.originOf(topic) });
        continue;
      }

      const { accessPassword, subscribeKey, quickToken, sharedWith, sharedAccess, ...safe } = topic;
      usable.push({
        ...safe,
        modules: this.visibleModules(topic, topic.modules || [], user),
        accessLevel: level,
        isOwn: false,
        ownerName: names.get(topic.ownerId) || 'Unbekannt',
        origin: this.originOf(topic),
      });
    }

    usable.sort((a, b) =>
      // Eigene zuerst, danach alphabetisch – so steht Vertrautes oben.
      a.isOwn === b.isOwn ? a.title.localeCompare(b.title, 'de') : a.isOwn ? -1 : 1,
    );
    return usable;
  }

  /** Aktive Kolleginnen und Kollegen für die Auswahl der Zielgruppe im Shop. */
  /**
   * Wer einer Schule angehört, wählt nur unter Kolleginnen und Kollegen der
   * eigenen Schule aus; "alle" im Shop bleibt davon unberührt.
   */
  /**
   * Eine Lehrkraft über ihre vollständige E-Mail-Adresse – auch aus einer
   * anderen Schule. So lässt sich gezielt an jemanden freigeben, ohne dass
   * fremde Kollegien aufgelistet werden. Nur exakte Treffer, keine Suche
   * nach Teilen der Adresse oder des Namens.
   */
  async lookupColleague(user: any, email: string) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean.includes('@')) throw new BadRequestException('Bitte die vollständige E-Mail-Adresse eingeben.');
    const found = (await this.userRepo.find()).find((u) => u.email.toLowerCase() === clean);
    if (!found || found.active === false || (found.role !== 'teacher' && found.role !== 'admin')) {
      throw new NotFoundException('Keine aktive Lehrkraft mit dieser Adresse gefunden.');
    }
    if (found.id === user.userId) throw new BadRequestException('Das bist du selbst.');
    const school = found.schoolId ? await this.schoolRepo.findOne({ where: { id: found.schoolId } }) : null;
    return {
      id: found.id,
      displayName: found.displayName || found.email,
      email: found.email,
      schoolName: school?.name || null,
      sameSchool: !!user.schoolId && found.schoolId === user.schoolId,
    };
  }

  async listColleagues(user: any) {
    const users = await this.userRepo.find();
    return users
      .filter((u) => u.id !== user.userId && u.active !== false && (u.role === 'teacher' || u.role === 'admin'))
      .filter((u) => !user.schoolId || u.schoolId === user.schoolId)
      .map((u) => ({
        id: u.id,
        displayName: u.displayName || u.email,
        email: u.email,
        role: u.role,
      }));
  }

  // ---- Quick-Link: Schüler starten per Link/QR-Code direkt das Quiz ----
  //
  // Der Quick-Link gehört nicht dem Thema, sondern der Lehrkraft, die ihn
  // verteilt. Deshalb darf ihn auch anlegen, wer das Thema nur verwenden
  // darf: Die Ergebnisse landen bei ihr, so wie beim Themen-Link auch. Der
  // Eigentümer bleibt Eigentümer des Inhalts – am Thema selbst ändert ein
  // fremder Quick-Link nichts.

  /**
   * Liefert den Quick-Link dieser Lehrkraft auf das Thema und legt ihn beim
   * ersten Aufruf an. Mit `regenerate` wird ein neuer Token erzeugt; die
   * bisher von *dieser* Lehrkraft verteilten Links und QR-Codes sind damit
   * sofort ungültig – die der Kolleginnen bleiben unberührt.
   */
  async getQuickLink(id: string, user: any, regenerate = false, req?: any) {
    const { topic, isOwner, activeCount } = await this.quickLinkableTopic(id, user);

    const entry = await this.quickLinkEntry(topic, user, regenerate);
    const share = await this.quickShare(topic, entry, user);
    const url = `${baseUrl(req)}/?q=${entry.token}`;

    return {
      token: entry.token,
      url,
      qrSvg: await renderQr(url),
      topicId: topic.id,
      title: topic.title,
      moduleCount: activeCount,
      isOwn: isOwner,
      // Nur beim ersten Mal gesetzt – der Dialog weist dann darauf hin.
      createdShare: share ? { id: share.id, name: share.name } : null,
    };
  }

  /**
   * Regel hinter dem Quick-Link-Knopf: ganzes Thema mit Quiz, Lernbegleitung
   * und Quiz-Arena. Der Knopf erzeugt daraus Klassenlinks; die Regel selbst
   * hat keinen Token. Gibt es sie nicht (mehr), entsteht sie neu – auch nach
   * dem Löschen, denn wer den Knopf drückt, will einen Link. Die beim
   * früheren Quick-Link angelegte Freigabe wird weiterverwendet.
   */
  async ensureQuickRule(topicId: string, user: any): Promise<TopicLink> {
    const { topic } = await this.quickLinkableTopic(topicId, user);
    const found = await this.linkRepo.findOne({ where: { ownerId: user.userId, quickTopicId: topic.id, classId: IsNull() } });
    if (found) return found;

    const entry = await this.quickRepo.findOne({ where: { topicId: topic.id, ownerId: user.userId } });
    const earlier = entry?.shareLinkId
      ? await this.linkRepo.findOne({ where: { id: entry.shareLinkId, ownerId: user.userId, classId: IsNull() } })
      : null;
    if (earlier) {
      earlier.quickTopicId = topic.id;
      return this.linkRepo.save(earlier);
    }

    return this.linkRepo.save(
      this.linkRepo.create({
        id: crypto.randomUUID(),
        name: topic.title,
        ownerId: user.userId,
        token: null,
        active: true,
        modes: ['quiz', 'companion', 'contest'],
        selection: [{ topicId: topic.id, all: true }],
        accessPassword: null,
        singleAttempt: false,
        tagIds: await this.tagsService.sanitizeIds(user, topic.tagIds || []),
        companionSettings: null,
        contestSettings: null,
        quickTopicId: topic.id,
      }),
    );
  }

  /** Darf für dieses Thema ein Quick-Link entstehen? Wirft sonst mit Begründung. */
  private async quickLinkableTopic(id: string, user: any) {
    const topic = await this.findOneFor(id, user, 'read');
    const isOwner = this.accessLevel(topic, user) === 'owner';

    // Ein Quick-Link auf etwas Gesperrtes wäre eine Falle: Der Schüler scannt
    // und landet vor einer verschlossenen Tür. Deshalb gar nicht erst erzeugen.
    //
    // Für fremde Themen zählt stattdessen die Nutzungsfreigabe: Sie ist die
    // ausdrückliche Zustimmung des Eigentümers, und der Haken "aktiv" gehört
    // zu seiner eigenen Schülersicht, nicht zu meiner. Genauso hält es der
    // Themen-Link.
    if (isOwner && !topic.selected) {
      throw new ForbiddenException(
        'Das Thema ist nicht für Schüler freigegeben. Bitte zuerst freigeben, dann den Quick-Link erzeugen.',
      );
    }
    const activeCount = (topic.modules || []).filter((m) => m.moduleSelected !== false).length;
    if (activeCount === 0) {
      throw new ForbiddenException(
        'Das Thema hat keine freigegebenen Module. Bitte zuerst mindestens ein Modul freigeben.',
      );
    }
    return { topic, isOwner, activeCount };
  }

  /**
   * Zum ersten Quick-Link gehört eine Schülerfreigabe für das ganze Thema:
   * Quiz, Lernbegleitung und Quiz-Arena, benannt nach dem Thema. Dann gibt
   * es Lernbegleitung und Quiz-Arena, ohne dass die Lehrkraft erst eine
   * Freigabe zusammenstellen muss. Angelegt wird sie genau einmal je
   * Quick-Link-Eintrag; liefert die neue Freigabe oder `null`.
   */
  private async quickShare(topic: LearningTopic, entry: TopicQuickLink, user: any): Promise<TopicLink | null> {
    if (entry.shareLinkId) return null;
    const link = this.linkRepo.create({
      id: crypto.randomUUID(),
      name: topic.title,
      ownerId: user.userId,
      token: crypto.randomBytes(12).toString('base64url'),
      active: true,
      modes: ['quiz', 'companion', 'contest'],
      selection: [{ topicId: topic.id, all: true }],
      accessPassword: null,
      singleAttempt: false,
      // Wie im Formular: Die Freigabe übernimmt die Tags des Themas – soweit
      // es meine sind (bei fremden Themen fallen sie hier heraus).
      tagIds: await this.tagsService.sanitizeIds(user, topic.tagIds || []),
      companionSettings: null,
      contestSettings: null,
    });
    await this.linkRepo.save(link);
    entry.shareLinkId = link.id;
    await this.quickRepo.save(entry);
    return link;
  }

  /**
   * Holt den Eintrag dieser Lehrkraft oder legt ihn an.
   *
   * Übergang vom alten Modell: Früher hing genau ein Token als Spalte am
   * Thema. Der gehört dem Eigentümer und wird beim ersten Aufruf in die
   * Tabelle übernommen, damit bereits verteilte Zettel gültig bleiben.
   */
  private async quickLinkEntry(topic: LearningTopic, user: any, regenerate: boolean) {
    let entry = await this.quickRepo.findOne({ where: { topicId: topic.id, ownerId: user.userId } });

    if (!entry && topic.quickToken && topic.ownerId === user.userId) {
      entry = this.quickRepo.create({
        id: crypto.randomUUID(),
        topicId: topic.id,
        ownerId: user.userId,
        token: topic.quickToken,
      });
      await this.quickRepo.save(entry);
    }

    if (!entry) {
      entry = this.quickRepo.create({
        id: crypto.randomUUID(),
        topicId: topic.id,
        ownerId: user.userId,
        token: this.newQuickToken(),
      });
    } else if (regenerate) {
      entry.token = this.newQuickToken();
    } else {
      return entry;
    }

    await this.quickRepo.save(entry);
    // Die alte Spalte wird mitgeführt, solange sie am Thema steht: Ein
    // Rückschritt auf eine ältere Fassung soll den Eigentümer nicht ohne
    // Quick-Link dastehen lassen.
    if (topic.ownerId === user.userId && topic.quickToken !== entry.token) {
      topic.quickToken = entry.token;
      await this.topicRepo.save(topic);
    }
    return entry;
  }

  /**
   * 16 Zeichen aus dem URL-sicheren Alphabet – genug Entropie, damit der
   * Link nicht erratbar ist, und noch kurz genug für einen QR-Code.
   */
  private newQuickToken(): string {
    return crypto.randomBytes(12).toString('base64url');
  }

  /** Den eigenen Quick-Link entwerten, ohne einen neuen zu erzeugen. */
  async revokeQuickLink(id: string, user: any) {
    const topic = await this.findOneFor(id, user, 'read');

    const entry = await this.quickRepo.findOne({ where: { topicId: id, ownerId: user.userId } });
    if (entry) await this.quickRepo.remove(entry);

    // Nur der eigene Zugang verschwindet; die Quick-Links der Kolleginnen auf
    // dasselbe Thema bleiben gültig.
    if (topic.ownerId === user.userId && topic.quickToken) {
      topic.quickToken = null;
      await this.topicRepo.save(topic);
    }
    return { success: true };
  }

  async create(user: any, topicData: Partial<LearningTopic>) {
    // Herkunft und Freigabelisten setzt nie der Client.
    const {
      copiedFromId: _a, copiedFromOwnerId: _b, copiedFromAuthor: _c, copiedFromTitle: _d,
      sharedWith: _e, sharedAccess: _f, modules: _g, ...data
    } = topicData as any;
    const topic = this.topicRepo.create({
      ...data,
      id: crypto.randomUUID(),
      ownerId: user.userId,
      visibility: (topicData as any).visibility || 'locked',
      tagIds: await this.tagsService.sanitizeIds(user, (topicData as any).tagIds),
    });
    return this.topicRepo.save(topic);
  }

  async addModule(topicId: string, user: any, moduleData: Partial<LearningModule>) {
    const topic = await this.findOneFor(topicId, user, 'write');
    let orderIndex = moduleData.orderIndex;
    if (orderIndex === undefined) {
      if (moduleData.id) {
        const existing = topic.modules ? topic.modules.find(m => m.id === moduleData.id) : null;
        orderIndex = existing ? existing.orderIndex : (topic.modules ? topic.modules.length : 0);
      } else {
        orderIndex = topic.modules ? topic.modules.length : 0;
      }
    }
    // Nur eigene Tags akzeptieren - wie beim Thema, damit eine manipulierte
    // Anfrage keine fremden Tag-IDs am Modul hinterlassen kann.
    const tagIds =
      (moduleData as any).tagIds !== undefined
        ? await this.tagsService.sanitizeIds(user, (moduleData as any).tagIds)
        : undefined;

    // Der Creator steht fest, sobald ein Modul existiert: Wer eine gekaufte
    // Kopie bearbeitet, wird dadurch nicht zum Verfasser. Neue Module gehören
    // dem, der sie anlegt. Was der Client dazu mitschickt, zählt nie.
    const existing = moduleData.id ? await this.moduleRepo.findOne({ where: { id: moduleData.id } }) : null;
    if (existing && existing.topicId !== topic.id) {
      throw new ForbiddenException('Das Modul gehört zu einem anderen Thema.');
    }
    // Ebenso die Herkunft: Sie entsteht nur beim Kopieren auf dem Server.
    const { creatorId: _ignored, originId: _origin, ...data } = moduleData as any;
    const creatorId = existing ? existing.creatorId : user.userId;

    const module = this.moduleRepo.create({
      ...data,
      creatorId,
      originId: existing ? existing.originId : null,
      ...(tagIds !== undefined ? { tagIds } : {}),
      // Ohne id schlug das Anlegen bisher mit einem NOT-NULL-Fehler fehl. Eine
      // mitgeschickte id bleibt erhalten, denn derselbe Aufruf aktualisiert
      // auch bestehende Module – sonst entstünde bei jeder Bearbeitung ein Duplikat.
      id: moduleData.id || crypto.randomUUID(),
      topicId: topic.id,
      orderIndex,
    });
    return this.moduleRepo.save(module);
  }

  /**
   * Löscht ein Thema. Wer für die Nutzung bezahlt hat, bekommt vorher eine
   * eigene Kopie (ShopService.preservePaidUse); kostenlose Nutzungsrechte
   * verfallen. Die Oberfläche warnt vorher (useCount, paidUseCount).
   */
  async remove(id: string, user: any) {
    const topic = await this.findOneFor(id, user, 'owner');
    // Erst sichern, dann löschen – scheitert das Kopieren, bleibt alles stehen.
    const preservedCopies = await this.shop.preservePaidUse(id);
    if (topic.modules && topic.modules.length > 0) {
      await this.moduleRepo.remove(topic.modules);
    }
    // Mit dem Thema gehen auch die Quick-Links aller Lehrkräfte darauf –
    // sonst blieben tote Tokens in der Tabelle zurück. Ebenso Angebote und
    // Nutzungsrechte: Sie zeigten sonst ins Leere.
    await this.quickRepo.delete({ topicId: id });
    await this.offerRepo.delete({ topicId: id });
    const grants = await this.grantRepo.count({ where: { topicId: id } });
    await this.grantRepo.delete({ topicId: id });
    await this.topicRepo.remove(topic);
    return { success: true, revokedUseGrants: grants - preservedCopies, preservedCopies };
  }

  /**
   * Inhaltliche Felder, die ein Bearbeiter setzen darf.
   *
   * Bewusst eine Positivliste: Über ein blindes Object.assign ließen sich
   * sonst ownerId oder die Herkunftsangaben mitsetzen.
   */
  private static readonly EDITABLE_FIELDS = ['title', 'description', 'selected', 'tagIds'];

  /** Zusätzlich nur für den Eigentümer: Zugang und Sichtbarkeit. */
  private static readonly OWNER_FIELDS = ['visibility', 'accessPassword', 'subscribeKey', 'permissions'];

  async update(id: string, user: any, updateData: Partial<LearningTopic>) {
    const topic = await this.findOneFor(id, user, 'write');
    const isOwner = this.accessLevel(topic, user) === 'owner';

    const allowed = isOwner
      ? [...TopicsService.EDITABLE_FIELDS, ...TopicsService.OWNER_FIELDS]
      : TopicsService.EDITABLE_FIELDS;

    const data = updateData as any;
    for (const field of allowed) {
      if (field === 'tagIds' || data[field] === undefined) continue;
      (topic as any)[field] = data[field];
    }

    // Nur eigene Tags akzeptieren – sonst könnte eine manipulierte Anfrage
    // fremde Tag-IDs am Thema hinterlassen.
    if (data.tagIds !== undefined) topic.tagIds = await this.tagsService.sanitizeIds(user, data.tagIds);

    // Auto-promote visibility when activating: selected=true + visibility='locked' → 'public'
    if (topic.selected && topic.visibility === 'locked') {
      topic.visibility = 'public';
    }
    return this.topicRepo.save(topic);
  }

  async removeModule(topicId: string, moduleId: string, user: any) {
    const topic = await this.findOneFor(topicId, user, 'write');
    const module = topic.modules.find(m => m.id === moduleId);
    if (!module) throw new NotFoundException('Modul nicht gefunden');
    await this.moduleRepo.remove(module);
    return { success: true };
  }

  async toggleModule(topicId: string, moduleId: string, selected: boolean, user: any) {
    const topic = await this.findOneFor(topicId, user, 'write');
    const module = topic.modules.find(m => m.id === moduleId);
    if (!module) throw new NotFoundException('Modul nicht gefunden');
    module.moduleSelected = selected;
    await this.moduleRepo.save(module);
    return { success: true };
  }

  async bulkToggleModules(topicId: string, moduleIds: string[], selected: boolean, user: any) {
    const topic = await this.findOneFor(topicId, user, 'write');
    const modulesToUpdate = topic.modules.filter(m => moduleIds.includes(m.id));
    for (const m of modulesToUpdate) {
      m.moduleSelected = selected;
    }
    if (modulesToUpdate.length > 0) {
      await this.moduleRepo.save(modulesToUpdate);
    }
    return { success: true };
  }

  /**
   * Module in ein anderes Thema verschieben oder kopieren – und mit
   * `targetTopicId === topicId` im selben Thema duplizieren.
   *
   * Beide Themen brauchen Schreibrecht: Verschieben nimmt dem einen etwas
   * weg und legt es dem anderen hinein. Tags wandern mit, Ergebnisse nicht –
   * die hängen am Link, nicht am Modul.
   */
  async transferModules(
    topicId: string,
    targetTopicId: string,
    moduleIds: string[],
    mode: 'move' | 'copy',
    user: any,
  ) {
    const ids = Array.isArray(moduleIds) ? [...new Set(moduleIds.filter(Boolean).map(String))] : [];
    if (ids.length === 0) throw new NotFoundException('Keine Module ausgewählt.');
    if (mode !== 'move' && mode !== 'copy') {
      throw new ForbiddenException('Unbekannte Aktion – erlaubt sind "move" und "copy".');
    }

    const source = await this.findOneFor(topicId, user, 'write');
    const sameTopic = topicId === targetTopicId;
    if (sameTopic && mode === 'move') {
      // Verschieben innerhalb desselben Themas ist die Reihenfolge, nicht das hier.
      throw new ForbiddenException('Quelle und Ziel sind dasselbe Thema – zum Duplizieren bitte "kopieren".');
    }
    const target = sameTopic ? source : await this.findOneFor(targetTopicId, user, 'write');

    // Die Reihenfolge der Auswahl soll im Ziel erhalten bleiben.
    const picked = (source.modules || [])
      .filter((m) => ids.includes(m.id))
      .sort((a, b) => a.orderIndex - b.orderIndex);
    if (picked.length === 0) throw new NotFoundException('Die gewählten Module gehören nicht zu diesem Thema.');

    if (mode === 'move') {
      let next = (target.modules || []).length;
      for (const m of picked) {
        m.topicId = target.id;
        // Untermodule kennt die Oberfläche nicht; ein mitgeschleppter
        // parentId zeigte sonst in das alte Thema.
        m.parentId = null as any;
        m.orderIndex = next++;
      }
      await this.moduleRepo.save(picked);
      // Im Quellthema bleiben sonst Lücken in der Reihenfolge zurück.
      await this.compactOrder(source.id, ids);
      return { success: true, count: picked.length, mode, targetTopicId: target.id };
    }

    const copies = picked.map((m) => {
      const { id: _id, topic: _t, subModules: _s, parent: _p, createdAt: _c, updatedAt: _u, ...rest } = m as any;
      return Object.assign(new LearningModule(), {
        ...rest,
        id: crypto.randomUUID(),
        topicId: target.id,
        parentId: null,
        // Nur im selben Thema braucht die Kopie einen eigenen Namen – sonst
        // stünden zwei identische Einträge untereinander.
        title: sameTopic ? `${m.title} (Kopie)` : m.title,
        originId: m.originId || m.id,
      });
    });

    if (sameTopic) {
      // Das Duplikat gehört direkt hinter sein Original, nicht ans Ende.
      const order = [...(source.modules || [])].sort((a, b) => a.orderIndex - b.orderIndex);
      const result: Array<{ id: string; entity: any }> = [];
      for (const m of order) {
        result.push({ id: m.id, entity: m });
        const copy = copies[picked.findIndex((p) => p.id === m.id)];
        if (copy) result.push({ id: copy.id, entity: copy });
      }
      result.forEach((entry, i) => { entry.entity.orderIndex = i; });
      await this.moduleRepo.save(copies);
      await this.moduleRepo.save(order);
    } else {
      let next = (target.modules || []).length;
      for (const copy of copies) copy.orderIndex = next++;
      await this.moduleRepo.save(copies);
    }

    return { success: true, count: copies.length, mode, targetTopicId: target.id };
  }

  /** Schließt die Lücken in der Reihenfolge, die entfernte Module hinterlassen. */
  private async compactOrder(topicId: string, removedIds: string[]) {
    const rest = await this.moduleRepo.find({ where: { topicId } });
    const ordered = rest
      .filter((m) => !removedIds.includes(m.id))
      .sort((a, b) => a.orderIndex - b.orderIndex);
    ordered.forEach((m, i) => { m.orderIndex = i; });
    if (ordered.length) await this.moduleRepo.save(ordered);
  }

  async reorderModules(topicId: string, moduleIds: string[], user: any) {
    const topic = await this.findOneFor(topicId, user, 'write');
    const updates = [];
    for (let i = 0; i < moduleIds.length; i++) {
      const module = topic.modules.find(m => m.id === moduleIds[i]);
      if (module) {
        module.orderIndex = i;
        updates.push(module);
      }
    }
    if (updates.length > 0) {
      await this.moduleRepo.save(updates);
    }
    return { success: true };
  }
}
