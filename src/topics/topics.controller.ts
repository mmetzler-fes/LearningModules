import { Controller, Get, Post, Body, Param, UseGuards, Request, Delete, Patch } from '@nestjs/common';
import { TopicsService } from './topics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('topics')
@UseGuards(JwtAuthGuard)
export class TopicsController {
  constructor(private readonly topicsService: TopicsService) {}

  @Get()
  async findAll(@Request() req: any) {
    return this.topicsService.findAll(req.user);
  }

  // Feste Pfade müssen vor @Get(':id') stehen, sonst matcht der Platzhalter
  // zuerst und "colleagues" landet als Themen-ID im findOne.
  /** Kolleginnen und Kollegen für die Auswahl im Freigabe-Dialog. */
  @Get('colleagues')
  async listColleagues(@Request() req: any) {
    return this.topicsService.listColleagues(req.user);
  }

  /** Themen, die mir jemand freigegeben hat. */
  /** Themen, die ich in eigenen Themen-Links verwenden darf (eigene + freigegebene). */
  @Get('usable')
  async findUsable(@Request() req: any) {
    return this.topicsService.findUsable(req.user);
  }

  @Get('shared-with-me')
  async sharedWithMe(@Request() req: any) {
    return this.topicsService.findSharedWithMe(req.user);
  }

  /**
   * Ein freigegebenes Thema nur zum Ansehen – auch dann, wenn es lediglich
   * zum Kopieren freigegeben wurde. Muss vor @Get(':id') stehen? Nein: der
   * Pfad ist zweiteilig und kollidiert deshalb nicht mit dem Platzhalter.
   */
  @Get(':id/shared-view')
  async sharedView(@Param('id') id: string, @Request() req: any) {
    return this.topicsService.findSharedForViewing(id, req.user);
  }

  /** Fremde Freigabe in der eigenen Liste ausblenden bzw. wieder einblenden. */
  @Post(':id/hidden')
  async setSharedHidden(@Param('id') id: string, @Request() req: any, @Body() body: { hidden?: boolean }) {
    return this.topicsService.setSharedHidden(id, req.user, body?.hidden !== false);
  }

  /**
   * Fremde Freigabe aus der eigenen Liste entfernen bzw. zurückholen.
   *
   * Bewusst kein DELETE auf :id – gelöscht wird hier nichts. Das Thema
   * gehört weiterhin dem Eigentümer; entfernt wird allein die eigene Sicht
   * darauf.
   */
  @Post(':id/removed')
  async setSharedRemoved(@Param('id') id: string, @Request() req: any, @Body() body: { removed?: boolean }) {
    return this.topicsService.setSharedRemoved(id, req.user, body?.removed !== false);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.topicsService.findOne(id, req.user);
  }

  @Get(':id/modules')
  async getModules(@Param('id') id: string, @Request() req: any) {
    const topic = await this.topicsService.findOne(id, req.user);
    return topic.modules || [];
  }

  // ---- Freigabe zum Kopieren ----

  /** Freigabe setzen: Liste von Benutzer-IDs oder ['*'] für alle. */
  @Post(':id/sharing')
  async setSharing(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { sharedWith?: string[]; sharedAccess?: Array<{ userId: string; level: string }> },
  ) {
    // Fehlt ein Feld, bleibt die jeweilige Freigabe unangetastet.
    return this.topicsService.setSharing(id, req.user, body?.sharedWith, body?.sharedAccess);
  }

  /** Eigene Kopie eines freigegebenen Themas anlegen. */
  @Post(':id/copy')
  async copyShared(@Param('id') id: string, @Request() req: any) {
    return this.topicsService.copySharedTopic(id, req.user);
  }

  // ---- Quick-Link für Schüler (Link + QR-Code) ----

  /**
   * Quick-Link abrufen bzw. beim ersten Mal erzeugen.
   *
   * Auch für Themen, die mir nur zur Nutzung freigegeben sind: Der Link
   * gehört der Lehrkraft, die ihn verteilt, und ihr werden die Ergebnisse
   * zugeordnet.
   */
  @Post(':id/quick-link')
  async createQuickLink(@Param('id') id: string, @Request() req: any, @Body() body: { regenerate?: boolean }) {
    return this.topicsService.getQuickLink(id, req.user, !!body?.regenerate, req);
  }

  /** Den eigenen Quick-Link entwerten – die der Kolleginnen bleiben gültig. */
  @Delete(':id/quick-link')
  async revokeQuickLink(@Param('id') id: string, @Request() req: any) {
    return this.topicsService.revokeQuickLink(id, req.user);
  }

  @Post()
  async create(@Request() req: any, @Body() topicData: any) {
    return this.topicsService.create(req.user, topicData);
  }

  @Post(':id/modules')
  async addModule(@Param('id') id: string, @Request() req: any, @Body() moduleData: any) {
    return this.topicsService.addModule(id, req.user, moduleData);
  }

  @Delete(':id')
  async removeTopic(@Param('id') id: string, @Request() req: any) {
    return this.topicsService.remove(id, req.user);
  }

  @Patch(':id')
  async updateTopic(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.topicsService.update(id, req.user, body);
  }

  @Delete(':id/modules/:moduleId')
  async removeModule(@Param('id') id: string, @Param('moduleId') moduleId: string, @Request() req: any) {
    return this.topicsService.removeModule(id, moduleId, req.user);
  }

  @Patch(':id/modules/:moduleId/toggle')
  async toggleModuleSelection(@Param('id') id: string, @Param('moduleId') moduleId: string, @Body() body: any, @Request() req: any) {
    return this.topicsService.toggleModule(id, moduleId, body.selected, req.user);
  }

  @Patch(':id/modules/bulk-toggle')
  async bulkToggleModules(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.topicsService.bulkToggleModules(id, body.moduleIds, body.selected, req.user);
  }

  /** Module in ein anderes Thema verschieben/kopieren oder im selben duplizieren. */
  @Post(':id/modules/transfer')
  async transferModules(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { targetTopicId: string; moduleIds: string[]; mode: 'move' | 'copy' },
  ) {
    return this.topicsService.transferModules(id, body?.targetTopicId, body?.moduleIds, body?.mode, req.user);
  }

  @Post(':id/modules/reorder')
  async reorderModules(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.topicsService.reorderModules(id, body.moduleIds, req.user);
  }
}
