import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MigrationService } from './migration.service';
import { User } from '../../entities/user.entity';
import { StudentClass } from '../../entities/student-class.entity';
import { LearningTopic } from '../../entities/learning-topic.entity';
import { LearningModule } from '../../entities/learning-module.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, StudentClass, LearningTopic, LearningModule]),
  ],
  providers: [MigrationService],
  exports: [MigrationService],
})
export class MigrationModule {}
