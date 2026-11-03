import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Req, Request, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeatureGuard, RequireFeature } from '../features/feature.guard';
import { HtmlAppsService } from './html-apps.service';

/** Hochladen und Vorschau für Lehrkräfte. */
@Controller('html-apps')
@UseGuards(JwtAuthGuard, FeatureGuard)
@RequireFeature('htmlApps')
export class HtmlAppsController {
  constructor(private readonly apps: HtmlAppsService) {}

  /** `{ html }` – liefert `{ fileId, manifest, size, warnings }`. */
  @Post()
  upload(@Request() req: any, @Body() body: { html?: string }) {
    return this.apps.upload(req.user, body?.html);
  }

  /** `{ moduleId }` oder `{ fileId }` – öffnet die App, ohne dass etwas gespeichert wird. */
  @Post('preview')
  @HttpCode(200)
  preview(@Request() req: any, @Body() body: { moduleId?: string; fileId?: string }) {
    return this.apps.preview(req.user, req.headers, body);
  }
}

/** Die beiden Rahmen. Nur auf der App-Adresse erreichbar (htmlAppHostGuard). */
@Controller('html-app-frame')
export class HtmlAppFrameController {
  constructor(private readonly apps: HtmlAppsService) {}

  @Get(':kind')
  async frame(@Param('kind') kind: string, @Query('t') token: string, @Req() _req: any, @Res() res: Response) {
    if (kind !== 'shell' && kind !== 'app') throw new NotFoundException();
    const page = await this.apps.frame(kind, token);
    if (!page) throw new NotFoundException('Die Adresse ist abgelaufen. Bitte die Seite neu öffnen.');
    for (const [k, v] of Object.entries(page.headers)) res.setHeader(k, v);
    res.send(page.html);
  }
}
