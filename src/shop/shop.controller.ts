import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShopService } from './shop.service';
import { OfferScope } from '../core/entities/shop-offer.entity';
import { PointsService } from '../accounts/points.service';

@Controller('shop')
@UseGuards(JwtAuthGuard)
export class ShopController {
  constructor(
    private readonly shop: ShopService,
    private readonly points: PointsService,
  ) {}

  /** Angebote anderer und an mich Geteiltes, samt Geben und Nehmen. */
  @Get('offers')
  async catalog(@Request() req: any) {
    return this.shop.catalog(req.user);
  }

  /** Meine eigenen Angebote mit allen, die daraus erworben haben. */
  @Get('my-offers')
  async myOffers(@Request() req: any) {
    return this.shop.myOffers(req.user);
  }

  /** Buchungen des früheren Punktekontos (bis Oktober 2026), zum Nachlesen. */
  @Get('points')
  async myPoints(@Request() req: any) {
    return { entries: await this.points.ledger(req.user.userId) };
  }

  /**
   * Zustand des Anbieten-Dialogs: `type` topic | node | modules, `id` das
   * Thema, der Knoten bzw. ein bestehendes Auswahl-Angebot; für eine neue
   * Auswahl stattdessen `moduleIds` (kommagetrennt).
   */
  @Get('offer-state')
  async offerState(@Request() req: any, @Query('type') type: string, @Query('id') id?: string, @Query('moduleIds') moduleIds?: string) {
    return this.shop.offerState((type || 'topic') as OfferScope, { id, moduleIds: moduleIds ? moduleIds.split(',').filter(Boolean) : undefined }, req.user);
  }

  /** Wie offer-state für ein Thema (ältere Oberfläche). */
  @Get('topics/:topicId')
  async topicState(@Param('topicId') topicId: string, @Request() req: any) {
    return this.shop.offerState('topic', { id: topicId }, req.user);
  }

  /**
   * Angebot anlegen oder ändern: `{ type, topicId | nodeId | moduleIds,
   * offerId?, title?, allowCopy, allowUse, audience,
   * includeForeign, active }`.
   */
  @Post('offers')
  async saveOffer(@Request() req: any, @Body() body: any) {
    return this.shop.saveOffer(req.user, body);
  }

  /** Angebot für ein Thema (ältere Oberfläche) – ohne fremde Module, wenn nicht anders gesagt. */
  @Post('topics/:topicId/creator-offer')
  async saveCreatorOffer(@Param('topicId') topicId: string, @Request() req: any, @Body() body: any) {
    return this.shop.saveOffer(req.user, { includeForeign: false, ...body, type: 'topic', topicId });
  }

  @Delete('offers/:id')
  async withdraw(@Param('id') id: string, @Request() req: any) {
    return this.shop.withdraw(id, req.user);
  }

  /** `{ mode: 'copy' | 'use' }` */
  @Post('offers/:id/acquire')
  async acquire(@Param('id') id: string, @Request() req: any, @Body() body: { mode?: string }) {
    return this.shop.acquire(id, String(body?.mode || ''), req.user);
  }

  /** Nutzungsrecht zurückgeben (Inhaber) oder kostenloses entziehen (Anbieter). */
  @Delete('grants/:id')
  async revokeGrant(@Param('id') id: string, @Request() req: any) {
    return this.shop.revokeGrant(id, req.user);
  }
}
