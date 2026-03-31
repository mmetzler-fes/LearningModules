import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { H5pService } from './h5p/h5p.service';
import { ImportService } from './import/import.service';
import { LearningTopic } from '../entities/learning-topic.entity';
import { LearningModule } from '../entities/learning-module.entity';
import { InterchangeController } from './interchange.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([LearningTopic, LearningModule]),
  ],
  providers: [H5pService, ImportService],
  exports: [H5pService, ImportService],
  controllers: [InterchangeController],
})
export class InterchangeModule {}
