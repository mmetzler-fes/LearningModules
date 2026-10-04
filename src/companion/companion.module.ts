import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../core/entities/user.entity';
import { School } from '../core/entities/school.entity';
import { CompanionService } from './companion.service';
import { CompanionController } from './companion.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, School])],
  controllers: [CompanionController],
  providers: [CompanionService],
  exports: [CompanionService],
})
export class CompanionModule {}
