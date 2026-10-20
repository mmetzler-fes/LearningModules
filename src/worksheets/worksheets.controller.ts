import { BadRequestException, Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeatureGuard, RequireFeature } from '../features/feature.guard';
import { WorksheetsService } from './worksheets.service';
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
  constructor(private readonly worksheets: WorksheetsService) {}

  @Get('status')
  status() {
    return this.worksheets.status();
  }

  /**
   * { spec, title, output } → die Datei. Gerendert wird der Stand aus dem
   * Editor, auch ungespeichert. Hinweise des Renderers (z. B. Bilder, die
   * nicht in den Druck kommen) stehen in X-Worksheet-Warnings.
   */
  @Post('render')
  @HttpCode(200)
  async render(@Body() body: { spec?: unknown; title?: string; output?: string }, @Res() res: Response) {
    const output = String(body?.output || '') as WorksheetOutput;
    if (!WORKSHEET_OUTPUTS.includes(output)) throw new BadRequestException(`output: ${WORKSHEET_OUTPUTS.join(', ')}`);
    const title = String(body?.title || '').trim().slice(0, 200);
    const { file, warnings } = await this.worksheets.render(body?.spec, title, output);
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
