import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentWork } from '../core/entities/document-work.entity';
import { ExamAttempt } from '../core/entities/exam-attempt.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { User } from '../core/entities/user.entity';
import { LinksModule } from '../links/links.module';
import { ClassesModule } from '../classes/classes.module';
import { WorkService } from './work.service';
import { ExamService } from './exam.service';
import { PublicWorkController, WorkController, PublicExamController, ExamController } from './work.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentWork, ExamAttempt, ClassStudent, User]), LinksModule, ClassesModule],
  controllers: [PublicWorkController, WorkController, PublicExamController, ExamController],
  providers: [WorkService, ExamService],
  exports: [ExamService],
})
export class WorkModule {}
