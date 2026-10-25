import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentWork } from '../core/entities/document-work.entity';
import { ExamAttempt } from '../core/entities/exam-attempt.entity';
import { DocumentVersion } from '../core/entities/document-version.entity';
import { RunProgress } from '../core/entities/run-progress.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { User } from '../core/entities/user.entity';
import { LinksModule } from '../links/links.module';
import { ClassesModule } from '../classes/classes.module';
import { WorkService } from './work.service';
import { ExamService } from './exam.service';
import { LiveService } from './live.service';
import { PublicWorkController, WorkController, PublicExamController, ExamController, PublicRunController, LiveController } from './work.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentWork, DocumentVersion, ExamAttempt, RunProgress, ClassStudent, User]), LinksModule, ClassesModule],
  controllers: [PublicWorkController, WorkController, PublicExamController, ExamController, PublicRunController, LiveController],
  providers: [WorkService, ExamService, LiveService],
  exports: [ExamService],
})
export class WorkModule {}
