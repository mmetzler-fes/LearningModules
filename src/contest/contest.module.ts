import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TopicLink } from '../core/entities/topic-link.entity';
import { User } from '../core/entities/user.entity';
import { Result } from '../core/entities/result.entity';
import { LinksModule } from '../links/links.module';
import { CompanionModule } from '../companion/companion.module';
import { ClassesModule } from '../classes/classes.module';
import { TimingsModule } from '../timings/timings.module';
import { ContestService } from './contest.service';
import { ContestController } from './contest.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TopicLink, User, Result]), LinksModule, CompanionModule, ClassesModule, TimingsModule],
  controllers: [ContestController],
  providers: [ContestService],
})
export class ContestModule {}
