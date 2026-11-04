import { ClassNotebook } from '../core/entities/class-notebook.entity';
import { ClassNotebookNode } from '../core/entities/class-notebook-node.entity';
import { ClassNotebookPlace } from '../core/entities/class-notebook-place.entity';
import { User } from '../core/entities/user.entity';
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
import { TimingsModule } from '../timings/timings.module';

@Module({
  imports: [TypeOrmModule.forFeature([TopicLink, LearningTopic, LearningModule, ClassNotebook, ClassNotebookNode, ClassNotebookPlace, User]), TagsModule, TopicsModule, GroupsModule, CompanionModule, ClassesModule, TimingsModule],
  controllers: [LinksController],
  providers: [LinksService],
  exports: [LinksService],
})
export class LinksModule {}
