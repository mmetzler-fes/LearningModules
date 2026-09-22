import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './core/entities/user.entity';
import { StudentClass } from './core/entities/student-class.entity';
import { LearningTopic } from './core/entities/learning-topic.entity';
import { LearningModule } from './core/entities/learning-module.entity';
import { Result } from './core/entities/result.entity';
import { School } from './core/entities/school.entity';
import { SystemConfig } from './core/entities/system-config.entity';
import { Tag } from './core/entities/tag.entity';
import { TopicLink } from './core/entities/topic-link.entity';
import { UploadedFile } from './core/entities/uploaded-file.entity';
import { MigrationModule } from './core/database/migration/migration.module';
import { MailModule } from './core/mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { ResultsModule } from './results/results.module';
import { InterchangeModule } from './core/interchange/interchange.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TopicsModule } from './topics/topics.module';
import { AdminModule } from './admin/admin.module';
import { PublicModule } from './core/public/public.module';
import { TagsModule } from './tags/tags.module';
import { LinksModule } from './links/links.module';
import { FilesModule } from './files/files.module';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'src', 'renderer'),
      serveRoot: '/',
      exclude: ['/api*'],
      serveStaticOptions: {
        // HTML, JS und CSS tragen keine Versionskennung im Namen. Ohne
        // Rückfrage beim Server kann ein Proxy oder Browser nach einem Update
        // beliebig lange die alte Oberfläche ausliefern – mit neuem Backend
        // und altem Frontend als Ergebnis.
        setHeaders: (res: any, path: string) => {
          if (/\.(html|js|css)$/i.test(path)) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
          }
        },
      },
    }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'data/database.sqlite',
      entities: [User, StudentClass, LearningTopic, LearningModule, Result, School, SystemConfig, Tag, TopicLink, UploadedFile],
      synchronize: true,
    }),
    MailModule,
    MigrationModule,
    AuthModule,
    ResultsModule,
    InterchangeModule,
    TopicsModule,
    AdminModule,
    TagsModule,
    LinksModule,
    FilesModule,
    PublicModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
