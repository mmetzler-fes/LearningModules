import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Result } from '../core/entities/result.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { loadBrowserModule } from '../core/browser-module';

type ScoreRun = (answers: any[], docs: any[]) => { score: number; total: number; each: Array<{ earned: number; max: number }> };
const scoreRun: ScoreRun = (answers, docs) => loadBrowserModule<{ scoreRun: ScoreRun }>('../lm-editor/src/doc/doc-quiz.js').scoreRun(answers, docs);

/**
 * Punkte eines Klassenarbeits-Ergebnisses nach den Aufgabenpunkten seiner Dokumente:
 * `details` mit `pts` ({ earned, max }) je bewerteter Antwort, dazu die Summe – `changed`, wenn sie sich ändert.
 */
export function rescoreExam(r: Pick<Result, 'score' | 'maxScore' | 'payload'>, docs: any[]) {
  const details: any[] = Array.isArray(r.payload?.details) ? r.payload.details : [];
  const graded = details.filter((a) => a && !a.informational && !a.ungraded);
  const { score, total, each } = scoreRun(graded, docs);
  const ptsOf = new Map(graded.map((a, i) => [a, each[i]]));
  const withPts = details.map((d) => (ptsOf.has(d) ? { ...d, pts: ptsOf.get(d) } : d));
  const changed = !!total && (score !== r.score || total !== r.maxScore);
  return { score, maxScore: total, percentage: total ? Math.round((score / total) * 100) : 0, details: withPts, changed };
}

/**
 * Klassenarbeiten, die vor den Aufgabenpunkten abgegeben wurden, zählten je Frage 1:
 * einmal beim Start nachrechnen (doc-quiz.js scoreRun, wie quiz.js bei der Abgabe).
 * Danach trägt das Ergebnis `payload.taskPoints` und bleibt, wie es ist; `detailPoints`: die Punkte je Antwort sind ergänzt.
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
    const results = (await this.resultRepo.find({ where: { mode: 'exam' } })).filter((r) => !r.payload?.detailPoints);
    let changed = 0;
    for (const r of results) {
      const docIds = [...new Set(((r.payload?.details || []) as any[]).map((a) => a?.inDoc).filter(Boolean))];
      const docs = docIds.length ? await this.moduleRepo.find({ where: { id: In(docIds) } }) : [];
      const next = rescoreExam(r, docs);
      // Schon nach Aufgabenpunkten gerechnet (taskPoints): die Summe bleibt, es kommen nur die Punkte je Antwort dazu.
      const rescore = next.changed && !r.payload?.taskPoints;
      if (rescore) {
        r.score = next.score;
        r.maxScore = next.maxScore;
        changed++;
      }
      r.payload = { ...(r.payload || {}), ...(rescore ? { percentage: next.percentage } : {}), details: next.details, taskPoints: true, detailPoints: true };
      await this.resultRepo.save(r);
    }
    if (changed) this.logger.log(`${changed} Klassenarbeit(en) nach Aufgabenpunkten nachgerechnet.`);
  }
}
