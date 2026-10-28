import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { TopicLink } from '../core/entities/topic-link.entity';
import { baseUrl, renderQr } from '../core/share/link-url';
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
import { PdfAiClient } from './pdf-ai.client';

/** Lage im PDF (`_pos` des Renderers) aus allen Bausteinen entfernen. */
/**
 * Beschriftung aus dem Stift-Editor: nur ein SVG aus Pfaden, Gruppen, Rechtecken,
 * Linien und Text (ink-view.js). Keine Verweise, Bilder, Skripte – LibreOffice
 * soll beim Drucken nichts nachladen.
 */
export function safeInkSvg(svg: unknown): boolean {
  if (typeof svg !== 'string' || svg.length > 2_000_000 || !/^\s*<svg[\s>]/.test(svg)) return false;
  if (/href|url\s*\(|<!|<\?|\bon[a-z]+\s*=|javascript:/i.test(svg)) return false;
  const tags = svg.match(/<\/?([a-zA-Z][\w:-]*)/g) || [];
  return tags.every((t) => /^<\/?(svg|g|path|rect|line|polyline|polygon|circle|ellipse|text|tspan)$/i.test(t));
}

export function stripPositions(v: any, keys: string[] = ['_pos']): void {
  if (Array.isArray(v)) v.forEach((x) => stripPositions(x, keys));
  else if (v && typeof v === 'object') {
    for (const k of keys) delete v[k];
    Object.values(v).forEach((x) => stripPositions(x, keys));
  }
}

/** Wie ein PDF übernommen wird: Struktur erkennen, Seiten als Bilder, KI-Erkennung (docling). */
export type PdfImportMode = 'text' | 'pages' | 'ai';

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
  /**
   * Lernthema des Dokuments und seine Lehrkraft – für Quiz-Blöcke: QR-Code
   * über ihren Quick-Link. Fehlt es, steht im Druck nur ein Hinweis.
   */
  topicId?: string;
  ownerId?: string;
  /** Öffentliche Adresse der App für die Quiz-Links (sonst APP_URL). */
  base?: string;
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
 * src/renderer/lm-editor/src/doc/docspec.js), Nummer, Kopfzeile und Verweise aus dem
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
    @Optional() @InjectRepository(TopicLink) private readonly linkRepo?: Repository<TopicLink>,
    @Optional() private readonly pdfAi?: PdfAiClient,
  ) {}

  /**
   * PDF → Dokument. `text` und `pages` macht der Renderer, `ai` der Dienst
   * pdf-ai. Das Ergebnis wird wie jedes Dokument geprüft; Fehler darin
   * stehen als Hinweis da (der Editor markiert sie).
   */
  /** `figures`: Lage der Bildbereiche (`_fig`) behalten – für „Schaubilder als Zeichnung“ (PdfImportJobs). */
  async importPdf(pdf: Buffer, mode: PdfImportMode, ocr = false, positions = false, figures = false) {
    if (!pdf?.length || pdf.subarray(0, 4).toString('latin1') !== '%PDF') throw new BadRequestException('Das ist kein PDF.');
    const result = mode === 'ai'
      ? await (this.pdfAi ?? (() => { throw new BadRequestException('Keine KI-Erkennung eingerichtet.'); })()).convert(pdf, ocr)
      : await this.renderer.importPdf(pdf, mode === 'pages' ? 'pages' : 'text');
    // `_pos` (Seite, Höhe im PDF) braucht nur der .xopp-Import – sonst landete es im Dokument.
    if (!positions) stripPositions(result.spec);
    if (!figures) stripPositions(result.spec, ['_fig']);
    const errors = docSpec().validateDocSpec(result.spec);
    return { ...result, mode, warnings: [...result.warnings, ...errors.map((e) => `Im Ergebnis: ${e}`)] };
  }

  /** Token des Quick-Links dieser Lehrkraft auf das Lernthema – oder `null`. */
  async quickTokenFor(ownerId: string, topicId: string): Promise<string | null> {
    if (!this.linkRepo) return null;
    const rule = await this.linkRepo.findOne({ where: { ownerId, quickTopicId: topicId, classId: IsNull(), token: Not(IsNull()) } });
    return rule?.token ?? null;
  }

  private async templateFor(userId: string, nodeId: string | null, docKind: string | undefined, preferred?: string | null) {
    const t = this.templates ? await this.templates.resolve(userId, nodeId, templateKindOf(docKind), undefined, preferred) : null;
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
    const sheets = [...numbering.docs.entries()]
      .filter(([, d]) => (d.nodeId ? bookOf(d.nodeId) : null) === book)
      .map(([id, d]) => ({ id, slug: d.slug, pfad: d.pfad, titel: d.title }));
    return { kurs: settings.kurs || '', aiGuidelines: settings.aiGuidelines || '', sheets };
  }

  /**
   * Für den KI-Prompt: Inhalt eigener Dokumente als Vorbild (Stil, Niveau,
   * Aufbau). Eingebettete Bilder (data:) fallen weg – sie blähen den Prompt
   * nur auf; Bilder aus der Nextcloud (nc:…) bleiben als Name stehen.
   */
  async promptExamples(user: any, ids: string[]) {
    const wanted = [...new Set(ids.map(String))].slice(0, 80);
    if (!wanted.length) return { examples: [] };
    const mods = await this.moduleRepo!.find({ where: { id: In(wanted), type: 'document' } });
    const topics = await this.topicRepo!.find({ where: { id: In([...new Set(mods.map((m) => m.topicId))]) }, select: ['id', 'ownerId'] });
    const own = new Set(topics.filter((t) => t.ownerId === user.userId).map((t) => t.id));
    const strip = (v: any): any => {
      if (typeof v === 'string') return v.startsWith('data:') ? '[eingebettetes Bild]' : v;
      if (Array.isArray(v)) return v.map(strip);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'id').map(([k, x]) => [k, strip(x)]));
      return v;
    };
    const examples = wanted
      .map((id) => mods.find((m) => m.id === id))
      .filter((m): m is LearningModule => !!m && own.has(m.topicId))
      .map((m) => {
        const content = typeof m.content === 'string' ? JSON.parse(m.content || '{}') : m.content || {};
        return { id: m.id, title: m.title || '', kind: content.kind || 'arbeitsblatt', spec: strip(content.spec || { content: [] }) };
      });
    return { examples };
  }

  async status() {
    return {
      configured: this.renderer.configured(),
      renderer: await this.renderer.health(),
      // PDF-Import: Struktur/Seiten über den Renderer, KI-Erkennung über pdf-ai
      pdfAi: this.pdfAi?.configured() ? (await this.pdfAi.health()) ?? { ok: false } : null,
    };
  }

  /**
   * Nummer, Kursangaben und Verweisziele eines eigenen Dokuments. Für den
   * Editor (Kopfzeile, aufgelöste Verweise) und den Druck.
   */
  /** `templateId`: Vorlage aus dem Editor (noch ungespeichert) – sonst die am Dokument gespeicherte. */
  async context(user: any, moduleId: string, kind?: string, templateId?: string | null): Promise<DocContext> {
    const mod = await this.moduleRepo!.findOne({ where: { id: moduleId }, select: ['id', 'topicId', 'type', 'title', 'content'] });
    if (!mod) throw new NotFoundException('Modul nicht gefunden.');
    const topic = await this.topicRepo!.findOne({ where: { id: mod.topicId }, select: ['id', 'ownerId'] });
    if (!topic || topic.ownerId !== user.userId) throw new ForbiddenException('Nur eigene Dokumente.');
    const preferred = templateId !== undefined ? templateId : (mod.content as any)?.templateId || null;
    const n = await this.numbering!.numberingFor(user.userId);
    const info = n.docs.get(moduleId);
    if (!info) {
      // Noch nicht gespeichert oder nicht vom Typ „Dokument“: ohne Nummer.
      return { pfad: '', slug: '', course: { kurs: '', titelmuster: '{titel}', autor: '', meta: {} }, folder: '', refs: null,
        template: await this.templateFor(user.userId, null, kind, preferred), topicId: topic.id, ownerId: topic.ownerId };
    }
    return { pfad: info.pfad, slug: info.slug, course: info.course, folder: info.folder, refs: n.refs.get(info.scope) || {},
      template: await this.templateFor(user.userId, info.nodeId, kind || info.kind, preferred), topicId: topic.id, ownerId: topic.ownerId };
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

  /**
   * Skript (Kompendium) aus allen Arbeitsblättern unter einem Ordner, in der
   * Reihenfolge des Baums – Verweise, Bilder und Kursangaben wie beim Blatt.
   */
  async renderScript(user: any, nodeId: string, output: WorksheetOutput) {
    const nodes = await this.nodeRepo!.find({ where: { ownerId: user.userId } });
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) throw new NotFoundException('Ordner nicht gefunden.');
    const n = await this.numbering!.numberingFor(user.userId);
    const below = new Set<string>([nodeId]);
    for (let grew = true; grew;) {
      grew = false;
      for (const x of nodes) if (x.parentId && below.has(x.parentId) && !below.has(x.id)) { below.add(x.id); grew = true; }
    }
    // Reihenfolge des Baums: Unterordner vor Lernthemen, darin die Modulreihenfolge.
    const order: string[] = [];
    const byOrder = (a: any, b: any) => a.orderIndex - b.orderIndex;
    const infos = [...n.docs.values()].filter((d) => d.nodeId && below.has(d.nodeId) && d.kind === 'arbeitsblatt');
    const visit = (id: string) => {
      for (const k of nodes.filter((x) => x.parentId === id).sort(byOrder)) visit(k.id);
      for (const d of infos.filter((d) => d.nodeId === id)) order.push(d.moduleId);
    };
    visit(nodeId);
    // Die Nummerierung legt die Dokumente schon in Baumreihenfolge an (Lernthemen, dann Module).
    const sorted = order;
    if (!sorted.length) throw new BadRequestException('Unter diesem Ordner liegen keine Arbeitsblätter.');
    const mods = await this.moduleRepo!.find({ where: { id: In(sorted) } });
    const sheets: Array<{ titel: string; spec: Record<string, any> }> = [];
    const files: Record<string, string> = {};
    const warnings: string[] = [];
    for (const [i, id] of sorted.entries()) {
      const mod = mods.find((m) => m.id === id);
      const info = n.docs.get(id)!;
      if (!mod?.content?.spec || docSpec().validateDocSpec(mod.content.spec).length) { warnings.push(`„${mod?.title || id}“ enthält Fehler und fehlt im Skript.`); continue; }
      const ctx: DocContext = { pfad: info.pfad, slug: info.slug, course: info.course, folder: info.folder, refs: n.refs.get(info.scope) || {},
        topicId: mod.topicId, ownerId: user.userId };
      const { job, warnings: w } = await this.prepare(mod.content.spec, mod.title, [], ctx);
      const folder = String(i + 1).padStart(2, '0');
      for (const [name, data] of Object.entries(job.files || {})) files[`${folder}/${name}`] = data;
      const { meta: _m, ...spec } = job.spec;
      sheets.push({ titel: mod.title, spec });
      warnings.push(...w);
    }
    const settings = settingsAt(nodes, nodeId);
    const skript = node.docSettings?.skript || {};
    const tpl = this.templates ? await this.templates.resolve(user.userId, nodeId, 'skript', nodes) : null;
    const result = await this.renderer.renderScript({
      sheets,
      course: { kurs: settings.kurs || '', autor: settings.autor || '', ...(settings.meta ? { meta: settings.meta } : {}) },
      skript: { titel: skript.titel || node.title, kopfzeile: skript.kopfzeile || [settings.kurs, node.title].filter(Boolean).join(' – ') },
      ...(tpl ? { template: tpl.data } : {}),
      files,
      outputs: [output],
    });
    const file = result.files[output];
    if (!file) throw new BadRequestException('Der Renderer hat die Datei nicht geliefert.');
    return { file, title: skript.titel || node.title, warnings: [...warnings, ...result.warnings] };
  }

  /** Mehrere Formate in einem Auftrag (Nextcloud-Abbild). */
  async renderFiles(spec: Record<string, any>, title: string, outputs: WorksheetOutput[], ctx: DocContext | null) {
    const { job, warnings } = await this.prepare(spec, title, outputs, ctx);
    const result = await this.renderer.render(job);
    return { files: result.files, warnings: [...warnings, ...result.warnings] };
  }

  async render(user: any, body: { spec: unknown; title: string; output: WorksheetOutput; moduleId?: string; kind?: string; templateId?: string | null }, req?: any) {
    const errors = docSpec().validateDocSpec(body.spec);
    if (errors.length) throw new BadRequestException({ message: 'Das Dokument enthält Fehler.', errors });
    const ctx = body.moduleId ? await this.context(user, body.moduleId, body.kind, body.templateId)
      : this.templates ? { pfad: '', slug: '', course: { kurs: '', titelmuster: '{titel}', autor: '', meta: {} }, folder: '', refs: null, template: await this.templateFor(user.userId, null, body.kind, body.templateId) }
        : null;
    if (ctx && req) ctx.base = baseUrl(req);
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

    // Zeichenrahmen (Bildgruppe): jedes Bild als Datei wie ein Bild-Baustein, Lage in
    // Prozent bleibt; Textfenster gehen, wie sie sind. Was sich nicht drucken lässt,
    // fällt heraus (mit Warnung).
    const groupBlock = async (block: Record<string, any>): Promise<Record<string, any>> => {
      const items: any[] = [];
      for (const it of Array.isArray(block.items) ? block.items : []) {
        if (!it || typeof it !== 'object') continue;
        if (typeof it.text === 'string') { items.push(it); continue; }
        const done = await imageBlock({ type: 'image', src: it.src, alt: it.alt });
        if (done.type !== 'image') continue;
        items.push({ file: done.file, x: it.x, y: it.y, w: it.w, h: it.h });
      }
      if (!items.length) return { type: 'note', text: '[Bildgruppe]' };
      const { items: _i, ...rest } = block;
      return { ...rest, items, width: widthInCm(block.width) || '16.5cm' };
    };

    // Quiz aus dem Lernthema: Kasten mit QR-Code und Adresse über den
    // Quick-Link – wer scannt, bearbeitet genau dieses Modul (&mod=).
    const quizBlock = async (block: Record<string, any>): Promise<Record<string, any>> => {
      const id = String(block.module ?? '');
      const mod = id && this.moduleRepo ? await this.moduleRepo.findOne({ where: { id }, select: ['id', 'topicId', 'title'] }) : null;
      const title = String(block.title || mod?.title || 'Quiz');
      if (!mod || !ctx?.topicId || mod.topicId !== ctx.topicId || !ctx.ownerId) {
        warnings.push(`Quiz „${title}“: Das Modul liegt nicht in diesem Lernthema – im Druck steht ein Hinweis.`);
        return { type: 'note', text: `[Quiz: ${title}]` };
      }
      const token = await this.quickTokenFor(ctx.ownerId, ctx.topicId);
      if (!token) {
        warnings.push(`Quiz „${title}“: Für das Lernthema gibt es noch keinen Quick-Link – im Druck fehlt der QR-Code.`);
        return { type: 'box', title: `Quiz: ${title}`, blocks: [{ type: 'note', text: 'Online in LearningModules – der QR-Code erscheint, sobald für das Lernthema ein Quick-Link erstellt ist.' }] };
      }
      const url = `${ctx.base || baseUrl()}/?l=${token}&mod=${mod.id}`;
      const blocks: Record<string, any>[] = [];
      const svg = await renderQr(url);
      if (svg) {
        const name = `bilder/quiz-${++n}.svg`;
        files[name] = Buffer.from(svg, 'utf-8').toString('base64');
        blocks.push({ type: 'image', file: name, width: '3.5cm', float: 'left' });
      }
      // Als Code: Die Adresse bleibt, wie sie ist (kein `_` als Tiefstellung).
      blocks.push({ type: 'text', text: 'QR-Code scannen oder die Adresse öffnen:' }, { type: 'code', code: url });
      return { type: 'box', title: `Quiz: ${title}`, blocks };
    };

    // Bilder in Tabellenzellen: wie Bild-Bausteine als Datei mitgeben; was sich
    // nicht drucken lässt, steht als Hinweis im Text der Zelle.
    const tableCells = async (block: Record<string, any>) => {
      const cell = async (c: any) => {
        // Bausteine in der Zelle (Tabelle in der Tabelle) wie alle anderen.
        if (c && typeof c === 'object' && Array.isArray(c.blocks)) c = { ...c, blocks: await walk(c.blocks) };
        if (!c || typeof c !== 'object' || !Array.isArray(c.images) || !c.images.length) return c;
        const images: any[] = [];
        const notes: string[] = [];
        for (const img of c.images) {
          const done = await imageBlock({ type: 'image', ...img });
          if (done.type === 'image') images.push({ file: done.file, width: done.width });
          else notes.push(done.text);
        }
        const text = [c.text || '', ...notes].filter(Boolean).join(' ');
        const { images: _i, ...rest } = c;
        return { ...rest, text, ...(images.length ? { images } : {}) };
      };
      const row = (r: any) => (Array.isArray(r) ? Promise.all(r.map(cell)) : r);
      return {
        ...block,
        ...(Array.isArray(block.header) ? { header: await row(block.header) } : {}),
        rows: Array.isArray(block.rows) ? await Promise.all(block.rows.map(row)) : block.rows,
      };
    };

    // Beschriftung aus dem Stift-Editor (lm-editor/src/ink/ink-print.js): SVG je
    // Baustein, Lage in Punkt → Datei und cm für den Renderer.
    let inkCount = 0;
    const pt = (v: any) => Math.round((Number(v) / 72) * 2.54 * 1000) / 1000;
    const inkFile = (ink: any): Record<string, any> | null => {
      if (!ink || typeof ink !== 'object' || ![ink.x, ink.y, ink.w, ink.h].every((v) => Number.isFinite(Number(v)))) return null;
      if (!safeInkSvg(ink.svg)) {
        warnings.push('Eine Beschriftung ließ sich nicht drucken (unerwarteter Inhalt).');
        return null;
      }
      const name = `stift/stift-${++inkCount}.svg`;
      files[name] = Buffer.from(ink.svg, 'utf-8').toString('base64');
      return { file: name, x: pt(ink.x), y: pt(ink.y), width: pt(ink.w), height: pt(ink.h) };
    };

    const walk = async (blocks: any[]): Promise<any[]> => {
      const out: any[] = [];
      for (const item of blocks) {
        // Die Beschriftung hängt am Baustein, auch wenn er unten neu gebaut wird (Bild, Quiz, Tabelle).
        const { ink, ...block } = item && typeof item === 'object' && !Array.isArray(item) ? item : { ink: null };
        const printedInk = ink ? inkFile(ink) : null;
        const at = out.length;
        if (!item || typeof item !== 'object') out.push(item);
        else if (block.type === 'quiz') out.push(await quizBlock(block));
        else if (block.type === 'table') out.push(await tableCells(block));
        else if (block.type === 'image' && block.src !== undefined) out.push(await imageBlock(block));
        else if (block.type === 'group') out.push(await groupBlock(block));
        else if (block.type === 'code' && block.file !== undefined && block.code === undefined) {
          warnings.push(`Code aus „${block.file}“ gibt es nur im Kurs-Projekt – im Druck steht ein Hinweis.`);
          out.push({ type: 'note', text: `[Code aus ${block.file}]` });
        } else if (block.type === 'image' && block.file !== undefined) {
          warnings.push(`Bild „${block.file}“ gibt es nur im Kurs-Projekt – im Druck steht ein Hinweis.`);
          out.push({ type: 'note', text: `[Bild ${block.file}]` });
        } else out.push(Array.isArray(block.blocks) ? { ...block, blocks: await walk(block.blocks) } : block);
        if (printedInk && out[at] && typeof out[at] === 'object') out[at] = { ...out[at], ink: printedInk };
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

