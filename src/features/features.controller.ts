import { Body, Controller, ForbiddenException, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeaturesService } from './features.service';

/** Freischalten von Funktionen in Entwicklung – nur der Admin. */
@Controller('admin/features')
@UseGuards(JwtAuthGuard)
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  private requireAdmin(req: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Nur Admins haben Zugriff.');
  }

  @Get()
  overview(@Request() req: any) {
    this.requireAdmin(req);
    return this.features.overview();
  }

  /** { feature, mode: 'off' | 'selected' | 'all' } */
  @Post('mode')
  setMode(@Request() req: any, @Body() body: { feature?: string; mode?: string }) {
    this.requireAdmin(req);
    return this.features.setMode(String(body?.feature || ''), String(body?.mode || ''));
  }

  /** { feature, enabled } für ein Konto */
  @Post('users/:id')
  setForUser(@Request() req: any, @Param('id') id: string, @Body() body: { feature?: string; enabled?: boolean }) {
    this.requireAdmin(req);
    return this.features.setForUser(id, String(body?.feature || ''), !!body?.enabled);
  }
}
