import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { PlanNode } from '../core/entities/plan-node.entity';
import { PlanEntry } from '../core/entities/plan-entry.entity';
import { DocumentVersion } from '../core/entities/document-version.entity';
import { AiBridgeSessionRow } from '../core/entities/ai-bridge-session.entity';
import { NotebooksModule } from '../notebooks/notebooks.module';
import { PlansModule } from '../plans/plans.module';
import { TopicsModule } from '../topics/topics.module';
import { AiBridgeService } from './ai-bridge.service';
import { AiBridgeController } from './ai-bridge.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotebookNode,
      NotebookPlacement,
      LearningTopic,
      LearningModule,
      PlanNode,
      PlanEntry,
      DocumentVersion,
      AiBridgeSessionRow,
    ]),
    NotebooksModule,
    PlansModule,
    TopicsModule,
  ],
  controllers: [AiBridgeController],
  providers: [AiBridgeService],
  exports: [AiBridgeService],
})
export class AiBridgeModule {}

