import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { User } from '../core/entities/user.entity';
import { ContentFeedback } from '../core/entities/content-feedback.entity';
import { FederationCopy } from '../core/entities/federation-copy.entity';
import { ShopModule } from '../shop/shop.module';
import { UsageModule } from './usage.module';
import { ImpactService } from './impact.service';
import { ImpactController } from './impact.controller';

/** Wirkung und Bewertung – siehe docs/nutzung-und-bewertung.md. */
@Module({
  imports: [
    TypeOrmModule.forFeature([LearningModule, LearningTopic, UseGrant, ShopOffer, User, ContentFeedback, FederationCopy]),
    ShopModule,
    UsageModule,
  ],
  controllers: [ImpactController],
  providers: [ImpactService],
})
export class ImpactModule {}
