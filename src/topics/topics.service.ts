import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import * as crypto from 'crypto';

@Injectable()
export class TopicsService {
  constructor(
    @InjectRepository(LearningTopic)
    private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule)
    private readonly moduleRepo: Repository<LearningModule>,
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
