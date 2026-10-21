import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { NextcloudService } from '../nextcloud/nextcloud.service';
import { docSpec } from './docspec';
import { DocNumberingService } from './doc-numbering.service';
import { formatHeader, settingsAt } from './numbering';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { TemplatesService, templateKindOf } from './templates.service';
import { widthInCm } from './course-format';

export { widthInCm };
import { RenderJob, WorksheetOutput, WorksheetRendererClient } from './renderer.client';

const PRINTABLE_IMAGES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' };

type Refs = Record<string, { pfad: string; titel: string }>;

/** Was ein Dokument aus seinem Platz im Notebook bekommt. */
export interface DocContext {
  pfad: string;
  slug: string;
  course: { kurs: string; titelmuster: string; autor: string; meta: Record<string, string> };
  /** Ordner, in dem das Dokument liegt – für {abschnitt} im Titelmuster */
  folder: string;
  refs: Refs | null;
  /** Vorlage für den Druck; fehlt sie, gilt die Grundvorlage des Renderers. */
  template?: { id: string; updatedAt: Date; data: string } | null;
}

/** Probeblatt für Vorlagen: zeigt Überschriften, Text, Karo, Lösung, Tabelle, Formel, Code. */
export const SAMPLE_SPEC = {
  content: [
    { type: 'section', text: 'Worum es geht' },
    { type: 'text', text: 'Ein Probeblatt mit **fettem** und *kursivem* Text, Index U_{R} und einer Liste:' },
    { type: 'list', items: ['Erster Punkt', 'Zweiter Punkt'] },
    { type: 'task', title: 'Rechnen', text: 'Berechne den Strom für U = 12 V und R = 240 Ω.', blocks: [
      { type: 'formula', math: 'I = U over R' },
      { type: 'karo', lines: 4 },
      { type: 'solution', blocks: [{ type: 'text', text: 'I = 12 V / 240 Ω = 50 mA' }] },
    ] },
    { type: 'table', header: ['Größe', 'Einheit'], rows: [['Spannung', 'V'], ['Strom', 'A']] },
    { type: 'code', caption: 'beispiel.ino', code: 'void loop() {\n  digitalWrite(LED, HIGH);\n}' },
  ],
};

/**
 * Modultyp „Dokument“ drucken: Spec prüfen (dieselbe Prüfung wie im Editor,
 * src/renderer/js/docspec.js), Nummer, Kopfzeile und Verweise aus dem
 * Notebook dazunehmen, Bilder mitgeben, rendern.
 */
@Injectable()
export class WorksheetsService {
  constructor(
    private readonly renderer: WorksheetRendererClient,
    @Optional() private readonly numbering?: DocNumberingService,
    @Optional() @InjectRepository(LearningModule) private readonly moduleRepo?: Repository<LearningModule>,
    @Optional() @InjectRepository(LearningTopic) private readonly topicRepo?: Repository<LearningTopic>,
    @Optional() private readonly nextcloud?: NextcloudService,
    @Optional() @InjectRepository(NotebookNode) private readonly nodeRepo?: Repository<NotebookNode>,
    @Optional() private readonly templates?: TemplatesService,
  ) {}

  private async templateFor(userId: string, nodeId: string | null, docKind: string | undefined) {
    const t = this.templates ? await this.templates.resolve(userId, nodeId, templateKindOf(docKind)) : null;
    return t ? { id: t.id, updatedAt: t.updatedAt, data: t.data } : null;
  }

  /** Probeblatt mit einer Vorlage als PDF. */
  async sample(userId: string, templateId: string) {
    const t = await this.templates!.readable(userId, templateId);
    const ctx: DocContext = { pfad: '1', slug: '', course: { kurs: 'Probe', titelmuster: '{kurs} {pfad} – {titel}', autor: '', meta: {} }, folder: '', refs: {}, template: { id: t.id, updatedAt: t.updatedAt, data: t.data } };
    const { files } = await this.renderFiles(SAMPLE_SPEC, `Probeblatt ${t.name}`, ['pdf'], ctx);
    if (!files.pdf) throw new BadRequestException('Der Renderer hat kein PDF geliefert.');
    return files.pdf;
  }

  /**
   * Für den KI-Prompt: was an einem Zielordner gilt (Kurs, KI-Vorgaben) und
   * welche Blätter es im selben Book schon gibt (für Verweise {{blatt:…}}).
   */
  async promptContext(user: any, nodeId: string | null) {
    const nodes = await this.nodeRepo!.find({ where: { ownerId: user.userId } });
    if (nodeId && !nodes.some((n) => n.id === nodeId)) throw new NotFoundException('Ordner nicht gefunden.');
    const settings = settingsAt(nodes, nodeId);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const bookOf = (id: string | null) => {
      let n = id ? byId.get(id) : undefined;
      const seen = new Set<string>();
      while (n?.parentId && byId.has(n.parentId) && !seen.has(n.id)) { seen.add(n.id); n = byId.get(n.parentId); }
      return n?.id ?? null;
    };
    const book = bookOf(nodeId);
    const numbering = await this.numbering!.numberingFor(user.userId);
    const sheets = [...numbering.docs.values()]
      .filter((d) => (d.nodeId ? bookOf(d.nodeId) : null) === book)
      .map((d) => ({ slug: d.slug, pfad: d.pfad, titel: d.title }));
    return { kurs: settings.kurs || '', aiGuidelines: settings.aiGuidelines || '', sheets };
  }

  async status() {
    return { configured: this.renderer.configured(), renderer: await this.renderer.health() };
  }

  /**
   * Nummer, Kursangaben und Verweisziele eines eigenen Dokuments. Für den
   * Editor (Kopfzeile, aufgelöste Verweise) und den Druck.
   */
  async context(user: any, moduleId: string, kind?: string): Promise<DocContext> {
    const mod = await this.moduleRepo!.findOne({ where: { id: moduleId }, select: ['id', 'topicId', 'type', 'title'] });
    if (!mod) throw new NotFoundException('Modul nicht gefunden.');
    const topic = await this.topicRepo!.findOne({ where: { id: mod.topicId }, select: ['id', 'ownerId'] });
    if (!topic || topic.ownerId !== user.userId) throw new ForbiddenException('Nur eigene Dokumente.');
    const n = await this.numbering!.numberingFor(user.userId);
    const info = n.docs.get(moduleId);
    if (!info) {
      // Noch nicht gespeichert oder nicht vom Typ „Dokument“: ohne Nummer.
      return { pfad: '', slug: '', course: { kurs: '', titelmuster: '{titel}', autor: '', meta: {} }, folder: '', refs: null,
        template: await this.templateFor(user.userId, null, kind) };
    }
    return { pfad: info.pfad, slug: info.slug, course: info.course, folder: info.folder, refs: n.refs.get(info.scope) || {},
      template: await this.templateFor(user.userId, info.nodeId, kind || info.kind) };
  }

  /** Kontext samt fertiger Kopfzeile (mit dem Titel aus dem Editor) – für den Editor. */
  async editorContext(user: any, moduleId: string, title: string) {
    const { template, ...ctx } = await this.context(user, moduleId);
    return { ...ctx, template: template ? { id: template.id } : null, header: WorksheetsService.header(ctx.refs ? ctx : null, title) };
  }

  static header(ctx: DocContext | null, title: string): string {
    if (!ctx) return title || 'Dokument';
    return formatHeader(ctx.course.titelmuster, {
      kurs: ctx.course.kurs, pfad: ctx.pfad, nummer: ctx.pfad.split('.').pop() || '', titel: title, autor: ctx.course.autor, abschnitt: ctx.folder,
    }) || title || 'Dokument';
  }

  /** Mehrere Formate in einem Auftrag (Nextcloud-Abbild). */
  async renderFiles(spec: Record<string, any>, title: string, outputs: WorksheetOutput[], ctx: DocContext | null) {
    const { job, warnings } = await this.prepare(spec, title, outputs, ctx);
    const result = await this.renderer.render(job);
    return { files: result.files, warnings: [...warnings, ...result.warnings] };
  }

  async render(user: any, body: { spec: unknown; title: string; output: WorksheetOutput; moduleId?: string; kind?: string }) {
    const errors = docSpec().validateDocSpec(body.spec);
    if (errors.length) throw new BadRequestException({ message: 'Das Dokument enthält Fehler.', errors });
    const ctx = body.moduleId ? await this.context(user, body.moduleId, body.kind)
      : this.templates ? { pfad: '', slug: '', course: { kurs: '', titelmuster: '{titel}', autor: '', meta: {} }, folder: '', refs: null, template: await this.templateFor(user.userId, null, body.kind) }
        : null;
    const { job, warnings } = await this.prepare(body.spec as Record<string, any>, body.title, [body.output], ctx);
    const result = await this.renderer.render(job);
    const file = result.files[body.output];
    if (!file) throw new BadRequestException('Der Renderer hat die Datei nicht geliefert.');
    return { file, warnings: [...warnings, ...result.warnings] };
  }

  /**
   * Spec → Auftrag für den Renderer. Die Kopfzeile entsteht hier (Titelmuster
   * des Kurses), Verweise werden aufgelöst. Bilder aus der App (data:) und
   * aus der Nextcloud gehen als Dateien mit; was sich nicht drucken lässt,
   * steht als Hinweis im Blatt.
   */
  async prepare(spec: Record<string, any>, title: string, outputs: WorksheetOutput[], ctx: DocContext | null = null):
    Promise<{ job: RenderJob; warnings: string[] }> {
    const files: Record<string, string> = {};
    const warnings: string[] = [];
    let n = 0;

    const imageBlock = async (block: Record<string, any>): Promise<Record<string, any>> => {
      const src = String(block.src ?? '');
      const label = block.caption || block.alt || 'Bild';
      let mime = '';
      let data = '';
      const inline = /^data:([^;,]+);base64,(.*)$/s.exec(src);
      if (inline) {
        mime = inline[1].toLowerCase();
        data = inline[2];
      } else if (/\/api\/nextcloud\//.test(src) && this.nextcloud) {
        const file = await this.nextcloud.readImageByUrl(src).catch(() => null);
        if (file) {
          mime = file.type.toLowerCase();
          data = file.data.toString('base64');
        }
      }
      const ext = PRINTABLE_IMAGES[mime];
      if (!data || !ext) {
        warnings.push(data
          ? `„${label}“: ${mime} lässt sich nicht drucken – bitte PNG, JPEG oder SVG.`
          : /\/api\/nextcloud\//.test(src)
            ? `„${label}“: Bild in der Nextcloud nicht gefunden.`
            : `„${label}“: Bilder aus dem Netz kommen nicht in den Druck – bitte hochladen.`);
        return { type: 'note', text: `[${label}]` };
      }
      const name = `bilder/bild-${++n}.${ext}`;
      files[name] = data;
      const { src: _src, alt: _alt, ...rest } = block;
      const width = widthInCm(block.width);
      return { ...rest, file: name, width: width || '12cm' };
    };

    const walk = async (blocks: any[]): Promise<any[]> => {
      const out: any[] = [];
      for (const block of blocks) {
        if (!block || typeof block !== 'object') out.push(block);
        else if (block.type === 'image' && block.src !== undefined) out.push(await imageBlock(block));
        else if (block.type === 'code' && block.file !== undefined && block.code === undefined) {
          warnings.push(`Code aus „${block.file}“ gibt es nur im Kurs-Projekt – im Druck steht ein Hinweis.`);
          out.push({ type: 'note', text: `[Code aus ${block.file}]` });
        } else if (block.type === 'image' && block.file !== undefined) {
          warnings.push(`Bild „${block.file}“ gibt es nur im Kurs-Projekt – im Druck steht ein Hinweis.`);
          out.push({ type: 'note', text: `[Bild ${block.file}]` });
        } else out.push(Array.isArray(block.blocks) ? { ...block, blocks: await walk(block.blocks) } : block);
      }
      return out;
    };

    const resolved = docSpec().resolveDocRefs(spec, ctx?.refs ?? null);
    if (ctx?.refs) {
      const missing = docSpec().docRefSlugs(spec).filter((s) => !ctx.refs![s]);
      if (missing.length) warnings.push(`Verweis auf fehlende Blätter: ${missing.join(', ')}`);
    }
    const { titel: _t, nummer: _n, kurs: _k, titelmuster: _m, ...rest } = resolved;
    const meta = { ...(ctx?.course.meta || {}), ...(rest.meta || {}) };
    // Eine eigene Kopfzeile in meta.TITEL (z. B. Klassenarbeit) hat Vorrang.
    if (!meta.TITEL) meta.TITEL = WorksheetsService.header(ctx, title);
    return {
      job: {
        spec: { ...rest, titel: title || 'Dokument', meta, content: await walk(resolved.content) },
        course: { ...(ctx?.course.autor ? { autor: ctx.course.autor } : {}) },
        ...(ctx?.template ? { template: ctx.template.data } : {}),
        files,
        outputs,
      },
      warnings,
    };
  }
}

