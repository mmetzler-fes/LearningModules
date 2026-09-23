import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicController } from './public.controller';
import { User } from '../entities/user.entity';
import { LearningTopic } from '../entities/learning-topic.entity';
import { LearningModule } from '../entities/learning-module.entity';
import { Result } from '../entities/result.entity';
import { TopicLink } from '../entities/topic-link.entity';
import { TopicQuickLink } from '../entities/topic-quick-link.entity';
import { LinksModule } from '../../links/links.module';
import { TopicsModule } from '../../topics/topics.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, LearningTopic, LearningModule, Result, TopicLink, TopicQuickLink]), LinksModule, TopicsModule],
  controllers: [PublicController],
})
export class PublicModule {}
