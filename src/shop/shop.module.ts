import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { User } from '../core/entities/user.entity';
import { TeacherGroup } from '../core/entities/teacher-group.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { AccountsModule } from '../accounts/accounts.module';
import { ShopService } from './shop.service';
import { ShopController } from './shop.controller';
import { RightsMigrationService } from './rights-migration.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShopOffer, UseGrant, LearningTopic, LearningModule, User, TeacherGroup, TopicLink, TopicQuickLink, SystemConfig,
    ]),
    AccountsModule,
  ],
  controllers: [ShopController],
  providers: [ShopService, RightsMigrationService],
  exports: [ShopService],
})
export class ShopModule {}
