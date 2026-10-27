import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentWork } from '../core/entities/document-work.entity';
import { ExamAttempt } from '../core/entities/exam-attempt.entity';
import { DocumentVersion } from '../core/entities/document-version.entity';
import { RunProgress } from '../core/entities/run-progress.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { User } from '../core/entities/user.entity';
import { DocumentInk } from '../core/entities/document-ink.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { TeacherInkService } from './teacher-ink.service';
import { LinksModule } from '../links/links.module';
import { ClassesModule } from '../classes/classes.module';
import { WorkService } from './work.service';
import { ExamService } from './exam.service';
import { LiveService } from './live.service';
import { PublicWorkController, WorkController, PublicExamController, ExamController, PublicRunController, LiveController, TeacherInkController } from './work.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentWork, DocumentVersion, ExamAttempt, RunProgress, ClassStudent, User, DocumentInk, LearningModule, LearningTopic]), LinksModule, ClassesModule],
  controllers: [PublicWorkController, WorkController, PublicExamController, ExamController, PublicRunController, LiveController, TeacherInkController],
  providers: [WorkService, ExamService, LiveService, TeacherInkService],
  exports: [ExamService],
})
export class WorkModule {}
