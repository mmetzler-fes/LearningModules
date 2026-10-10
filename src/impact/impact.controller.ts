import { Controller, Get, Post, Param, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ImpactService } from './impact.service';

@Controller('impact')
@UseGuards(JwtAuthGuard)
export class ImpactController {
  constructor(private readonly impact: ImpactService) {}

  /** Meine Wirkung: Lernthemen, Zahlen, Rückmeldungen, Geben und Nehmen. */
  @Get('mine')
  async mine(@Request() req: any) {
    return this.impact.mine(req.user);
  }

  /** Was ein Creator teilt und wen es erreicht (ohne Namen). */
  @Get('creators/:id')
  async creator(@Param('id') id: string) {
    return this.impact.creatorSummary(id);
  }

  /** Eigene Rückmeldung zu einem genutzten oder kopierten Lernthema. */
  @Get('feedback/:topicId')
  async getFeedback(@Param('topicId') topicId: string, @Request() req: any) {
    return this.impact.getFeedback(topicId, req.user);
  }

  /** `{ stars, thanks, comment }`; alles leer löscht sie. */
  @Post('feedback/:topicId')
  async saveFeedback(@Param('topicId') topicId: string, @Request() req: any, @Body() body: any) {
    return this.impact.saveFeedback(topicId, req.user, body);
  }
}
