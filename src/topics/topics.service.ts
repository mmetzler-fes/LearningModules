import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { User } from '../core/entities/user.entity';
import { TagsService } from '../tags/tags.service';
import { baseUrl, renderQr } from '../core/share/link-url';
import * as crypto from 'crypto';

@Injectable()
export class TopicsService {
  constructor(
    @InjectRepository(LearningTopic)
    private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule)
    private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly tagsService: TagsService,
  ) {}

  async findAll(user: any) {
    const qb = this.topicRepo.createQueryBuilder('topic');

    // Teachers and admins only see their own topics
    qb.where('topic.ownerId = :ownerId', { ownerId: user.userId });

    return qb.leftJoinAndSelect('topic.modules', 'modules').orderBy('modules.orderIndex', 'ASC').addOrderBy('topic.id', 'ASC').getMany();
  }

  // ---- Zugriffsstufen ----
  //
  // Der gesamte Zugriff auf ein fremdes Thema hängt an dieser einen Stelle.
  // Jede Methode sagt, was sie braucht: 'read', 'write' oder 'owner'. Was
  // nicht ausdrücklich geöffnet wird, bleibt damit eigentümergebunden.

  /** Zugriffsstufe eines Benutzers auf ein Thema. */
  accessLevel(topic: LearningTopic, user: any): 'owner' | 'write' | 'read' | 'none' {
    if (topic.ownerId === user.userId) return 'owner';
    // Admins sehen und bearbeiten alles – wie bisher.
    if (user.role === 'admin') return 'owner';

    const entries = Array.isArray(topic.sharedAccess) ? topic.sharedAccess : [];
    // Ein persönlicher Eintrag schlägt die Sammelfreigabe für alle.
    const mine = entries.find((e) => e && e.userId === user.userId);
    const all = entries.find((e) => e && e.userId === '*');
    const level = (mine || all)?.level;
    if (level === 'write') return 'write';
    if (level === 'read') return 'read';
    return 'none';
  }

  private static readonly RANK = { none: 0, read: 1, write: 2, owner: 3 };

  /**
   * Lädt ein Thema und prüft dabei die geforderte Mindeststufe.
   * `findOne` bleibt als Lesezugriff erhalten, damit bestehende Aufrufer
   * unverändert weiterlaufen.
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
        need === 'owner'
          ? 'Das kann nur der Eigentümer des Themas.'
          : 'Keine Berechtigung für dieses Thema.',
      );
    }
    return topic;
  }

  async findOne(id: string, user: any) {
    return this.findOneFor(id, user, 'read');
  }

  // ---- Freigabe zum Kopieren ----

  /** Prüft, ob ein Thema für diesen Benutzer zum Kopieren freigegeben ist. */
  private isSharedWith(topic: LearningTopic, userId: string): boolean {
    const list = topic.sharedWith;
    if (!Array.isArray(list) || list.length === 0) return false;
    return list.includes('*') || list.includes(userId);
  }

  /** Freigabe setzen. Nur der Eigentümer (oder ein Admin) darf das. */
  async setSharing(id: string, user: any, sharedWith?: string[], sharedAccess?: any) {
    const topic = await this.findOneFor(id, user, 'owner');
    if (sharedWith !== undefined) {
      const clean = Array.isArray(sharedWith)
        ? [...new Set(sharedWith.map(String).filter(Boolean))]
        : [];
      // '*' schlägt jede Einzelauswahl – sonst wäre der Zustand widersprüchlich.
      topic.sharedWith = clean.includes('*') ? ['*'] : clean;
    }

    if (sharedAccess !== undefined) {
      topic.sharedAccess = this.cleanAccess(sharedAccess);
    }

    await this.topicRepo.save(topic);
    return { success: true, sharedWith: topic.sharedWith, sharedAccess: topic.sharedAccess };
  }

  /**
   * Themen, die in einem eigenen Themen-Link verwendet werden dürfen:
   * die eigenen und die, die mir jemand zur Nutzung freigegeben hat.
   *
   * Fremde Themen kommen entschärft zurück – Zugangsdaten des Eigentümers
   * gehen niemanden sonst etwas an, auch nicht die Lehrkraft, die die
   * Inhalte verwenden darf.
   */
  async findUsable(user: any) {
    const all = await this.topicRepo.find({ relations: ['modules'] });
    const owners = await this.userRepo.find();
    const ownerName = new Map(owners.map((o) => [o.id, o.displayName || o.email]));

    const usable = [];
    for (const topic of all) {
      const level = this.accessLevel(topic, user);
      if (level === 'none') continue;

      const isOwn = topic.ownerId === user.userId;
      if (isOwn) {
        usable.push({ ...topic, accessLevel: level, isOwn: true, ownerName: null });
        continue;
      }

      const { accessPassword, subscribeKey, quickToken, sharedWith, sharedAccess, ...safe } = topic;
      usable.push({
        ...safe,
        accessLevel: level,
        isOwn: false,
        ownerName: ownerName.get(topic.ownerId) || 'Unbekannt',
      });
    }

    usable.sort((a, b) =>
      // Eigene zuerst, danach alphabetisch – so steht Vertrautes oben.
      a.isOwn === b.isOwn ? a.title.localeCompare(b.title, 'de') : a.isOwn ? -1 : 1,
    );
    return usable;
  }

  /**
   * Räumt eine übergebene Zugriffsliste auf: bekannte Stufen, keine
   * Doppelungen, pro Person ein Eintrag.
   */
  private cleanAccess(input: any): Array<{ userId: string; level: 'read' | 'write' }> {
    if (!Array.isArray(input)) return [];
    const byUser = new Map<string, 'read' | 'write'>();
    for (const entry of input) {
      const userId = String(entry?.userId || '').trim();
      const level = entry?.level;
      if (!userId || (level !== 'read' && level !== 'write')) continue;
      // Die höhere Stufe gewinnt, falls jemand doppelt auftaucht.
      const existing = byUser.get(userId);
      byUser.set(userId, existing === 'write' || level === 'write' ? 'write' : 'read');
    }
    return [...byUser].map(([userId, level]) => ({ userId, level }));
  }

  /** Kolleginnen und Kollegen für die Auswahl im Freigabe-Dialog. */
  async listColleagues(user: any) {
    const users = await this.userRepo.find();
    return users
      .filter((u) => u.id !== user.userId && (u.role === 'teacher' || u.role === 'admin'))
      .map((u) => ({
        id: u.id,
        displayName: u.displayName || u.email,
        email: u.email,
        role: u.role,
      }));
  }

  /**
   * Themen, die mir jemand freigegeben hat. Die Liste wird in JavaScript
   * gefiltert, weil sharedWith als JSON-Text gespeichert ist – bei schulischen
   * Datenmengen völlig unkritisch.
   */
  async findSharedWithMe(user: any) {
    const topics = await this.topicRepo.find({ relations: ['modules'] });
    const owners = await this.userRepo.find();
    const ownerName = new Map(owners.map((o) => [o.id, o.displayName || o.email]));

    // Alles, was mir jemand zugänglich gemacht hat – zum Kopieren, zum
    // Verwenden oder beides. Welche Knöpfe erscheinen, entscheidet danach
    // die Oberfläche anhand von canCopy/canUse.
    return topics
      .filter((t) => {
        if (t.ownerId === user.userId) return false;
        return this.isSharedWith(t, user.userId) || this.accessLevel(t, user) !== 'none';
      })
      .map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        ownerId: t.ownerId,
        ownerName: ownerName.get(t.ownerId) || 'Unbekannt',
        moduleCount: (t.modules || []).length,
        canCopy: this.isSharedWith(t, user.userId),
        canUse: this.accessLevel(t, user) !== 'none',
      }));
  }

  /**
   * Zieht eine eigene Kopie eines freigegebenen Themas. Der Kopierende wird
   * Eigentümer; das Original bleibt unverändert. Zugangsdaten des Originals
   * (Passwort, Subscribe-Key, Quick-Link) werden bewusst nicht übernommen.
   */
  async copySharedTopic(id: string, user: any) {
    const source = await this.topicRepo.findOne({ where: { id }, relations: ['modules'] });
    if (!source) throw new NotFoundException('Thema nicht gefunden');
    if (source.ownerId === user.userId) {
      throw new ForbiddenException('Das ist bereits dein eigenes Thema.');
    }
    if (!this.isSharedWith(source, user.userId) && user.role !== 'admin') {
      throw new ForbiddenException('Dieses Thema ist nicht für dich freigegeben.');
    }

    const copy = await this.topicRepo.save(this.topicRepo.create({
      id: crypto.randomUUID(),
      // Kennzeichnung, damit mehrfaches Kopieren nicht zu gleichnamigen
      // Themen führt. Umbenennen kann der neue Eigentümer jederzeit.
      title: `${source.title} (Kopie)`,
      description: source.description,
      ownerId: user.userId,
      // Die Kopie startet bewusst unveröffentlicht: erst prüfen, dann freigeben.
      selected: false,
      visibility: 'locked',
      accessPassword: null as any,
      subscribeKey: null as any,
      quickToken: null,
      sharedWith: null,
      permissions: source.permissions,
    }));

    const modules = (source.modules || []).map((m) => {
      const { id: _id, topic: _t, subModules: _s, parent: _p, ...rest } = m as any;
      return Object.assign(new LearningModule(), {
        ...rest,
        id: crypto.randomUUID(),
        topicId: copy.id,
        parentId: null,
      });
    });
    if (modules.length) await this.moduleRepo.save(modules);

    return { success: true, topicId: copy.id, title: copy.title, moduleCount: modules.length };
  }

  // ---- Quick-Link: Schüler starten per Link/QR-Code direkt das Quiz ----

  /**
   * Liefert den Quick-Link des Themas und legt ihn beim ersten Aufruf an.
   * Mit `regenerate` wird ein neuer Token erzeugt; alle bisher verteilten
   * Links und QR-Codes sind damit sofort ungültig.
   */
  async getQuickLink(id: string, user: any, regenerate = false, req?: any) {
    const topic = await this.findOneFor(id, user, 'owner');

    // Ein Quick-Link auf etwas Gesperrtes wäre eine Falle: Der Schüler scannt
    // und landet vor einer verschlossenen Tür. Deshalb gar nicht erst erzeugen.
    if (!topic.selected) {
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

    if (!topic.quickToken || regenerate) {
      // 16 Zeichen aus dem URL-sicheren Alphabet – genug Entropie, damit der
      // Link nicht erratbar ist, und noch kurz genug für einen QR-Code.
      topic.quickToken = crypto.randomBytes(12).toString('base64url');
      await this.topicRepo.save(topic);
    }

    const url = `${baseUrl(req)}/?q=${topic.quickToken}`;

    return {
      token: topic.quickToken,
      url,
      qrSvg: await renderQr(url),
      topicId: topic.id,
      title: topic.title,
      moduleCount: activeCount,
    };
  }

  /** Quick-Link entwerten, ohne einen neuen zu erzeugen. */
  async revokeQuickLink(id: string, user: any) {
    const topic = await this.findOneFor(id, user, 'owner');
    topic.quickToken = null;
    await this.topicRepo.save(topic);
    return { success: true };
  }

  async create(user: any, topicData: Partial<LearningTopic>) {
    const topic = this.topicRepo.create({
      ...topicData,
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

    const module = this.moduleRepo.create({
      ...moduleData,
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

  async remove(id: string, user: any) {
    const topic = await this.findOneFor(id, user, 'owner');
    if (topic.modules && topic.modules.length > 0) {
      await this.moduleRepo.remove(topic.modules);
    }
    await this.topicRepo.remove(topic);
    return { success: true };
  }

  /**
   * Inhaltliche Felder, die ein Bearbeiter setzen darf.
   *
   * Bewusst eine Positivliste: Vorher kam nur der Eigentümer hierher, ein
   * blindes Object.assign war deshalb harmlos. Sobald Fremde schreiben
   * dürfen, ließen sich darüber sonst ownerId, sharedWith/sharedAccess oder
   * das Themenpasswort mitsetzen.
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
