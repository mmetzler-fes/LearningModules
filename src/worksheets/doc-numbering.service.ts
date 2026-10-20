import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { NumModule, Numbering, numberDocuments } from './numbering';

/**
 * Nummern der Dokumente einer Lehrkraft (numbering.ts) mit den Daten aus der
 * Datenbank. Vom Modulinhalt werden nur Art und Kurzname gelesen – der Rest
 * kann eingebettete Bilder enthalten und bleibt in der Datenbank.
 */
@Injectable()
export class DocNumberingService {
  constructor(
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    @InjectRepository(NotebookPlacement) private readonly placeRepo: Repository<NotebookPlacement>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
  ) {}

  async numberingFor(userId: string): Promise<Numbering> {
    const [nodes, placements, topics] = await Promise.all([
      this.nodeRepo.find({ where: { ownerId: userId } }),
      this.placeRepo.find({ where: { ownerId: userId } }),
      this.topicRepo.find({ where: { ownerId: userId }, select: ['id'] }),
    ]);
    const modules = await this.documentsOf(topics.map((t) => t.id));
    return numberDocuments(
      nodes.map(({ id, kind, title, parentId, orderIndex, docSettings }) => ({ id, kind, title, parentId, orderIndex, docSettings })),
      placements.map(({ topicId, nodeId, orderIndex }) => ({ topicId, nodeId, orderIndex })),
      modules,
    );
  }

  /** Dokument-Module dieser Themen – mit Elternmodul, falls ein Dokument ein Untermodul ist. */
  private async documentsOf(topicIds: string[]): Promise<NumModule[]> {
    if (!topicIds.length) return [];
    const rows = await this.moduleRepo.createQueryBuilder('m')
      .select(['m.id AS id', 'm.topicId AS topicId', 'm.type AS type', 'm.title AS title', 'm.parentId AS parentId', 'm.orderIndex AS orderIndex'])
      .addSelect("json_extract(m.content, '$.kind')", 'kind')
      .addSelect("json_extract(m.content, '$.slug')", 'slug')
      .where('m.topicId IN (:...ids)', { ids: topicIds })
      .andWhere("(m.type = 'document' OR m.id IN (SELECT d.parentId FROM modules d WHERE d.type = 'document' AND d.parentId IS NOT NULL))")
      .getRawMany();
    return rows.map((r: any) => ({
      id: r.id, topicId: r.topicId, type: r.type, title: r.title, parentId: r.parentId, orderIndex: Number(r.orderIndex) || 0,
      content: r.type === 'document' ? { kind: r.kind ?? undefined, slug: r.slug ?? undefined } : undefined,
    }));
  }

  /** Für die Baumansicht: Nummer je Dokument und je Ordner. */
  async treeNumbers(userId: string) {
    const n = await this.numberingFor(userId);
    return {
      docNumbers: Object.fromEntries([...n.docs.values()].map((d) => [d.moduleId, d.pfad])),
      nodeNumbers: Object.fromEntries(n.nodeNumbers),
    };
  }
}

