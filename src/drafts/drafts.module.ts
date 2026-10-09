import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModuleDraft } from '../core/entities/module-draft.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { TopicsModule } from '../topics/topics.module';
import { DraftsService } from './drafts.service';
import { DraftsController } from './drafts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ModuleDraft, LearningModule]), TopicsModule],
  controllers: [DraftsController],
  providers: [DraftsService],
})
export class DraftsModule {}
