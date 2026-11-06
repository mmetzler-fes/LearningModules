import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanNode } from '../core/entities/plan-node.entity';
import { PlanEntry } from '../core/entities/plan-entry.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { ClassNotebook } from '../core/entities/class-notebook.entity';
import { StudentClass } from '../core/entities/student-class.entity';
import { NotebooksModule } from '../notebooks/notebooks.module';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PlanNode, PlanEntry, NotebookNode, NotebookPlacement, LearningTopic, ClassNotebook, StudentClass]), NotebooksModule],
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
