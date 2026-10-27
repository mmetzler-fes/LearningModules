import { ForbiddenException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentInk } from '../core/entities/document-ink.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';

/**
 * Beschriftung der Lehrkraft auf dem Server statt nur im Browser – auf jedem
 * ihrer Geräte da, auch für importierte .xopp-Striche. Schreiben darf nur,
 * wem das Lernthema des Dokuments gehört; ein noch nicht gespeichertes neues
 * Dokument (Modul gibt es noch nicht) darf schon eine Beschriftung haben.
 */
/** Wie bei den Bearbeitungen der Schüler (work.service.ts). */
const MAX_INK_BYTES = 5 * 1024 * 1024;

@Injectable()
export class TeacherInkService {
  constructor(
    @InjectRepository(DocumentInk) private readonly repo: Repository<DocumentInk>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
  ) {}

  /** Gehört das Dokument `moduleId` der Lehrkraft? Ein Modul, das es (noch) nicht gibt, zählt als ihres. */
  private async owns(userId: string, moduleId: string) {
    const mod = await this.moduleRepo.findOne({ where: { id: moduleId }, select: ['id', 'topicId', 'type'] });
    if (!mod) return true;
    const topic = await this.topicRepo.findOne({ where: { id: mod.topicId }, select: ['id', 'ownerId'] });
    return !!topic && topic.ownerId === userId;
  }

  async get(user: any, moduleId: string) {
    const ink = await this.repo.findOne({ where: { id: String(moduleId) } });
    if (!ink || ink.ownerId !== user.userId) return { data: null, visibility: 'teacher', own: await this.owns(user.userId, String(moduleId)) };
    return { data: ink.data, visibility: ink.visibility, own: true, updatedAt: ink.updatedAt };
  }

  /** `{ data?, visibility? }` – fehlt `data`, bleibt der Stand (nur die Sichtbarkeit ändert sich). */
  async put(user: any, moduleId: string, body: { data?: any; visibility?: string }) {
    const id = String(moduleId || '');
    if (!/^[\w-]{6,64}$/.test(id)) throw new ForbiddenException('Ungültiges Dokument.');
    const existing = await this.repo.findOne({ where: { id } });
    if ((existing && existing.ownerId !== user.userId) || !(await this.owns(user.userId, id))) {
      throw new ForbiddenException('Beschriften lässt sich nur ein eigenes Dokument.');
    }
    const ink = existing || this.repo.create({ id, ownerId: user.userId, visibility: 'teacher', data: null });
    if (body?.data !== undefined) {
      if (Buffer.byteLength(JSON.stringify(body.data ?? null)) > MAX_INK_BYTES) {
        throw new PayloadTooLargeException('Die Beschriftung ist zu groß (mehr als 5 MB).');
      }
      ink.data = body.data;
    }
    if (body?.visibility === 'all' || body?.visibility === 'teacher') ink.visibility = body.visibility;
    await this.repo.save(ink);
    return { success: true, visibility: ink.visibility };
  }

  /** Für Schüler: die Beschriftung, wenn sie für alle sichtbar ist – sonst null. */
  async forStudents(moduleId: string) {
    const ink = await this.repo.findOne({ where: { id: moduleId } });
    return ink && ink.visibility === 'all' ? ink.data : null;
  }
}
