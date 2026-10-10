import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { isTestStudent } from '../classes/test-student';
import { Result } from '../core/entities/result.entity';
import { ClassesService } from '../classes/classes.service';
import { isExpired } from '../classes/retention';

const RESULTS_FORMAT = 'learningmodules-results';

/** Ergebnis in der Form, die beide Ergebnisansichten zeigen. */
export function resultView(r: Result) {
  return {
    id: r.id,
    studentName: r.studentName,
    username: r.studentName, // Fallback for frontend
    topicId: r.topicId,
    topicTitle: r.payload?.topicTitle || 'Unbekanntes Thema',
    score: r.score,
    totalQuestions: r.maxScore,
    percentage: r.payload?.percentage || 0,
    timestamp: r.createdAt.toISOString(),
    details: r.payload?.details || [],
    ipAddress: r.ipAddress || null,
    pcName: r.pcName || null,
    linkId: r.linkId || null,
    linkName: r.linkName || null,
    linkKind: r.linkKind || null,
    mode: r.mode || null,
    schoolYear: r.schoolYear || null,
    classId: r.classId || null,
    className: r.className || null,
    studentId: r.studentId || null,
    // Quiz-Arena: Platz und Zahl der Teilnehmer.
    rank: r.payload?.rank ?? null,
    playerCount: r.payload?.playerCount ?? null,
  };
}

@Injectable()
export class ResultsService {
  constructor(
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    private readonly classesService: ClassesService,
  ) {}

  /**
   * Klassenergebnisse: die Klasse mit Schülerliste und alle eigenen
   * Ergebnisse über ihre Klassenlinks. Auch für Admins nur die eigenen –
   * die Klasse gehört der Lehrkraft.
   */
  async forClass(classId: string, user: any) {
    const klasse = await this.classesService.findOne(classId, user);
    const results = await this.resultRepo.find({
      where: { classId, teacherId: user.userId },
      order: { createdAt: 'DESC' },
    });
    // Testläufe der Lehrkraft (🧪) gehören nicht in die Klassenauswertung –
    // sie stehen unter „Ergebnisse“.
    return { class: klasse, results: results.filter((r) => !isTestStudent(r.studentId)).map(resultView) };
  }

  async findAll(user: any) {
    const qb = this.resultRepo.createQueryBuilder('result');

    // Teachers see only results for their own topics
    if (user.role === 'teacher') {
      qb.where('result.teacherId = :teacherId', { teacherId: user.userId });
    }
    // Admins see all results

    const results = await qb.orderBy('result.createdAt', 'DESC').getMany();

    return results.map(resultView);
  }

  /**
   * Eigene Ergebnisse als Datei – vollständig, damit sie sich wieder
   * einlesen lassen (etwa vor der Löschregel oder auf einem anderen Server).
   * `years` beschränkt auf einzelne Schuljahre.
   */
  async exportResults(user: any, years?: string[]) {
    const where: any = { teacherId: user.userId };
    if (years?.length) where.schoolYear = In(years);
    const results = await this.resultRepo.find({ where, order: { createdAt: 'ASC' } });
    return {
      format: RESULTS_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      schoolYears: years?.length ? years : null,
      // IP und Rechnername bleiben auf diesem Server.
      results: results.map(({ ipAddress: _ip, pcName: _pc, ...r }) => r),
    };
  }

  /**
   * Ergebnisse aus einem Export einlesen. Sie gehören danach der Lehrkraft,
   * die einliest; schon vorhandene (gleiche ID) werden übersprungen.
   * Ergebnisse aus abgelaufenen Schuljahren entfernt die Löschregel wieder.
   */
  async importResults(user: any, body: any) {
    if (body?.format !== RESULTS_FORMAT || !Array.isArray(body?.results)) {
      throw new BadRequestException('Das ist keine Ergebnis-Datei von LearningModules.');
    }
    const rows = body.results.filter((r: any) => r && typeof r.id === 'string' && Number.isFinite(r.score) && Number.isFinite(r.maxScore));
    const ids = rows.map((r: any) => r.id);
    const existing = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const found = await this.resultRepo.find({ where: { id: In(ids.slice(i, i + 500)) }, select: ['id'] });
      found.forEach((f) => existing.add(f.id));
    }
    const fresh = rows
      .filter((r: any) => !existing.has(r.id))
      .map((r: any) =>
        this.resultRepo.create({
          id: r.id, userId: r.userId ?? null, studentName: r.studentName ?? null, teacherId: user.userId,
          schoolId: r.schoolId ?? null, topicId: r.topicId ?? null, moduleId: r.moduleId ?? null,
          score: r.score, maxScore: r.maxScore, payload: r.payload ?? null, linkId: r.linkId ?? null,
          linkName: r.linkName ?? null, linkKind: r.linkKind ?? null, mode: r.mode ?? null,
          schoolYear: r.schoolYear ?? null, classId: r.classId ?? null, className: r.className ?? null,
          studentId: r.studentId ?? null, ipAddress: null,
          createdAt: r.createdAt ? new Date(r.createdAt) : undefined,
        } as any),
      );
    for (let i = 0; i < fresh.length; i += 200) await this.resultRepo.save(fresh.slice(i, i + 200));
    const current = await this.classesService.currentSchoolYear();
    const expired = fresh.filter((r: any) => isExpired(r.schoolYear, current)).length;
    return { success: true, imported: fresh.length, skipped: rows.length - fresh.length, expired };
  }

  async deleteOne(id: string, user: any) {
    const result = await this.resultRepo.findOne({ where: { id } });
    if (!result) return { success: false };
    if (user.role === 'teacher' && result.teacherId !== user.userId) return { success: false };
    await this.resultRepo.delete({ id });
    return { success: true };
  }

  async deleteAll(user: any) {
    if (user.role === 'teacher') {
      await this.resultRepo.delete({ teacherId: user.userId });
    } else {
      await this.resultRepo.clear();
    }
    return { success: true };
  }
}
