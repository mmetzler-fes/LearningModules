import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DocMigrationService } from './doc-migration.service';

/** Umwandlung alter Module „Text / Arbeitsblatt“ in Dokumente – nur der Admin. */
@Controller('admin/doc-migration')
@UseGuards(JwtAuthGuard)
export class DocMigrationController {
  constructor(private readonly migration: DocMigrationService) {}

  private requireAdmin(req: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Nur Admins haben Zugriff.');
  }

  @Get()
  overview(@Request() req: any) {
    this.requireAdmin(req);
    return this.migration.overview();
  }

  /** Alte Module seitenweise (?offset=0) mit ihrem HTML – umgewandelt wird im Browser. */
  @Get('modules')
  page(@Request() req: any, @Query('offset') offset?: string) {
    this.requireAdmin(req);
    return this.migration.page(Number(offset) || 0);
  }

  /** { items: [{ id, spec }] } speichern; das alte HTML bleibt als legacyHtml. */
  @Post('apply')
  @HttpCode(200)
  apply(@Request() req: any, @Body() body: { items?: Array<{ id?: string; spec?: unknown }> }) {
    this.requireAdmin(req);
    return this.migration.apply(body?.items || []);
  }

  @Post('rollback')
  @HttpCode(200)
  rollback(@Request() req: any) {
    this.requireAdmin(req);
    return this.migration.rollback();
  }
}
