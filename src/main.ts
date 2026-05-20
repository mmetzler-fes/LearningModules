import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));
  app.setGlobalPrefix('api');

  // Ensure at least one admin exists on startup
  const authService = app.get(AuthService);
  await authService.ensureAdminExists();

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
