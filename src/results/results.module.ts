import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResultsService } from './results.service';
import { ResultsController } from './results.controller';
import { Result } from '../core/entities/result.entity';
import { ClassesModule } from '../classes/classes.module';
import { LearningModule } from '../core/entities/learning-module.entity';
import { ExamPointsMigration } from './exam-points';

@Module({
  imports: [TypeOrmModule.forFeature([Result, LearningModule]), ClassesModule],
  controllers: [ResultsController],
  providers: [ResultsService, ExamPointsMigration],
})
export class ResultsModule {}
