import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Request, Res, UseGuards, Headers } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { baseUrl } from '../core/share/link-url';
import { deviceLabel } from '../auth/device-label';
import { SsoService } from './sso.service';

/** Anmeldung mit dem Schulkonto (docs/sso.md). */
@Controller('sso')
export class SsoController {
  constructor(private readonly sso: SsoService) {}

  @Get('options')
  options() {
    return this.sso.teacherOptions();
  }

  @Get('classbook/:token')
  classbook(@Param('token') token: string) {
    return this.sso.classbookOption(token);
  }

  /** Browser-Sprung zum Anbieter. */
  @Get('start')
  async start(@Query() q: any, @Request() req: any, @Res() res: Response) {
    try {
      res.redirect(302, await this.sso.start(q, baseUrl(req)));
    } catch (e: any) {
      const sp = new URLSearchParams({ ssoError: e?.response?.message || e?.message || 'Anmeldung nicht möglich.' });
      if (q?.purpose === 'student' && q?.k) sp.set('k', String(q.k));
      res.redirect(302, `${baseUrl(req)}/?${sp.toString()}`);
    }
  }

  @Get('callback')
  async callback(@Query() q: any, @Request() req: any, @Res() res: Response, @Headers('user-agent') ua?: string) {
    res.redirect(302, await this.sso.callback(q, baseUrl(req), deviceLabel(ua)));
  }

  @Post('redeem')
  @HttpCode(200)
  redeem(@Body() body: { code?: string }) {
    return this.sso.redeem(String(body?.code || ''));
  }
}

/** Einrichtung durch den Schuladmin. */
@Controller('my-school/sso')
@UseGuards(JwtAuthGuard)
export class SchoolSsoController {
  constructor(private readonly sso: SsoService) {}

  @Get()
  get(@Request() req: any) {
    return this.sso.getConfig(req.user, baseUrl(req));
  }

  @Put()
  save(@Request() req: any, @Body() body: any) {
    return this.sso.saveConfig(req.user, body, baseUrl(req));
  }

  @Post('test')
  @HttpCode(200)
  test(@Request() req: any) {
    return this.sso.testConfig(req.user);
  }
}
