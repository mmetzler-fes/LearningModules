import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { OAuthService } from './oauth.service';

function extractBaseUrl(req: ExpressRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

function escapeHtml(str: string): string {
  return String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] || m));
}

function escapeAttr(str: string): string {
  return escapeHtml(str);
}

@Controller()
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  // ---- 1. Discovery / Metadata (RFC 8414) ----

  @Get(['.well-known/oauth-authorization-server', '.well-known/openid-configuration', 'oauth/.well-known/oauth-authorization-server', 'api/oauth/.well-known/oauth-authorization-server'])
  getMetadata(@Req() req: ExpressRequest) {
    const base = extractBaseUrl(req);
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      scopes_supported: ['mcp'],
    };
  }

  /** RFC 9728: Beschreibung des geschützten MCP-Servers – darauf zeigt die 401-Antwort von /api/mcp. */
  @Get(['.well-known/oauth-protected-resource', '.well-known/oauth-protected-resource/api/mcp'])
  getProtectedResource(@Req() req: ExpressRequest) {
    const base = extractBaseUrl(req);
    return { resource: `${base}/api/mcp`, authorization_servers: [base], scopes_supported: ['mcp'], bearer_methods_supported: ['header'] };
  }

  // ---- 2. Dynamic Client Registration (RFC 7591) ----

  @Post(['oauth/register', 'api/oauth/register'])
  @HttpCode(201)
  async register(@Req() req: ExpressRequest, @Body() body: any) {
    const base = extractBaseUrl(req);
    return this.oauthService.registerClient(body, base);
  }

  // ---- 3. Authorize-Seite (HTML Consent & Login) ----

  @Get(['oauth/authorize', 'api/oauth/authorize'])
  async authorizePage(@Req() req: ExpressRequest, @Res() res: Response, @Query() q: any) {
    const clientId = String(q.client_id || '');
    const redirectUri = String(q.redirect_uri || '');
    const state = String(q.state || '');
    const codeChallenge = String(q.code_challenge || '');
    const codeChallengeMethod = String(q.code_challenge_method || 'S256');
    const scope = String(q.scope || 'mcp');

    // Nur registrierte KIs mit ihrer hinterlegten Rücksprung-Adresse – sonst kein Formular, keine Weiterleitung.
    const client = await this.oauthService.checkedClient(clientId, redirectUri);
    if (!client) {
      res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8')
        .send('<!DOCTYPE html><meta charset="utf-8"><p style="font-family:sans-serif;padding:40px">❌ Unbekannte KI-Anwendung oder Rücksprung-Adresse. Bitte die Verbindung in der KI neu einrichten.</p>');
      return;
    }
    const clientName = client.clientName;
    const target = (() => { try { return new URL(redirectUri).host; } catch { return redirectUri; } })();

    const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KI-Verbindung zulassen – LearningModules</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f1f5f9; color: #1e293b; display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 20px;
    }
    .card {
      background: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      max-width: 440px; width: 100%; padding: 28px; border: 1px solid #e2e8f0;
    }
    h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: 8px; color: #0f172a; display: flex; align-items: center; gap: 8px; }
    p.lead { color: #64748b; font-size: 0.9rem; line-height: 1.45; margin-bottom: 20px; }
    .client-badge {
      background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 14px;
      margin-bottom: 20px; font-size: 0.95rem; font-weight: 600; color: #1d4ed8; display: flex; align-items: center; gap: 8px;
    }
    .info-list { list-style: none; margin-bottom: 24px; font-size: 0.85rem; color: #475569; }
    .info-list li { margin-bottom: 8px; padding-left: 20px; position: relative; }
    .info-list li::before { content: "✓"; position: absolute; left: 0; color: #16a34a; font-weight: bold; }
    .form-group { margin-bottom: 14px; text-align: left; }
    label { display: block; font-size: 0.82rem; font-weight: 600; margin-bottom: 4px; color: #334155; }
    input[type="text"], input[type="email"], input[type="password"] {
      width: 100%; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.95rem;
    }
    input:focus { outline: none; border-color: #2563eb; ring: 2px solid #93c5fd; }
    .actions { display: flex; gap: 10px; margin-top: 24px; }
    button {
      flex: 1; padding: 11px 16px; border-radius: 6px; font-size: 0.95rem; font-weight: 600; cursor: pointer; border: none;
    }
    .btn-primary { background: #2563eb; color: #ffffff; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-secondary { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
    .btn-secondary:hover { background: #e2e8f0; }
    .logged-in-box {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px;
      margin-bottom: 18px; font-size: 0.88rem; color: #334155;
    }
    .hint { font-size: 0.78rem; color: #94a3b8; text-align: center; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🤖 KI-Verbindung zulassen</h2>
    <p class="lead">Eine KI-Anwendung möchte sich als Assistent mit deinen Lernnotizbüchern und Plänen verbinden.</p>

    <div class="client-badge">
      🔌 <span>${escapeHtml(clientName)}</span>
    </div>
    <p class="lead">Nach dem Zulassen geht es zurück zu <strong>${escapeHtml(target)}</strong>. Stimmt das nicht mit deiner KI überein, bitte abbrechen.</p>

    <ul class="info-list">
      <li><strong>Keine Schülerdaten:</strong> Die KI sieht nur deine eigenen Notizbücher und Pläne.</li>
      <li><strong>Kontrolle:</strong> Jeder KI-Aufruf wird vorläufig übernommen und kann angenommen oder abgelehnt werden.</li>
      <li><strong>Schutz:</strong> Zugriff erfolgt nur, wenn der Zugang im KI-Assistenten eingeschaltet ist.</li>
      <li><strong>Jederzeit trennbar:</strong> Im KI-Assistenten mit einem Klick sofort trennbar.</li>
    </ul>

    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeAttr(clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeAttr(redirectUri)}">
      <input type="hidden" name="state" value="${escapeAttr(state)}">
      <input type="hidden" name="code_challenge" value="${escapeAttr(codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeAttr(codeChallengeMethod)}">
      <input type="hidden" name="scope" value="${escapeAttr(scope)}">
      <input type="hidden" name="token" id="authToken" value="">

      <div id="loginFields">
        <div class="form-group">
          <label for="email">E-Mail-Adresse</label>
          <input type="email" id="email" name="email" placeholder="name@schule.de" autocomplete="username">
        </div>
        <div class="form-group">
          <label for="password">Passwort</label>
          <input type="password" id="password" name="password" placeholder="••••••••" autocomplete="current-password">
        </div>
      </div>

      <p class="hint" id="msHint" style="text-align:left;margin:-4px 0 12px">Mit Microsoft angemeldet? Dann LearningModules in einem anderen Tab öffnen,
        mit „Angemeldet bleiben“ anmelden und diese Seite neu laden.</p>

      <div id="loggedInNotice" style="display:none;" class="logged-in-box">
        Angemeldet in LearningModules.
      </div>

      <div class="actions">
        <button type="submit" name="approve" value="false" class="btn-secondary">Abbrechen</button>
        <button type="submit" name="approve" value="true" class="btn-primary">✅ Zulassen</button>
      </div>
    </form>

    <p class="hint">LearningModules KI-Schnittstelle (OAuth 2.0 PKCE)</p>
  </div>

  <script>
    try {
      const t = localStorage.getItem('lm_token') || sessionStorage.getItem('lm_token');
      if (t) {
        document.getElementById('authToken').value = t;
        document.getElementById('loginFields').style.display = 'none';
        document.getElementById('msHint').style.display = 'none';
        document.getElementById('loggedInNotice').style.display = 'block';
      }
    } catch (_) {}
  </script>
</body>
</html>`;

    // Nicht in fremde Seiten einbetten (sonst ließe sich „Zulassen“ unterschieben).
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
  }

  // ---- 4. Authorize Submit ----

  @Post(['oauth/authorize', 'api/oauth/authorize'])
  async handleAuthorizeSubmit(@Req() req: ExpressRequest, @Res() res: Response, @Body() body: any) {
    const redirectUri = String(body.redirect_uri || '');
    const state = String(body.state || '');
    const clientId = String(body.client_id || '');
    const codeChallenge = String(body.code_challenge || '');
    const codeChallengeMethod = String(body.code_challenge_method || 'S256');

    const checked = await this.oauthService.checkedClient(clientId, redirectUri);
    if (!checked) throw new BadRequestException('Unbekannte KI-Anwendung oder Rücksprung-Adresse.');

    // Abgebrochen?
    if (String(body.approve) !== 'true') {
      const target = new URL(redirectUri);
      target.searchParams.set('error', 'access_denied');
      target.searchParams.set('error_description', 'Verbindung wurde vom Benutzer abgelehnt.');
      if (state) target.searchParams.set('state', state);
      res.redirect(target.toString());
      return;
    }

    const user = await this.oauthService.authenticateUserForAuthorize({
      email: body.email,
      password: body.password,
      token: body.token,
    });

    if (!user) {
      // Fehlgeschlagen: Zurück zur Authorize-Seite mit Fehlermeldung
      res.status(401).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px;">
        <h3>❌ Anmeldung fehlgeschlagen</h3>
        <p>E-Mail oder Passwort nicht korrekt oder kein Lehrkraft-Konto.</p>
        <p><a href="javascript:history.back()">Zurück und erneut versuchen</a></p>
      </body></html>`);
      return;
    }

    const code = await this.oauthService.createAuthorizationCode(
      user.id,
      clientId,
      checked.clientName,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
    );

    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    if (state) target.searchParams.set('state', state);
    res.redirect(target.toString());
  }

  // ---- 5. Token-Endpunkt (RFC 6749) ----

  @Post(['oauth/token', 'api/oauth/token'])
  @HttpCode(200)
  async token(@Body() body: any) {
    const grantType = String(body?.grant_type || '');
    if (grantType === 'authorization_code') {
      return this.oauthService.exchangeCode(
        String(body.client_id || ''),
        String(body.code || ''),
        String(body.redirect_uri || ''),
        String(body.code_verifier || ''),
      );
    }
    if (grantType === 'refresh_token') {
      return this.oauthService.refreshToken(
        String(body.client_id || ''),
        String(body.refresh_token || ''),
      );
    }
    throw new BadRequestException({ error: 'unsupported_grant_type', error_description: `Grant-Typ „${grantType}“ wird nicht unterstützt.` });
  }

  // ---- 6. Revoke-Endpunkt (RFC 7009) ----

  @Post(['oauth/revoke', 'api/oauth/revoke'])
  @HttpCode(200)
  async revoke(@Body() body: any) {
    return this.oauthService.revokeToken(String(body?.token || ''));
  }
}
