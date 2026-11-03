import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HtmlAppFile } from '../core/entities/html-app-file.entity';
import { HtmlAppState } from '../core/entities/html-app-state.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { Result } from '../core/entities/result.entity';
import { RunProgress } from '../core/entities/run-progress.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { ClassesModule } from '../classes/classes.module';
import { FeaturesModule } from '../features/features.module';
import { TopicsModule } from '../topics/topics.module';
import { HtmlAppFrameController, HtmlAppsController } from './html-apps.controller';
import { HtmlAppsService } from './html-apps.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([HtmlAppFile, HtmlAppState, LearningModule, LearningTopic, Result, RunProgress, TopicLink]),
    ClassesModule, FeaturesModule, TopicsModule,
  ],
  controllers: [HtmlAppsController, HtmlAppFrameController],
  providers: [HtmlAppsService],
  exports: [HtmlAppsService],
})
export class HtmlAppsModule {}
