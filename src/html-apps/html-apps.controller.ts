import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Put, Query, Req, Request, Res, UseGuards } from '@nestjs/common';
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

/** Für den Admin: alle hochgeladenen Apps, ihr Quelltext und die Sperre im Shop je Fassung. */
@Controller('admin/html-apps')
@UseGuards(JwtAuthGuard)
export class HtmlAppsAdminController {
  constructor(private readonly apps: HtmlAppsService) {}

  private requireAdmin(req: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Nur Admins haben Zugriff.');
  }

  @Get()
  list(@Request() req: any) {
    this.requireAdmin(req);
    return this.apps.adminList();
  }

  @Get(':id/source')
  source(@Request() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    return this.apps.adminSource(id);
  }

  /** `{ blocked }` – gilt für genau diese Fassung. */
  @Put(':id/shop')
  shop(@Request() req: any, @Param('id') id: string, @Body() body: { blocked?: boolean }) {
    this.requireAdmin(req);
    return this.apps.setShopBlock(id, body?.blocked === true, req.user);
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
