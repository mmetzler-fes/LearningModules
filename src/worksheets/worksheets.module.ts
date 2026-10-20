import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features/features.module';
import { WorksheetsController } from './worksheets.controller';
import { WorksheetsService } from './worksheets.service';
import { WorksheetRendererClient } from './renderer.client';

@Module({
  imports: [FeaturesModule],
  controllers: [WorksheetsController],
  providers: [WorksheetsService, WorksheetRendererClient],
  exports: [WorksheetsService],
})
export class WorksheetsModule {}
