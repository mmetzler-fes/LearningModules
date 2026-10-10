import { Controller, Get, Post, Delete, Param, Body, UseGuards, Request, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FederationService } from './federation.service';
import { AccountSyncService } from './account-sync.service';

/**
 * Endpunkte für andere Server (ohne Anmeldung, dafür signiert – siehe
 * FederationService.verifyRequest) und für Lehrkräfte (mit Anmeldung).
 */
@Controller('federation')
export class FederationController {
  constructor(
    private readonly federation: FederationService,
    private readonly accounts: AccountSyncService,
  ) {}

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

  @Post('link/confirm')
  async linkConfirm(@Req() req: any) {
    return this.accounts.receiveConfirm(req);
  }

  @Post('link/export')
  async linkExport(@Req() req: any) {
    return this.accounts.serveExport(req);
  }

  @Post('link/unlink')
  async linkUnlink(@Req() req: any) {
    return this.accounts.receiveUnlink(req);
  }

  // ---- Lehrkräfte ----

  /** Verknüpfte Konten auf anderen Servern. */
  @Get('links')
  @UseGuards(JwtAuthGuard)
  async links(@Request() req: any) {
    return this.accounts.mine(req.user);
  }

  /** `{ peerId }` – Code erzeugen, der drüben eingegeben wird. */
  @Post('links/code')
  @UseGuards(JwtAuthGuard)
  async linkCode(@Request() req: any, @Body() body: any) {
    return this.accounts.createCode(req.user, body);
  }

  /** `{ peerId, code }` – Code von drüben eingeben. */
  @Post('links')
  @UseGuards(JwtAuthGuard)
  async linkEnter(@Request() req: any, @Body() body: any) {
    return this.accounts.enterCode(req.user, body);
  }

  @Post('links/:id/sync')
  @UseGuards(JwtAuthGuard)
  async linkSync(@Param('id') id: string, @Request() req: any) {
    return this.accounts.syncNow(id, req.user);
  }

  /** `{ autoSync }` */
  @Post('links/:id')
  @UseGuards(JwtAuthGuard)
  async linkUpdate(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    return this.accounts.update(id, req.user, body);
  }

  @Delete('links/:id')
  @UseGuards(JwtAuthGuard)
  async linkDelete(@Param('id') id: string, @Request() req: any) {
    return this.accounts.unlink(id, req.user);
  }

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
