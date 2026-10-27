import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from '../core/entities/user.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { AuthSession } from '../core/entities/auth-session.entity';
import { SessionsService } from './sessions.service';
import { GroupsModule } from '../groups/groups.module';
import { AccountsModule } from '../accounts/accounts.module';
import { SchoolsModule } from '../core/schools/schools.module';
import { FeaturesModule } from '../features/features.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, SystemConfig, AuthSession]),
    GroupsModule,
    AccountsModule,
    SchoolsModule,
    FeaturesModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secretKey',
      // Die Gültigkeit setzt AuthService je Sitzung ("Angemeldet bleiben").
      signOptions: { expiresIn: '12h' },
    }),
  ],
  providers: [AuthService, JwtStrategy, SessionsService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
