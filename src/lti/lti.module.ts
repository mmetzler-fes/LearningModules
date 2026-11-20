import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LtiCourse, LtiGrade, LtiPlatform } from '../core/entities/lti.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { Result } from '../core/entities/result.entity';
import { User } from '../core/entities/user.entity';
import { CryptoModule } from '../core/crypto/crypto.module';
import { AuthModule } from '../auth/auth.module';
import { ClassbookModule } from '../classbook/classbook.module';
import { ClassesModule } from '../classes/classes.module';
import { LinksModule } from '../links/links.module';
import { LtiService } from './lti.service';
import { LtiController, SchoolLtiController } from './lti.controller';

@Module({
  imports: [TypeOrmModule.forFeature([LtiPlatform, LtiCourse, LtiGrade, SystemConfig, TopicLink, LearningTopic, Result, User]), CryptoModule, AuthModule, ClassbookModule, ClassesModule, LinksModule],
  controllers: [LtiController, SchoolLtiController],
  providers: [LtiService],
})
export class LtiModule {}
