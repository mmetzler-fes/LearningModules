import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { baseUrl } from '../core/share/link-url';
import { ShortLinksService } from './short-links.service';

/** Kurzlinks der angemeldeten Lehrkraft; die Weiterleitung `/k/<code>` steht in short-link-redirect.ts. */
@Controller('short-links')
@UseGuards(JwtAuthGuard)
export class ShortLinksController {
  constructor(private readonly links: ShortLinksService) {}

  @Get()
  list(@Request() req: any) {
    return this.links.list(req.user.userId, baseUrl(req));
  }

  @Post()
  create(@Request() req: any, @Body() body: { url?: string; title?: string }) {
    return this.links.create(req.user.userId, body, baseUrl(req));
  }

  @Get(':id/qr')
  qr(@Request() req: any, @Param('id') id: string) {
    return this.links.qr(req.user.userId, id, baseUrl(req));
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() body: { url?: string; title?: string }) {
    return this.links.update(req.user.userId, id, body, baseUrl(req));
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.links.remove(req.user.userId, id);
  }
}
