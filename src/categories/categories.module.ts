import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../core/entities/category.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { Tag } from '../core/entities/tag.entity';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';

/** Kategorien (Fach, Bildungsstufe) – siehe docs/kategorien.md. */
@Module({
  imports: [TypeOrmModule.forFeature([Category, LearningTopic, Tag, ShopOffer])],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
