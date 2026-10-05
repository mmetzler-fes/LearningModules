import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LinksService } from './links.service';
import { LinksController } from './links.controller';
import { TopicLink } from '../core/entities/topic-link.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { TagsModule } from '../tags/tags.module';
import { TopicsModule } from '../topics/topics.module';
import { GroupsModule } from '../groups/groups.module';
import { CompanionModule } from '../companion/companion.module';
import { ClassesModule } from '../classes/classes.module';

@Module({
  imports: [TypeOrmModule.forFeature([TopicLink, LearningTopic, LearningModule]), TagsModule, TopicsModule, GroupsModule, CompanionModule, ClassesModule],
  controllers: [LinksController],
  providers: [LinksService],
  exports: [LinksService],
})
export class LinksModule {}
