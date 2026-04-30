import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MigrationService } from './migration.service';
import { User } from '../../entities/user.entity';
import { StudentClass } from '../../entities/student-class.entity';
import { LearningTopic } from '../../entities/learning-topic.entity';
import { LearningModule } from '../../entities/learning-module.entity';
import { DemoDataModule } from './demo-data.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, StudentClass, LearningTopic, LearningModule]),
    DemoDataModule,
  ],
  providers: [MigrationService],
  exports: [MigrationService],
})
export class MigrationModule {}
