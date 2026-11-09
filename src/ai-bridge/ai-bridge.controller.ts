import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Request, UseGuards } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiBridgeService } from './ai-bridge.service';

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
  constructor(private readonly bridge: AiBridgeService) {}

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
  listSessions(@Request() req: any) {
    return { sessions: this.bridge.listSessions(req.user) };
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

  // ---- KI-Endpunkte (Authentifizierung über das 15-Minuten-Token lma_…) ----

  @Get('instructions')
  async instructions(@Req() req: ExpressRequest, @Query('token') token?: string) {
    const session = this.bridge.authenticateToken(extractAiToken(req, token));
    return this.bridge.getInstructionsForAi(session, extractBaseUrl(req));
  }

  @Get('tree')
  async tree(@Req() req: ExpressRequest, @Query('token') token?: string) {
    const session = this.bridge.authenticateToken(extractAiToken(req, token));
    return this.bridge.scopedTree(session);
  }

  @Get('topics/:topicId')
  async topic(@Req() req: ExpressRequest, @Param('topicId') topicId: string, @Query('token') token?: string) {
    const session = this.bridge.authenticateToken(extractAiToken(req, token));
    return this.bridge.getScopedTopic(session, topicId);
  }

  @Post('batch')
  @HttpCode(200)
  async batch(@Req() req: ExpressRequest, @Query('token') token?: string, @Query('dryRun') dryRunQuery?: string, @Body() body?: any) {
    const session = this.bridge.authenticateToken(extractAiToken(req, token));
    const dryRun = body?.dryRun !== undefined ? !!body.dryRun : dryRunQuery === 'true';
    return this.bridge.executeBatch(session, { ...body, dryRun });
  }
}

