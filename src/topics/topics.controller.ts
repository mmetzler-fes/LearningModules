import { Controller, Get, Post, Body, Param, UseGuards, Request, Delete, Patch, Query, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TopicsService } from './topics.service';
import { uploadToNextcloud, fileStamp } from '../core/share/nextcloud-upload';
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
  /** Kolleginnen und Kollegen für die Zielgruppe eines Shop-Angebots. */
  @Get('colleagues')
  async listColleagues(@Request() req: any) {
    return this.topicsService.listColleagues(req.user);
  }

  /** Audio Recorder: Nextcloud-Ablage mit einer kleinen Testdatei prüfen. */
  @Post('recording-test')
  async testRecordingTarget(@Request() req: any, @Body() body: { uploadUrl?: string; uploadPassword?: string }) {
    const text = `Verbindungstest von LernModule (${req.user.email || 'Lehrkraft'}) am ${new Date().toLocaleString('de-DE')}.\n` +
      'Diese Datei kann gelöscht werden.\n';
    await uploadToNextcloud(body?.uploadUrl || '', body?.uploadPassword, 'LernModule-Verbindungstest.txt', Buffer.from(text, 'utf8'), 'text/plain');
    return { success: true };
  }

  /**
   * Audio Recorder in der Vorschau: Die Lehrkraft gibt eine Probeaufnahme in
   * ihre eigene Ablage ab (Dateiname beginnt mit „Vorschau_“). Die Adresse
   * kommt aus dem Editor – wie beim Verbindungstest, denn das Modul ist evtl.
   * noch nicht gespeichert.
   */
  @Post('recording-preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async previewRecording(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { uploadUrl?: string; uploadPassword?: string; title?: string },
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Keine Aufnahme empfangen.');
    const ext = /mp4|m4a|aac/.test(file.mimetype) ? 'm4a' : /ogg/.test(file.mimetype) ? 'ogg' : /wav/.test(file.mimetype) ? 'wav' : 'webm';
    const stamp = fileStamp();
    const fileName = `Vorschau_${stamp}_${String(body?.title || 'Aufnahme').slice(0, 60)}.${ext}`;
    await uploadToNextcloud(body?.uploadUrl || '', body?.uploadPassword, fileName, file.buffer, file.mimetype);
    return { success: true, fileName };
  }

  /** Eine Lehrkraft (auch anderer Schulen) über ihre genaue E-Mail-Adresse finden. */
  @Get('colleagues/lookup')
  async lookupColleague(@Request() req: any, @Query('email') email: string) {
    return this.topicsService.lookupColleague(req.user, email);
  }

  /** Themen, die ich in eigenen Themen-Links verwenden darf (eigene + mit Nutzungsrecht). */
  @Get('usable')
  async findUsable(@Request() req: any) {
    return this.topicsService.findUsable(req.user);
  }

  /** Themen, auf die ich ein Nutzungsrecht aus dem Shop habe. */
  @Get('granted')
  async granted(@Request() req: any) {
    return this.topicsService.findGranted(req.user);
  }

  /** Ein Thema mit Nutzungsrecht nur zum Ansehen. */
  @Get(':id/shared-view')
  async sharedView(@Param('id') id: string, @Request() req: any) {
    return this.topicsService.findSharedForViewing(id, req.user);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.topicsService.findOne(id, req.user);
  }

  @Get(':id/modules')
  async getModules(@Param('id') id: string, @Request() req: any) {
    return this.topicsService.findModules(id, req.user);
  }

  // ---- Quick-Link für Schüler (Link + QR-Code) ----

  /**
   * Quick-Link abrufen bzw. beim ersten Mal erzeugen.
   *
   * Auch für Themen, auf die ich nur ein Nutzungsrecht habe: Der Link
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
