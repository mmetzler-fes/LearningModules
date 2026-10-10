import { RemotePerson } from '../core/entities/remote-person.entity';
import { FederationPeer } from '../core/entities/federation-peer.entity';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TopicsService } from './topics.service';
import { TopicsController } from './topics.controller';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { User } from '../core/entities/user.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { School } from '../core/entities/school.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { TagsModule } from '../tags/tags.module';
import { ShopModule } from '../shop/shop.module';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LearningTopic, LearningModule, User, TopicQuickLink, TopicLink, ShopOffer, UseGrant, School, RemotePerson, FederationPeer]),
    TagsModule,
    ShopModule,
    CategoriesModule,
  ],
  controllers: [TopicsController],
  providers: [TopicsService],
  exports: [TopicsService],
})
export class TopicsModule {}
