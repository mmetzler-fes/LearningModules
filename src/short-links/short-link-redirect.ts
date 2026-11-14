import type { ShortLinksService } from './short-links.service';

const page = (title: string, text: string) => `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32em;margin:3em auto;padding:0 16px;color:#222}</style></head>
<body><h1>${title}</h1><p>${text}</p></body></html>`;

/**
 * `GET /k/<code>` → Weiterleitung auf die hinterlegte Adresse. Außerhalb von
 * /api, damit der Link kurz bleibt; vor der Oberfläche eingehängt (main.ts),
 * sonst lieferte die statische Auslieferung die App statt der Weiterleitung.
 * 302 statt 301: Ändert die Lehrkraft das Ziel, folgen auch Browser, die den
 * Link schon kennen.
 */
export function shortLinkRedirect(links: ShortLinksService) {
  return async (req: any, res: any, next: any) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const m = /^\/k\/([A-Za-z0-9]+)\/?$/.exec(req.path || '');
    if (!m) return next();
    try {
      const url = await links.resolve(m[1]);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (!url) {
        res.status(404).type('html').send(page('Kurzlink unbekannt', 'Diesen Kurzlink gibt es nicht (mehr). Bitte bei der Lehrkraft nachfragen.'));
        return;
      }
      res.redirect(302, url);
    } catch (e) {
      next(e);
    }
  };
}
