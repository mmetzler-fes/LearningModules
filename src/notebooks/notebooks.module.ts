import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { TopicsModule } from '../topics/topics.module';
import { TagsModule } from '../tags/tags.module';
import { LinksModule } from '../links/links.module';
import { InterchangeModule } from '../core/interchange/interchange.module';
import { ShopModule } from '../shop/shop.module';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { User } from '../core/entities/user.entity';
import { NotebooksService } from './notebooks.service';
import { NotebooksController } from './notebooks.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotebookNode, NotebookPlacement, LearningTopic, LearningModule, ShopOffer, User]),
    TopicsModule,
    TagsModule,
    LinksModule,
    InterchangeModule,
    ShopModule,
  ],
  controllers: [NotebooksController],
  providers: [NotebooksService],
})
export class NotebooksModule {}
