import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClassesService } from './classes.service';
import { ClassesController } from './classes.controller';
import { StudentClass } from '../core/entities/student-class.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { Result } from '../core/entities/result.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { ClassShare } from '../core/entities/class-share.entity';
import { User } from '../core/entities/user.entity';
import { DocumentWork } from '../core/entities/document-work.entity';
import { ExamAttempt } from '../core/entities/exam-attempt.entity';
import { RunProgress } from '../core/entities/run-progress.entity';
import { ClassbookProgress } from '../core/entities/classbook-progress.entity';
import { ClassNotebook } from '../core/entities/class-notebook.entity';
import { ClassNotebookNode } from '../core/entities/class-notebook-node.entity';
import { ClassNotebookPlace } from '../core/entities/class-notebook-place.entity';
import { ClassBoard } from '../core/entities/class-board.entity';
import { ClassSolution } from '../core/entities/class-solution.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';

@Module({
  imports: [TypeOrmModule.forFeature([StudentClass, ClassStudent, SystemConfig, Result, TopicLink, ClassShare, User, DocumentWork, ExamAttempt, RunProgress, ClassbookProgress, ClassNotebook, ClassNotebookNode, ClassNotebookPlace, LearningTopic, LearningModule, ClassBoard, ClassSolution])],
  controllers: [ClassesController],
  providers: [ClassesService],
  exports: [ClassesService],
})
export class ClassesModule {}
