import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlantTemplate } from '../core/entities/plant-template.entity';
import { User } from '../core/entities/user.entity';
import { PlantLibraryService } from './plant-library.service';
import { PlantLibraryController } from './plant-library.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PlantTemplate, User])],
  controllers: [PlantLibraryController],
  providers: [PlantLibraryService],
})
export class PlantLibraryModule {}
