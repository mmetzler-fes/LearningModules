import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request, UseGuards, HttpCode } from '@nestjs/common';
import { ExamService } from './exam.service';
import { LiveService } from './live.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkService } from './work.service';
import { TeacherInkService } from './teacher-ink.service';
import type { WorkAccess } from './work.service';

/** Beschriftung der Lehrkraft auf ihrem Dokument (Stift-Editor, .xopp-Import). */
@Controller('teacher-ink')
@UseGuards(JwtAuthGuard)
export class TeacherInkController {
  constructor(private readonly ink: TeacherInkService) {}

  /** → `{ data | null, visibility: 'teacher' | 'all', own }` */
  @Get(':moduleId')
  get(@Request() req: any, @Param('moduleId') moduleId: string) {
    return this.ink.get(req.user, moduleId);
  }

  /** `{ data?, visibility? }` */
  @Put(':moduleId')
  put(@Request() req: any, @Param('moduleId') moduleId: string, @Body() body: any) {
    return this.ink.put(req.user, moduleId, body);
  }
}

/** Schüler über ihren Klassenlink – ohne Anmeldung, mit Schülerausweis (und PIN). */
@Controller('public/work')
export class PublicWorkController {
  constructor(private readonly work: WorkService) {}

  /** `{ linkToken, studentTicket, moduleId, pin? }` → `{ data | null }`; ohne PIN: 403 mit `needPin`. */
  @Post('load')
  @HttpCode(200)
  load(@Body() body: WorkAccess) {
    return this.work.load(body);
  }

  /** Wie load, dazu `data` (Stand des Stift-Editors) → `{ success, pin? }`. */
  @Post('save')
  @HttpCode(200)
  save(@Body() body: WorkAccess & { data?: any }) {
    return this.work.save(body);
  }
}

/** Die Lehrkraft sieht die Bearbeitungen ihrer Schüler. */
@Controller('work')
@UseGuards(JwtAuthGuard)
export class WorkController {
  constructor(private readonly work: WorkService) {}

  @Get()
  list(@Request() req: any, @Query('linkId') linkId?: string, @Query('moduleId') moduleId?: string, @Query('classId') classId?: string) {
    return this.work.list(req.user, { linkId, moduleId, classId });
  }

  @Get(':id')
  get(@Request() req: any, @Param('id') id: string) {
    return this.work.getWithVersion(req.user, id);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.work.remove(req.user, id);
  }
}

/** Zwischenstand einer Klassenarbeit (Schüler, mit Schülerausweis). */
@Controller('public/exam')
export class PublicExamController {
  constructor(private readonly exams: ExamService) {}

  /** `{ linkToken, studentTicket, progress: { steps, index, answers, embeddedAnswers } }` */
  @Post('progress')
  @HttpCode(200)
  progress(@Body() body: any) {
    return this.exams.saveProgress(body);
  }
}

/** Klassenarbeiten der eigenen Links: wer begonnen, wer abgegeben hat; Wiedereinstieg freigeben. */
@Controller('exams')
@UseGuards(JwtAuthGuard)
export class ExamController {
  constructor(private readonly exams: ExamService) {}

  @Get()
  list(@Request() req: any, @Query('classId') classId?: string, @Query('linkId') linkId?: string) {
    return this.exams.list(req.user, { classId, linkId });
  }

  /** `{ allow: true | false }` */
  @Post(':id/reentry')
  reentry(@Request() req: any, @Param('id') id: string, @Body() body: { allow?: boolean }) {
    return this.exams.setReentry(req.user, id, body?.allow !== false);
  }
}

/** Fortschritt im Durchlauf (Schüler über einen Klassenlink). */
@Controller('public/run')
export class PublicRunController {
  constructor(private readonly live: LiveService) {}

  @Post('progress')
  @HttpCode(200)
  progress(@Body() body: any) {
    return this.live.report(body);
  }
}

/** Live-Ansicht einer Klasse. */
@Controller('live')
@UseGuards(JwtAuthGuard)
export class LiveController {
  constructor(private readonly live: LiveService) {}

  @Get('class/:id')
  ofClass(@Request() req: any, @Param('id') id: string) {
    return this.live.ofClass(req.user, id);
  }
}
