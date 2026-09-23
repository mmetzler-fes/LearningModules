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
import { UploadedFile } from '../core/entities/uploaded-file.entity';
import { TeacherGroup } from '../core/entities/teacher-group.entity';
import { HandoverService } from './handover.service';
import { UserSheetService } from './user-sheet.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, SystemConfig, LearningTopic, TopicLink, TopicQuickLink, Tag, Result, UploadedFile, TeacherGroup]),
    AuthModule,
  ],
  controllers: [AdminController],
  providers: [HandoverService, UserSheetService],
})
export class AdminModule {}
