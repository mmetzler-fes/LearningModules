import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  // Ensure at least one admin exists on startup
  const authService = app.get(AuthService);
  await authService.ensureAdminExists();

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
