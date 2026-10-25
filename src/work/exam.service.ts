import { Injectable, NotFoundException, ForbiddenException, BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ExamAttempt } from '../core/entities/exam-attempt.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { LinksService } from '../links/links.service';
import { readTicket } from '../classes/student-ticket';
import { isTestStudent } from '../classes/test-student';

const MAX_PROGRESS_BYTES = 2 * 1024 * 1024;

/**
 * Klassenarbeiten über einen Klassenlink: wer begonnen hat, Zwischenstand,
 * Abgabe, Wiedereinstieg nur nach Freigabe der Lehrkraft
 * (docs/bearbeitungen.md#klassenarbeit). Gilt bei „nur ein Durchlauf“;
 * ohne diese Einstellung setzt jeder neue Start einfach fort.
 */
@Injectable()
export class ExamService {
  constructor(
    @InjectRepository(ExamAttempt) private readonly repo: Repository<ExamAttempt>,
    private readonly links: LinksService,
  ) {}

  /** Bewacht dieser Link Klassenarbeiten (mit Klasse, kein Testschüler)? */
  private guarded(link: TopicLink, studentId: string | null) {
    return !!link.classId && !!studentId && !isTestStudent(studentId);
  }

  /**
   * Start der Klassenarbeit: neuer Versuch, Wiedereinstieg nach Freigabe –
   * oder Absage. Liefert den Zwischenstand zum Fortsetzen (oder null).
   */
  async begin(link: TopicLink, student: { id: string | null; name: string }, session: number) {
    if (!this.guarded(link, student.id)) return { progress: null, reentry: false };
    const found = await this.repo.findOne({ where: { linkId: link.id, studentId: student.id! } });
    if (!found) {
      await this.repo.save(this.repo.create({
        id: crypto.randomUUID(), teacherId: link.ownerId, linkId: link.id, linkName: link.name || '',
        studentId: student.id!, studentName: student.name, classId: link.classId, session, progress: null,
        submittedAt: null, reentryAllowed: false, reentries: 0,
      }));
      return { progress: null, reentry: false };
    }
    if (link.singleAttempt && !found.reentryAllowed) {
      throw new ForbiddenException(found.submittedAt
        ? `„${student.name}“ hat die Klassenarbeit schon abgegeben. Bitte bei der Lehrkraft melden.`
        : `„${student.name}“ hat die Klassenarbeit schon begonnen. Bitte bei der Lehrkraft melden – sie kann den Wiedereinstieg freigeben.`);
    }
    Object.assign(found, {
      session, studentName: student.name, submittedAt: null,
      reentryAllowed: false, reentries: found.reentries + (link.singleAttempt ? 1 : 0),
    });
    await this.repo.save(found);
    return { progress: found.progress || null, reentry: true };
  }

  /** Hat dieser Schüler eine freigegebene (oder keine bewachte) Wiederholung? Für „nur ein Durchlauf“. */
  async mayStartAgain(link: TopicLink, studentId: string | null) {
    if (!this.guarded(link, studentId)) return false;
    const found = await this.repo.findOne({ where: { linkId: link.id, studentId: studentId! } });
    return !!found?.reentryAllowed;
  }

  /** Läuft die Anmeldung mit diesem Ausweis gerade (nicht abgegeben, nicht woanders fortgesetzt)? */
  async isOpen(linkId: string, studentId: string, session: number) {
    const found = await this.repo.findOne({ where: { linkId, studentId } });
    if (!found) return true; // vor Einführung der Versuche begonnen
    return Number(found.session) === session && !found.submittedAt;
  }

  private async attemptFor(body: { linkToken?: string; studentTicket?: string }) {
    const found = body?.linkToken ? await this.links.linkOfToken(String(body.linkToken)) : null;
    if (!found || found.access !== 'exam') throw new NotFoundException('Dieser Link ist keine Klassenarbeit.');
    const ticket = readTicket(body.studentTicket, found.link.id);
    if (!ticket) throw new ForbiddenException('Die Anmeldung ist abgelaufen.');
    const attempt = await this.repo.findOne({ where: { linkId: found.link.id, studentId: ticket.s } });
    return { link: found.link, ticket, attempt };
  }

  /** Zwischenstand nach jeder Aufgabe. */
  async saveProgress(body: { linkToken?: string; studentTicket?: string; progress?: any }) {
    const { ticket, attempt } = await this.attemptFor(body);
    if (!attempt) return { success: true, stored: false };
    if (Number(attempt.session) !== ticket.e) throw new ForbiddenException('Die Klassenarbeit wurde an einem anderen Gerät fortgesetzt.');
    if (attempt.submittedAt) throw new ForbiddenException('Die Klassenarbeit ist schon abgegeben.');
    const p = body?.progress;
    if (!p || !Array.isArray(p.steps) || !Array.isArray(p.answers)) throw new BadRequestException('Kein gültiger Zwischenstand.');
    if (Buffer.byteLength(JSON.stringify(p)) > MAX_PROGRESS_BYTES) throw new PayloadTooLargeException('Zwischenstand zu groß.');
    attempt.progress = { steps: p.steps.map(String), index: Number(p.index) || 0, answers: p.answers, embeddedAnswers: p.embeddedAnswers || {} };
    await this.repo.save(attempt);
    return { success: true, stored: true };
  }

  /**
   * Abgabe (beim Speichern des Ergebnisses). Wirft, wenn die Anmeldung nicht
   * mehr gilt. Ergebnis: Ist es ein Wiedereinstieg (frühere Ergebnisse ersetzen)?
   */
  async submit(link: TopicLink, studentId: string | null, session: number) {
    if (!this.guarded(link, studentId)) return { replaces: false };
    const found = await this.repo.findOne({ where: { linkId: link.id, studentId: studentId! } });
    if (!found) return { replaces: false };
    if (Number(found.session) !== session) throw new ForbiddenException('Die Klassenarbeit wurde an einem anderen Gerät fortgesetzt – dort abgeben.');
    found.submittedAt = new Date();
    await this.repo.save(found);
    return { replaces: found.reentries > 0 };
  }

  // ---- Lehrkraft ----

  async list(user: any, filter: { classId?: string; linkId?: string } = {}) {
    const where: any = { teacherId: user.userId };
    if (filter.classId) where.classId = String(filter.classId);
    if (filter.linkId) where.linkId = String(filter.linkId);
    const rows = await this.repo.find({ where, order: { createdAt: 'DESC' } });
    return rows.map(({ progress, ...r }) => ({ ...r, answered: Array.isArray(progress?.answers) ? progress.answers.filter(Boolean).length : 0 }));
  }

  /** `allow`: Wiedereinstieg freigeben bzw. zurücknehmen. */
  async setReentry(user: any, id: string, allow: boolean) {
    const found = await this.repo.findOne({ where: { id, teacherId: user.userId } });
    if (!found) throw new NotFoundException('Klassenarbeit nicht gefunden.');
    found.reentryAllowed = !!allow;
    await this.repo.save(found);
    return { success: true, reentryAllowed: found.reentryAllowed };
  }
}
