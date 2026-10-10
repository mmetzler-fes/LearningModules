import { Controller, Get, Post, Param, Body, UseGuards, Request, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FederationService } from './federation.service';

/**
 * Endpunkte für andere Server (ohne Anmeldung, dafür signiert – siehe
 * FederationService.verifyRequest) und für Lehrkräfte (mit Anmeldung).
 */
@Controller('federation')
export class FederationController {
  constructor(private readonly federation: FederationService) {}

  // ---- Server untereinander ----

  /** Wer dieser Server ist (öffentlich). */
  @Get('info')
  async info() {
    return this.federation.info();
  }

  @Post('hello')
  async hello(@Req() req: any) {
    return this.federation.receiveHello(req);
  }

  @Post('accept')
  async accept(@Req() req: any) {
    return this.federation.receiveAccept(req);
  }

  @Post('goodbye')
  async goodbye(@Req() req: any) {
    return this.federation.receiveGoodbye(req);
  }

  @Get('catalog')
  async catalog(@Req() req: any) {
    return this.federation.serveCatalog(req);
  }

  @Post('serve/:offerId/copy')
  async serveCopy(@Param('offerId') offerId: string, @Req() req: any) {
    return this.federation.serveCopy(req, offerId);
  }

  // ---- Lehrkräfte ----

  /** Angebote verbundener Server für den Shop. */
  @Get('offers')
  @UseGuards(JwtAuthGuard)
  async offers(@Request() req: any) {
    return this.federation.remoteOffers(req.user);
  }

  @Post('offers/:peerId/:offerId/copy')
  @UseGuards(JwtAuthGuard)
  async copy(@Param('peerId') peerId: string, @Param('offerId') offerId: string, @Request() req: any) {
    return this.federation.acquireCopy(req.user, peerId, offerId);
  }
}

/** Verwaltung der Verbindungen (nur Admins). */
@Controller('admin/federation')
@UseGuards(JwtAuthGuard)
export class FederationAdminController {
  constructor(private readonly federation: FederationService) {}

  @Get()
  async overview(@Request() req: any) {
    return this.federation.overview(req.user);
  }

  /** `{ name?, url? }` */
  @Post('settings')
  async settings(@Request() req: any, @Body() body: any) {
    return this.federation.saveSettings(req.user, body);
  }

  /** `{ url }` – Anfrage an einen anderen Server. */
  @Post('peers')
  async request(@Request() req: any, @Body() body: any) {
    return this.federation.requestPeer(req.user, body);
  }

  @Post('peers/:id/accept')
  async accept(@Param('id') id: string, @Request() req: any) {
    return this.federation.accept(req.user, id);
  }

  /** Ablehnen, zurückziehen oder trennen. */
  @Post('peers/:id/end')
  async end(@Param('id') id: string, @Request() req: any) {
    return this.federation.end(req.user, id);
  }

  @Post('peers/:id/sync')
  async sync(@Param('id') id: string, @Request() req: any) {
    return this.federation.syncNow(req.user, id);
  }
}
