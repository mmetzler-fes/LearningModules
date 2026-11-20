import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SchoolSso } from '../core/entities/school-sso.entity';
import { School } from '../core/entities/school.entity';
import { User } from '../core/entities/user.entity';
import { CryptoModule } from '../core/crypto/crypto.module';
import { AuthModule } from '../auth/auth.module';
import { ClassbookModule } from '../classbook/classbook.module';
import { LinksModule } from '../links/links.module';
import { SsoService } from './sso.service';
import { SchoolSsoController, SsoController } from './sso.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SchoolSso, School, User]), CryptoModule, AuthModule, ClassbookModule, LinksModule],
  controllers: [SsoController, SchoolSsoController],
  providers: [SsoService],
})
export class SsoModule {}
