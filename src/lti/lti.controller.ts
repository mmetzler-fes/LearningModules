import { All, Body, Controller, Get, HttpCode, Post, Put, Query, Request, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { baseUrl } from '../core/share/link-url';
import { LtiService } from './lti.service';

/** LTI 1.3 – Adressen für die Lernplattform (docs/lti.md). */
@Controller('lti')
export class LtiController {
  constructor(private readonly lti: LtiService) {}

  @Get('jwks')
  jwks() {
    return this.lti.jwks();
  }

  /** Login-Initiierung: Moodle schickt GET oder POST. */
  @All('login')
  async login(@Query() q: any, @Body() body: any, @Request() req: any, @Res() res: Response) {
    try {
      res.redirect(302, await this.lti.login({ ...(q || {}), ...(body || {}) }, baseUrl(req)));
    } catch (e: any) {
      res.status(400).type('text/plain; charset=utf-8').send(e?.response?.message || e?.message || 'LTI-Start nicht möglich.');
    }
  }

  /** Start mit dem Ausweis (form_post) – weiter in die App. */
  @Post('launch')
  async launch(@Body() body: any, @Request() req: any, @Res() res: Response) {
    res.redirect(303, await this.lti.launch(body, baseUrl(req)));
  }

  @Post('redeem')
  @HttpCode(200)
  redeem(@Body() body: { code?: string }) {
    return this.lti.redeem(String(body?.code || ''));
  }

  @Post('deep-link')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  deepLink(@Request() req: any, @Body() body: any) {
    return this.lti.deepLinkComplete(req.user, body, baseUrl(req));
  }
}

/** Einrichtung durch den Schuladmin. */
@Controller('my-school/lti')
@UseGuards(JwtAuthGuard)
export class SchoolLtiController {
  constructor(private readonly lti: LtiService) {}

  @Get()
  get(@Request() req: any) {
    return this.lti.getConfig(req.user, baseUrl(req));
  }

  @Put()
  save(@Request() req: any, @Body() body: any) {
    return this.lti.saveConfig(req.user, body, baseUrl(req));
  }
}
