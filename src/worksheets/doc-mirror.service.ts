import { Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { dump as yamlDump } from 'js-yaml';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { DocMirror } from '../core/entities/doc-mirror.entity';
import { docChanges } from '../core/events/doc-changes';
import { NextcloudService } from '../nextcloud/nextcloud.service';
import { safeFolderName } from '../nextcloud/nextcloud-api';
import { FeaturesService } from '../features/features.service';
import { DocNumberingService } from './doc-numbering.service';
import { DocContext, WorksheetsService } from './worksheets.service';
import { WorksheetRendererClient, WorksheetOutput } from './renderer.client';
import { docSpec } from './docspec';
import { PRINT_FORMATS, settingsAt } from './numbering';
import { DOC_FOLDER, DesiredDoc, MirrorArt, MirrorRecord, MirrorReport, mirrorDocs } from './doc-mirror';
import { TemplatesService, templateKindOf } from './templates.service';

/** Erhöhen, wenn sich am Druck etwas ändert, das alle Dateien neu braucht. */
const RENDER_EPOCH = 1;
/** Nach einer Änderung so lange sammeln, bevor abgeglichen wird. */
const DEBOUNCE_MS = 60_000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Nextcloud-Abbild der Dokumente (doc-mirror.ts) für eine Lehrkraft: wohin
 * jedes Dokument gehört, was gedruckt werden muss, was die App zuletzt
 * geschrieben hat. Läuft beim Start, stündlich, eine Minute nach Änderungen
 * (docChanges) und auf Knopfdruck – nur mit Freischaltung 'worksheets' und
 * einer Ablage (eigene Freigabe oder Nextcloud der Schule).
 */
@Injectable()
export class DocMirrorService implements OnApplicationBootstrap {
  private readonly logger = new Logger('DocMirror');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Map<string, Promise<any>>();

  constructor(
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(DocMirror) private readonly mirrorRepo: Repository<DocMirror>,
    private readonly numbering: DocNumberingService,
    private readonly worksheets: WorksheetsService,
    private readonly renderer: WorksheetRendererClient,
    private readonly features: FeaturesService,
    private readonly templates: TemplatesService,
    @Optional() private readonly nextcloud?: NextcloudService,
  ) {}

  onApplicationBootstrap() {
    docChanges.on('changed', (userId: string) => this.schedule(userId));
    if (process.env.JEST_WORKER_ID) return;
    const all = () => void this.syncAll().catch((err) => this.logger.warn(`Abgleich fehlgeschlagen: ${err?.message || err}`));
    setTimeout(all, 30_000).unref?.();
    setInterval(all, HOUR_MS).unref?.();
  }

  /** Nach einer Änderung: in einer Minute abgleichen (weitere Änderungen schieben das auf). */
  schedule(userId: string) {
    clearTimeout(this.timers.get(userId));
    const t = setTimeout(() => {
      this.timers.delete(userId);
      void this.syncUser(userId).catch((err) => this.logger.warn(`Abgleich ${userId}: ${err?.message || err}`));
    }, DEBOUNCE_MS);
    t.unref?.();
    this.timers.set(userId, t);
  }

  async syncAll() {
    const owners = await this.moduleRepo.createQueryBuilder('m')
      .innerJoin(LearningTopic, 't', 't.id = m.topicId')
      .select('DISTINCT t.ownerId', 'ownerId')
      .where("m.type = 'document'")
      .getRawMany();
    const withRecords = await this.mirrorRepo.createQueryBuilder('d').select('DISTINCT d.ownerId', 'ownerId').getRawMany();
    const ids = new Set([...owners, ...withRecords].map((r: any) => r.ownerId).filter(Boolean));
    let written = 0, moved = 0, saved = 0, errors = 0;
    for (const id of ids) {
      const r = await this.syncUser(id).catch(() => null);
      if (r?.report) { written += r.report.written; moved += r.report.moved; saved += r.report.saved; errors += r.report.errors.length; }
    }
    if (written || moved || saved || errors) this.logger.log(`Nextcloud-Abbild: ${written} geschrieben, ${moved} verschoben, ${saved} gesichert, ${errors} Fehler`);
  }

  /** Abgleich einer Lehrkraft; läuft schon einer, wird auf ihn gewartet und danach erneut abgeglichen. */
  syncUser(userId: string): Promise<{ skipped?: string; report?: MirrorReport }> {
    const before = this.running.get(userId) || Promise.resolve();
    const run = before.catch(() => undefined).then(() => this.doSync(userId));
    const tail = run.finally(() => { if (this.running.get(userId) === tail) this.running.delete(userId); });
    this.running.set(userId, tail);
    return run;
  }

  private async store(userId: string) {
    const store = this.nextcloud ? await this.nextcloud.storeFor(userId).catch(() => null) : null;
    if (!store) return null;
    const own = store.kind === 'own';
    return {
      nc: store.nc,
      kind: store.kind,
      root: own ? [DOC_FOLDER] : [DOC_FOLDER, store.l.schoolFolder || 'Lehrkraft'],
      key: own ? `own:${store.l.id}:${store.l.shareToken}` : `school:${store.snc?.id}:${store.l.schoolFolder}`,
    };
  }

  private async doSync(userId: string): Promise<{ skipped?: string; report?: MirrorReport }> {
    if (!(await this.features.has(userId, 'worksheets'))) return { skipped: 'feature' };
    if (!this.renderer.configured()) return { skipped: 'renderer' };
    const store = await this.store(userId);
    if (!store) return { skipped: 'store' };

    const n = await this.numbering.numberingFor(userId);
    const nodes = await this.nodeRepo.find({ where: { ownerId: userId } });
    const ids = [...n.docs.keys()];
    const mods = ids.length ? await this.moduleRepo.find({ where: { id: In(ids) } }) : [];
    const modById = new Map(mods.map((m) => [m.id, m]));
    const byId = new Map(nodes.map((x) => [x.id, x]));

    const folderOf = (nodeId: string | null): string[] => {
      if (!nodeId) return ['Unsortiert'];
      const chain: NotebookNode[] = [];
      const seen = new Set<string>();
      for (let x = byId.get(nodeId); x && !seen.has(x.id); x = x.parentId ? byId.get(x.parentId) : undefined) {
        seen.add(x.id);
        chain.unshift(x);
      }
      return chain.map((x) => {
        const num = n.nodeNumbers.get(x.id)?.split('.').pop();
        return safeFolderName(num ? `${num.padStart(2, '0')} ${x.title}` : x.title);
      });
    };

    const templateOf = this.templates.resolver(userId, nodes);
    const docs: DesiredDoc[] = [];
    for (const info of n.docs.values()) {
      const mod = modById.get(info.moduleId);
      const spec = mod?.content?.spec;
      if (!mod || !spec || typeof spec !== 'object') continue;
      // Am Dokument gewählte Vorlage (z. B. A4 quer für eine Präsentation) vor der des Ordners.
      const tpl = await templateOf(info.nodeId, templateKindOf(info.kind), mod.content?.templateId || null);
      const ctx: DocContext = { pfad: info.pfad, slug: info.slug, course: info.course, folder: info.folder, refs: n.refs.get(info.scope) || {},
        template: tpl ? { id: tpl.id, updatedAt: tpl.updatedAt, data: tpl.data } : null, topicId: mod.topicId, ownerId: userId };
      // Quiz-Blöcke tragen den Quick-Link im QR-Code – ein neuer Link heißt neu drucken.
      const quick = JSON.stringify(spec).includes('"quiz"') ? await this.worksheets.quickTokenFor(userId, mod.topicId) : null;
      const settings = settingsAt(nodes, info.nodeId);
      const formats = (Array.isArray(settings.formats) ? settings.formats : PRINT_FORMATS) as MirrorArt[];
      const header = WorksheetsService.header(ctx, mod.title);
      const resolved = docSpec().resolveDocRefs(spec, ctx.refs);
      docs.push({
        moduleId: mod.id,
        folder: folderOf(info.nodeId),
        base: safeFolderName(info.nummer !== null ? `${String(info.nummer).padStart(2, '0')} ${mod.title}` : mod.title),
        formats,
        hash: crypto.createHash('sha256').update(JSON.stringify({ v: RENDER_EPOCH, resolved, title: mod.title, header, course: ctx.course, formats, template: tpl ? `${tpl.id}@${new Date(tpl.updatedAt).getTime()}` : null, ...(quick !== null ? { quick } : {}) })).digest('hex'),
        handMaintained: !!mod.content?.handMaintained,
        yaml: yamlDump({ titel: mod.title, ...spec }, { lineWidth: -1, noRefs: true }),
        render: async (arts) => {
          const errors = docSpec().validateDocSpec(spec);
          if (errors.length) throw new Error(`Dokument enthält Fehler: ${errors[0]}`);
          const { files } = await this.worksheets.renderFiles(spec, mod.title, arts as WorksheetOutput[], ctx);
          return files as Partial<Record<MirrorArt, Buffer>>;
        },
      });
    }

    const rows = await this.mirrorRepo.find({ where: { ownerId: userId } });
    const records = new Map<string, MirrorRecord>(rows.map((r) => [r.moduleId, {
      moduleId: r.moduleId, storeKey: r.storeKey, files: r.files as any, hash: r.hash, status: r.status, error: r.error,
    }]));
    const result = await mirrorDocs(store.nc, store.root, docs, records, { storeKey: store.key });

    const rowByModule = new Map(rows.map((r) => [r.moduleId, r]));
    const save: DocMirror[] = [];
    for (const rec of result.records.values()) {
      const row = rowByModule.get(rec.moduleId) || this.mirrorRepo.create({ id: crypto.randomUUID(), ownerId: userId, moduleId: rec.moduleId });
      Object.assign(row, { storeKey: rec.storeKey, files: rec.files, hash: rec.hash, status: rec.status, error: rec.error });
      save.push(row);
    }
    if (save.length) await this.mirrorRepo.save(save);
    const gone = rows.filter((r) => result.removed.includes(r.moduleId));
    if (gone.length) await this.mirrorRepo.remove(gone);
    return { report: result.report };
  }

  /** Für die Anzeige im Notebook: Ablage, Anzahl, Größe, Fehler, letzter Lauf. */
  async status(userId: string) {
    const store = await this.store(userId);
    const rows = await this.mirrorRepo.find({ where: { ownerId: userId } });
    const titles = rows.length
      ? new Map((await this.moduleRepo.find({ where: { id: In(rows.map((r) => r.moduleId)) }, select: ['id', 'title'] })).map((m) => [m.id, m.title]))
      : new Map<string, string>();
    const size = store ? (await store.nc.stat(store.root).catch(() => null))?.size ?? null : null;
    const last = rows.reduce<Date | null>((a, r) => (!a || r.updatedAt > a ? r.updatedAt : a), null);
    return {
      store: store ? store.kind : null,
      folder: store ? store.root.join('/') : null,
      renderer: this.renderer.configured(),
      documents: rows.filter((r) => r.storeKey === store?.key).length,
      files: rows.filter((r) => r.storeKey === store?.key).reduce((s, r) => s + (r.files?.length || 0), 0),
      size,
      lastSync: last,
      errors: rows.filter((r) => r.status === 'error').map((r) => ({ moduleId: r.moduleId, title: titles.get(r.moduleId) || '', error: r.error })),
      running: this.running.has(userId),
    };
  }
}
