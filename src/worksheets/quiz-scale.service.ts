import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { docChanges } from '../core/events/doc-changes';
import { contentOf, embeddedQuizIds } from '../core/public/student-view';
import { settingsAt } from './numbering';

/** Was ein Dokument bekommt: die geerbte Vorgabe, nur wenn es Quizze enthält – sonst nichts. */
export function quizScaleFor(content: any, inherited: Record<string, number> | undefined): Record<string, number> | null {
  if (!inherited || !Object.keys(inherited).length) return null;
  return embeddedQuizIds({ type: 'document', content }).length ? inherited : null;
}

/**
 * Größe eingebetteter Quizze (Dokument-Einstellungen, `quizScale`) in die
 * Dokumente schreiben – so kommt sie überall an, wo das Dokument gezeigt wird
 * (Vorschau, Durchlauf, Klassennotizbuch, Stift-Editor), ohne dass jeder Weg
 * den Ordner kennen muss. Läuft nach jeder Änderung an Dokumenten oder
 * Ordnern einer Lehrkraft (docChanges), kurz verzögert.
 */
@Injectable()
export class QuizScaleService implements OnApplicationBootstrap {
  private readonly logger = new Logger('QuizScale');
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    @InjectRepository(NotebookPlacement) private readonly placeRepo: Repository<NotebookPlacement>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
  ) {}

  onApplicationBootstrap() {
    docChanges.on('changed', (userId: string) => {
      clearTimeout(this.timers.get(userId));
      this.timers.set(userId, setTimeout(() => {
        this.timers.delete(userId);
        this.apply(userId).catch((err) => this.logger.warn(`Quiz-Größe für ${userId}: ${err?.message || err}`));
      }, 1500));
    });
  }

  /** Alle eigenen Dokumente der Lehrkraft auf den Stand ihrer Ordner bringen; liefert die Zahl der geänderten. */
  async apply(userId: string): Promise<number> {
    const [nodes, places, topics] = await Promise.all([
      this.nodeRepo.find({ where: { ownerId: userId } }),
      this.placeRepo.find({ where: { ownerId: userId } }),
      this.topicRepo.find({ where: { ownerId: userId }, select: ['id'] }),
    ]);
    if (!topics.length) return 0;
    const nodeOf = new Map(places.map((p) => [p.topicId, p.nodeId]));
    const docs = await this.moduleRepo.find({ where: { topicId: In(topics.map((t) => t.id)), type: 'document' } });
    let changed = 0;
    for (const doc of docs) {
      const content = contentOf(doc);
      const spec = content.spec && typeof content.spec === 'object' ? content.spec : null;
      if (!spec) continue;
      const want = quizScaleFor(content, settingsAt(nodes as any, nodeOf.get(doc.topicId) ?? null).quizScale);
      if (JSON.stringify(spec.quizScale ?? null) === JSON.stringify(want)) continue;
      if (want) spec.quizScale = want; else delete spec.quizScale;
      await this.moduleRepo.update({ id: doc.id }, { content: (typeof doc.content === 'string' ? JSON.stringify(content) : content) as any });
      changed++;
    }
    return changed;
  }
}
