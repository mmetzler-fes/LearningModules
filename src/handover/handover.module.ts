import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentHandover } from '../core/entities/content-handover.entity';
import { User } from '../core/entities/user.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { ContentHandoverService } from './content-handover.service';
import { ContentHandoverController } from './content-handover.controller';

/** Übergabe von Inhalten – siehe docs/uebergabe.md. */
@Module({
  imports: [TypeOrmModule.forFeature([ContentHandover, User, LearningTopic])],
  controllers: [ContentHandoverController],
  providers: [ContentHandoverService],
})
export class HandoverModule {}
