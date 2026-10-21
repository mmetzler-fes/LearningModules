import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { DocMirror } from '../core/entities/doc-mirror.entity';
import { DocMirrorService } from './doc-mirror.service';
import { TemplatesService } from './templates.service';
import { WorksheetTemplate } from '../core/entities/worksheet-template.entity';
import { User } from '../core/entities/user.entity';
import { FeaturesModule } from '../features/features.module';
import { NextcloudModule } from '../nextcloud/nextcloud.module';
import { WorksheetsController } from './worksheets.controller';
import { WorksheetsService } from './worksheets.service';
import { WorksheetRendererClient } from './renderer.client';
import { DocNumberingService } from './doc-numbering.service';
import { CourseService } from './course.service';
import { InterchangeModule } from '../core/interchange/interchange.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotebookNode, NotebookPlacement, LearningTopic, LearningModule, DocMirror, WorksheetTemplate, User]),
    FeaturesModule,
    NextcloudModule,
    InterchangeModule,
  ],
  controllers: [WorksheetsController],
  providers: [WorksheetsService, WorksheetRendererClient, DocNumberingService, CourseService, DocMirrorService, TemplatesService],
  exports: [WorksheetsService, DocNumberingService, CourseService, DocMirrorService, TemplatesService],
})
export class WorksheetsModule {}
