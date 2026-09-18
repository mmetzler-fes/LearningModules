import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));
  app.setGlobalPrefix('api');

  // API-Antworten dürfen weder vom Browser noch vom Reverse Proxy
  // zwischengespeichert werden – sonst zeigt z.B. die Benutzerliste nach dem
  // Anlegen weiterhin den alten Stand.
  app.use('/api', (_req: any, res: any, next: any) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  // Ensure at least one admin exists on startup
  const authService = app.get(AuthService);
  await authService.ensureAdminExists();

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
