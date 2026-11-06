import { Controller, Get, Post, Patch, Delete, Body, Param, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlansService } from './plans.service';

/** Planungsebene: Ordner, Pläne, Teilpläne und Verweise auf Lernthemen (docs/planung.md). */
@Controller('plans')
@UseGuards(JwtAuthGuard)
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  tree(@Request() req: any) {
    return this.plans.tree(req.user);
  }

  /** Plan ausgerollt, wie eine Klasse ihn bekommt. */
  @Get(':id/expanded')
  expanded(@Param('id') id: string, @Request() req: any) {
    return this.plans.expanded(req.user, id);
  }

  /** `{ kind: 'folder'|'plan'|'area'|'section'|'include', title, parentId, refId?, index? }` */
  @Post('nodes')
  create(@Request() req: any, @Body() body: any) {
    return this.plans.createNode(req.user, body);
  }

  @Patch('nodes/:id')
  rename(@Param('id') id: string, @Request() req: any, @Body() body: { title?: string }) {
    return this.plans.renameNode(req.user, id, body?.title);
  }

  @Delete('nodes/:id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.plans.deleteNode(req.user, id);
  }

  /** `{ type: 'node'|'entry', id, parentId, index? }` */
  @Post('move')
  move(@Request() req: any, @Body() body: any) {
    return this.plans.move(req.user, body);
  }

  /** `{ parentId, index?, items: [{ type: 'topic'|'nbnode'|'plan', id }] }` */
  @Post('add')
  add(@Request() req: any, @Body() body: any) {
    return this.plans.add(req.user, body);
  }

  @Delete('entries/:id')
  removeEntry(@Param('id') id: string, @Request() req: any) {
    return this.plans.deleteEntry(req.user, id);
  }
}
