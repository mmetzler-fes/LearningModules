import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
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

  /** Link zum Versenden abrufen (URL + QR); `{regenerate:true}` erneuert ihn. */
  @Post(':id/share')
  async share(@Param('id') id: string, @Request() req: any, @Body() body: { regenerate?: boolean }) {
    return this.linksService.share(id, req.user, !!body?.regenerate, req);
  }

  /** Token entwerten – verteilte Links und QR-Codes wirken nicht mehr. */
  @Delete(':id/share')
  async revoke(@Param('id') id: string, @Request() req: any) {
    return this.linksService.revoke(id, req.user);
  }
}
