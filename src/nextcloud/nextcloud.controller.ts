import { Controller, Get, Post, Delete, Body, Query, Param, UseGuards, Request, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { baseUrl } from '../core/share/link-url';
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

  /** `{ shareUrl, password?, readShareUrl? }` – speichert und prüft gleich. */
  @Post()
  async connect(@Request() req: any, @Body() body: any) {
    return this.nextcloud.connect(req.user, body || {}, baseUrl(req));
  }

  @Post('verify')
  async verify(@Request() req: any) {
    return this.nextcloud.verify(req.user, baseUrl(req));
  }

  @Delete()
  async disconnect(@Request() req: any) {
    return this.nextcloud.disconnect(req.user);
  }

  /** Bild hochladen (Feld `file`, dazu `topicId`) – liefert die Lese-URL. */
  @Post('images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES + 1024 } }))
  async upload(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.nextcloud.uploadImage(req.user, req.body?.topicId || undefined, file, baseUrl(req));
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
    return this.nextcloud.migrateTopic(req.user, String(body?.topicId || ''), baseUrl(req));
  }

  @Get('images')
  async list(@Request() req: any, @Query('folder') folder?: string, @Query('topicId') topicId?: string) {
    return this.nextcloud.listImages(req.user, { folder, topicId }, baseUrl(req));
  }
}

/**
 * Bilder für Schüler – ohne Anmeldung, die haben Schüler nicht. Der Server
 * holt das Bild mit dem Passwort der Freigabe und reicht es durch; er
 * speichert es nicht. Nur Bilder unter Bilder/… (siehe readImage).
 * /files: eigene Freigabe der Lehrkraft, /school: Ordner der Schule.
 */
@Controller('nextcloud')
export class NextcloudFilesController {
  constructor(private readonly nextcloud: NextcloudService) {}

  @Get('files/:link/:folder/:name')
  async own(@Param('link') link: string, @Param('folder') folder: string, @Param('name') name: string, @Res() res: Response) {
    return this.send(res, await this.nextcloud.readImage(link, folder, name, false).catch(() => null));
  }

  @Get('school/:link/:folder/:name')
  async school(@Param('link') link: string, @Param('folder') folder: string, @Param('name') name: string, @Res() res: Response) {
    return this.send(res, await this.nextcloud.readImage(link, folder, name, true).catch(() => null));
  }

  private send(res: Response, file: { type: string; data: Buffer } | null) {
    if (!file) { res.status(404).send('Bild nicht gefunden'); return; }
    res.setHeader('Content-Type', file.type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Ein SVG direkt aufgerufen darf auf dieser Seite kein Skript ausführen.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.send(file.data);
  }
}
