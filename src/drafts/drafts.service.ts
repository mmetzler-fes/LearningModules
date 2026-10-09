import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ModuleDraft } from '../core/entities/module-draft.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { TopicsService } from '../topics/topics.service';

/** Entwürfe, die so lange nicht angefasst wurden, räumt die App weg. */
const KEEP_DAYS = 90;

@Injectable()
export class DraftsService {
  constructor(
    @InjectRepository(ModuleDraft) private readonly draftRepo: Repository<ModuleDraft>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    private readonly topics: TopicsService,
  ) {}

  private cleanKey(key: string): string {
    const k = String(key || '');
    if (!/^[A-Za-z0-9_:.-]{1,120}$/.test(k)) throw new BadRequestException('Ungültiger Entwurf.');
    return k;
  }

  /** Meine Entwürfe (ohne Inhalt), optional für ein Lernthema. Alte und verwaiste fallen weg. */
  async list(user: any, topicId?: string) {
    await this.draftRepo.delete({ userId: user.userId, updatedAt: LessThan(new Date(Date.now() - KEEP_DAYS * 86400e3)) });
    const drafts = await this.draftRepo.find({
      where: { userId: user.userId, ...(topicId ? { topicId } : {}) },
      select: ['id', 'draftKey', 'topicId', 'moduleId', 'title', 'updatedAt'],
      order: { updatedAt: 'DESC' },
    });
    // Entwürfe zu gelöschten Modulen haben kein Ziel mehr.
    const ids = drafts.map((d) => d.moduleId).filter(Boolean) as string[];
    const existing = new Set(ids.length ? (await this.moduleRepo.find({ where: { id: In(ids) }, select: ['id'] })).map((m) => m.id) : []);
    const orphaned = drafts.filter((d) => d.moduleId && !existing.has(d.moduleId));
    if (orphaned.length) await this.draftRepo.delete({ id: In(orphaned.map((d) => d.id)) });
    return drafts.filter((d) => !orphaned.includes(d));
  }

  async get(user: any, key: string) {
    const draft = await this.draftRepo.findOne({ where: { userId: user.userId, draftKey: this.cleanKey(key) } });
    if (!draft) throw new NotFoundException('Kein Entwurf.');
    return draft;
  }

  /** Entwurf anlegen oder aktualisieren. Nur in Lernthemen, die man bearbeiten darf. */
  async save(user: any, key: string, body: { topicId?: string; moduleId?: string | null; data?: any }) {
    const draftKey = this.cleanKey(key);
    const topicId = String(body?.topicId || '');
    await this.topics.findOneFor(topicId, user, 'write');
    if (!body?.data || typeof body.data !== 'object') throw new BadRequestException('Kein Inhalt.');
    let draft = await this.draftRepo.findOne({ where: { userId: user.userId, draftKey } });
    if (!draft) draft = this.draftRepo.create({ id: crypto.randomUUID(), userId: user.userId, draftKey });
    Object.assign(draft, {
      topicId,
      moduleId: body.moduleId || null,
      title: String(body.data.title || '').slice(0, 200),
      data: body.data,
    });
    await this.draftRepo.save(draft);
    return { success: true, updatedAt: draft.updatedAt };
  }

  async remove(user: any, key: string) {
    await this.draftRepo.delete({ userId: user.userId, draftKey: this.cleanKey(key) });
    return { success: true };
  }
}
