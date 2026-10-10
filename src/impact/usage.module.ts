import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsageCount } from '../core/entities/usage-count.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { Result } from '../core/entities/result.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { UsageService } from './usage.service';

/**
 * Zählen der Nutzung und die Einstellungen dazu – ohne Abhängigkeit vom
 * Shop, damit Schülerergebnisse (PublicModule, ContestModule) und der Shop
 * es gleichermaßen einbinden können. Die Auswertung liegt im ImpactModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UsageCount, LearningModule, LearningTopic, Result, SystemConfig])],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
