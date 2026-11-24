import { Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LearningModule } from '../core/entities/learning-module.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { docChanges } from '../core/events/doc-changes';
import { DocNumberingService } from './doc-numbering.service';
import { TemplatesService, templateKindOf } from './templates.service';
import { templatePage } from './template-page';

/** Kurz warten: Mehrere Änderungen hintereinander (Ordner umräumen …) werden ein Abgleich. */
const DELAY_MS = 3000;

/**
 * Hoch oder quer folgt der Druckvorlage (am Dokument, sonst am Ordner, sonst
 * die Standardvorlage). Die Ansichten – Stift-Editor, Schüler, .zlm – lesen es
 * aus `spec.orientation` des gespeicherten Dokuments. Ändert sich die Vorlage
 * eines Ordners, die Standardvorlage oder liegt ein Dokument jetzt in einem
 * anderen Ordner, gleicht dieser Dienst `orientation` aller Dokumente der
 * Lehrkraft an (nach docChanges). Ohne gültige Vorlage bleibt es, wie es ist.
 */
@Injectable()
export class OrientationSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger('OrientationSync');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Map<string, Promise<number>>();

  constructor(
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    private readonly numbering: DocNumberingService,
    @Optional() private readonly templates?: TemplatesService,
  ) {}

  onApplicationBootstrap() {
    docChanges.on('changed', (userId: string) => this.schedule(userId));
  }

  private schedule(userId: string) {
    clearTimeout(this.timers.get(userId));
    const t = setTimeout(() => {
      this.timers.delete(userId);
      void this.sync(userId).catch((err) => this.logger.warn(`Abgleich für ${userId} fehlgeschlagen: ${err?.message || err}`));
    }, DELAY_MS);
    t.unref?.();
    this.timers.set(userId, t);
  }

  /** Alle Dokumente der Lehrkraft an ihre Vorlage angleichen – Anzahl der geänderten. */
  async sync(userId: string): Promise<number> {
    // Nie zwei Läufe für dieselbe Lehrkraft gleichzeitig: der zweite wartet und läuft danach.
    const before = this.running.get(userId);
    const run = (before ? before.catch(() => 0) : Promise.resolve(0)).then(() => this.run(userId));
    this.running.set(userId, run);
    try {
      return await run;
    } finally {
      if (this.running.get(userId) === run) this.running.delete(userId);
    }
  }

  private async run(userId: string): Promise<number> {
    if (!this.templates) return 0;
    const n = await this.numbering.numberingFor(userId);
    const ids = [...n.docs.keys()];
    if (!ids.length) return 0;
    const nodes = await this.nodeRepo.find({ where: { ownerId: userId } });
    const resolve = this.templates.resolver(userId, nodes);
    const pages = new Map<string, boolean | null>(); // Vorlage → quer?
    const mods = await this.moduleRepo.find({ where: { id: In(ids), type: 'document' }, select: ['id', 'content'] });
    let changed = 0;
    for (const mod of mods) {
      const content = mod.content;
      const spec = content?.spec;
      if (!spec || typeof spec !== 'object' || !Array.isArray(spec.content)) continue;
      const info = n.docs.get(mod.id);
      const tpl = await resolve(info?.nodeId ?? null, templateKindOf(info?.kind || content.kind), content.templateId || null);
      if (!tpl) continue;
      if (!pages.has(tpl.id)) {
        const page = templatePage(tpl.data);
        pages.set(tpl.id, page ? page.width > page.height : null);
      }
      const landscape = pages.get(tpl.id);
      if (landscape === null || landscape === undefined) continue;
      if (landscape === (spec.orientation === 'landscape')) continue;
      const nextSpec = { ...spec };
      if (landscape) nextSpec.orientation = 'landscape';
      else delete nextSpec.orientation;
      await this.moduleRepo.update(mod.id, { content: { ...content, spec: nextSpec } });
      changed++;
    }
    if (changed) this.logger.log(`${changed} Dokument(e) von ${userId} auf ihre Vorlage (hoch/quer) gebracht.`);
    return changed;
  }
}
