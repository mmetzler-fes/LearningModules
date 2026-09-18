import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { User } from '../core/entities/user.entity';
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
  ) {}

  async findAll(user: any) {
    const qb = this.topicRepo.createQueryBuilder('topic');

    // Teachers and admins only see their own topics
    qb.where('topic.ownerId = :ownerId', { ownerId: user.userId });

    return qb.leftJoinAndSelect('topic.modules', 'modules').orderBy('modules.orderIndex', 'ASC').addOrderBy('topic.id', 'ASC').getMany();
  }

  async findOne(id: string, user: any) {
    const qb = this.topicRepo.createQueryBuilder('topic')
      .where('topic.id = :id', { id })
      .leftJoinAndSelect('topic.modules', 'modules')
      .orderBy('modules.orderIndex', 'ASC');

    const topic = await qb.getOne();
    if (!topic) throw new NotFoundException('Thema nicht gefunden');

    // Teachers can only access their own topics
    if (user.role === 'teacher' && topic.ownerId !== user.userId) {
      throw new ForbiddenException('Keine Berechtigung für dieses Thema');
    }

    return topic;
  }

  // ---- Freigabe zum Kopieren ----

  /** Prüft, ob ein Thema für diesen Benutzer zum Kopieren freigegeben ist. */
  private isSharedWith(topic: LearningTopic, userId: string): boolean {
    const list = topic.sharedWith;
    if (!Array.isArray(list) || list.length === 0) return false;
    return list.includes('*') || list.includes(userId);
  }

  /** Freigabe setzen. Nur der Eigentümer (oder ein Admin) darf das. */
  async setSharing(id: string, user: any, sharedWith: string[]) {
    const topic = await this.findOne(id, user);
    if (user.role === 'teacher' && topic.ownerId !== user.userId) {
      throw new ForbiddenException('Nur der Eigentümer kann die Freigabe ändern.');
    }
    const clean = Array.isArray(sharedWith)
      ? [...new Set(sharedWith.map(String).filter(Boolean))]
      : [];
    // '*' schlägt jede Einzelauswahl – sonst wäre der Zustand widersprüchlich.
    topic.sharedWith = clean.includes('*') ? ['*'] : clean;
    await this.topicRepo.save(topic);
    return { success: true, sharedWith: topic.sharedWith };
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

    return topics
      .filter((t) => t.ownerId !== user.userId && this.isSharedWith(t, user.userId))
      .map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        ownerId: t.ownerId,
        ownerName: ownerName.get(t.ownerId) || 'Unbekannt',
        moduleCount: (t.modules || []).length,
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
    const topic = await this.findOne(id, user);

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

    const url = `${this.baseUrl(req)}/?q=${topic.quickToken}`;

    return {
      token: topic.quickToken,
      url,
      qrSvg: await this.renderQr(url),
      topicId: topic.id,
      title: topic.title,
      moduleCount: activeCount,
    };
  }

  /**
   * Öffentliche Adresse der Anwendung. APP_URL hat Vorrang; sonst wird sie aus
   * dem Request abgeleitet, damit es hinter einem Reverse Proxy ohne
   * zusätzliche Konfiguration stimmt.
   */
  private baseUrl(req?: any): string {
    const configured = (process.env.APP_URL || '').trim();
    if (configured) return configured.replace(/\/+$/, '');

    const headers = req?.headers || {};
    const proto = (headers['x-forwarded-proto'] || req?.protocol || 'http').toString().split(',')[0].trim();
    const host = (headers['x-forwarded-host'] || headers.host || 'localhost:3000').toString().split(',')[0].trim();
    return `${proto}://${host}`;
  }

  /** QR-Code als SVG – skaliert verlustfrei und lässt sich sauber ausdrucken. */
  private async renderQr(url: string): Promise<string | null> {
    try {
      const moduleName = 'qrcode';
      const qrcode: any = await import(moduleName);
      const toString = qrcode.toString || qrcode.default?.toString;
      return await toString(url, { type: 'svg', margin: 1, width: 240 });
    } catch (err: any) {
      // Ohne QR-Code bleibt der Link trotzdem nutzbar.
      return null;
    }
  }

  /** Quick-Link entwerten, ohne einen neuen zu erzeugen. */
  async revokeQuickLink(id: string, user: any) {
    const topic = await this.findOne(id, user);
    topic.quickToken = null;
    await this.topicRepo.save(topic);
    return { success: true };
  }

  async create(user: any, topicData: Partial<LearningTopic>) {
    const topic = this.topicRepo.create({
      ...topicData,
      id: require('crypto').randomUUID(),
      ownerId: user.userId,
      visibility: (topicData as any).visibility || 'locked',
    });
    return this.topicRepo.save(topic);
  }

  async addModule(topicId: string, user: any, moduleData: Partial<LearningModule>) {
    const topic = await this.findOne(topicId, user);
    let orderIndex = moduleData.orderIndex;
    if (orderIndex === undefined) {
      if (moduleData.id) {
        const existing = topic.modules ? topic.modules.find(m => m.id === moduleData.id) : null;
        orderIndex = existing ? existing.orderIndex : (topic.modules ? topic.modules.length : 0);
      } else {
        orderIndex = topic.modules ? topic.modules.length : 0;
      }
    }
    const module = this.moduleRepo.create({
      ...moduleData,
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
    const topic = await this.findOne(id, user);
    if (topic.modules && topic.modules.length > 0) {
      await this.moduleRepo.remove(topic.modules);
    }
    await this.topicRepo.remove(topic);
    return { success: true };
  }

  async update(id: string, user: any, updateData: Partial<LearningTopic>) {
    const topic = await this.findOne(id, user);
    Object.assign(topic, updateData);
    // Auto-promote visibility when activating: selected=true + visibility='locked' → 'public'
    if (topic.selected && topic.visibility === 'locked') {
      topic.visibility = 'public';
    }
    return this.topicRepo.save(topic);
  }

  async removeModule(topicId: string, moduleId: string, user: any) {
    const topic = await this.findOne(topicId, user);
    const module = topic.modules.find(m => m.id === moduleId);
    if (!module) throw new NotFoundException('Modul nicht gefunden');
    await this.moduleRepo.remove(module);
    return { success: true };
  }

  async toggleModule(topicId: string, moduleId: string, selected: boolean, user: any) {
    const topic = await this.findOne(topicId, user);
    const module = topic.modules.find(m => m.id === moduleId);
    if (!module) throw new NotFoundException('Modul nicht gefunden');
    module.moduleSelected = selected;
    await this.moduleRepo.save(module);
    return { success: true };
  }

  async bulkToggleModules(topicId: string, moduleIds: string[], selected: boolean, user: any) {
    const topic = await this.findOne(topicId, user);
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
    const topic = await this.findOne(topicId, user);
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
