import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { PlanNode } from '../core/entities/plan-node.entity';
import { PlanEntry } from '../core/entities/plan-entry.entity';
import { DocumentVersion } from '../core/entities/document-version.entity';
import { AiBridgeSessionRow } from '../core/entities/ai-bridge-session.entity';
import { AiBridgeClientRow } from '../core/entities/ai-bridge-client.entity';
import { AiBridgeConnectionRow } from '../core/entities/ai-bridge-connection.entity';
import { User } from '../core/entities/user.entity';
import { ModuleDraft } from '../core/entities/module-draft.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { NotebooksModule } from '../notebooks/notebooks.module';
import { PlansModule } from '../plans/plans.module';
import { TopicsModule } from '../topics/topics.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { AuthModule } from '../auth/auth.module';
import { AiBridgeService } from './ai-bridge.service';
import { OAuthService } from './oauth.service';
import { AiBridgeController, McpController } from './ai-bridge.controller';
import { OAuthController } from './oauth.controller';

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
      AiBridgeClientRow,
      AiBridgeConnectionRow,
      User,
      ModuleDraft,
      TopicLink,
    ]),
    NotebooksModule,
    PlansModule,
    TopicsModule,
    FeedbackModule,
    AuthModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secretKey',
    }),
  ],
  controllers: [AiBridgeController, McpController, OAuthController],
  providers: [AiBridgeService, OAuthService],
  exports: [AiBridgeService, OAuthService],
})
export class AiBridgeModule {}
