import { Controller, Get, Post, Body, Param, UseGuards, Request, Res, Header, UseInterceptors, UploadedFile, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as crypto from 'crypto';
import type { Response } from 'express';
import { H5pService } from './h5p/h5p.service';
import { ImportService } from './import/import.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SchoolIsolationGuard } from '../../auth/guards/school-isolation.guard';

@Controller('interchange')
@UseGuards(JwtAuthGuard, SchoolIsolationGuard)
export class InterchangeController {
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
        const { id: _id, ...moduleData } = m;
        const mod = this.h5pService['moduleRepo'].create({
          ...moduleData,
          id: crypto.randomUUID(),
          topicId: savedTopic.id,
          moduleSelected: true,
        });
        return mod;
      });
      if (modules.length > 0) {
        await this.h5pService['moduleRepo'].save(modules);
      }
      return { success: true, topicId: savedTopic.id, importedCount: modules.length };
    }
  constructor(
    private readonly h5pService: H5pService,
    private readonly importService: ImportService,
  ) {}

  @Get('topics/:id/export-h5p')
  @Header('Content-Type', 'application/octet-stream')
  async exportH5p(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
    const buffer = await this.h5pService.generateH5pBuffer(id);
    const filename = `export_${id}.h5p`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post('import-json')
  @UseInterceptors(FileInterceptor('file'))
  async importJson(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    try {
      const jsonString = file.buffer.toString('utf-8');
      const targetTopicId = req.body?.topicId || undefined;
      return await this.importService.importTopicFromJson(jsonString, req.user, targetTopicId);
    } catch (err) {
      if (err?.status) throw err; // re-throw NestJS HttpExceptions (400, 403, 404 …)
      throw new InternalServerErrorException(err?.message || 'Import fehlgeschlagen');
    }
  }
}
