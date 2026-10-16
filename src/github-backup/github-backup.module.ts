import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GithubBackup } from '../core/entities/github-backup.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { User } from '../core/entities/user.entity';
import { InterchangeModule } from '../core/interchange/interchange.module';
import { GithubBackupController } from './github-backup.controller';
import { GithubBackupService } from './github-backup.service';

/** GitHub-Backup je Lehrkraft – siehe docs/github-backup.md. */
@Module({
  imports: [TypeOrmModule.forFeature([GithubBackup, LearningModule, LearningTopic, SystemConfig, User]), InterchangeModule],
  controllers: [GithubBackupController],
  providers: [GithubBackupService],
})
export class GithubBackupModule {}
