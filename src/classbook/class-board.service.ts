import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ClassBoard } from '../core/entities/class-board.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { ClassesService } from '../classes/classes.service';
import { ClassbookService } from './classbook.service';
import { embeddedQuizIds, forStudents } from '../core/public/student-view';

/** Wie bei der Beschriftung der Lehrkraft (teacher-ink.service.ts). */
const MAX_BOARD_BYTES = 20 * 1024 * 1024;

const boardId = (classId: string, moduleId: string) => `${classId}:${moduleId}`;

/**
 * ✍️ Tafelbild je Klasse und Dokument (docs/klassennotizbuch.md): Die Lehrkraft
 * schreibt im Klassennotizbuch auf ein Dokument, gespeichert wird nur für diese
 * Klasse. Das Dokument im Lernnotizbuch bleibt sauber. Schüler sehen das
 * Tafelbild erst, wenn die Lehrkraft es einschaltet (●), und nur zum Ansehen.
 */
@Injectable()
export class ClassBoardService {
  constructor(
    @InjectRepository(ClassBoard) private readonly repo: Repository<ClassBoard>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    private readonly classes: ClassesService,
    private readonly classbook: ClassbookService,
  ) {}

  /** Ein Dokument, das die Lehrkraft dieser Klasse zeigen darf: eigenes oder einer Zuweisung der Klasse. */
  private async documentFor(user: any, classId: string, moduleId: string) {
    const mod = await this.moduleRepo.findOne({ where: { id: String(moduleId || '') }, select: ['id', 'topicId', 'type', 'title'] });
    if (!mod || mod.type !== 'document') throw new NotFoundException('Dokument nicht gefunden.');
    const topic = await this.topicRepo.findOne({ where: { id: mod.topicId }, select: ['id', 'ownerId'] });
    if (topic?.ownerId === user.userId) return mod;
    const links = await this.linkRepo.find({ where: { classId }, select: ['id', 'selection'] });
    if (links.some((l) => (l.selection || []).some((e) => e.topicId === mod.topicId))) return mod;
    throw new ForbiddenException('Dieses Dokument gehört nicht zu dieser Klasse.');
  }

  /** Alle Tafelbilder der Klasse (ohne Inhalt) – für die Einträge im Klassennotizbuch. */
  async list(user: any, classId: string) {
    await this.classes.ownedClass(classId, user);
    const rows = await this.repo.find({ where: { classId }, select: ['id', 'moduleId', 'studentVisible', 'updatedAt'] });
    return rows.map((b) => ({ moduleId: b.moduleId, studentVisible: b.studentVisible, updatedAt: b.updatedAt }));
  }

  async get(user: any, classId: string, moduleId: string) {
    await this.classes.ownedClass(classId, user);
    const b = await this.repo.findOne({ where: { id: boardId(classId, moduleId) } });
    return { data: b?.data ?? null, studentVisible: !!b?.studentVisible, updatedAt: b?.updatedAt ?? null };
  }

  /** `{ data?, studentVisible? }` – fehlt `data`, bleibt der Stand (nur ●/○ ändert sich). */
  async put(user: any, classId: string, moduleId: string, body: { data?: any; studentVisible?: boolean }) {
    await this.classes.ownedClass(classId, user);
    const mod = await this.documentFor(user, classId, moduleId);
    const id = boardId(classId, mod.id);
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing && body?.data === undefined) throw new BadRequestException('Noch kein Tafelbild.');
    const b = existing || this.repo.create({ id, classId, moduleId: mod.id, ownerId: user.userId, studentVisible: false, data: null });
    if (body?.data !== undefined) {
      if (Buffer.byteLength(JSON.stringify(body.data ?? null)) > MAX_BOARD_BYTES) {
        throw new PayloadTooLargeException('Das Tafelbild ist zu groß (mehr als 20 MB).');
      }
      b.data = body.data;
    }
    if (typeof body?.studentVisible === 'boolean') b.studentVisible = body.studentVisible;
    await this.repo.save(b);
    return { success: true, studentVisible: b.studentVisible, updatedAt: b.updatedAt };
  }

  /** „Neues Tafelbild beginnen“: das bisherige weg. */
  async remove(user: any, classId: string, moduleId: string) {
    await this.classes.ownedClass(classId, user);
    await this.repo.delete({ id: boardId(classId, String(moduleId || '')) });
    return { success: true };
  }

  /** Schüler: eingeschaltete Tafelbilder ihrer Klasse (ohne Inhalt). */
  async listForStudent(token: string, ticket: unknown) {
    const { klasse } = await this.classbook.studentSession(token, ticket);
    const rows = await this.repo.find({ where: { classId: klasse.id, studentVisible: true }, select: ['id', 'moduleId', 'updatedAt'] });
    return rows.map((b) => ({ moduleId: b.moduleId, updatedAt: b.updatedAt }));
  }

  /** Schüler: ein eingeschaltetes Tafelbild mit dem Dokument (ohne Lösungen) und seinen Quizzen – nur zum Ansehen. */
  async getForStudent(token: string, ticket: unknown, moduleId: string) {
    const { klasse } = await this.classbook.studentSession(token, ticket);
    const b = await this.repo.findOne({ where: { id: boardId(klasse.id, String(moduleId || '')) } });
    if (!b?.studentVisible) throw new NotFoundException('Dieses Tafelbild ist gerade nicht freigegeben.');
    const mod = await this.moduleRepo.findOne({ where: { id: b.moduleId } });
    if (!mod || mod.type !== 'document') throw new NotFoundException('Das Dokument gibt es nicht mehr.');
    const ids = embeddedQuizIds(mod);
    const embedded = ids.length ? await this.moduleRepo.find({ where: { id: In(ids), topicId: mod.topicId } }) : [];
    return {
      moduleId: mod.id,
      title: mod.title || 'Dokument',
      content: forStudents(mod).content,
      embedded: embedded.map((m) => forStudents({ id: m.id, title: m.title, type: m.type, content: m.content })),
      data: b.data ?? null,
      updatedAt: b.updatedAt,
    };
  }
}
