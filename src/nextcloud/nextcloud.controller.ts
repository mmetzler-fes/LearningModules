import { Controller, Get, Post, Delete, Body, Query, UseGuards, Request, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NextcloudService, MAX_IMAGE_BYTES } from './nextcloud.service';
import { NextcloudBackupService } from './nextcloud-backup.service';

/** Nextcloud der Lehrkraft für Bilder – siehe docs/nextcloud.md. */
@Controller('nextcloud')
@UseGuards(JwtAuthGuard)
export class NextcloudController {
  constructor(
    private readonly nextcloud: NextcloudService,
    private readonly backup: NextcloudBackupService,
  ) {}

  @Get()
  async status(@Request() req: any) {
    return this.nextcloud.status(req.user);
  }

  /** `{ baseUrl, username, password?, folder? }` – speichert und prüft gleich. */
  @Post()
  async connect(@Request() req: any, @Body() body: any) {
    return this.nextcloud.connect(req.user, body || {});
  }

  @Post('verify')
  async verify(@Request() req: any) {
    return this.nextcloud.verify(req.user);
  }

  @Delete()
  async disconnect(@Request() req: any) {
    return this.nextcloud.disconnect(req.user);
  }

  /** Bild hochladen (Feld `file`, dazu `topicId`) – liefert die Lese-URL. */
  @Post('images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES + 1024 } }))
  async upload(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.nextcloud.uploadImage(req.user, req.body?.topicId || undefined, file);
  }

  /** `{ enabled?, hour? }` – tägliches Backup der eigenen Inhalte nach <Hauptordner>/Backups. */
  @Post('backup')
  async saveBackup(@Request() req: any, @Body() body: any) {
    return this.backup.saveSettings(req.user, body || {});
  }

  @Post('backup/run')
  async runBackup(@Request() req: any) {
    return this.backup.run(req.user);
  }

  /** Eigene Themen, die noch Bilder in der Datenbank haben. */
  @Get('migrate')
  async migrationPlan(@Request() req: any) {
    return this.nextcloud.migrationPlan(req.user);
  }

  /** `{ topicId }` – Bilder dieses Themas in die Nextcloud auslagern. */
  @Post('migrate')
  async migrate(@Request() req: any, @Body() body: any) {
    return this.nextcloud.migrateTopic(req.user, String(body?.topicId || ''));
  }

  @Get('images')
  async list(@Request() req: any, @Query('folder') folder?: string, @Query('topicId') topicId?: string) {
    return this.nextcloud.listImages(req.user, { folder, topicId });
  }
}
