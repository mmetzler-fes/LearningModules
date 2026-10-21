import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LearningModule } from '../core/entities/learning-module.entity';
import { FeaturesService } from '../features/features.service';
import { docSpec } from './docspec';

const PAGE = 50;

/**
 * Alte Module „Text / Arbeitsblatt“ (HTML) in Dokumente umwandeln. Die
 * Umwandlung HTML → Spec läuft im Browser des Admins (docspec-html.js – der
 * Server hat keinen HTML-Parser); hier wird nur gelesen und gespeichert.
 * Das alte HTML bleibt als content.legacyHtml am Modul – rückgängig() stellt
 * den alten Stand wieder her.
 *
 * Nur wenn Dokumente für alle freigeschaltet sind: Sonst hätten Lehrkräfte
 * Module eines Typs, den sie nicht drucken können.
 */
@Injectable()
export class DocMigrationService {
  constructor(
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    private readonly features: FeaturesService,
  ) {}

  private async ready() {
    const modes = await this.features.modes();
    return modes.worksheets === 'all';
  }

  async overview() {
    const [legacy, migrated] = await Promise.all([
      this.moduleRepo.count({ where: { type: 'worksheet' } }),
      this.moduleRepo.createQueryBuilder('m').where("m.type = 'document'").andWhere("json_extract(m.content, '$.legacyHtml') IS NOT NULL").getCount(),
    ]);
    return { legacy, migrated, ready: await this.ready(), page: PAGE };
  }

  /** Eine Seite alter Module mit ihrem HTML. */
  async page(offset: number) {
    const rows = await this.moduleRepo.find({ where: { type: 'worksheet' }, select: ['id', 'title', 'content'], order: { id: 'ASC' }, skip: Math.max(0, offset), take: PAGE });
    return { modules: rows.map((m) => ({ id: m.id, title: m.title, html: String(m.content?.html || '') })) };
  }

  async apply(items: Array<{ id?: string; spec?: unknown }>) {
    if (!(await this.ready())) throw new BadRequestException('Erst Dokumente für alle freischalten (Benutzerverwaltung → Arbeitsblätter → alle).');
    const list = (Array.isArray(items) ? items : []).slice(0, PAGE).filter((i) => i && typeof i.id === 'string');
    const mods = list.length ? await this.moduleRepo.find({ where: { id: In(list.map((i) => i.id!)), type: 'worksheet' } }) : [];
    const failed: Array<{ id: string; title: string; error: string }> = [];
    const save: LearningModule[] = [];
    for (const m of mods) {
      const spec = list.find((i) => i.id === m.id)!.spec;
      const errors = docSpec().validateDocSpec(spec);
      if (errors.length) { failed.push({ id: m.id, title: m.title, error: errors[0] }); continue; }
      m.content = { kind: 'text', spec, legacyHtml: String(m.content?.html || '') };
      m.type = 'document';
      save.push(m);
    }
    if (save.length) await this.moduleRepo.save(save);
    return { converted: save.length, failed };
  }

  async rollback() {
    const mods = await this.moduleRepo.createQueryBuilder('m')
      .where("m.type = 'document'").andWhere("json_extract(m.content, '$.legacyHtml') IS NOT NULL").getMany();
    for (const m of mods) {
      m.content = { html: String(m.content?.legacyHtml || '') };
      m.type = 'worksheet';
    }
    if (mods.length) await this.moduleRepo.save(mods);
    return { restored: mods.length };
  }
}
