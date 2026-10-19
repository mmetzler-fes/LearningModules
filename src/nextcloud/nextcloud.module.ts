import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NextcloudLink } from '../core/entities/nextcloud-link.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { User } from '../core/entities/user.entity';
import { NextcloudController } from './nextcloud.controller';
import { NextcloudService } from './nextcloud.service';
import { NextcloudBackupService } from './nextcloud-backup.service';

/** Nextcloud je Lehrkraft für die Bilder der Module – siehe docs/nextcloud.md. */
@Module({
  imports: [TypeOrmModule.forFeature([NextcloudLink, LearningTopic, LearningModule, SystemConfig, User])],
  controllers: [NextcloudController],
  providers: [NextcloudService, NextcloudBackupService],
  exports: [NextcloudService],
})
export class NextcloudModule {}
