import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TopicsService } from '../topics/topics.service';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly topics: TopicsService,
  ) {}

  private requireAdmin(req: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Gruppen pflegt der Admin.');
  }

  /**
   * Lesen darf jede Lehrkraft – der Freigabe-Dialog braucht die Namen zur
   * Auswahl. Die Mitgliederlisten sind dabei kein Geheimnis: Wer an eine
   * Fachschaft freigibt, soll sehen, wen er damit erreicht.
   */
  @Get()
  async findAll() {
    return this.groups.findAll();
  }

  @Post()
  async create(@Request() req: any, @Body() body: { name: string; description?: string; memberIds?: string[] }) {
    this.requireAdmin(req);
    return this.groups.create(body?.name, body?.description, body?.memberIds);
  }

  @Patch(':id')
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; memberIds?: string[] },
  ) {
    this.requireAdmin(req);
    return this.groups.update(id, body || {});
  }

  /**
   * Löschen räumt zugleich die Freigaben auf, die auf die Gruppe zeigen.
   * Ein toter Verweis wäre in der Zugriffsprüfung zwar folgenlos – niemand
   * ist Mitglied einer gelöschten Gruppe –, stünde aber für immer als
   * unerklärlicher Eintrag in den Listen der Kolleginnen.
   */
  @Delete(':id')
  async remove(@Request() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    const cleaned = await this.topics.dropGroupFromSharing(id);
    await this.groups.remove(id);
    return { success: true, sharingEntriesRemoved: cleaned };
  }
}
