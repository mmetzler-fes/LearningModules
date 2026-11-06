import { Body, Controller, Get, HttpCode, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SicherungService } from './sicherung.service';

/** Sicherung in die Nextcloud: draußen geänderte .zlm übernehmen oder verwerfen (docs/nextcloud.md#sicherung). */
@Controller('nextcloud/sicherung')
@UseGuards(JwtAuthGuard)
export class SicherungController {
  constructor(private readonly sicherung: SicherungService) {}

  /** `{ files: [{ key, title, path, moduleId, topicId, changedAt }] }` */
  @Get('changed')
  changed(@Request() req: any) {
    return this.sicherung.changed(req.user);
  }

  /** `{ key }` – die Datei aus der Nextcloud wird zum Stand in der App. */
  @Post('take-over')
  @HttpCode(200)
  takeOver(@Request() req: any, @Body() body: { key?: string }) {
    return this.sicherung.takeOver(req.user, String(body?.key || ''));
  }

  /** `{ key }` – Datei nach _Gesichert, die App schreibt ihre Fassung. */
  @Post('discard')
  @HttpCode(200)
  discard(@Request() req: any, @Body() body: { key?: string }) {
    return this.sicherung.discard(req.user, String(body?.key || ''));
  }

  /** Ordner der Sicherung zum Wiederherstellen. */
  @Get('tree')
  tree(@Request() req: any) {
    return this.sicherung.tree(req.user);
  }

  /** `{ path: string[] }` – Ordner als neues Book „Aus der Nextcloud (Datum)“. */
  @Post('restore')
  @HttpCode(200)
  restore(@Request() req: any, @Body() body: { path?: string[] }) {
    return this.sicherung.restore(req.user, body?.path);
  }
}
