import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DrawingSource } from '../core/entities/drawing-source.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { NextcloudModule } from '../nextcloud/nextcloud.module';
import { WorksheetRendererClient } from '../worksheets/renderer.client';
import { DrawingsService } from './drawings.service';
import { DrawingsController } from './drawings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DrawingSource, LearningTopic, LearningModule]), NextcloudModule],
  providers: [DrawingsService, WorksheetRendererClient],
  controllers: [DrawingsController],
  exports: [DrawingsService],
})
export class DrawingsModule {}
