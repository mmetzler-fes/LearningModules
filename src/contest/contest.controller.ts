import { Controller, Get, Post, Body, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ContestService } from './contest.service';

/**
 * Lernwettkampf – ohne Anmeldung, wie die übrigen Schülerzugänge.
 *
 * Leitung: Der Leitungs-Token (`/?wh=…`) ist der Schlüssel. So lässt sich der
 * Wettkampf am Beamer-PC starten, ohne sich dort anzumelden.
 * Teilnehmer: Schüler-Token des Links plus Spieler-ID und -Geheimnis aus
 * dem Beitritt.
 *
 * Laufende Ereignisse kommen als Server-Sent Events (`…/events`).
 */
@Controller('public/contest')
export class ContestController {
  constructor(private readonly contest: ContestService) {}

  // ---- Leitung ----

  @Post('host/:hostToken/open')
  async open(@Param('hostToken') hostToken: string, @Req() req: any) {
    return this.contest.hostOpen(hostToken, req);
  }

  @Get('host/:hostToken/events')
  async hostEvents(@Param('hostToken') hostToken: string, @Res() res: Response) {
    await this.contest.hostStream(hostToken, res);
  }

  @Post('host/:hostToken/start')
  async start(@Param('hostToken') hostToken: string) {
    return this.contest.hostStart(hostToken);
  }

  @Post('host/:hostToken/next')
  async next(@Param('hostToken') hostToken: string) {
    return this.contest.hostNext(hostToken);
  }

  @Post('host/:hostToken/kick')
  async kick(@Param('hostToken') hostToken: string, @Body() body: { playerId?: string }) {
    return this.contest.hostKick(hostToken, String(body?.playerId || ''));
  }

  @Post('host/:hostToken/reset')
  async reset(@Param('hostToken') hostToken: string) {
    return this.contest.hostReset(hostToken);
  }

  @Post('host/:hostToken/close')
  async close(@Param('hostToken') hostToken: string) {
    return this.contest.hostClose(hostToken);
  }

  // ---- Teilnehmer ----

  @Post(':token/join')
  async join(@Param('token') token: string, @Body() body: any, @Req() req: any) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0] : req.ip || '').trim() || null;
    return this.contest.join(token, body || {}, ip);
  }

  @Get(':token/events')
  async events(
    @Param('token') token: string,
    @Query('pid') playerId: string,
    @Query('sec') secret: string,
    @Res() res: Response,
  ) {
    await this.contest.playerStream(token, String(playerId || ''), String(secret || ''), res);
  }

  @Post(':token/answer')
  async answer(@Param('token') token: string, @Body() body: any) {
    return this.contest.answer(token, body || {});
  }
}
