import { Controller, Get, Put, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanionService } from './companion.service';

/** Lernbegleiter: eigene Ergänzungen, Vorgaben der Schule. */
@Controller('companion')
@UseGuards(JwtAuthGuard)
export class CompanionController {
  constructor(private readonly companion: CompanionService) {}

  @Get()
  async overview(@Request() req: any) {
    return this.companion.overview(req.user);
  }

  @Put('mine')
  async saveMine(@Request() req: any, @Body() body: any) {
    return this.companion.saveMine(req.user, body);
  }

  /** Nur Schuladmin: Vorgaben für alle Lehrkräfte der Schule. */
  @Put('school')
  async saveSchool(@Request() req: any, @Body() body: any) {
    return this.companion.saveSchool(req.user, body);
  }

  /** Nur Schuladmin: Ergänzungen der Lehrkräfte zum Übernehmen. */
  @Get('school/colleagues')
  async colleagues(@Request() req: any) {
    return this.companion.colleagues(req.user);
  }
}
