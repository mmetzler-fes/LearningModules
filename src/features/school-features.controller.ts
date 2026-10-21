import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeaturesService } from './features.service';

/** Schuladmin: Funktionen in Entwicklung für Lehrkräfte der eigenen Schule freischalten. */
@Controller('my-school/features')
@UseGuards(JwtAuthGuard)
export class SchoolFeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get()
  overview(@Request() req: any) {
    return this.features.schoolOverview(req.user);
  }

  /** { feature, enabled } für eine Lehrkraft der eigenen Schule */
  @Post('users/:id')
  setForUser(@Request() req: any, @Param('id') id: string, @Body() body: { feature?: string; enabled?: boolean }) {
    return this.features.setForSchoolTeacher(req.user, id, String(body?.feature || ''), !!body?.enabled);
  }
}
