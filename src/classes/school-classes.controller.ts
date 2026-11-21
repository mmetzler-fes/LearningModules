import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SchoolClassesService } from './school-classes.service';

/** Schuladmin: 🎓 Klassen der Schule – einlesen, Autoregistrierung, Freigaben. */
@Controller('my-school/classes')
@UseGuards(JwtAuthGuard)
export class MySchoolClassesController {
  constructor(private readonly service: SchoolClassesService) {}

  @Get()
  list(@Request() req: any, @Query('year') year?: string) {
    return this.service.listForAdmin(req.user, year);
  }

  /** Anfragen, die auf die Freigabe warten – für den Hinweis nach der Anmeldung. */
  @Get('pending')
  async pending(@Request() req: any) {
    return { pending: await this.service.pendingCount(req.user) };
  }

  /** `{ rows: [{ className, lastName, firstName, loginId }], schoolYear?, autoRegister?, dryRun? }` */
  @Post('import')
  import(@Request() req: any, @Body() body: any) {
    return this.service.importForAdmin(req.user, body);
  }

  /** ⏭ Versetzen: `{ schoolYear, items: [{ id, action: 'promote' | 'delete' | 'keep', name? }] }` */
  @Post('promote')
  promote(@Request() req: any, @Body() body: any) {
    return this.service.promote(req.user, body);
  }

  /** `{ schoolYear?, autoRegister }` für alle Klassen des Schuljahres. */
  @Post('auto-register')
  autoRegisterAll(@Request() req: any, @Body() body: any) {
    return this.service.setAutoRegisterAll(req.user, body);
  }

  @Post('requests/:id/approve')
  approve(@Request() req: any, @Param('id') id: string) {
    return this.service.answerRequest(id, req.user, true);
  }

  @Post('requests/:id/decline')
  decline(@Request() req: any, @Param('id') id: string) {
    return this.service.answerRequest(id, req.user, false);
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.updateForAdmin(id, req.user, body);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.service.removeForAdmin(id, req.user);
  }

  @Delete(':id/students/:studentId')
  removeStudent(@Request() req: any, @Param('id') id: string, @Param('studentId') studentId: string) {
    return this.service.removeStudentForAdmin(id, studentId, req.user);
  }
}

/** Lehrkraft: Klassen der Schule übernehmen und die eigene Klasse darüber aktualisieren. */
@Controller('school-classes')
@UseGuards(JwtAuthGuard)
export class SchoolClassesController {
  constructor(private readonly service: SchoolClassesService) {}

  @Get()
  list(@Request() req: any, @Query('year') year?: string, @Query('classId') classId?: string) {
    return this.service.listForTeacher(req.user, year, classId);
  }

  /** `{ classId? }` – eigene Klasse verbinden, sonst neu anlegen. */
  @Post(':id/take')
  take(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.take(id, req.user, body || {});
  }

  /** Alle eigenen Klassen abgleichen: `{ schoolYear?, dryRun? }` */
  @Post('match-all')
  matchAll(@Request() req: any, @Body() body: any) {
    return this.service.matchAll(req.user, body || {});
  }

  /** 🔄 Alle aktualisieren aus Datei: `{ rows: [{ className, lastName, firstName, loginId }], schoolYear?, dryRun? }` */
  @Post('from-file')
  fromFile(@Request() req: any, @Body() body: any) {
    return this.service.updateFromFile(req.user, body || {});
  }

  @Get('link/:classId')
  link(@Request() req: any, @Param('classId') classId: string) {
    return this.service.linkOf(classId, req.user);
  }

  /** `{ dryRun? }` */
  @Post('sync/:classId')
  sync(@Request() req: any, @Param('classId') classId: string, @Body() body: any) {
    return this.service.syncClass(classId, req.user, body || {});
  }
}
