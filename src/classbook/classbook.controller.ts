import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Request, UseGuards, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClassbookService } from './classbook.service';

/** Klassennotizbuch der Lehrkraft (docs/klassennotizbuch.md). */
@Controller('classbook')
@UseGuards(JwtAuthGuard)
export class ClassbookController {
  constructor(private readonly classbook: ClassbookService) {}

  @Get(':classId')
  get(@Request() req: any, @Param('classId') classId: string) {
    return this.classbook.forTeacher(req.user, classId, req);
  }

  /** `{ open }` – Erstanmeldung bis Ende des Tages an bzw. aus. */
  @Post(':classId/first-login')
  @HttpCode(200)
  firstLogin(@Request() req: any, @Param('classId') classId: string, @Body() body: { open?: boolean }) {
    return this.classbook.setFirstLogin(req.user, classId, !!body?.open);
  }

  @Post(':classId/token')
  @HttpCode(200)
  renew(@Request() req: any, @Param('classId') classId: string) {
    return this.classbook.renewToken(req.user, classId, req);
  }

  /** `{ items: [{ type: 'topic'|'node', id }] }` – Bereich „Nur für Lehrer“. */
  @Put(':classId/teacher-items')
  teacherItems(@Request() req: any, @Param('classId') classId: string, @Body() body: { items?: unknown }) {
    return this.classbook.setTeacherItems(req.user, classId, body?.items);
  }

  /** `{ kind: 'area'|'section', title, parentId? }` – Bereich oder Abschnitt anlegen. */
  @Post(':classId/nodes')
  createNode(@Request() req: any, @Param('classId') classId: string, @Body() body: any) {
    return this.classbook.createNode(req.user, classId, body);
  }

  @Patch(':classId/nodes/:id')
  renameNode(@Request() req: any, @Param('classId') classId: string, @Param('id') id: string, @Body() body: { title?: string }) {
    return this.classbook.renameNode(req.user, classId, id, body?.title);
  }

  /** Inhalt rückt eine Ebene höher. */
  @Delete(':classId/nodes/:id')
  deleteNode(@Request() req: any, @Param('classId') classId: string, @Param('id') id: string) {
    return this.classbook.deleteNode(req.user, classId, id);
  }

  /** `{ type: 'node'|'entry', id, parentId, index? }` */
  @Post(':classId/move')
  @HttpCode(200)
  move(@Request() req: any, @Param('classId') classId: string, @Body() body: any) {
    return this.classbook.move(req.user, classId, body);
  }

  /** `{ title, nodeId? }` – klasseneigenes Lernthema. */
  @Post(':classId/topics')
  createTopic(@Request() req: any, @Param('classId') classId: string, @Body() body: any) {
    return this.classbook.createTopic(req.user, classId, body);
  }

  @Patch(':classId/entries/:linkId')
  renameEntry(@Request() req: any, @Param('classId') classId: string, @Param('linkId') linkId: string, @Body() body: { title?: string }) {
    return this.classbook.renameEntry(req.user, classId, linkId, body?.title);
  }

  /** Zuweisung entfernen; klasseneigenes Lernthema samt Modulen löschen. */
  @Delete(':classId/entries/:linkId')
  deleteEntry(@Request() req: any, @Param('classId') classId: string, @Param('linkId') linkId: string) {
    return this.classbook.deleteEntry(req.user, classId, linkId);
  }

  /** `{ type: 'topic'|'node', id, nodeId? }` – aus dem Notizbuch zuweisen. */
  @Post(':classId/assign')
  @HttpCode(200)
  assign(@Request() req: any, @Param('classId') classId: string, @Body() body: { type?: string; id?: string; nodeId?: string | null }) {
    return this.classbook.assign(req.user, classId, body, req);
  }

  /** `{ topicId, moduleId?, enabled }` – Lernthema oder Modul einer Zuweisung ein-/ausschalten. */
  @Put(':classId/links/:linkId/item')
  setItem(@Request() req: any, @Param('classId') classId: string, @Param('linkId') linkId: string, @Body() body: any) {
    return this.classbook.setItem(req.user, classId, linkId, body);
  }

  /** `{ linkIds, enabled }` – ganze Zuweisungen ein- oder ausschalten (Bereich, Abschnitt, alles). */
  @Put(':classId/links-enabled')
  setLinks(@Request() req: any, @Param('classId') classId: string, @Body() body: any) {
    return this.classbook.setLinks(req.user, classId, body);
  }

  /** 📍 `{ linkId, topicId, moduleId }` setzt den Merker, `{}` entfernt ihn. */
  @Put(':classId/marker')
  marker(@Request() req: any, @Param('classId') classId: string, @Body() body: any) {
    return this.classbook.setMarker(req.user, classId, body);
  }

  @Get(':classId/overview')
  overview(@Request() req: any, @Param('classId') classId: string) {
    return this.classbook.overview(req.user, classId);
  }
}

/** Schüler über den Klassenbuch-Link – Name und PIN, dann mit Ausweis. */
@Controller('public/classbook')
export class PublicClassbookController {
  constructor(private readonly classbook: ClassbookService) {}

  /** Klassencode aus der Schüler-App → `{ token }`. */
  @Get('code/:code')
  byCode(@Param('code') code: string) {
    return this.classbook.byCode(code);
  }

  @Get(':token')
  info(@Param('token') token: string) {
    return this.classbook.info(token);
  }

  /** `{ name, pin?, testPassword? }` → `{ ticket, name, pending, pin? }`; 403 mit `needPin`. */
  @Post(':token/login')
  @HttpCode(200)
  login(@Param('token') token: string, @Body() body: any) {
    return this.classbook.login(token, body);
  }

  /** `{ ticket }` → Zuweisungen, Ergebnisse, Blätter. */
  @Post(':token/home')
  @HttpCode(200)
  home(@Param('token') token: string, @Body() body: { ticket?: string }) {
    return this.classbook.home(token, body?.ticket);
  }

  /** `{ ticket }` → `{ arena: { linkId, name } | null }` – die Schülerseite fragt regelmäßig nach. */
  @Post(':token/arena')
  @HttpCode(200)
  arena(@Param('token') token: string, @Body() body: { ticket?: string }) {
    return this.classbook.arena(token, body?.ticket);
  }

  /** `{ ticket, linkId, exam? }` → `{ linkToken }` für den Start mit `classTicket` (Klassenarbeit: ihr eigener Link). */
  @Post(':token/enter')
  @HttpCode(200)
  enter(@Param('token') token: string, @Body() body: { ticket?: string; linkId?: string; exam?: boolean }) {
    return this.classbook.enter(token, body);
  }
}
