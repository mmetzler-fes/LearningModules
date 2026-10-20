import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Request, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeatureGuard, RequireFeature } from '../features/feature.guard';
import { WorksheetsService } from './worksheets.service';
import { DocMirrorService } from './doc-mirror.service';
import { WORKSHEET_OUTPUTS, WorksheetOutput } from './renderer.client';

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
  constructor(private readonly worksheets: WorksheetsService, private readonly mirror: DocMirrorService) {}

  @Get('status')
  status() {
    return this.worksheets.status();
  }

  /** Für den KI-Prompt: Kurs, KI-Vorgaben und vorhandene Blätter eines Zielordners (?nodeId=). */
  @Get('prompt-context')
  promptContext(@Request() req: any, @Query('nodeId') nodeId?: string) {
    return this.worksheets.promptContext(req.user, nodeId || null);
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
  async render(@Request() req: any, @Body() body: { spec?: unknown; title?: string; output?: string; moduleId?: string }, @Res() res: Response) {
    const output = String(body?.output || '') as WorksheetOutput;
    if (!WORKSHEET_OUTPUTS.includes(output)) throw new BadRequestException(`output: ${WORKSHEET_OUTPUTS.join(', ')}`);
    const title = String(body?.title || '').trim().slice(0, 200);
    const moduleId = body?.moduleId ? String(body.moduleId) : undefined;
    const { file, warnings } = await this.worksheets.render(req.user, { spec: body?.spec, title, output, moduleId });
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
