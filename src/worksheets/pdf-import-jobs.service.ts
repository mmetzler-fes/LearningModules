import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { WorksheetsService, PdfImportMode, stripPositions } from './worksheets.service';
import { WorksheetRendererClient } from './renderer.client';
import { DrawingsService } from '../drawings/drawings.service';

/**
 * PDF-Import als Auftrag mit Fortschritt (docs/dokumente.md): Mit „Schaubilder
 * als Zeichnung“ dauert er – jede Folie mit Schaubild geht durch LibreOffice.
 * Der Browser fragt den Stand ab, statt minutenlang auf eine Antwort zu
 * warten, die wie ein Absturz aussähe. Nur im Speicher; nach einer Stunde weg.
 */
export interface PdfImportJob {
  id: string;
  ownerId: string;
  state: 'running' | 'done' | 'failed';
  /** text: PDF lesen · figures: Schaubilder in LibreOffice · store: in die Nextcloud */
  phase: 'text' | 'figures' | 'store' | 'done';
  done: number;
  total: number;
  message: string;
  result?: { spec: any; title: string; warnings: string[]; mode: string };
  error?: string;
  createdAt: number;
}

const KEEP_MS = 60 * 60 * 1000;

/** Bausteine mit `_fig` (Lage eines Bildbereichs im PDF) – auch in Spalten, Kästen, Lösungen. */
export function figureBlocks(v: any, out: any[] = []): any[] {
  if (Array.isArray(v)) v.forEach((x) => figureBlocks(x, out));
  else if (v && typeof v === 'object') {
    if (v.type === 'image' && v._fig && Array.isArray(v._fig.box)) out.push(v);
    Object.values(v).forEach((x) => figureBlocks(x, out));
  }
  return out;
}

@Injectable()
export class PdfImportJobs {
  private readonly logger = new Logger(PdfImportJobs.name);
  private readonly jobs = new Map<string, PdfImportJob>();

  constructor(
    private readonly worksheets: WorksheetsService,
    private readonly renderer: WorksheetRendererClient,
    private readonly drawings: DrawingsService,
  ) {}

  start(user: any, pdf: Buffer, fileName: string, opts: { mode: PdfImportMode; ocr: boolean; figures: boolean; topicId?: string }) {
    const now = Date.now();
    for (const [id, j] of this.jobs) if (now - j.createdAt > KEEP_MS) this.jobs.delete(id);
    const job: PdfImportJob = {
      id: crypto.randomUUID(), ownerId: user.userId, state: 'running', phase: 'text', done: 0, total: 0,
      message: opts.mode === 'ai' ? 'KI-Erkennung läuft …' : 'PDF wird gelesen …', createdAt: now,
    };
    this.jobs.set(job.id, job);
    this.run(job, user, pdf, fileName, opts).catch((err) => {
      job.state = 'failed';
      job.error = err?.response?.message || err?.message || 'Der Import ist gescheitert.';
      this.logger.warn(`PDF-Import ${job.id}: ${job.error}`);
    });
    return { id: job.id };
  }

  get(user: any, id: string) {
    const job = this.jobs.get(id);
    if (!job || job.ownerId !== user.userId) throw new NotFoundException('Diesen Import gibt es nicht (mehr).');
    const { ownerId: _o, createdAt: _c, ...view } = job;
    return view;
  }

  private async run(job: PdfImportJob, user: any, pdf: Buffer, fileName: string, opts: { mode: PdfImportMode; ocr: boolean; figures: boolean; topicId?: string }) {
    const wantFigures = opts.figures && opts.mode === 'text';
    const result = await this.worksheets.importPdf(pdf, opts.mode, opts.ocr, false, wantFigures);
    const warnings = [...result.warnings];
    const figs = wantFigures ? figureBlocks(result.spec) : [];
    if (figs.length && !(await this.drawings.canStore(user, opts.topicId))) {
      warnings.push('Schaubilder als Zeichnung brauchen eine verbundene Nextcloud und ein eigenes Lernthema – sie bleiben Bilder.');
    } else if (figs.length) {
      // Seite für Seite durch LibreOffice – dazwischen steht der Fortschritt.
      job.phase = 'figures';
      job.total = figs.length;
      const byPage = new Map<number, Array<{ block: any; id: string }>>();
      figs.forEach((block, i) => {
        const page = Number(block._fig.page) || 0;
        if (!byPage.has(page)) byPage.set(page, []);
        byPage.get(page)!.push({ block, id: `f${i + 1}` });
      });
      const drawn = new Map<string, { svg: Buffer; odg: Buffer; widthMm: number }>();
      const blockOf = new Map<string, any>();
      for (const [page, list] of [...byPage].sort((a, b) => a[0] - b[0])) {
        job.message = `Schaubild ${job.done + 1}${list.length > 1 ? `–${job.done + list.length}` : ''} von ${job.total} (Seite ${page + 1}) in LibreOffice …`;
        try {
          const res = await this.renderer.exportPdfFigures(pdf, page, list.map(({ block, id }) => ({ id, box: block._fig.box, skip: block._fig.skip || [] })));
          for (const f of res.figures) {
            const entry = list.find((x) => x.id === f.id);
            if (!entry) continue;
            drawn.set(f.id, { svg: f.svg, odg: f.odg, widthMm: f.widthMm });
            blockOf.set(f.id, entry.block);
          }
          warnings.push(...res.warnings);
        } catch (err: any) {
          warnings.push(`Seite ${page + 1}: Schaubild bleibt Bild (${err?.response?.message || err?.message || err}).`);
        }
        job.done += list.length;
      }
      if (drawn.size) {
        job.phase = 'store';
        job.message = `${drawn.size} Zeichnung${drawn.size === 1 ? '' : 'en'} in die Nextcloud …`;
        try {
          const stored = await this.drawings.storeImported(user, opts.topicId!, fileName, drawn);
          for (const [id, s] of stored) {
            const block = blockOf.get(id);
            if (!block) continue;
            block.src = s.url;
            block.source = s.source;
          }
          warnings.push(`${stored.size} Schaubild${stored.size === 1 ? '' : 'er'} als Zeichnung abgelegt – „🖍 In Draw bearbeiten“ an einem Bild öffnet sie als Gruppe.`);
        } catch (err: any) {
          warnings.push(`Zeichnungen nicht in der Nextcloud abgelegt (${err?.message || err}) – sie bleiben Bilder.`);
        }
      }
    }
    stripPositions(result.spec, ['_fig']);
    job.result = { spec: result.spec, title: result.title, warnings, mode: result.mode };
    job.phase = 'done';
    job.state = 'done';
    job.message = 'Fertig.';
  }
}
