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
import { GroupsModule } from '../../groups/groups.module';
import { CompanionModule } from '../../companion/companion.module';
import { ClassesModule } from '../../classes/classes.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, LearningTopic, LearningModule, Result, TopicLink, TopicQuickLink]), LinksModule, TopicsModule, GroupsModule, CompanionModule, ClassesModule],
  controllers: [PublicController],
})
export class PublicModule {}
