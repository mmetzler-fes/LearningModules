import { Controller, Get, Post, Param, UseGuards, Request, Res, UseInterceptors, UploadedFile, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as crypto from 'crypto';
import type { Response } from 'express';
import { H5pService } from './h5p/h5p.service';
import { ImportService } from './import/import.service';
import { ExportService } from './export/export.service';
import { MasterKeyService } from '../crypto/master-key.service';
import { odtToHtml } from './odt/odt';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SchoolIsolationGuard } from '../../auth/guards/school-isolation.guard';

/** Dateiname ohne Zeichen, die im Content-Disposition-Kopf stören. */
const fileName = (title: string, ext: string) =>
  `${String(title || 'thema').replace(/[^\p{L}\p{N} _.-]+/gu, '_').trim() || 'thema'}.${ext}`;

const sendFile = (res: Response, buffer: Buffer, name: string, type: string) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(buffer);
};

@Controller('interchange')
@UseGuards(JwtAuthGuard, SchoolIsolationGuard)
export class InterchangeController {
  constructor(
    private readonly h5pService: H5pService,
    private readonly importService: ImportService,
    private readonly exportService: ExportService,
    private readonly masterKey: MasterKeyService,
  ) {}

  @Post('h5p/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadH5p(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const importMode = req.headers['x-import-mode'] || 'native';
    const { processH5pBuffer } = await import('./h5p/h5p-parser.js');
    const result = processH5pBuffer(file.buffer, file.originalname, importMode);
    if (!result.success || !result.topic) {
      return result;
    }
    // Speichere das Thema und die Module in der Datenbank
    const topicData = result.topic;
    // ownerId und schoolId aus req.user übernehmen, Fehler wenn nicht vorhanden
    const user = req.user || {};
    if (!user.userId) {
      throw new BadRequestException('ownerId (userId) fehlt im Request. Bitte als eingeloggter Nutzer importieren.');
    }
    const topicEntity = this.h5pService['topicRepo'].create({
      id: crypto.randomUUID(),
      title: topicData.title,
      description: topicData.description,
      ownerId: user.userId,
      schoolId: user.schoolId || null,
      permissions: topicData.permissions || { visibleTo: 'school' },
    });
    const savedTopic = await this.h5pService['topicRepo'].save(topicEntity);
    const modules = (topicData.modules || []).map((m: any) => {
      const { id: _id, creatorId: _c, ...moduleData } = m;
      const mod = this.h5pService['moduleRepo'].create({
        ...moduleData,
        id: crypto.randomUUID(),
        topicId: savedTopic.id,
        moduleSelected: true,
        // Eine offen hereinkommende H5P-Datei ist neues Material: Creator ist,
        // wer sie importiert.
        creatorId: user.userId,
      });
      return mod;
    });
    if (modules.length > 0) {
      await this.h5pService['moduleRepo'].save(modules);
    }
    return { success: true, topicId: savedTopic.id, topicTitle: savedTopic.title, importedCount: modules.length };
  }

  /**
   * Writer-Dokument (.odt) in HTML für das Modul "Text / Arbeitsblatt".
   * Gespeichert wird hier nichts – das Ergebnis landet im Editor und wird
   * erst mit dem Modul gesichert.
   */
  @Post('odt-to-html')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 40 * 1024 * 1024 } }))
  async odtToHtml(@UploadedFile() file: Express.Multer.File) {
    if (!file || !file.buffer) throw new BadRequestException('Keine Datei empfangen.');
    try {
      return { success: true, ...odtToHtml(file.buffer, file.originalname) };
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'Die Datei konnte nicht gelesen werden.');
    }
  }

  /** Wie viele Module eigene bzw. fremde sind – für die Warnung vor dem Export. */
  @Get('topics/:id/export-info')
  async exportInfo(@Param('id') id: string, @Request() req: any) {
    return this.exportService.info(id, req.user);
  }

  /** JSON, nur die selbst verfassten Module. */
  @Get('topics/:id/export-json')
  async exportJson(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
    const data = await this.exportService.exportJson(id, req.user);
    sendFile(res, Buffer.from(JSON.stringify(data, null, 2), 'utf-8'), fileName(data.topic.title, 'json'), 'application/json');
  }

  /** H5P, nur die selbst verfassten Module. */
  @Get('topics/:id/export-h5p')
  async exportH5p(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
    const { title, buffer } = await this.exportService.exportH5p(id, req.user);
    sendFile(res, buffer, fileName(title, 'h5p'), 'application/octet-stream');
  }

  /** Das ganze Thema, verschlüsselt mit dem Masterkey. */
  @Get('topics/:id/export-encrypted')
  async exportEncrypted(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
    const { title, buffer } = await this.exportService.exportEncrypted(id, req.user);
    sendFile(res, buffer, fileName(title, 'lmenc'), 'application/octet-stream');
  }

  /**
   * Import eines Themas. Erkennt selbst, ob die Datei offenes JSON oder ein
   * verschlüsselter Export ist.
   */
  @Post('import-json')
  @UseInterceptors(FileInterceptor('file'))
  async importJson(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    try {
      const targetTopicId = req.body?.topicId || undefined;
      if (this.masterKey.isEncrypted(file.buffer)) {
        return await this.exportService.importEncrypted(file.buffer, req.user, targetTopicId);
      }
      const jsonString = file.buffer.toString('utf-8');
      return await this.importService.importTopicFromJson(jsonString, req.user, targetTopicId);
    } catch (err) {
      if (err?.status) throw err; // re-throw NestJS HttpExceptions (400, 403, 404 …)
      throw new InternalServerErrorException(err?.message || 'Import fehlgeschlagen');
    }
  }
}
