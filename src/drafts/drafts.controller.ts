import { Controller, Get, Put, Delete, Param, Query, Body, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DraftsService } from './drafts.service';

/** Entwürfe des Modul-Editors – nur für die eigene Lehrkraft. */
@Controller('drafts')
@UseGuards(JwtAuthGuard)
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  /** Liste ohne Inhalt; `?topicId=` schränkt auf ein Lernthema ein. */
  @Get()
  list(@Request() req: any, @Query('topicId') topicId?: string) {
    return this.drafts.list(req.user, topicId);
  }

  @Get(':key')
  get(@Request() req: any, @Param('key') key: string) {
    return this.drafts.get(req.user, key);
  }

  /** `{ topicId, moduleId, data: { title, type, description, content, tagIds } }` */
  @Put(':key')
  save(@Request() req: any, @Param('key') key: string, @Body() body: any) {
    return this.drafts.save(req.user, key, body);
  }

  @Delete(':key')
  remove(@Request() req: any, @Param('key') key: string) {
    return this.drafts.remove(req.user, key);
  }
}
