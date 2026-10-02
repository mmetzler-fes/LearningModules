import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShopService } from '../shop/shop.service';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly shop: ShopService,
  ) {}

  /**
   * Der Hauptadmin pflegt alle Gruppen, ein Schuladmin nur die seiner Schule.
   * Schulübergreifende Gruppen bleiben beim Hauptadmin.
   */
  private async requireManage(req: any, groupId?: string) {
    const user = req.user;
    if (user.role === 'admin') return;
    if (!user.isSchoolAdmin || !user.schoolId) throw new ForbiddenException('Gruppen pflegt der Admin.');
    if (groupId) {
      const group = await this.groups.findOne(groupId);
      if (group.schoolId !== user.schoolId) throw new ForbiddenException('Diese Gruppe gehört nicht zu eurer Schule.');
    }
  }

  /**
   * Lesen darf jede Lehrkraft – der Freigabe-Dialog braucht die Namen zur
   * Auswahl. Die Mitgliederlisten sind dabei kein Geheimnis: Wer an eine
   * Fachschaft freigibt, soll sehen, wen er damit erreicht.
   */
  @Get()
  async findAll(@Request() req: any) {
    return this.groups.findAll(req.user);
  }

  @Post()
  async create(
    @Request() req: any,
    @Body() body: { name: string; description?: string; memberIds?: string[]; schoolId?: string | null },
  ) {
    await this.requireManage(req);
    // Ein Schuladmin legt immer für die eigene Schule an.
    const schoolId = req.user.role === 'admin' ? body?.schoolId || null : req.user.schoolId;
    return this.groups.create(body?.name, body?.description, body?.memberIds, schoolId);
  }

  @Patch(':id')
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; memberIds?: string[]; schoolId?: string | null },
  ) {
    await this.requireManage(req, id);
    const { schoolId, ...rest } = body || {};
    return this.groups.update(id, req.user.role === 'admin' ? { ...rest, schoolId } : rest);
  }

  /**
   * Löschen räumt zugleich die Shop-Angebote auf, die auf die Gruppe zeigen.
   * Ein toter Verweis wäre in der Zugriffsprüfung zwar folgenlos – niemand
   * ist Mitglied einer gelöschten Gruppe –, stünde aber für immer als
   * unerklärlicher Eintrag in den Listen der Kolleginnen.
   */
  @Delete(':id')
  async remove(@Request() req: any, @Param('id') id: string) {
    await this.requireManage(req, id);
    const cleaned = await this.shop.dropGroupFromAudiences(id);
    await this.groups.remove(id);
    return { success: true, sharingEntriesRemoved: cleaned };
  }
}
