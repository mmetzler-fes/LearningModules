import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { H5pService } from './h5p/h5p.service';
import { ImportService } from './import/import.service';
import { ExportService } from './export/export.service';
import { LearningTopic } from '../entities/learning-topic.entity';
import { LearningModule } from '../entities/learning-module.entity';
import { User } from '../entities/user.entity';
import { InterchangeController } from './interchange.controller';
import { TopicsModule } from '../../topics/topics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LearningTopic, LearningModule, User]),
    TopicsModule,
  ],
  providers: [H5pService, ImportService, ExportService],
  exports: [H5pService, ImportService, ExportService],
  controllers: [InterchangeController],
})
export class InterchangeModule {}
