import { Controller, Get, Post, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ContentHandoverService } from './content-handover.service';

/** Inhalte an eine andere Lehrkraft übergeben (docs/uebergabe.md). */
@Controller('handovers')
@UseGuards(JwtAuthGuard)
export class ContentHandoverController {
  constructor(private readonly handovers: ContentHandoverService) {}

  @Get()
  async mine(@Request() req: any) {
    return this.handovers.mine(req.user);
  }

  /** `{ email, withCreator, note }` */
  @Post()
  async request(@Request() req: any, @Body() body: any) {
    return this.handovers.request(req.user, body);
  }

  @Post(':id/accept')
  async accept(@Param('id') id: string, @Request() req: any) {
    return this.handovers.accept(id, req.user);
  }

  @Post(':id/decline')
  async decline(@Param('id') id: string, @Request() req: any) {
    return this.handovers.decline(id, req.user);
  }

  /** Eigene Anfrage zurückziehen. */
  @Delete(':id')
  async withdraw(@Param('id') id: string, @Request() req: any) {
    return this.handovers.withdraw(id, req.user);
  }
}
