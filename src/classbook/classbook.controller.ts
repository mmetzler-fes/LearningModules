import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Request, Res, UseGuards, HttpCode } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClassbookService } from './classbook.service';
import { ClassBoardService } from './class-board.service';

/** Klassennotizbuch der Lehrkraft (docs/klassennotizbuch.md). */
@Controller('classbook')
@UseGuards(JwtAuthGuard)
export class ClassbookController {
  constructor(private readonly classbook: ClassbookService, private readonly boards: ClassBoardService) {}

  /** ✍️ Tafelbilder dieser Klasse (ohne Inhalt). */
  @Get(':classId/boards')
  listBoards(@Request() req: any, @Param('classId') classId: string) {
    return this.boards.list(req.user, classId);
  }

  @Get(':classId/boards/:moduleId')
  getBoard(@Request() req: any, @Param('classId') classId: string, @Param('moduleId') moduleId: string) {
    return this.boards.get(req.user, classId, moduleId);
  }

  /** `{ data?, studentVisible? }` – Tafelbild speichern bzw. für die Schüler ●/○. */
  @Put(':classId/boards/:moduleId')
  putBoard(@Request() req: any, @Param('classId') classId: string, @Param('moduleId') moduleId: string, @Body() body: any) {
    return this.boards.put(req.user, classId, moduleId, body);
  }

  /** 🔑 Lehrerlösungen (eigene Dokumente mit Beschriftung) und ob diese Klasse sie sieht. */
  @Get(':classId/solutions')
  listSolutions(@Request() req: any, @Param('classId') classId: string) {
    return this.boards.solutions(req.user, classId);
  }

  /** `{ studentVisible }` – Lehrerlösung für die Schüler dieser Klasse ●/○. */
  @Put(':classId/solutions/:moduleId')
  setSolution(@Request() req: any, @Param('classId') classId: string, @Param('moduleId') moduleId: string, @Body() body: { studentVisible?: boolean }) {
    return this.boards.setSolution(req.user, classId, moduleId, !!body?.studentVisible);
  }

  /** Lehrerlösung als Start des Tafelbilds dieser Klasse. */
  @Post(':classId/boards/:moduleId/from-solution')
  @HttpCode(200)
  boardFromSolution(@Request() req: any, @Param('classId') classId: string, @Param('moduleId') moduleId: string) {
    return this.boards.boardFromSolution(req.user, classId, moduleId);
  }

  /** Tafelbild als Lehrerlösung übernehmen (gilt für alle Klassen). */
  @Post(':classId/boards/:moduleId/to-solution')
  @HttpCode(200)
  solutionFromBoard(@Request() req: any, @Param('classId') classId: string, @Param('moduleId') moduleId: string) {
    return this.boards.solutionFromBoard(req.user, classId, moduleId);
  }

  /** Neues Tafelbild beginnen: das bisherige löschen. */
  @Delete(':classId/boards/:moduleId')
  deleteBoard(@Request() req: any, @Param('classId') classId: string, @Param('moduleId') moduleId: string) {
    return this.boards.remove(req.user, classId, moduleId);
  }

  @Get(':classId')
  get(@Request() req: any, @Param('classId') classId: string) {
    return this.classbook.forTeacher(req.user, classId, req);
  }

  /** Link, Klassencode und QR-Code für die Schüler; legt das Klassennotizbuch bei Bedarf an. */
  @Get(':classId/access')
  access(@Request() req: any, @Param('classId') classId: string) {
    return this.classbook.access(req.user, classId, req);
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

  /** `{ moduleId, on }` – 🔓 Gesperrtes Modul nur für diese Klasse freigeben. */
  @Put(':classId/links/:linkId/release')
  setRelease(@Request() req: any, @Param('classId') classId: string, @Param('linkId') linkId: string, @Body() body: any) {
    return this.classbook.setRelease(req.user, classId, linkId, body);
  }

  /** `{ topicId, moduleId }` – Link der Klassenarbeit dieser Klasse für ein Modul (vorhanden oder neu, für Schüler aus). */
  @Post(':classId/exam')
  @HttpCode(200)
  examLink(@Request() req: any, @Param('classId') classId: string, @Body() body: any) {
    return this.classbook.examLink(req.user, classId, body);
  }

  /** `{ visible }` – ●/○ der Klassenarbeit für die Schüler dieser Klasse. */
  @Put(':classId/exam/:linkId/visible')
  setExamVisible(@Request() req: any, @Param('classId') classId: string, @Param('linkId') linkId: string, @Body() body: { visible?: boolean }) {
    return this.classbook.setExamVisible(req.user, classId, linkId, !!body?.visible);
  }

  /** 🧪 Klassenarbeit selbst ausprobieren: Ausweis der Vorschau (Testschüler) dieser Klasse. */
  @Post(':classId/exam/:linkId/try')
  @HttpCode(200)
  tryExam(@Request() req: any, @Param('classId') classId: string, @Param('linkId') linkId: string) {
    return this.classbook.tryExam(req.user, classId, linkId);
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

  /** 🔗 `{ type: 'node'|'entry', id, revoke? }` – eigener Link auf diesen Teil des Klassennotizbuchs (Link und QR-Code). */
  @Post(':classId/share')
  @HttpCode(200)
  share(@Request() req: any, @Param('classId') classId: string, @Body() body: any) {
    return this.classbook.shareLink(req.user, classId, body, req);
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
  /** 🌳 Zuweisungen wieder wie im Notizbuch anordnen. */
  @Post(':classId/arrange')
  @HttpCode(200)
  arrange(@Request() req: any, @Param('classId') classId: string) {
    return this.classbook.arrange(req.user, classId);
  }

  /** 🗂 Plan der Klasse: `{ planId, on? }` zuweisen (`on: false` = ausgeschaltet), `{ planId: null }` lösen (docs/planung.md). */
  @Post(':classId/plan')
  @HttpCode(200)
  setPlan(@Request() req: any, @Param('classId') classId: string, @Body() body: { planId?: string | null; on?: boolean }) {
    return this.classbook.setPlan(req.user, classId, body?.planId ?? null, req, body?.on !== false);
  }

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
  /** `{ moduleId, on }` – 💡 Lösungen eines Dokuments für diese Klasse. */
  @Put(':classId/links/:linkId/solutions')
  setSolutions(@Request() req: any, @Param('classId') classId: string, @Param('linkId') linkId: string, @Body() body: any) {
    return this.classbook.setSolutions(req.user, classId, linkId, body);
  }

  @Put(':classId/links-enabled')
  setLinks(@Request() req: any, @Param('classId') classId: string, @Body() body: any) {
    return this.classbook.setLinks(req.user, classId, body);
  }

  /**
   * 📍 Setzt den Merker auf jeder Ebene – `{ level: 'root' }`, `{ level: 'node', nodeId }`,
   * `{ level: 'link', linkId }`, `{ level: 'topic', linkId, topicId }` oder
   * `{ level: 'module', linkId, topicId, moduleId }`; `{}` entfernt ihn.
   */
  @Put(':classId/marker')
  marker(@Request() req: any, @Param('classId') classId: string, @Body() body: any) {
    return this.classbook.setMarker(req.user, classId, body);
  }

  /** 🙈 `{ type: 'node', id, hidden }` oder `{ type: 'book', hidden }` – für Schüler aus-/einblenden, Module unverändert. */
  @Put(':classId/visibility')
  visibility(@Request() req: any, @Param('classId') classId: string, @Body() body: any) {
    return this.classbook.setVisibility(req.user, classId, body);
  }

  /** 📡 `{ linkId, moduleId }` – bei allen verbundenen Schüler-Geräten öffnen. */
  @Post(':classId/send')
  @HttpCode(200)
  send(@Request() req: any, @Param('classId') classId: string, @Body() body: any) {
    return this.classbook.sendToClass(req.user, classId, body);
  }

  /** 👁 → `{ token, ticket, name }`: als Testschüler die eigene Klasse ansehen. */
  @Post(':classId/preview')
  preview(@Request() req: any, @Param('classId') classId: string) {
    return this.classbook.preview(req.user, classId);
  }

  /** 🧹 Ergebnisse, Blätter und Stand des Testschülers in dieser Klasse löschen. */
  @Delete(':classId/preview')
  resetPreview(@Request() req: any, @Param('classId') classId: string) {
    return this.classbook.resetPreview(req.user, classId);
  }

  /** 👣 `{ on }` – Schüler-Geräte folgen dem 📍-Merker. */
  @Put(':classId/follow')
  follow(@Request() req: any, @Param('classId') classId: string, @Body() body: { on?: boolean }) {
    return this.classbook.setFollow(req.user, classId, !!body?.on);
  }

  @Get(':classId/overview')
  overview(@Request() req: any, @Param('classId') classId: string) {
    return this.classbook.overview(req.user, classId);
  }
}

/** Schüler über den Klassenbuch-Link – Name und PIN, dann mit Ausweis. */
@Controller('public/classbook')
export class PublicClassbookController {
  constructor(private readonly classbook: ClassbookService, private readonly boards: ClassBoardService) {}

  /** `{ ticket }` → eingeschaltete ✍️ Tafelbilder der Klasse (ohne Inhalt). */
  @Post(':token/boards')
  @HttpCode(200)
  boardList(@Param('token') token: string, @Body() body: { ticket?: string }) {
    return this.boards.listForStudent(token, body?.ticket);
  }

  /** `{ ticket }` → freigegebene 🔑 Lehrerlösungen der Klasse (ohne Inhalt). */
  @Post(':token/solutions')
  @HttpCode(200)
  solutionList(@Param('token') token: string, @Body() body: { ticket?: string }) {
    return this.boards.solutionsForStudent(token, body?.ticket);
  }

  /** `{ ticket }` → eine Lehrerlösung mit Dokument, nur zum Ansehen. */
  @Post(':token/solutions/:moduleId')
  @HttpCode(200)
  solution(@Param('token') token: string, @Param('moduleId') moduleId: string, @Body() body: { ticket?: string }) {
    return this.boards.solutionForStudent(token, body?.ticket, moduleId);
  }

  /** `{ ticket }` → ein Tafelbild mit Dokument, nur zum Ansehen. */
  @Post(':token/boards/:moduleId')
  @HttpCode(200)
  board(@Param('token') token: string, @Param('moduleId') moduleId: string, @Body() body: { ticket?: string }) {
    return this.boards.getForStudent(token, body?.ticket, moduleId);
  }

  /** Live-Verbindung (Server-Sent Events) – `?ticket=`, weil EventSource keine Kopfzeilen sendet. */
  @Get(':token/live')
  async live(@Param('token') token: string, @Query('ticket') ticket: string, @Res() res: Response) {
    try {
      await this.classbook.liveStream(token, ticket, res);
    } catch (err: any) {
      res.status(err?.status || 403).json(err?.response || { message: 'Die Anmeldung ist abgelaufen.' });
    }
  }

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

  /** `{ ticket, examOnly? }` → Zuweisungen, Ergebnisse, Blätter (`examOnly`: 🧪 Ausprobieren einer Klassenarbeit – nur sie). */
  @Post(':token/home')
  @HttpCode(200)
  home(@Param('token') token: string, @Body() body: { ticket?: string; examOnly?: string }) {
    return this.classbook.home(token, body?.ticket, body?.examOnly);
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

  /** `{ ticket, workId }` → eigenes Blatt, dessen Dokument gelöscht ist: nur zum Lesen, ohne Lösungen. */
  @Post(':token/gone-work')
  @HttpCode(200)
  goneWork(@Param('token') token: string, @Body() body: { ticket?: string; workId?: string }) {
    return this.classbook.goneWork(token, body);
  }

  /** `{ ticket }` → `{ current, hasNext }` – Stand im 📍-Pfad, ohne ihn zu verändern. */
  @Post(':token/weiter')
  @HttpCode(200)
  weiter(@Param('token') token: string, @Body() body: { ticket?: string }) {
    return this.classbook.weiter(token, body?.ticket);
  }

  /** `{ ticket }` → `{ current, hasNext }` – einen Schritt im 📍-Pfad vor, gespeichert je Schüler. */
  @Post(':token/weiter/next')
  @HttpCode(200)
  weiterNext(@Param('token') token: string, @Body() body: { ticket?: string }) {
    return this.classbook.advanceWeiter(token, body?.ticket);
  }
}
