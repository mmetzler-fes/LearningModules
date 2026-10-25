import { Injectable, NotFoundException, ForbiddenException, BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { DocumentWork } from '../core/entities/document-work.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { User } from '../core/entities/user.entity';
import { LinksService, LinkAccess } from '../links/links.service';
import { ClassesService } from '../classes/classes.service';
import { readTicket } from '../classes/student-ticket';
import { isTestStudent } from '../classes/test-student';
import { newPin, pinMatches, PinGuard } from './pin';
import { ExamService } from './exam.service';

/** Größer wird ein Stand mit Strichen kaum; Bilder als Hintergrund speichert der Server nicht. */
export const MAX_WORK_BYTES = 5 * 1024 * 1024;

export interface WorkAccess {
  linkToken?: string;
  studentTicket?: string;
  moduleId?: string;
  pin?: string;
}

/**
 * Bearbeitungen der Schüler (Stift-Editor auf Dokumenten): speichern, laden,
 * für die Lehrkraft auflisten. Regeln in docs/bearbeitungen.md:
 * - nur über einen Klassenlink mit gültigem Schülerausweis,
 * - die PIN schützt das Weiterbearbeiten; angezeigt wird sie einmal, beim
 *   ersten Speichern überhaupt, danach fragt jeder Link nach ihr,
 * - Klassenarbeit: nur die laufende Anmeldung vor der Abgabe, ohne PIN;
 *   einen Wiedereinstieg gibt die Lehrkraft frei (ExamService).
 */
@Injectable()
export class WorkService {
  private readonly guard = new PinGuard();

  constructor(
    @InjectRepository(DocumentWork) private readonly workRepo: Repository<DocumentWork>,
    @InjectRepository(ClassStudent) private readonly studentRepo: Repository<ClassStudent>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly links: LinksService,
    private readonly classes: ClassesService,
    private readonly exams: ExamService,
  ) {}

  /** Link, Ausweis, Schüler und Dokument prüfen. */
  private async access(body: WorkAccess) {
    const found = body?.linkToken ? await this.links.linkOfToken(String(body.linkToken)) : null;
    if (!found) throw new NotFoundException('Dieser Link ist ungültig oder wurde zurückgezogen.');
    const { link, access } = found;
    if (!link.active || found.quick?.active === false) throw new ForbiddenException('Dieser Link ist derzeit deaktiviert.');
    const owner = await this.userRepo.findOne({ where: { id: link.ownerId } });
    if (!owner || owner.active === false) throw new ForbiddenException('Dieser Link ist derzeit gesperrt.');
    const klasse = await this.classes.findById(link.classId);
    if (!klasse) throw new ForbiddenException('Speichern auf dem Server geht nur über einen Klassenlink.');
    const ticket = readTicket(body.studentTicket, link.id);
    if (!ticket) throw new ForbiddenException('Die Anmeldung ist abgelaufen. Bitte den Link neu öffnen und den Namen eingeben.');
    const moduleId = String(body.moduleId || '');
    const resolved = await this.links.resolveModules(link);
    const mod = resolved.flatMap((r) => r.modules).find((m) => m.id === moduleId);
    if (!mod || mod.type !== 'document') throw new NotFoundException('Dokument nicht gefunden.');
    const student = isTestStudent(ticket.s) ? null : await this.studentRepo.findOne({ where: { id: ticket.s, classId: klasse.id } });
    if (!student && !isTestStudent(ticket.s)) throw new ForbiddenException('Dieser Name steht nicht mehr in der Klassenliste.');
    return { link, access: access as LinkAccess, klasse, ticket, mod, student };
  }

  /** Schon einmal eine PIN gesehen? Dann muss sie stimmen (nicht in der Klassenarbeit). */
  private checkPin(student: ClassStudent | null, access: LinkAccess, typed?: string) {
    if (!student || access === 'exam' || !student.pinShownAt || !student.pin) return;
    const locked = this.guard.lockedFor(student.id);
    if (locked) throw new ForbiddenException({ statusCode: 403, needPin: true, message: `Zu viele falsche PINs – bitte in ${locked} Minute${locked === 1 ? '' : 'n'} noch einmal.` });
    if (!typed) throw new ForbiddenException({ statusCode: 403, needPin: true, message: 'Bitte deine PIN eingeben.' });
    if (!pinMatches(typed, student.pin)) {
      this.guard.failed(student.id);
      throw new ForbiddenException({ statusCode: 403, needPin: true, message: 'Falsche PIN. Vergessen? Die Lehrkraft sieht sie in der Klassenliste.' });
    }
    this.guard.passed(student.id);
  }

  /** Klassenarbeit: nur die laufende Anmeldung, vor der Abgabe (Wiedereinstieg gibt die Lehrkraft frei). */
  private async assertExamOpen(a: { access: LinkAccess; link: { id: string }; ticket: { s: string; e: number } }) {
    if (a.access !== 'exam' || isTestStudent(a.ticket.s)) return;
    if (!(await this.exams.isOpen(a.link.id, a.ticket.s, a.ticket.e))) {
      throw new ForbiddenException('Diese Klassenarbeit ist abgegeben oder an einem anderen Gerät geöffnet – weiter geht es nur, wenn die Lehrkraft den Wiedereinstieg freigibt.');
    }
  }

  private find(linkId: string, studentId: string, moduleId: string) {
    return this.workRepo.findOne({ where: { linkId, studentId, moduleId } });
  }

  /** Stand laden – `{ data: null }`, wenn es noch keinen gibt. */
  async load(body: WorkAccess) {
    const a = await this.access(body);
    this.checkPin(a.student, a.access, body.pin);
    await this.assertExamOpen(a);
    const work = await this.find(a.link.id, a.ticket.s, a.mod.id);
    if (!work) return { data: null };
    return { data: work.data, updatedAt: work.updatedAt };
  }

  /**
   * Stand speichern. Beim ersten Speichern überhaupt bekommt der Schüler
   * seine PIN zu sehen (`pin` in der Antwort) – nur dieses eine Mal.
   */
  async save(body: WorkAccess & { data?: any }) {
    const a = await this.access(body);
    this.checkPin(a.student, a.access, body.pin);
    const data = body?.data;
    if (!data || typeof data !== 'object' || data.v !== 1) throw new BadRequestException('Kein gültiger Stand.');
    const bytes = Buffer.byteLength(JSON.stringify(data));
    if (bytes > MAX_WORK_BYTES) throw new PayloadTooLargeException('Die Bearbeitung ist zu groß (mehr als 5 MB).');

    await this.assertExamOpen(a);
    let work = await this.find(a.link.id, a.ticket.s, a.mod.id);
    if (!work) {
      work = this.workRepo.create({
        id: crypto.randomUUID(), teacherId: a.link.ownerId, linkId: a.link.id, linkName: a.link.name || '',
        studentId: a.ticket.s, classId: a.klasse.id, moduleId: a.mod.id, access: a.access,
      });
    }
    Object.assign(work, {
      data, bytes, studentName: a.ticket.n, className: a.klasse.name, moduleTitle: a.mod.title || '', topicId: a.mod.topicId || null,
    });
    await this.workRepo.save(work);

    let pin: string | undefined;
    if (a.student && a.access !== 'exam' && !a.student.pinShownAt) {
      a.student.pin = a.student.pin || newPin();
      a.student.pinShownAt = new Date();
      await this.studentRepo.update({ id: a.student.id }, { pin: a.student.pin, pinShownAt: a.student.pinShownAt });
      pin = a.student.pin;
    }
    return { success: true, updatedAt: work.updatedAt, ...(pin ? { pin } : {}) };
  }

  // ---- Lehrkraft ----

  /** Bearbeitungen der eigenen Links, ohne den Stand selbst. Filter: linkId, moduleId, classId. */
  async list(user: any, filter: { linkId?: string; moduleId?: string; classId?: string } = {}) {
    const where: any = { teacherId: user.userId };
    for (const k of ['linkId', 'moduleId', 'classId'] as const) if (filter[k]) where[k] = String(filter[k]);
    const rows = await this.workRepo.find({
      where, order: { updatedAt: 'DESC' },
      select: ['id', 'linkId', 'linkName', 'studentId', 'studentName', 'classId', 'className', 'moduleId', 'moduleTitle', 'topicId', 'access', 'bytes', 'createdAt', 'updatedAt'],
    });
    return rows;
  }

  async get(user: any, id: string) {
    const work = await this.workRepo.findOne({ where: { id, teacherId: user.userId } });
    if (!work) throw new NotFoundException('Bearbeitung nicht gefunden.');
    return work;
  }

  async remove(user: any, id: string) {
    const work = await this.get(user, id);
    await this.workRepo.remove(work);
    return { success: true };
  }
}
