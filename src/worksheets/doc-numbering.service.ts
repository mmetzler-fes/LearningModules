import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { NumModule, Numbering, numberDocuments, legacyNumbering, DocSettings } from './numbering';

/** Einmal umgerechnet: Nummerierung nur noch, wo eingeschaltet (`docSettings.numbering`). */
const MIGRATED_KEY = 'numbering_v2_migrated';

/**
 * Nummern der Dokumente einer Lehrkraft (numbering.ts) mit den Daten aus der
 * Datenbank. Vom Modulinhalt werden nur Art und Kurzname gelesen – der Rest
 * kann eingebettete Bilder enthalten und bleibt in der Datenbank.
 */
@Injectable()
export class DocNumberingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DocNumberingService.name);

  constructor(
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    @InjectRepository(NotebookPlacement) private readonly placeRepo: Repository<NotebookPlacement>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
  ) {}

  async onApplicationBootstrap() {
    await this.migrateNumbering().catch((err) => this.logger.warn(`Nummerierung nicht umgerechnet: ${err?.message || err}`));
  }

  /**
   * Einmal beim ersten Start: „Zählung beginnt hier“, eigener Kurs und „Darunter durchzählen“ →
   * `numbering` (legacyNumbering). Books ohne Einstellung zählen danach nicht mehr von selbst.
   * Nur einmal – sonst würde ein später eingetragener Kursname wieder zum Zählbeginn.
   */
  async migrateNumbering() {
    if (await this.configRepo.findOne({ where: { key: MIGRATED_KEY } })) return;
    let changed = 0;
    for (const n of await this.nodeRepo.find()) {
      const s = n.docSettings as DocSettings | null;
      if (!s || 'numbering' in s) continue;
      const mode = legacyNumbering(s);
      if (mode === undefined && s.numberRoot === undefined && s.numberFlat === undefined) continue;
      const { numberRoot: _r, numberFlat: _f, ...rest } = s;
      n.docSettings = { ...rest, ...(mode ? { numbering: mode } : {}) };
      await this.nodeRepo.save(n);
      changed++;
    }
    await this.configRepo.save(this.configRepo.create({ key: MIGRATED_KEY, value: new Date().toISOString() }));
    if (changed) this.logger.log(`Nummerierung: ${changed} Ordner auf die neue Einstellung umgerechnet.`);
  }

  /**
   * Vorschau für „🔢 Nummerierung…“: die Nummern unter `nodeId`, als hätte er die Einstellung `mode`
   * ('tree' | 'flat' | 'off' | 'inherit') – gespeichert wird nichts. Höchstens `max` Einträge, in Baumreihenfolge.
   */
  async preview(userId: string, nodeId: string, mode: string, max = 14) {
    const n = await this.numberingFor(userId, (nodes) => nodes.map((x) => {
      if (x.id !== nodeId) return x;
      const { numbering: _n, ...rest } = (x.docSettings || {}) as DocSettings;
      return { ...x, docSettings: ['tree', 'flat', 'off'].includes(mode) ? { ...rest, numbering: mode as any } : rest };
    }));
    const nodes = await this.nodeRepo.find({ where: { ownerId: userId }, select: ['id', 'parentId', 'title'] });
    const inside = new Set([nodeId]);
    for (let grew = true; grew;) {
      grew = false;
      for (const x of nodes) if (x.parentId && inside.has(x.parentId) && !inside.has(x.id)) { inside.add(x.id); grew = true; }
    }
    const docs = [...n.docs.values()].filter((d) => d.nodeId && inside.has(d.nodeId));
    return {
      docs: docs.slice(0, max).map((d) => ({ pfad: d.pfad, title: d.title, folder: d.folder })),
      more: Math.max(0, docs.length - max),
      numbered: docs.filter((d) => d.pfad).length,
      folders: nodes.filter((x) => inside.has(x.id) && n.nodeNumbers.has(x.id)).map((x) => ({ pfad: n.nodeNumbers.get(x.id), title: x.title })),
    };
  }

  async numberingFor(userId: string, adjust?: (nodes: any[]) => any[]): Promise<Numbering> {
    const [nodes, placements, topics] = await Promise.all([
      this.nodeRepo.find({ where: { ownerId: userId } }),
      this.placeRepo.find({ where: { ownerId: userId } }),
      this.topicRepo.find({ where: { ownerId: userId }, select: ['id'] }),
    ]);
    const modules = await this.documentsOf(topics.map((t) => t.id));
    const numNodes = nodes.map(({ id, kind, title, parentId, orderIndex, docSettings }) => ({ id, kind, title, parentId, orderIndex, docSettings }));
    return numberDocuments(
      adjust ? adjust(numNodes) : numNodes,
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
    const docs = [...n.docs.values()];
    // Wo gezählt wird, aber ein Dokument keine Arbeitsblatt-Art hat: im Baum sagen, warum die Nummer fehlt.
    const counted = new Set(docs.filter((d) => d.pfad).map((d) => d.scope));
    return {
      docNumbers: Object.fromEntries(docs.map((d) => [d.moduleId, d.pfad])),
      nodeNumbers: Object.fromEntries(n.nodeNumbers),
      docKinds: Object.fromEntries(docs.filter((d) => !d.pfad && d.kind !== 'arbeitsblatt' && counted.has(d.scope)).map((d) => [d.moduleId, d.kind])),
    };
  }
}

