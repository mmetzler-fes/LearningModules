import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Query, Req, Request, Res, UseGuards } from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiBridgeService } from './ai-bridge.service';
import { FeedbackService } from '../feedback/feedback.service';
import { handleMcp, McpBridge } from './mcp';

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

  /** Dauerhaften Zugang einschalten: `{ minutes }` (höchstens 4 Stunden). */
  @Post('sessions/:id/activate')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  activateSession(@Request() req: any, @Param('id') id: string, @Body() body: { minutes?: number }) {
    return this.bridge.activateSession(req.user, id, body?.minutes);
  }

  /** Offene KI-Änderung annehmen. */
  @Post('sessions/:id/runs/:runId/accept')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  acceptRun(@Request() req: any, @Param('id') id: string, @Param('runId') runId: string) {
    return this.bridge.acceptRun(req.user, id, runId);
  }

  /** Offene KI-Änderung ablehnen (rückgängig machen); `{ force }` trotz eigener Änderungen seitdem. */
  @Post('sessions/:id/runs/:runId/reject')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  rejectRun(@Request() req: any, @Param('id') id: string, @Param('runId') runId: string, @Body() body: { force?: boolean }) {
    return this.bridge.rejectRun(req.user, id, runId, !!body?.force);
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


/**
 * MCP-Server (mcp.ts): `POST /api/mcp` mit `Authorization: Bearer lma_…`, oder – für KIs, bei
 * denen sich nur eine Adresse eintragen lässt (Connector in Claude.ai, ChatGPT) – `POST /api/mcp/lma_…`.
 * Dann ist die Adresse der Schlüssel: nur mit dem dauerhaften Zugang verwenden (ausschaltbar, neu erzeugbar).
 */
@Controller('mcp')
export class McpController {
  constructor(private readonly bridge: AiBridgeService) {}

  @Post()
  post(@Req() req: ExpressRequest, @Res() res: Response, @Body() body: any) {
    return this.serve(req, res, body, extractAiToken(req));
  }

  @Post(':token')
  postWithToken(@Req() req: ExpressRequest, @Res() res: Response, @Param('token') token: string, @Body() body: any) {
    return this.serve(req, res, body, extractAiToken(req) || token);
  }

  /** Kein Ereignis-Strom (SSE) – nur POST. */
  @Get()
  get(@Res() res: Response) {
    res.status(405).setHeader('Allow', 'POST').send('Nur POST (MCP Streamable HTTP ohne Ereignis-Strom).');
  }

  @Get(':token')
  getWithToken(@Res() res: Response) {
    res.status(405).setHeader('Allow', 'POST').send('Nur POST (MCP Streamable HTTP ohne Ereignis-Strom).');
  }

  private async serve(req: ExpressRequest, res: Response, body: any, token: string | undefined) {
    const session = await this.bridge.sessionOfToken(token);
    if (!session) {
      res.status(401).setHeader('WWW-Authenticate', 'Bearer').json({
        jsonrpc: '2.0', id: null,
        error: { code: -32001, message: 'KI-Token fehlt oder ist ungültig – in LearningModules unter 🤖 KI-Assistent einen dauerhaften Zugang einrichten.' },
      });
      return;
    }
    const base = extractBaseUrl(req);
    const bridge: McpBridge = {
      authenticate: () => this.bridge.authenticateToken(token),
      overview: (s) => this.bridge.getInstructionsForAi(s, base),
      tree: (s) => this.bridge.scopedTree(s),
      topic: (s, id) => this.bridge.getScopedTopic(s, id),
      document: (s, id) => this.bridge.getScopedDocument(s, id),
      docSpecReference: () => this.bridge.getDocSpecReference(),
      quizReference: (types) => this.bridge.getQuizReference(types),
      run: (s, operations, dryRun) => this.bridge.executeBatch(s, { operations, dryRun }),
    };
    const batch = Array.isArray(body);
    const out: any[] = [];
    for (const msg of batch ? body : [body]) {
      const answer = await handleMcp(msg, bridge);
      if (answer) out.push(answer);
    }
    if (!out.length) { res.status(202).end(); return; }
    res.status(200).json(batch ? out : out[0]);
  }
}
