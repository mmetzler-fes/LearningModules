import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TopicLink } from '../core/entities/topic-link.entity';
import { User } from '../core/entities/user.entity';
import { Result } from '../core/entities/result.entity';
import { LinksModule } from '../links/links.module';
import { CompanionModule } from '../companion/companion.module';
import { ContestService } from './contest.service';
import { ContestController } from './contest.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TopicLink, User, Result]), LinksModule, CompanionModule],
  controllers: [ContestController],
  providers: [ContestService],
})
export class ContestModule {}
