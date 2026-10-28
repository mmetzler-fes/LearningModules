import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClassNotebook } from '../core/entities/class-notebook.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { Result } from '../core/entities/result.entity';
import { DocumentWork } from '../core/entities/document-work.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { User } from '../core/entities/user.entity';
import { ExamAttempt } from '../core/entities/exam-attempt.entity';
import { ClassNotebookNode } from '../core/entities/class-notebook-node.entity';
import { ClassNotebookPlace } from '../core/entities/class-notebook-place.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LinksModule } from '../links/links.module';
import { ClassesModule } from '../classes/classes.module';
import { NotebooksModule } from '../notebooks/notebooks.module';
import { ContestModule } from '../contest/contest.module';
import { ClassbookService } from './classbook.service';
import { ClassbookController, PublicClassbookController } from './classbook.controller';
import { WebappController } from './webapp.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ClassNotebook, ClassStudent, Result, DocumentWork, TopicLink, User, ExamAttempt, ClassNotebookNode, ClassNotebookPlace, LearningTopic, LearningModule, NotebookNode, NotebookPlacement]), LinksModule, ClassesModule, NotebooksModule, ContestModule],
  controllers: [ClassbookController, PublicClassbookController, WebappController],
  providers: [ClassbookService],
})
export class ClassbookModule {}
