import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Feedback } from '../core/entities/feedback.entity';
import { User } from '../core/entities/user.entity';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Feedback, User])],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
