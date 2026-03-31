import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './core/entities/user.entity';
import { StudentClass } from './core/entities/student-class.entity';
import { LearningTopic } from './core/entities/learning-topic.entity';
import { LearningModule } from './core/entities/learning-module.entity';
import { Result } from './core/entities/result.entity';
import { MigrationModule } from './core/database/migration/migration.module';
import { AuthModule } from './auth/auth.module';
import { ResultsModule } from './results/results.module';
import { InterchangeModule } from './core/interchange/interchange.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TopicsModule } from './topics/topics.module';
import { join } from 'path';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'src', 'renderer'),
      serveRoot: '/',
      exclude: ['/api/(.*)'],
    }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'data/database.sqlite',
      entities: [User, StudentClass, LearningTopic, LearningModule, Result],
      synchronize: true, // Only for development; auto-syncs schema
    }),
    MigrationModule,
    AuthModule,
    ResultsModule,
    InterchangeModule,
    TopicsModule,
  ],
})
export class AppModule {}
