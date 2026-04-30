import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { User } from '../core/entities/user.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, SystemConfig]), AuthModule],
  controllers: [AdminController],
})
export class AdminModule {}
