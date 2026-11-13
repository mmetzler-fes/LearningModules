import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, PayloadTooLargeException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { ClassBoard } from '../core/entities/class-board.entity';
import { ClassSolution } from '../core/entities/class-solution.entity';
import { DocumentInk } from '../core/entities/document-ink.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { ClassesService } from '../classes/classes.service';
import { ClassbookService } from './classbook.service';
import { embeddedQuizIds, forStudents } from '../core/public/student-view';
import { baseUrl, renderQr } from '../core/share/link-url';
import * as crypto from 'crypto';

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
export class ClassBoardService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ClassBoardService.name);

  constructor(
    @InjectRepository(ClassBoard) private readonly repo: Repository<ClassBoard>,
    @InjectRepository(ClassSolution) private readonly solutionRepo: Repository<ClassSolution>,
    @InjectRepository(DocumentInk) private readonly inkRepo: Repository<DocumentInk>,
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
    return this.withDocument(b.moduleId, b.data, b.updatedAt);
  }

  // ---- 🔑 Lehrerlösung: die Beschriftung der Lehrkraft am Dokument, je Klasse freigegeben ----

  /** Eigene Dokumente mit Lehrerlösung und ob diese Klasse sie sieht. */
  async solutions(user: any, classId: string) {
    await this.classes.ownedClass(classId, user);
    const inks = await this.inkRepo.find({ where: { ownerId: user.userId, data: Not(IsNull()) }, select: ['id'] });
    const on = new Set((await this.solutionRepo.find({ where: { classId }, select: ['id', 'moduleId'] })).map((r) => r.moduleId));
    return inks.map((i) => ({ moduleId: i.id, studentVisible: on.has(i.id) }));
  }

  /** ●/○ der Lehrerlösung für diese Klasse. */
  async setSolution(user: any, classId: string, moduleId: string, studentVisible: boolean) {
    await this.classes.ownedClass(classId, user);
    const mod = await this.documentFor(user, classId, moduleId);
    const id = boardId(classId, mod.id);
    if (studentVisible) {
      const ink = await this.inkRepo.findOne({ where: { id: mod.id } });
      if (!ink?.data || ink.ownerId !== user.userId) throw new BadRequestException('Zu diesem Dokument gibt es keine Lehrerlösung.');
      if (!(await this.solutionRepo.findOne({ where: { id } }))) await this.solutionRepo.save(this.solutionRepo.create({ id, classId, moduleId: mod.id }));
    } else {
      await this.solutionRepo.delete({ id });
    }
    return { success: true, studentVisible };
  }

  /** Lehrerlösung als Ausgangspunkt: in das Tafelbild dieser Klasse kopieren (ersetzt ein vorhandenes). */
  async boardFromSolution(user: any, classId: string, moduleId: string) {
    await this.classes.ownedClass(classId, user);
    const ink = await this.inkRepo.findOne({ where: { id: String(moduleId || '') } });
    if (!ink?.data || ink.ownerId !== user.userId) throw new NotFoundException('Zu diesem Dokument gibt es keine Lehrerlösung.');
    return this.put(user, classId, moduleId, { data: ink.data });
  }

  /** Tafelbild als Lehrerlösung übernehmen: gilt dann für alle Klassen (nur eigene Dokumente). */
  async solutionFromBoard(user: any, classId: string, moduleId: string) {
    await this.classes.ownedClass(classId, user);
    const b = await this.repo.findOne({ where: { id: boardId(classId, String(moduleId || '')) } });
    if (!b?.data) throw new NotFoundException('Noch kein Tafelbild.');
    const mod = await this.moduleRepo.findOne({ where: { id: b.moduleId }, select: ['id', 'topicId'] });
    const topic = mod ? await this.topicRepo.findOne({ where: { id: mod.topicId }, select: ['id', 'ownerId'] }) : null;
    if (topic?.ownerId !== user.userId) throw new ForbiddenException('Eine Lehrerlösung gibt es nur an eigenen Dokumenten.');
    const ink = (await this.inkRepo.findOne({ where: { id: b.moduleId } })) || this.inkRepo.create({ id: b.moduleId, ownerId: user.userId, visibility: 'teacher', data: null });
    ink.data = b.data;
    await this.inkRepo.save(ink);
    return { success: true };
  }

  /** Schüler: freigegebene Lehrerlösungen ihrer Klasse (ohne Inhalt). */
  async solutionsForStudent(token: string, ticket: unknown) {
    const { klasse } = await this.classbook.studentSession(token, ticket);
    const rows = await this.solutionRepo.find({ where: { classId: klasse.id } });
    if (!rows.length) return [];
    const inks = await this.inkRepo.find({ where: { id: In(rows.map((r) => r.moduleId)), ownerId: klasse.ownerId || '', data: Not(IsNull()) }, select: ['id', 'updatedAt'] });
    return inks.map((i) => ({ moduleId: i.id, updatedAt: i.updatedAt }));
  }

  /** Schüler: eine freigegebene Lehrerlösung mit dem Dokument – nur zum Ansehen. */
  async solutionForStudent(token: string, ticket: unknown, moduleId: string) {
    const { klasse } = await this.classbook.studentSession(token, ticket);
    const released = await this.solutionRepo.findOne({ where: { id: boardId(klasse.id, String(moduleId || '')) } });
    const ink = released ? await this.inkRepo.findOne({ where: { id: released.moduleId } }) : null;
    if (!ink?.data || ink.ownerId !== klasse.ownerId) throw new NotFoundException('Diese Lösung ist gerade nicht freigegeben.');
    return this.withDocument(ink.id, ink.data, ink.updatedAt);
  }

  private async withDocument(moduleId: string, data: any, updatedAt: Date) {
    const mod = await this.moduleRepo.findOne({ where: { id: moduleId } });
    if (!mod || mod.type !== 'document') throw new NotFoundException('Das Dokument gibt es nicht mehr.');
    const ids = embeddedQuizIds(mod);
    const embedded = ids.length ? await this.moduleRepo.find({ where: { id: In(ids), topicId: mod.topicId } }) : [];
    return {
      moduleId: mod.id,
      title: mod.title || 'Dokument',
      content: forStudents(mod).content,
      embedded: embedded.map((m) => forStudents({ id: m.id, title: m.title, type: m.type, content: m.content })),
      data: data ?? null,
      updatedAt,
    };
  }

  /**
   * Bisher „👁 Für alle“ (DocumentInk.visibility 'all'): einmal in Freigaben umwandeln –
   * für jede Klasse der Lehrkraft, der das Lernthema des Dokuments zugewiesen ist. Danach 'teacher'.
   */
  async onApplicationBootstrap() {
    await this.migrateVisibleInk().catch((err) => this.logger.warn(`„Für alle“ nicht umgewandelt: ${err?.message || err}`));
  }

  async migrateVisibleInk() {
    const inks = await this.inkRepo.find({ where: { visibility: 'all' } });
    for (const ink of inks) {
      const mod = await this.moduleRepo.findOne({ where: { id: ink.id }, select: ['id', 'topicId'] });
      if (mod) {
        const links = await this.linkRepo.find({ where: { ownerId: ink.ownerId, classId: Not(IsNull()) }, select: ['id', 'classId', 'selection'] });
        const classIds = new Set(links.filter((l) => (l.selection || []).some((e) => e.topicId === mod.topicId)).map((l) => l.classId as string));
        for (const classId of classIds) {
          const id = boardId(classId, mod.id);
          if (!(await this.solutionRepo.findOne({ where: { id } }))) await this.solutionRepo.save(this.solutionRepo.create({ id, classId, moduleId: mod.id }));
        }
      }
      ink.visibility = 'teacher';
      await this.inkRepo.save(ink);
    }
    if (inks.length) this.logger.log(`${inks.length} Beschriftung(en) „für alle“ als Lehrerlösung je Klasse freigegeben.`);
  }

  // ---- 🔗 Quick-Link: Tafelbild bzw. Lehrerlösung ohne Anmeldung ansehen ----

  /** `kind`: 'board' | 'solution'. Erzeugt den Link (oder zieht ihn mit `revoke` zurück) → `{ url, title, className, qrSvg }`. */
  async share(user: any, classId: string, kind: string, moduleId: string, revoke: boolean, req?: any) {
    const klasse = await this.classes.ownedClass(classId, user);
    const id = boardId(classId, String(moduleId || ''));
    const repo: Repository<ClassBoard | ClassSolution> = kind === 'solution' ? this.solutionRepo : this.repo;
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(kind === 'solution' ? 'Die Lehrerlösung ist für diese Klasse nicht freigegeben.' : 'Noch kein Tafelbild.');
    row.shareToken = revoke ? null : row.shareToken || crypto.randomBytes(12).toString('base64url');
    await repo.save(row as any);
    if (!row.shareToken) return { revoked: true };
    const mod = await this.moduleRepo.findOne({ where: { id: row.moduleId }, select: ['id', 'title'] });
    const url = `${baseUrl(req)}/?tb=${row.shareToken}`;
    return { url, title: `${kind === 'solution' ? '🔑 Lösung' : '✍️ Tafelbild'} – ${mod?.title || 'Dokument'}`, className: klasse.name, qrSvg: await renderQr(url) };
  }

  /** Öffentlich über den Quick-Link: das Dokument mit Tafelbild bzw. Lösung – nur, solange ● an ist. */
  async viewByToken(token: string) {
    const t = String(token || '');
    const gone = () => new NotFoundException('Dieser Link gilt nicht mehr.');
    if (t.length < 10) throw gone();
    const b = await this.repo.findOne({ where: { shareToken: t } });
    if (b) {
      if (!b.studentVisible || !b.data) throw new NotFoundException('Dieses Tafelbild ist gerade nicht freigegeben.');
      return { kind: 'board', ...(await this.withDocument(b.moduleId, b.data, b.updatedAt)) };
    }
    const s = await this.solutionRepo.findOne({ where: { shareToken: t } });
    const ink = s ? await this.inkRepo.findOne({ where: { id: s.moduleId } }) : null;
    if (!s || !ink?.data) throw gone();
    return { kind: 'solution', ...(await this.withDocument(ink.id, ink.data, ink.updatedAt)) };
  }
}
