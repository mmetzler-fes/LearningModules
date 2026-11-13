import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Result } from '../core/entities/result.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { loadBrowserModule } from '../core/browser-module';

type ScoreRun = (answers: any[], docs: any[]) => { score: number; total: number };
const scoreRun: ScoreRun = (answers, docs) => loadBrowserModule<{ scoreRun: ScoreRun }>('../lm-editor/src/doc/doc-quiz.js').scoreRun(answers, docs);

/** Neue Punkte eines Klassenarbeits-Ergebnisses nach den Aufgabenpunkten seiner Dokumente – oder null (unverändert). */
export function rescoreExam(r: Pick<Result, 'score' | 'maxScore' | 'payload'>, docs: any[]) {
  const details: any[] = Array.isArray(r.payload?.details) ? r.payload.details : [];
  const graded = details.filter((a) => a && !a.informational && !a.ungraded);
  const { score, total } = scoreRun(graded, docs);
  if (!total || (score === r.score && total === r.maxScore)) return null;
  return { score, maxScore: total, percentage: Math.round((score / total) * 100) };
}

/**
 * Klassenarbeiten, die vor den Aufgabenpunkten abgegeben wurden, zählten je Frage 1:
 * einmal beim Start nachrechnen (doc-quiz.js scoreRun, wie quiz.js bei der Abgabe).
 * Danach trägt das Ergebnis `payload.taskPoints` und bleibt, wie es ist.
 */
@Injectable()
export class ExamPointsMigration implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExamPointsMigration.name);

  constructor(
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
  ) {}

  async onApplicationBootstrap() {
    await this.run().catch((err) => this.logger.warn(`Punkte der Klassenarbeiten nicht nachgerechnet: ${err?.message || err}`));
  }

  async run() {
    const results = (await this.resultRepo.find({ where: { mode: 'exam' } })).filter((r) => !r.payload?.taskPoints);
    let changed = 0;
    for (const r of results) {
      const docIds = [...new Set(((r.payload?.details || []) as any[]).map((a) => a?.inDoc).filter(Boolean))];
      const docs = docIds.length ? await this.moduleRepo.find({ where: { id: In(docIds) } }) : [];
      const next = rescoreExam(r, docs);
      if (next) {
        r.score = next.score;
        r.maxScore = next.maxScore;
        changed++;
      }
      r.payload = { ...(r.payload || {}), ...(next ? { percentage: next.percentage } : {}), taskPoints: true };
      await this.resultRepo.save(r);
    }
    if (changed) this.logger.log(`${changed} Klassenarbeit(en) nach Aufgabenpunkten nachgerechnet.`);
  }
}
