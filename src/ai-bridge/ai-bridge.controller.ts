import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Query, Req, Request, Res, UseGuards } from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiBridgeService } from './ai-bridge.service';
import { FeedbackService } from '../feedback/feedback.service';

function extractBaseUrl(req: ExpressRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

function extractAiToken(req: ExpressRequest, queryToken?: string): string | undefined {
  const auth = req.headers?.authorization;
  if (auth && /^Bearer\s+lma_/i.test(auth)) return auth;
  const headerToken = req.headers?.['x-ai-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) return headerToken;
  return queryToken;
}

@Controller('ai-bridge')
export class AiBridgeController {
  constructor(
    private readonly bridge: AiBridgeService,
    private readonly feedback: FeedbackService,
  ) {}

  /** Konto hinter dem KI-Token – 💬 Feedback nur, wenn es ein Admin ist. */
  private async feedbackAccount(req: ExpressRequest, token?: string) {
    const session = await this.bridge.authenticateToken(extractAiToken(req, token));
    const account = await this.feedback.accountOf(session.userId);
    if (account.role !== 'admin') throw new ForbiddenException('💬 Feedback gibt es nur mit dem KI-Token eines Admins.');
    return account;
  }

  // ---- Lehrer-Endpunkte (normale Anmeldung über JWT) ----

  @Post('sessions')
  @UseGuards(JwtAuthGuard)
  createSession(@Request() req: any, @Body() body: any) {
    return this.bridge.createSession(req.user, {
      ...body,
      baseUrl: body?.baseUrl || extractBaseUrl(req),
    });
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async listSessions(@Request() req: any) {
    return { sessions: await this.bridge.listSessions(req.user) };
  }

  /** `{ minutes }` – laufende Sitzung verlängern. */
  @Post('sessions/:id/extend')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  extendSession(@Request() req: any, @Param('id') id: string, @Body() body: { minutes?: number }) {
    return this.bridge.extendSession(req.user, id, body?.minutes);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  revokeSession(@Request() req: any, @Param('id') id: string) {
    return this.bridge.revokeSession(req.user, id);
  }

  @Post('sessions/:id/rollback')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  rollbackSession(@Request() req: any, @Param('id') id: string) {
    return this.bridge.rollbackSession(req.user, id);
  }

  /** Direkt im Dialog eingefügtes KI-Antwort-JSON ausführen (oder mit dryRun=true prüfen). */
  @Post('sessions/:id/batch')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  executeBatchByTeacher(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.bridge.executeBatchByTeacher(req.user, id, body);
  }

  // ---- KI-Endpunkte (Authentifizierung über das zeitlich begrenzte Token lma_…) ----

  @Get('instructions')
  async instructions(@Req() req: ExpressRequest, @Query('token') token?: string) {
    const session = await this.bridge.authenticateToken(extractAiToken(req, token));
    const info: any = await this.bridge.getInstructionsForAi(session, extractBaseUrl(req));
    if ((await this.feedback.accountOf(session.userId)).role === 'admin') {
      const base = extractBaseUrl(req);
      info.endpoints.feedbackList = `GET ${base}/api/ai-bridge/feedback`;
      info.endpoints.feedbackImage = `GET ${base}/api/ai-bridge/feedback/:id/image`;
      info.endpoints.feedbackUpdate = `PATCH ${base}/api/ai-bridge/feedback/:id`;
      info.feedback = 'Rückmeldungen zur App (💬 Feedback): lesen; mit PATCH { priority: 0–3, status: "open"|"done", adminNote } ordnen oder als erledigt markieren. Löschen nur in der App. Namen sind gekürzt (Klasse · Vorname N.).';
    }
    return info;
  }

  // ---- 💬 Feedback zur App (nur mit dem KI-Token eines Admins) ----

  @Get('feedback')
  async feedbackList(@Req() req: ExpressRequest, @Query('token') token?: string) {
    return this.feedback.list(await this.feedbackAccount(req, token));
  }

  @Get('feedback/:id/image')
  async feedbackImage(@Req() req: ExpressRequest, @Param('id') id: string, @Res() res: Response, @Query('token') token?: string) {
    const img = await this.feedback.image(await this.feedbackAccount(req, token), id);
    res.setHeader('Content-Type', img.type);
    res.send(img.data);
  }

  /** Schreiben nur mit dem Token im Header. */
  @Patch('feedback/:id')
  async feedbackUpdate(@Req() req: ExpressRequest, @Param('id') id: string, @Body() body: any) {
    const { priority, status, adminNote } = body || {};
    return this.feedback.update(await this.feedbackAccount(req), id, { priority, status, adminNote });
  }

  /** Nachschlagen: Format der Arbeitsblätter (DocSpec) – nur bei Bedarf, die Anleitung bleibt kurz. */
  @Get('reference/docspec')
  async docSpecReference(@Req() req: ExpressRequest, @Query('token') token?: string) {
    await this.bridge.authenticateToken(extractAiToken(req, token));
    return this.bridge.getDocSpecReference();
  }

  /** Nachschlagen: Format der Quiz-Typen `?types=multipleChoice,trueFalse` (Markdown) – nur die gewünschten. */
  @Get('reference/quiz')
  async quizReference(@Req() req: ExpressRequest, @Res({ passthrough: true }) res: Response, @Query('types') types?: string, @Query('token') token?: string) {
    await this.bridge.authenticateToken(extractAiToken(req, token));
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    return this.bridge.getQuizReference(types || '');
  }

  @Get('tree')
  async tree(@Req() req: ExpressRequest, @Query('token') token?: string) {
    const session = await this.bridge.authenticateToken(extractAiToken(req, token));
    return this.bridge.scopedTree(session);
  }

  @Get('topics/:topicId')
  async topic(@Req() req: ExpressRequest, @Param('topicId') topicId: string, @Query('token') token?: string) {
    const session = await this.bridge.authenticateToken(extractAiToken(req, token));
    return this.bridge.getScopedTopic(session, topicId);
  }

  @Get('documents/:moduleId')
  async document(@Req() req: ExpressRequest, @Param('moduleId') moduleId: string, @Query('token') token?: string) {
    const session = await this.bridge.authenticateToken(extractAiToken(req, token));
    return this.bridge.getScopedDocument(session, moduleId);
  }

  /** Schreiben nur mit dem Token im Header – in der Adresse landete es in Protokollen. */
  @Post('batch')
  @HttpCode(200)
  async batch(@Req() req: ExpressRequest, @Query('dryRun') dryRunQuery?: string, @Body() body?: any) {
    const session = await this.bridge.authenticateToken(extractAiToken(req));
    const dryRun = body?.dryRun !== undefined ? !!body.dryRun : dryRunQuery === 'true';
    return this.bridge.executeBatch(session, { ...body, dryRun });
  }
}

