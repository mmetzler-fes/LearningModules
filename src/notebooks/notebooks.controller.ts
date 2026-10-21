import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Request, Res, UseGuards, UseInterceptors, UploadedFile, BadRequestException, ForbiddenException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotebooksService } from './notebooks.service';
import { FeatureGuard, RequireFeature } from '../features/feature.guard';
import { FeaturesService } from '../features/features.service';
import { CourseService } from '../worksheets/course.service';
import { docChanged } from '../core/events/doc-changes';

/** Dateiname ohne Zeichen, die Betriebssysteme stören. */
function fileName(title: string): string {
  return `${String(title || 'Notebook').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.notebook.zip`;
}

@Controller('notebooks')
@UseGuards(JwtAuthGuard)
export class NotebooksController {
  constructor(
    private readonly notebooks: NotebooksService,
    private readonly courses: CourseService,
    private readonly features: FeaturesService,
  ) {}

  /** Struktur, Plätze und Themen (eigene und mit Nutzungsrecht). */
  @Get()
  async tree(@Request() req: any) {
    return this.notebooks.tree(req.user);
  }

  /** `{ kind: 'book'|'area'|'section', title, parentId }` */
  @Post('nodes')
  async create(@Request() req: any, @Body() body: any) {
    const result = await this.notebooks.createNode(req.user, body);
    docChanged(req.user.userId); // Nextcloud-Abbild der Dokumente
    return result;
  }

  /** `{ title?, tagIds? }` – Tags vererben sich auf alle Lernthemen darunter. */
  @Patch('nodes/:id')
  async update(@Param('id') id: string, @Request() req: any, @Body() body: { title?: string; tagIds?: string[] }) {
    const result = await this.notebooks.updateNode(id, req.user, body);
    docChanged(req.user.userId); // Nextcloud-Abbild der Dokumente
    return result;
  }

  /**
   * Dokument-Einstellungen eines Ordners: `{ kurs?, titelmuster?, autor?,
   * meta?, numberRoot?, numberFlat?, aiGuidelines? }` – nur mit Freischaltung.
   */
  @Patch('nodes/:id/doc-settings')
  @UseGuards(FeatureGuard)
  @RequireFeature('worksheets')
  async docSettings(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    const result = await this.notebooks.updateDocSettings(id, req.user, body);
    docChanged(req.user.userId); // Nextcloud-Abbild der Dokumente
    return result;
  }

  /** Hoch- oder runterstufen: `{ kind: 'area' | 'section' | 'book' }`. */
  @Post('nodes/:id/convert')
  async convert(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    const result = await this.notebooks.convertNode(id, req.user, body);
    docChanged(req.user.userId); // Nextcloud-Abbild der Dokumente
    return result;
  }

  /** Bereich darüber einfügen: `{ title }` – der Knoten kommt in den neuen Bereich. */
  @Post('nodes/:id/wrap')
  async wrap(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    const result = await this.notebooks.wrapNode(id, req.user, body);
    docChanged(req.user.userId); // Nextcloud-Abbild der Dokumente
    return result;
  }

  /** Lernthemen darin bleiben erhalten und rücken eine Ebene nach oben. */
  @Delete('nodes/:id')
  async remove(@Param('id') id: string, @Request() req: any) {
    const result = await this.notebooks.deleteNode(id, req.user);
    docChanged(req.user.userId); // Nextcloud-Abbild der Dokumente
    return result;
  }

  /** `{ type: 'node'|'topic', id, parentId, index }` */
  @Post('move')
  async move(@Request() req: any, @Body() body: any) {
    const result = await this.notebooks.move(req.user, body);
    docChanged(req.user.userId); // Nextcloud-Abbild der Dokumente
    return result;
  }

  @Post('nodes/:id/copy')
  async copyNode(@Param('id') id: string, @Request() req: any) {
    const result = await this.notebooks.copyNode(id, req.user);
    docChanged(req.user.userId); // Nextcloud-Abbild der Dokumente
    return result;
  }

  @Post('topics/:topicId/copy')
  async copyTopic(@Param('topicId') topicId: string, @Request() req: any, @Body() body: { title?: string }) {
    const result = await this.notebooks.copyTopic(req.user, topicId, body?.title);
    docChanged(req.user.userId); // Nextcloud-Abbild der Dokumente
    return result;
  }

  /** `{ selected: boolean }` – alle eigenen Lernthemen darin. */
  @Post('nodes/:id/selected')
  async setSelected(@Param('id') id: string, @Request() req: any, @Body() body: { selected?: boolean }) {
    return this.notebooks.setSelected(id, req.user, !!body?.selected);
  }

  /** `{ classId }` – Klassenlink mit allen startbaren Lernthemen darin. */
  @Post('nodes/:id/quick-link')
  async quickLink(@Param('id') id: string, @Request() req: any, @Body() body: { classId?: string }) {
    return this.notebooks.quickLink(id, req.user, String(body?.classId || ''), req);
  }

  /**
   * Quick-Link des Knotens: ein Link mit allen startbaren Lernthemen darin,
   * Schüler wählen ihre Klasse aus `classIds`. Erstellt ihn beim ersten Mal.
   */
  @Put('nodes/:id/quick')
  async saveQuick(@Param('id') id: string, @Request() req: any, @Body() body: { classIds?: string[] }) {
    return this.notebooks.saveQuickLink(id, req.user, body?.classIds, req);
  }

  /** ZIP: notebook.json (Struktur) + topics/*.json (gewohnter JSON-Export je Lernthema). */
  @Get('nodes/:id/export')
  async export(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
    const { title, buffer, count, skipped } = await this.notebooks.exportNode(id, req.user);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName(title))}`);
    res.setHeader('X-Export-Report', encodeURIComponent(JSON.stringify({ count, skipped })));
    res.send(buffer);
  }

  /**
   * Notebook-Datei (ZIP) hochladen; Feld `parentId` = Ziel (leer = oben).
   * Ein Kurs aus dem Arbeitsblatt-Generator (ZIP mit kurs.yaml) wird – mit
   * freigeschalteten Dokumenten – als Book bzw. Bereich mit Abschnitten
   * eingelesen (src/worksheets/course.service.ts).
   */
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async import(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file?.buffer?.length) throw new BadRequestException('Keine Datei empfangen.');
    if (CourseService.isCourseZip(file.buffer)) {
      if (!(await this.features.has(req.user.userId, 'worksheets'))) {
        throw new ForbiddenException('Das ist ein Kurs aus dem Arbeitsblatt-Generator – dafür müssen Dokumente für dein Konto freigeschaltet sein.');
      }
      const res = await this.courses.importCourse(req.user, file.buffer, req.body?.parentId || null);
      await this.notebooks.applyInheritance(req.user);
      docChanged(req.user.userId);
      return res;
    }
    const result = await this.notebooks.importNode(req.user, file.buffer, req.body?.parentId || null);
    docChanged(req.user.userId); // Nextcloud-Abbild der Dokumente
    return result;
  }

  /** Dokumente darunter als Kurs für den Arbeitsblatt-Generator (ZIP: kurs.yaml, NN_blatt/…, skripte/). */
  @Get('nodes/:id/course-export')
  @UseGuards(FeatureGuard)
  @RequireFeature('worksheets')
  async courseExport(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
    const { kuerzel, buffer, count, warnings } = await this.courses.exportCourse(req.user, id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${kuerzel}.kurs.zip`)}`);
    res.setHeader('X-Export-Report', encodeURIComponent(JSON.stringify({ count, skipped: warnings })));
    res.send(buffer);
  }
}
