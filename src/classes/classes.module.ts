import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClassesService } from './classes.service';
import { ClassesController } from './classes.controller';
import { StudentClass } from '../core/entities/student-class.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { Result } from '../core/entities/result.entity';

@Module({
  imports: [TypeOrmModule.forFeature([StudentClass, ClassStudent, SystemConfig, Result])],
  controllers: [ClassesController],
  providers: [ClassesService],
  exports: [ClassesService],
})
export class ClassesModule {}
