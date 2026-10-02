import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { School } from '../entities/school.entity';
import { User } from '../entities/user.entity';
import { TeacherGroup } from '../entities/teacher-group.entity';
import { AccountsModule } from '../../accounts/accounts.module';
import { SchoolsService } from './schools.service';
import { SchoolsController, MySchoolController } from './schools.controller';

@Module({
  imports: [TypeOrmModule.forFeature([School, User, TeacherGroup]), AccountsModule],
  providers: [SchoolsService],
  controllers: [SchoolsController, MySchoolController],
  exports: [SchoolsService],
})
export class SchoolsModule {}
