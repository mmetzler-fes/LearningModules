import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Request, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeatureGuard, RequireFeature } from '../features/feature.guard';
import { FeaturesService } from '../features/features.service';
import { WorksheetsService } from './worksheets.service';
import { DocMirrorService } from './doc-mirror.service';
import { TemplatesService } from './templates.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { WORKSHEET_OUTPUTS, WorksheetOutput } from './renderer.client';
import type { PdfImportMode } from './worksheets.service';
import { PdfImportJobs } from './pdf-import-jobs.service';

const MAX_PDF_BYTES = 40 * 1024 * 1024;

const FILE_TYPES: Record<WorksheetOutput, { mime: string; ext: string; suffix: string }> = {
  odt: { mime: 'application/vnd.oasis.opendocument.text', ext: 'odt', suffix: '' },
  loesung: { mime: 'application/vnd.oasis.opendocument.text', ext: 'odt', suffix: ' – Lösung' },
  pdf: { mime: 'application/pdf', ext: 'pdf', suffix: '' },
  loesung_pdf: { mime: 'application/pdf', ext: 'pdf', suffix: ' – Lösung' },
};

/** Modultyp „Dokument“ als .odt/.pdf – nur mit freigeschalteter Funktion. */
@Controller('worksheets')
@UseGuards(JwtAuthGuard, FeatureGuard)
@RequireFeature('worksheets')
export class WorksheetsController {
  constructor(
    private readonly worksheets: WorksheetsService,
    private readonly mirror: DocMirrorService,
    private readonly templates: TemplatesService,
    private readonly features: FeaturesService,
    private readonly pdfJobs: PdfImportJobs,
  ) {}

  // ---- Vorlagen (eigene und der Schule) ----

  @Get('templates')
  listTemplates(@Request() req: any) {
    return this.templates.list(req.user.userId);
  }

  /** Hochladen: Felder file, name, kind (arbeitsblatt|klassenarbeit), scope (own|school). */
  @Post('templates')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadTemplate(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.templates.upload(req.user.userId, { ...req.body, buffer: file?.buffer });
  }

  @Post('templates/:id/default')
  @HttpCode(200)
  defaultTemplate(@Request() req: any, @Param('id') id: string, @Body() body: { on?: boolean }) {
    return this.templates.setDefault(req.user.userId, id, body?.on !== false);
  }

  @Delete('templates/:id')
  removeTemplate(@Request() req: any, @Param('id') id: string) {
    return this.templates.remove(req.user.userId, id);
  }

  /** Probeblatt mit dieser Vorlage als PDF. */
  @Get('templates/:id/sample')
  async sampleTemplate(@Request() req: any, @Param('id') id: string, @Res() res: Response) {
    const pdf = await this.worksheets.sample(req.user.userId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Probeblatt.pdf"');
    res.send(pdf);
  }

  /**
   * PDF als Dokument übernehmen: Feld `file`, `mode` text | pages | ai,
   * `ocr` (nur ai) – liefert `{ spec, title, warnings }` für den Editor.
   */
  @Post('import-pdf')
  @HttpCode(200)
  @RequireFeature('pdfImport')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES } }))
  async importPdf(@UploadedFile() file: Express.Multer.File, @Body() body: { mode?: string; ocr?: string; positions?: string }) {
    if (!file?.buffer?.length) throw new BadRequestException('Keine Datei empfangen.');
    const mode: PdfImportMode = body?.mode === 'pages' ? 'pages' : body?.mode === 'ai' ? 'ai' : 'text';
    return this.worksheets.importPdf(file.buffer, mode, body?.ocr === 'true', body?.positions === 'true');
  }

  /**
   * PDF als Auftrag mit Fortschritt: wie import-pdf, dazu `figures=true`
   * (Schaubilder als gruppierte .odg in die Nextcloud, `topicId` nötig).
   * Ergebnis `{ id }`; den Stand liefert GET import-pdf-job/:id.
   */
  @Post('import-pdf-job')
  @HttpCode(200)
  @RequireFeature('pdfImport')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES } }))
  startPdfJob(@Request() req: any, @UploadedFile() file: Express.Multer.File, @Body() body: { mode?: string; ocr?: string; figures?: string; topicId?: string }) {
    if (!file?.buffer?.length) throw new BadRequestException('Keine Datei empfangen.');
    if (file.buffer.subarray(0, 4).toString('latin1') !== '%PDF') throw new BadRequestException('Das ist kein PDF.');
    const mode: PdfImportMode = body?.mode === 'pages' ? 'pages' : body?.mode === 'ai' ? 'ai' : 'text';
    // Multer liefert den Namen als latin1 – Umlaute sonst verstümmelt.
    const name = Buffer.from(file.originalname || 'PDF', 'latin1').toString('utf8');
    return this.pdfJobs.start(req.user, file.buffer, name, {
      mode, ocr: body?.ocr === 'true', figures: body?.figures === 'true', topicId: String(body?.topicId || '') || undefined,
    });
  }

  /** Stand eines PDF-Imports: `{ state, phase, done, total, message, result?, error? }`. */
  @Get('import-pdf-job/:id')
  pdfJob(@Request() req: any, @Param('id') id: string) {
    return this.pdfJobs.get(req.user, id);
  }

  /** Renderer/pdf-ai erreichbar? Dazu, ob dieses Konto PDFs übernehmen darf. */
  @Get('status')
  async status(@Request() req: any) {
    return { ...(await this.worksheets.status()), pdfImport: await this.features.has(req.user.userId, 'pdfImport') };
  }

  /** Skript (Kompendium) aller Arbeitsblätter unter einem Ordner: output = odt | loesung | pdf | loesung_pdf. */
  @Get('script/:nodeId/:output')
  async script(@Request() req: any, @Param('nodeId') nodeId: string, @Param('output') output: string, @Res() res: Response) {
    if (!WORKSHEET_OUTPUTS.includes(output as WorksheetOutput)) throw new BadRequestException(`output: ${WORKSHEET_OUTPUTS.join(', ')}`);
    const { file, title, warnings } = await this.worksheets.renderScript(req.user, nodeId, output as WorksheetOutput);
    const type = FILE_TYPES[output as WorksheetOutput];
    res.setHeader('Content-Type', type.mime);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`Skript ${fileName(title)}${type.suffix}.${type.ext}`)}`);
    res.setHeader('X-Worksheet-Warnings', encodeURIComponent(JSON.stringify(warnings)));
    res.send(file);
  }

  /** Für den KI-Prompt: Kurs, KI-Vorgaben und vorhandene Blätter eines Zielordners (?nodeId=). */
  @Get('prompt-context')
  promptContext(@Request() req: any, @Query('nodeId') nodeId?: string) {
    return this.worksheets.promptContext(req.user, nodeId || null);
  }

  /** Für den KI-Prompt: Inhalt eigener Dokumente als Vorbild (?ids=a,b). */
  @Get('prompt-examples')
  promptExamples(@Request() req: any, @Query('ids') ids?: string) {
    return this.worksheets.promptExamples(req.user, String(ids || '').split(',').filter(Boolean));
  }

  /** Nextcloud-Abbild der eigenen Dokumente: Ablage, Umfang, Fehler. */
  @Get('mirror')
  mirrorStatus(@Request() req: any) {
    return this.mirror.status(req.user.userId);
  }

  /** Jetzt abgleichen (wartet auf das Ergebnis). */
  @Post('mirror/sync')
  @HttpCode(200)
  async mirrorSync(@Request() req: any) {
    const result = await this.mirror.syncUser(req.user.userId);
    return { ...result, status: await this.mirror.status(req.user.userId) };
  }

  /**
   * { moduleId, title } → Nummer, Kopfzeile, Kursangaben und Verweisziele
   * des Dokuments im Notebook.
   */
  @Post('context')
  @HttpCode(200)
  context(@Request() req: any, @Body() body: { moduleId?: string; title?: string }) {
    if (!body?.moduleId) throw new BadRequestException('moduleId fehlt.');
    return this.worksheets.editorContext(req.user, String(body.moduleId), String(body.title || '').slice(0, 200));
  }

  /**
   * { spec, title, output, moduleId? } → die Datei. Gerendert wird der Stand
   * aus dem Editor, auch ungespeichert; mit moduleId samt Nummer, Kopfzeile
   * und Verweisen aus dem Notebook. Hinweise des Renderers (z. B. Bilder, die
   * nicht in den Druck kommen) stehen in X-Worksheet-Warnings.
   */
  @Post('render')
  @HttpCode(200)
  async render(@Request() req: any, @Body() body: { spec?: unknown; title?: string; output?: string; moduleId?: string; kind?: string; templateId?: string | null }, @Res() res: Response) {
    const output = String(body?.output || '') as WorksheetOutput;
    if (!WORKSHEET_OUTPUTS.includes(output)) throw new BadRequestException(`output: ${WORKSHEET_OUTPUTS.join(', ')}`);
    const title = String(body?.title || '').trim().slice(0, 200);
    const moduleId = body?.moduleId ? String(body.moduleId) : undefined;
    const kind = typeof body?.kind === 'string' ? body.kind : undefined;
    // Vorlage aus dem Editor: '' = wie im Ordner, fehlt das Feld, gilt die gespeicherte des Dokuments.
    const templateId = typeof body?.templateId === 'string' ? body.templateId || null : undefined;
    const { file, warnings } = await this.worksheets.render(req.user, { spec: body?.spec, title, output, moduleId, kind, templateId }, req);
    const type = FILE_TYPES[output];
    const name = `${fileName(title || 'Dokument')}${type.suffix}.${type.ext}`;
    res.setHeader('Content-Type', type.mime);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('X-Worksheet-Warnings', encodeURIComponent(JSON.stringify(warnings)));
    res.send(file);
  }
}

function fileName(title: string): string {
  return title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Dokument';
}
