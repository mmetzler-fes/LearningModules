import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HtmlAppFile } from '../core/entities/html-app-file.entity';
import { HtmlAppState } from '../core/entities/html-app-state.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { User } from '../core/entities/user.entity';
import { FeaturesModule } from '../features/features.module';
import { TopicsModule } from '../topics/topics.module';
import { HtmlAppFrameController, HtmlAppsAdminController, HtmlAppsController } from './html-apps.controller';
import { HtmlAppsService } from './html-apps.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([HtmlAppFile, HtmlAppState, LearningModule, LearningTopic, TopicLink, User]),
    FeaturesModule, TopicsModule,
  ],
  controllers: [HtmlAppsController, HtmlAppsAdminController, HtmlAppFrameController],
  providers: [HtmlAppsService],
  exports: [HtmlAppsService],
})
export class HtmlAppsModule {}
