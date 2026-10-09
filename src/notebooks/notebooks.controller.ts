import { Controller, Get, Post, Patch, Delete, Body, Param, Request, Res, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotebooksService } from './notebooks.service';

/** Dateiname ohne Zeichen, die Betriebssysteme stören. */
function fileName(title: string): string {
  return `${String(title || 'Notebook').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.notebook.zip`;
}

@Controller('notebooks')
@UseGuards(JwtAuthGuard)
export class NotebooksController {
  constructor(private readonly notebooks: NotebooksService) {}

  /** Struktur, Plätze und Themen (eigene und mit Nutzungsrecht). */
  @Get()
  async tree(@Request() req: any) {
    return this.notebooks.tree(req.user);
  }

  /** `{ kind: 'book'|'area'|'section', title, parentId }` */
  @Post('nodes')
  async create(@Request() req: any, @Body() body: any) {
    return this.notebooks.createNode(req.user, body);
  }

  /** `{ title?, tagIds? }` – Tags vererben sich auf alle Lernthemen darunter. */
  @Patch('nodes/:id')
  async update(@Param('id') id: string, @Request() req: any, @Body() body: { title?: string; tagIds?: string[] }) {
    return this.notebooks.updateNode(id, req.user, body);
  }

  /** Lernthemen darin bleiben erhalten und rücken eine Ebene nach oben. */
  @Delete('nodes/:id')
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.notebooks.deleteNode(id, req.user);
  }

  /** `{ type: 'node'|'topic', id, parentId, index }` */
  @Post('move')
  async move(@Request() req: any, @Body() body: any) {
    return this.notebooks.move(req.user, body);
  }

  @Post('nodes/:id/copy')
  async copyNode(@Param('id') id: string, @Request() req: any) {
    return this.notebooks.copyNode(id, req.user);
  }

  @Post('topics/:topicId/copy')
  async copyTopic(@Param('topicId') topicId: string, @Request() req: any, @Body() body: { title?: string }) {
    return this.notebooks.copyTopic(req.user, topicId, body?.title);
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

  /** ZIP: notebook.json (Struktur) + topics/*.json (gewohnter JSON-Export je Lernthema). */
  @Get('nodes/:id/export')
  async export(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
    const { title, buffer, count, skipped } = await this.notebooks.exportNode(id, req.user);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName(title))}`);
    res.setHeader('X-Export-Report', encodeURIComponent(JSON.stringify({ count, skipped })));
    res.send(buffer);
  }

  /** Notebook-Datei (ZIP) hochladen; Feld `parentId` = Ziel (leer = oben). */
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async import(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file?.buffer?.length) throw new BadRequestException('Keine Datei empfangen.');
    return this.notebooks.importNode(req.user, file.buffer, req.body?.parentId || null);
  }
}
