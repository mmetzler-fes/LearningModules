import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { User } from '../core/entities/user.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { Tag } from '../core/entities/tag.entity';
import { Result } from '../core/entities/result.entity';
import { TeacherGroup } from '../core/entities/teacher-group.entity';
import { School } from '../core/entities/school.entity';
import { BackupService } from './backup.service';
import { CloudBackupService } from './cloud-backup.service';
import { LearningModule } from '../core/entities/learning-module.entity';
import { AccountsModule } from '../accounts/accounts.module';
import { UserSheetService } from './user-sheet.service';
import { AuthModule } from '../auth/auth.module';
import { SchoolsModule } from '../core/schools/schools.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, SystemConfig, LearningTopic, LearningModule, TopicLink, TopicQuickLink, Tag, Result, TeacherGroup, School]),
    AuthModule,
    AccountsModule,
    SchoolsModule,
  ],
  controllers: [AdminController],
  providers: [UserSheetService, BackupService, CloudBackupService],
})
export class AdminModule {}
