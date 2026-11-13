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
 * Stand der Punkte-Rechnung (doc-quiz.js scoreRun), den quiz.js bei der Abgabe als `payload.pointsVersion` mitgibt.
 * 2: Aufgabenpunkte, Punkte je Antwort, „Wörter ziehen“ anteilig, je Aufgabe auf halbe Punkte abgerundet.
 */
export const POINTS_VERSION = 2;

/**
 * Klassenarbeiten mit älterem Stand der Rechnung einmal beim Start nachrechnen (wie quiz.js bei der Abgabe);
 * danach tragen sie `payload.pointsVersion` und bleiben, wie sie sind.
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
    const results = (await this.resultRepo.find({ where: { mode: 'exam' } })).filter((r) => (Number(r.payload?.pointsVersion) || 0) < POINTS_VERSION);
    let changed = 0;
    for (const r of results) {
      const docIds = [...new Set(((r.payload?.details || []) as any[]).map((a) => a?.inDoc).filter(Boolean))];
      const docs = docIds.length ? await this.moduleRepo.find({ where: { id: In(docIds) } }) : [];
      const next = rescoreExam(r, docs);
      if (next.changed) {
        r.score = next.score;
        r.maxScore = next.maxScore;
        changed++;
      }
      r.payload = { ...(r.payload || {}), ...(next.changed ? { percentage: next.percentage } : {}), details: next.details, pointsVersion: POINTS_VERSION };
      await this.resultRepo.save(r);
    }
    if (changed) this.logger.log(`${changed} Klassenarbeit(en) nach Aufgabenpunkten nachgerechnet.`);
  }
}
