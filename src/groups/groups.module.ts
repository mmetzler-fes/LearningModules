import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { TeacherGroup } from '../core/entities/teacher-group.entity';
import { User } from '../core/entities/user.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { ShopModule } from '../shop/shop.module';

@Module({
  imports: [TypeOrmModule.forFeature([TeacherGroup, User, UseGrant]), ShopModule],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
