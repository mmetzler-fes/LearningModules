import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NextcloudLink } from '../core/entities/nextcloud-link.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { DocumentInk } from '../core/entities/document-ink.entity';
import { HtmlAppFile } from '../core/entities/html-app-file.entity';
import { NextcloudModule } from '../nextcloud/nextcloud.module';
import { SicherungService } from './sicherung.service';
import { SicherungController } from './sicherung.controller';

@Module({
  imports: [TypeOrmModule.forFeature([NextcloudLink, NotebookNode, NotebookPlacement, LearningTopic, LearningModule, DocumentInk, HtmlAppFile]), NextcloudModule],
  controllers: [SicherungController],
  providers: [SicherungService],
  exports: [SicherungService],
})
export class SicherungModule {}
