import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CategoriesService } from './categories.service';

@Controller('categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** Alle Kategorien, die ich sehe (wählbare und zugeordnete). */
  @Get()
  async list(@Request() req: any) {
    return this.categories.listFor(req.user);
  }

  /** Admin: wie oft jede Kategorie zugeordnet ist. */
  @Get('usage')
  async usage(@Request() req: any) {
    return this.categories.usage(req.user);
  }

  /** `{ parentId, label }` – Lehrkraft: Vorschlag; Admin: sofort für alle (auch `{ facet, label }` ganz oben). */
  @Post()
  async propose(@Request() req: any, @Body() body: any) {
    return this.categories.propose(req.user, body);
  }

  /** Admin: `{ label?, status?: 'active' | 'hidden' }`. */
  @Patch(':id')
  async update(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    return this.categories.update(id, req.user, body);
  }

  /** Admin: `{ into }` – Zuordnungen wandern mit. */
  @Post(':id/merge')
  async merge(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    return this.categories.merge(id, req.user, body?.into);
  }

  /** Vorschlag ablehnen / eigenen zurückziehen; Zuordnungen gehen an den Oberbegriff. */
  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.categories.remove(id, req.user);
  }

  /** Alle eigenen Lernthemen in einem Notebook-Knoten: `{ categoryIds, mode: 'add' | 'remove' }`. */
  @Post('nodes/:nodeId')
  async applyToNode(@Param('nodeId') nodeId: string, @Request() req: any, @Body() body: any) {
    return this.categories.applyToNode(nodeId, req.user, body);
  }
}
