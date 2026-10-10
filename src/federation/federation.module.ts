import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemConfig } from '../core/entities/system-config.entity';
import { FederationPeer } from '../core/entities/federation-peer.entity';
import { RemoteOffer } from '../core/entities/remote-offer.entity';
import { RemotePerson } from '../core/entities/remote-person.entity';
import { FederationCopy } from '../core/entities/federation-copy.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { User } from '../core/entities/user.entity';
import { ShopModule } from '../shop/shop.module';
import { CategoriesModule } from '../categories/categories.module';
import { FederationService } from './federation.service';
import { FederationController, FederationAdminController } from './federation.controller';

/** Vernetzung mehrerer Server – siehe docs/vernetzung.md. */
@Module({
  imports: [
    TypeOrmModule.forFeature([SystemConfig, FederationPeer, RemoteOffer, RemotePerson, FederationCopy, LearningTopic, User]),
    ShopModule,
    CategoriesModule,
  ],
  controllers: [FederationController, FederationAdminController],
  providers: [FederationService],
})
export class FederationModule {}
