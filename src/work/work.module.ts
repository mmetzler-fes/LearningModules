import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentWork } from '../core/entities/document-work.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { User } from '../core/entities/user.entity';
import { LinksModule } from '../links/links.module';
import { ClassesModule } from '../classes/classes.module';
import { WorkService } from './work.service';
import { PublicWorkController, WorkController } from './work.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentWork, ClassStudent, User]), LinksModule, ClassesModule],
  controllers: [PublicWorkController, WorkController],
  providers: [WorkService],
})
export class WorkModule {}
