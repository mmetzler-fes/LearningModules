import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { RunProgress } from '../core/entities/run-progress.entity';
import { DocumentWork } from '../core/entities/document-work.entity';
import { LinksService } from '../links/links.service';
import { ClassesService } from '../classes/classes.service';
import { readTicket } from '../classes/student-ticket';
import { isTestStudent } from '../classes/test-student';

/** Stand je Aufgabe säubern: nur 'd' (bearbeitet), 's' (übersprungen), 'p' (teilweise – Dokument mit Quizzen) oder ''. */
export function cleanStates(states: unknown[], length: number): string[] {
  return Array.from({ length }, (_, i) => (['d', 's', 'p'].includes(states[i] as string) ? (states[i] as string) : ''));
}

/** So lange gilt ein Durchlauf in der Live-Ansicht als aktuell. */
export const LIVE_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * Live-Ansicht: Welche Schüler einer Klasse sind bei welcher Aufgabe? Der
 * Durchlauf meldet nach jeder Aufgabe (nur über Klassenlinks, mit
 * Schülerausweis); die Lehrkraft fragt alle paar Sekunden ab.
 */
@Injectable()
export class LiveService {
  constructor(
    @InjectRepository(RunProgress) private readonly repo: Repository<RunProgress>,
    @InjectRepository(DocumentWork) private readonly workRepo: Repository<DocumentWork>,
    private readonly links: LinksService,
    private readonly classes: ClassesService,
  ) {}

  /** `{ linkToken, studentTicket, steps?, done, states?, finished?, mode? }` – `steps` beim Start. */
  async report(body: { linkToken?: string; studentTicket?: string; steps?: string[]; done?: number; states?: string[]; finished?: boolean; mode?: string }) {
    const found = body?.linkToken ? await this.links.linkOfToken(String(body.linkToken)) : null;
    if (!found?.link.classId) return { success: true, stored: false };
    const { link } = found;
    const ticket = readTicket(body.studentTicket, link.id);
    if (!ticket) throw new ForbiddenException('Die Anmeldung ist abgelaufen.');
    if (isTestStudent(ticket.s)) return { success: true, stored: false };
    let row = await this.repo.findOne({ where: { linkId: link.id, studentId: ticket.s } });
    const starting = Array.isArray(body.steps);
    if (!row) {
      row = this.repo.create({
        id: crypto.randomUUID(), teacherId: link.ownerId, linkId: link.id, classId: link.classId,
        studentId: ticket.s, steps: null, states: null, done: 0, finishedAt: null,
      });
    }
    if (starting) Object.assign(row, { steps: body.steps!.slice(0, 500).map((t) => String(t).slice(0, 200)), states: null, done: 0, finishedAt: null });
    if (Array.isArray(body.states)) row.states = cleanStates(body.states, row.steps?.length ?? 0);
    Object.assign(row, {
      linkName: link.name || '', studentName: ticket.n, mode: String(body.mode || row.mode || '').slice(0, 20),
      done: Math.max(0, Math.min(Number(body.done) || 0, row.steps?.length ?? 0)),
      finishedAt: body.finished ? new Date() : row.finishedAt,
    });
    await this.repo.save(row);
    return { success: true, stored: true };
  }

  /**
   * Stand einer Klasse: alle Schüler der Liste, ihre Durchläufe der letzten
   * Stunden und wer gerade mit dem Stift schreibt.
   */
  async ofClass(user: any, classId: string, now = Date.now()) {
    const klasse = await this.classes.findOne(classId, user).catch(() => null);
    if (!klasse) throw new NotFoundException('Klasse nicht gefunden.');
    const since = new Date(now - LIVE_WINDOW_MS);
    const runs = await this.repo.find({ where: { classId, teacherId: user.userId, updatedAt: MoreThan(since) }, order: { updatedAt: 'DESC' } });
    const ink = await this.workRepo.find({
      where: { classId, teacherId: user.userId, updatedAt: MoreThan(since) },
      select: ['id', 'studentId', 'linkId', 'moduleTitle', 'updatedAt'],
    });
    return {
      now: new Date(now).toISOString(),
      students: (klasse.students || []).map((s: any) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`.trim() })),
      runs: runs.map(({ linkId, linkName, studentId, studentName, mode, steps, states, done, finishedAt, updatedAt }) => ({
        linkId, linkName, studentId, studentName, mode, steps: steps || [], states: states || [], done, finishedAt, updatedAt,
      })),
      ink: ink.map(({ id, studentId, linkId, moduleTitle, updatedAt }) => ({ id, studentId, linkId, moduleTitle, updatedAt })),
    };
  }
}
