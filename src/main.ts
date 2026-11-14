import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { json, urlencoded } from 'express';
import { htmlAppHostGuard } from './html-apps/html-app-rules';
import { ShortLinksService } from './short-links/short-links.service';
import { shortLinkRedirect } from './short-links/short-link-redirect';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Zuerst: Die App-Adresse liefert nur die Rahmen der HTML-Apps (docs/html-apps.md).
  app.use(htmlAppHostGuard());
  // Kurzlinks /k/<code> (src/short-links) vor der Oberfläche – sonst käme die App.
  app.use(shortLinkRedirect(app.get(ShortLinksService)));
  // Den rohen Inhalt merken: Signierte Aufrufe verbundener Server werden
  // über genau diese Bytes geprüft (docs/vernetzung.md).
  app.use(json({ limit: '50mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
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
