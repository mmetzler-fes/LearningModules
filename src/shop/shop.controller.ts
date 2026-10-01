import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShopService } from './shop.service';
import { PointsService } from '../accounts/points.service';

@Controller('shop')
@UseGuards(JwtAuthGuard)
export class ShopController {
  constructor(
    private readonly shop: ShopService,
    private readonly points: PointsService,
  ) {}

  /** Angebote anderer und an mich Geteiltes, samt Kontostand. */
  @Get('offers')
  async catalog(@Request() req: any) {
    return this.shop.catalog(req.user);
  }

  /** Meine eigenen Angebote mit allen, die daraus erworben haben. */
  @Get('my-offers')
  async myOffers(@Request() req: any) {
    return this.shop.myOffers(req.user);
  }

  /** Kontostand, Buchungen und die geltenden Regeln. */
  @Get('points')
  async myPoints(@Request() req: any) {
    const [balance, entries, settings] = await Promise.all([
      this.points.balance(req.user.userId),
      this.points.ledger(req.user.userId),
      this.points.getSettings(),
    ]);
    return { balance, entries, settings };
  }

  /** Zustand des Anbieten-Dialogs für ein eigenes Thema. */
  @Get('topics/:topicId')
  async topicState(@Param('topicId') topicId: string, @Request() req: any) {
    return this.shop.topicOfferState(topicId, req.user);
  }

  @Post('topics/:topicId/creator-offer')
  async saveCreatorOffer(@Param('topicId') topicId: string, @Request() req: any, @Body() body: any) {
    return this.shop.saveCreatorOffer(topicId, req.user, body);
  }

  @Post('topics/:topicId/buyer-share')
  async saveBuyerShare(@Param('topicId') topicId: string, @Request() req: any, @Body() body: any) {
    return this.shop.saveBuyerShare(topicId, req.user, body);
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
