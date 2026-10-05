import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResultsService } from './results.service';
import { ResultsController } from './results.controller';
import { Result } from '../core/entities/result.entity';
import { ClassesModule } from '../classes/classes.module';

@Module({
  imports: [TypeOrmModule.forFeature([Result]), ClassesModule],
  controllers: [ResultsController],
  providers: [ResultsService],
})
export class ResultsModule {}
