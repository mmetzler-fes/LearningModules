import { Controller, Get, Post, Delete, Body, Query, Param, UseGuards, Request, Res, UploadedFile, UseInterceptors, ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import { baseUrl } from '../core/share/link-url';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NextcloudService, MAX_IMAGE_BYTES, SERVER_SCOPE } from './nextcloud.service';
import { NextcloudBackupService } from './nextcloud-backup.service';
import { SchoolNextcloudService } from './school-nextcloud.service';

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

  /** Bilder in der App: belegt, Hinweis ab, Grenze – für den Hinweis beim Einfügen. */
  @Get('quota')
  async quota(@Request() req: any) {
    return this.nextcloud.quota(req.user);
  }

  /** Admin: Grenzen für Bilder in der App (MB, 0 = keine). */
  @Get('quota-settings')
  async quotaSettings(@Request() req: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Nur Admins haben Zugriff.');
    return this.nextcloud.quotaSettings();
  }

  @Post('quota-settings')
  async saveQuotaSettings(@Request() req: any, @Body() body: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Nur Admins haben Zugriff.');
    return this.nextcloud.saveQuotaSettings(body || {});
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

  /** `?force=1`: auch trennen, wenn noch Bilder aus der Freigabe in Modulen stecken. */
  @Delete()
  async disconnect(@Request() req: any, @Query('force') force?: string) {
    return this.nextcloud.disconnect(req.user, force === '1');
  }

  /** Was an der Freigabe hängt – vor dem Trennen. */
  @Get('usage')
  async usage(@Request() req: any) {
    return this.nextcloud.usage(req.user);
  }

  /** Eigene Freigabe trennen, Bilder dabei in die Nextcloud der Schule übernehmen. */
  @Post('hand-over')
  async handOver(@Request() req: any) {
    return this.nextcloud.handOverToSchool(req.user);
  }

  /** `{ items: [{ sub, name, dataUrl }] }` – Bilder zurück in die App (im Browser verkleinert). */
  @Post('return')
  async returnImages(@Request() req: any, @Body() body: any) {
    return this.nextcloud.returnImages(req.user, body?.items || []);
  }

  /** `{ shareUrl, password }` – in eine andere Freigabe umziehen (Bilder werden mitkopiert). */
  @Post('move')
  async move(@Request() req: any, @Body() body: any) {
    return this.nextcloud.startMove(req.user, body || {}, baseUrl(req));
  }

  /** Bild hochladen (Feld `file`, dazu `topicId` – oder `folder`, `name`, `replace`) – liefert den Link. */
  @Post('images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES + 1024 } }))
  async upload(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    const b = req.body || {};
    return this.nextcloud.uploadImage(req.user, b.topicId || undefined, file, {
      folder: b.folder || undefined, name: b.name || undefined, replace: b.replace === 'true',
    });
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

/**
 * Bilder für Schüler – ohne Anmeldung, die haben Schüler nicht. Der Server
 * holt das Bild mit dem Passwort der Freigabe und reicht es durch; er
 * speichert es nicht. Nur Bilder unter Bilder/… (siehe readImage).
 * /files: Freigabe der Lehrkraft, /sch: Nextcloud der Schule,
 * /school: alte Bilder im früheren Ordner des Admin-Backups.
 */
@Controller('nextcloud')
export class NextcloudFilesController {
  constructor(private readonly nextcloud: NextcloudService) {}

  @Get('files/:link/:folder/:name')
  async own(@Param('link') link: string, @Param('folder') folder: string, @Param('name') name: string, @Res() res: Response) {
    return this.send(res, await this.nextcloud.readImage(link, folder, name, false).catch(() => null));
  }

  /** Nextcloud einer Schule: Bilder/<Lehrkraft>/<Ordner>/<Datei>. */
  @Get('sch/:school/:teacher/:folder/:name')
  async schoolShare(@Param('school') school: string, @Param('teacher') teacher: string, @Param('folder') folder: string, @Param('name') name: string, @Res() res: Response) {
    return this.send(res, await this.nextcloud.readSchoolImage(school, teacher, folder, name).catch(() => null));
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

/**
 * Eine Nextcloud für die Bilder vieler Lehrkräfte (school_nextcloud): die der
 * Schule oder die des Servers. Die Unterklasse sagt, welche – und wer darf.
 */
abstract class SharedNextcloudController {
  constructor(protected readonly school: SchoolNextcloudService) {}

  protected abstract scope(req: any): string;

  @Get()
  async status(@Request() req: any) {
    return this.school.status(this.scope(req));
  }

  /** `{ shareUrl, password? }` – speichert und prüft gleich. */
  @Post()
  async connect(@Request() req: any, @Body() body: any) {
    return this.school.connect(this.scope(req), body || {}, baseUrl(req));
  }

  /** `?force=1`: auch trennen, wenn noch Bilder daraus in Modulen stecken. */
  @Delete()
  async disconnect(@Request() req: any, @Query('force') force?: string) {
    return this.school.disconnect(this.scope(req), force === '1');
  }

  @Get('folders')
  async folders(@Request() req: any) {
    return this.school.folders(this.scope(req));
  }

  @Delete('folders/:folder')
  async removeFolder(@Request() req: any, @Param('folder') folder: string) {
    return this.school.removeFolder(this.scope(req), folder);
  }

  /** `{ shareUrl, password }` – umziehen, Bilder werden mitkopiert. */
  @Post('move')
  async move(@Request() req: any, @Body() body: any) {
    return this.school.startMove(this.scope(req), body || {}, baseUrl(req));
  }
}

/** Nextcloud der Schule – nur für Schuladmins (docs/nextcloud.md). */
@Controller('my-school/nextcloud')
@UseGuards(JwtAuthGuard)
export class SchoolNextcloudController extends SharedNextcloudController {
  constructor(school: SchoolNextcloudService) { super(school); }

  protected scope(req: any) {
    return this.school.schoolOf(req.user);
  }
}

/** Nextcloud des Servers für Lehrkräfte, deren Schule keine hat – nur für Admins. */
@Controller('server-nextcloud')
@UseGuards(JwtAuthGuard)
export class ServerNextcloudController extends SharedNextcloudController {
  constructor(school: SchoolNextcloudService) { super(school); }

  protected scope(req: any) {
    if (req.user?.role !== 'admin') throw new ForbiddenException('Nur Admins haben Zugriff.');
    return SERVER_SCOPE;
  }
}
