import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModuleTiming } from '../core/entities/module-timing.entity';
import { TimingsService } from './timings.service';

@Module({
  imports: [TypeOrmModule.forFeature([ModuleTiming])],
  providers: [TimingsService],
  exports: [TimingsService],
})
export class TimingsModule {}
