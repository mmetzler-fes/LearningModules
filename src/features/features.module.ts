import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../core/entities/user.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { FeaturesService } from './features.service';
import { FeaturesController } from './features.controller';
import { FeatureGuard } from './feature.guard';

@Module({
  imports: [TypeOrmModule.forFeature([User, SystemConfig])],
  controllers: [FeaturesController],
  providers: [FeaturesService, FeatureGuard],
  exports: [FeaturesService, FeatureGuard],
})
export class FeaturesModule {}
