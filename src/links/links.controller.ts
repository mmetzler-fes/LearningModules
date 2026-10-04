import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { LinksService } from './links.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Themen-Links: benannte Zugänge für Schüler, die Themen/Module bündeln und
 * den Abfragemodus festlegen.
 */
@Controller('links')
@UseGuards(JwtAuthGuard)
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Get()
  async findAll(@Request() req: any) {
    return this.linksService.findAll(req.user, req);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.linksService.findOne(id, req.user, req);
  }

  @Post()
  async create(@Request() req: any, @Body() body: any) {
    return this.linksService.create(req.user, body, req);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    return this.linksService.update(id, req.user, body, req);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.linksService.remove(id, req.user);
  }

  /**
   * Link zum Versenden abrufen (URL + QR); `{regenerate:true}` erneuert ihn.
   * `{access:'exam'}` liefert den eigenen Link der Klassenarbeit.
   */
  @Post(':id/share')
  async share(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { regenerate?: boolean; access?: string },
  ) {
    return this.linksService.share(id, req.user, !!body?.regenerate, req, body?.access === 'exam' ? 'exam' : 'practice');
  }

  /** Quiz-Arena: Leitungs- und Schüler-Link; `{regenerate:true}` erneuert den Leitungs-Link. */
  @Post(':id/contest-share')
  async contestShare(@Param('id') id: string, @Request() req: any, @Body() body: { regenerate?: boolean }) {
    return this.linksService.contestShare(id, req.user, !!body?.regenerate, req);
  }

  /** Token entwerten – verteilte Links und QR-Codes wirken nicht mehr. */
  @Delete(':id/share')
  async revoke(@Param('id') id: string, @Request() req: any, @Query('access') access?: string) {
    return this.linksService.revoke(id, req.user, access === 'exam' ? 'exam' : 'practice');
  }
}
