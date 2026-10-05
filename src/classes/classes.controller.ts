import { Controller, Get, Post, Patch, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ClassesService } from './classes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/** Klassen und Schülerlisten der Lehrkraft, dazu das aktuelle Schuljahr. */
@Controller('classes')
@UseGuards(JwtAuthGuard)
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  /** Aktuelles Schuljahr und die Schuljahre, in denen es eigene Klassen gibt. */
  @Get('school-year')
  async schoolYear(@Request() req: any) {
    return this.classesService.schoolYearInfo(req.user);
  }

  /** Nur Admin: aktuelles Schuljahr setzen (`{ schoolYear: 'SJ26-27' }`). */
  @Put('school-year')
  async setSchoolYear(@Request() req: any, @Body() body: { schoolYear?: string }) {
    return this.classesService.setSchoolYear(req.user, body?.schoolYear);
  }

  /** Löschregel: Was von mir wird wann gelöscht? */
  @Get('retention')
  async retention(@Request() req: any) {
    return this.classesService.retentionInfo(req.user);
  }

  /** Offene Angebote geteilter Klassen an mich. */
  @Get('shares/incoming')
  async incomingShares(@Request() req: any) {
    return this.classesService.incomingShares(req.user);
  }

  @Post('shares/:shareId/accept')
  async acceptShare(@Param('shareId') shareId: string, @Request() req: any) {
    return this.classesService.acceptShare(shareId, req.user);
  }

  @Post('shares/:shareId/decline')
  async declineShare(@Param('shareId') shareId: string, @Request() req: any) {
    return this.classesService.declineShare(shareId, req.user);
  }

  /** Schuljahreswechsel: Klassen des Vorjahres, über die noch nicht entschieden ist. */
  @Get('rollover')
  async rolloverInfo(@Request() req: any) {
    return this.classesService.rolloverInfo(req.user);
  }

  /** Schuljahreswechsel: `{ items: [{ classId, take, name, moveLinks }] }`. */
  @Post('rollover')
  async rollover(@Request() req: any, @Body() body: any) {
    return this.classesService.rollover(req.user, body);
  }

  /** Mehrere Klassen einlesen (Export des SchülerLernTools); `{ dryRun: true }` liefert die Vorschau. */
  @Post('import')
  async importClasses(@Request() req: any, @Body() body: any) {
    return this.classesService.importClasses(req.user, body);
  }

  @Get()
  async findAll(@Request() req: any, @Query('year') year?: string) {
    return this.classesService.findAll(req.user, year);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.classesService.findOne(id, req.user);
  }

  @Post()
  async create(@Request() req: any, @Body() body: { name?: string; schoolYear?: string }) {
    return this.classesService.create(req.user, body);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Request() req: any, @Body() body: { name?: string; strict?: boolean }) {
    return this.classesService.update(id, req.user, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.classesService.remove(id, req.user);
  }

  /** Klasse anbieten: `{ userIds }` – Kolleginnen und Kollegen der eigenen Schule. */
  @Post(':id/share')
  async shareClass(@Param('id') id: string, @Request() req: any, @Body() body: { userIds?: string[] }) {
    return this.classesService.shareClass(id, req.user, body);
  }

  @Get(':id/shares')
  async sharesOfClass(@Param('id') id: string, @Request() req: any) {
    return this.classesService.sharesOfClass(id, req.user);
  }

  @Post(':id/students')
  async addStudent(@Param('id') id: string, @Request() req: any, @Body() body: { firstName?: string; lastName?: string }) {
    return this.classesService.addStudent(id, req.user, body);
  }

  /** Schülerliste einlesen; `{ dryRun: true }` liefert nur die Vorschau. */
  @Post(':id/import')
  async importStudents(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    return this.classesService.importStudents(id, req.user, body);
  }

  @Patch(':id/students/:studentId')
  async updateStudent(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Request() req: any,
    @Body() body: { firstName?: string; lastName?: string; confirm?: boolean },
  ) {
    return this.classesService.updateStudent(id, studentId, req.user, body);
  }

  /** Unbestätigten Eintrag mit einem Schüler zusammenführen (`{ targetId }`). */
  @Post(':id/students/:studentId/merge')
  async mergeStudent(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Request() req: any,
    @Body() body: { targetId?: string },
  ) {
    return this.classesService.mergeStudent(id, studentId, req.user, String(body?.targetId || ''));
  }

  @Delete(':id/students/:studentId')
  async removeStudent(@Param('id') id: string, @Param('studentId') studentId: string, @Request() req: any) {
    return this.classesService.removeStudent(id, studentId, req.user);
  }
}
