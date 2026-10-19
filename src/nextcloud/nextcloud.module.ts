import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NextcloudLink } from '../core/entities/nextcloud-link.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { NextcloudController } from './nextcloud.controller';
import { NextcloudService } from './nextcloud.service';

/** Nextcloud je Lehrkraft für die Bilder der Module – siehe docs/nextcloud.md. */
@Module({
  imports: [TypeOrmModule.forFeature([NextcloudLink, LearningTopic, SystemConfig])],
  controllers: [NextcloudController],
  providers: [NextcloudService],
  exports: [NextcloudService],
})
export class NextcloudModule {}
