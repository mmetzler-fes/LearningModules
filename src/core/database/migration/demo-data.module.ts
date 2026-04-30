import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DemoDataService } from './demo-data.service';
import { User } from '../../entities/user.entity';
import { School } from '../../entities/school.entity';
import { StudentClass } from '../../entities/student-class.entity';

import { DemoDataController } from './demo-data.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, School, StudentClass])],
  providers: [DemoDataService],
  controllers: [DemoDataController],
  exports: [DemoDataService],
})
export class DemoDataModule {}
