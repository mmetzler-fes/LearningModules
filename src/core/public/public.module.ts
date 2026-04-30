import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicController } from './public.controller';
import { User } from '../entities/user.entity';
import { LearningTopic } from '../entities/learning-topic.entity';
import { LearningModule } from '../entities/learning-module.entity';
import { Result } from '../entities/result.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, LearningTopic, LearningModule, Result])],
  controllers: [PublicController],
})
export class PublicModule {}
