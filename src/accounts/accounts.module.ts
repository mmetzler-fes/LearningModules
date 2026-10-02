import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../core/entities/user.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { Tag } from '../core/entities/tag.entity';
import { Result } from '../core/entities/result.entity';
import { TeacherGroup } from '../core/entities/teacher-group.entity';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { PointsEntry } from '../core/entities/points-entry.entity';
import { AccountsService } from './accounts.service';
import { HandoverService } from './handover.service';
import { PointsService } from './points.service';
import { TwoFactorService } from './two-factor.service';

/** Konten über ihren ganzen Lebenszyklus, samt Punktekonto. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, SystemConfig, LearningTopic, LearningModule, TopicLink, TopicQuickLink,
      Tag, Result, TeacherGroup, ShopOffer, UseGrant, PointsEntry,
    ]),
  ],
  providers: [AccountsService, HandoverService, PointsService, TwoFactorService],
  exports: [AccountsService, HandoverService, PointsService, TwoFactorService],
})
export class AccountsModule {}
