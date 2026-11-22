import { BadRequestException, ForbiddenException, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { AiBridgeClientRow } from '../core/entities/ai-bridge-client.entity';
import { AiBridgeConnectionRow } from '../core/entities/ai-bridge-connection.entity';
import { AiBridgeSessionRow } from '../core/entities/ai-bridge-session.entity';
import { User } from '../core/entities/user.entity';
import { AiBridgeService, AiBridgeSession } from './ai-bridge.service';
import { AuthService } from '../auth/auth.service';
import { SessionsService } from '../auth/sessions.service';
import { hasAcceptedTerms } from '../auth/terms';

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function verifyPkce(verifier: string, challenge: string, method = 'S256'): boolean {
  if (method === 'plain') return verifier === challenge;
  const hash = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return hash === challenge;
}

interface AuthCodeRecord {
  codeHash: string;
  userId: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: number;
}

@Injectable()
export class OAuthService {
  /** Unbestätigte / nicht eingelöste Authorization Codes (5 Minuten gültig) */
  private readonly codes = new Map<string, AuthCodeRecord>();

  constructor(
    @InjectRepository(AiBridgeClientRow) private readonly clientRepo: Repository<AiBridgeClientRow>,
    @InjectRepository(AiBridgeConnectionRow) private readonly connRepo: Repository<AiBridgeConnectionRow>,
    @InjectRepository(AiBridgeSessionRow) private readonly sessionRepo: Repository<AiBridgeSessionRow>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly bridge: AiBridgeService,
    private readonly auth: AuthService,
    private readonly jwtService: JwtService,
    @Optional() private readonly sessions?: SessionsService,
  ) {}

  /** RFC 7591: Dynamische Client-Registrierung (Claude.ai, ChatGPT, Claude Code …) */
  async registerClient(body: any, baseUrl: string) {
    const clientName = String(body?.client_name || '').trim() || 'KI-Assistent';
    const redirectUris = Array.isArray(body?.redirect_uris)
      ? body.redirect_uris.map(String).filter((u: string) => /^https:\/\//i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(u))
      : [];

    const clientId = `lmc_${crypto.randomBytes(16).toString('hex')}`;
    const clientSecret = `lms_${crypto.randomBytes(24).toString('hex')}`;

    const client = this.clientRepo.create({
      id: clientId,
      clientName,
      redirectUris,
      clientSecretHash: sha256(clientSecret),
    });
    await this.clientRepo.save(client);

    return {
      client_id: clientId,
      client_secret: clientSecret,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  async findClient(clientId: string): Promise<{ id: string; clientName: string; redirectUris: string[] } | null> {
    if (!clientId) return null;
    const row = await this.clientRepo.findOne({ where: { id: clientId } });
    if (row) return { id: row.id, clientName: row.clientName, redirectUris: row.redirectUris || [] };

    // Bekannte Standard-Clients (falls ein Client ohne Registrierung anfragt)
    const defaults: Record<string, string> = {
      claude: 'Claude.ai',
      'claude-ai': 'Claude.ai',
      'claude-code': 'Claude Code',
      chatgpt: 'ChatGPT',
    };
    if (defaults[clientId.toLowerCase()]) {
      return { id: clientId, clientName: defaults[clientId.toLowerCase()], redirectUris: [] };
    }
    return { id: clientId, clientName: 'KI-Anwendung', redirectUris: [] };
  }

  /**
   * Nur registrierte KIs, und nur an eine ihrer hinterlegten Rücksprung-Adressen (genau gleich).
   * Sonst ginge der Anmelde-Code an eine beliebige Adresse – wer sie kontrolliert, bekäme Zugriff.
   */
  async checkedClient(clientId: string, redirectUri: string): Promise<{ id: string; clientName: string; redirectUris: string[] } | null> {
    if (!clientId || !redirectUri) return null;
    const row = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!row || !(row.redirectUris || []).includes(redirectUri)) return null;
    return { id: row.id, clientName: row.clientName, redirectUris: row.redirectUris || [] };
  }

  /** Authorization Code nach Freigabe durch die Lehrkraft erzeugen */
  async createAuthorizationCode(
    userId: string,
    clientId: string,
    clientName: string,
    redirectUri: string,
    codeChallenge: string,
    codeChallengeMethod = 'S256',
  ): Promise<string> {
    // Abgelaufene Codes bereinigen
    const now = Date.now();
    for (const [k, v] of this.codes.entries()) {
      if (v.expiresAt <= now) this.codes.delete(k);
    }

    const code = `lmc_code_${crypto.randomBytes(24).toString('hex')}`;
    this.codes.set(sha256(code), {
      codeHash: sha256(code),
      userId,
      clientId,
      clientName,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      expiresAt: now + 5 * 60 * 1000,
    });
    return code;
  }

  /** Code gegen Token tauschen (mit PKCE-Prüfung) */
  async exchangeCode(clientId: string, code: string, redirectUri: string, codeVerifier: string) {
    if (!code) throw new BadRequestException({ error: 'invalid_request', error_description: 'Code fehlt.' });
    const record = this.codes.get(sha256(code));
    if (!record || record.expiresAt <= Date.now()) {
      if (record) this.codes.delete(sha256(code));
      throw new BadRequestException({ error: 'invalid_grant', error_description: 'Der Autorisierungscode ist ungültig oder abgelaufen.' });
    }
    // Einmalige Verwendung (RFC 6749)
    this.codes.delete(sha256(code));

    if (record.redirectUri && redirectUri && record.redirectUri !== redirectUri) {
      throw new BadRequestException({ error: 'invalid_grant', error_description: 'Die redirect_uri stimmt nicht überein.' });
    }

    if (record.codeChallenge) {
      if (!codeVerifier) {
        throw new BadRequestException({ error: 'invalid_grant', error_description: 'code_verifier fehlt (PKCE erforderlich).' });
      }
      if (!verifyPkce(codeVerifier, record.codeChallenge, record.codeChallengeMethod)) {
        throw new BadRequestException({ error: 'invalid_grant', error_description: 'PKCE-Prüfung fehlgeschlagen.' });
      }
    }

    // Sicherstellen, dass die Lehrkraft einen dauerhaften Zugang hat
    const persistentSession = await this.ensurePersistentSession(record.userId);

    const accessToken = `lma_oauth_${crypto.randomBytes(24).toString('hex')}`;
    const refreshToken = `lmr_${crypto.randomBytes(32).toString('hex')}`;
    const now = new Date();
    const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 Stunde

    const conn = this.connRepo.create({
      id: crypto.randomUUID(),
      userId: record.userId,
      clientId: record.clientId || clientId,
      clientName: record.clientName || 'KI-Verbindung',
      sessionId: persistentSession.id,
      accessTokenHash: sha256(accessToken),
      accessTokenExpiresAt: expiresAt,
      refreshTokenHash: sha256(refreshToken),
      createdAt: now,
      lastActiveAt: now,
      revokedAt: null,
    });
    await this.connRepo.save(conn);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: 'mcp',
    };
  }

  /** Token über Refresh-Token erneuern */
  async refreshToken(clientId: string, refreshToken: string) {
    if (!refreshToken) throw new BadRequestException({ error: 'invalid_request', error_description: 'refresh_token fehlt.' });
    const conn = await this.connRepo.findOne({
      where: { refreshTokenHash: sha256(refreshToken) },
    });
    if (!conn || conn.revokedAt) {
      throw new BadRequestException({ error: 'invalid_grant', error_description: 'Das Refresh-Token ist ungültig oder die Verbindung wurde getrennt.' });
    }

    const accessToken = `lma_oauth_${crypto.randomBytes(24).toString('hex')}`;
    conn.accessTokenHash = sha256(accessToken);
    conn.accessTokenExpiresAt = new Date(Date.now() + 3600 * 1000);
    conn.lastActiveAt = new Date();
    await this.connRepo.save(conn);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mcp',
    };
  }

  /** Token widerrufen (RFC 7009) */
  async revokeToken(token: string) {
    if (!token) return { success: true };
    const hash = sha256(token);
    const conn = (await this.connRepo.findOne({ where: { accessTokenHash: hash } }))
      || (await this.connRepo.findOne({ where: { refreshTokenHash: hash } }));
    if (conn && !conn.revokedAt) {
      conn.revokedAt = new Date();
      await this.connRepo.save(conn);
    }
    return { success: true };
  }

  /** Verbundene KIs der Lehrkraft auflisten */
  async listConnections(userId: string) {
    const rows = await this.connRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return rows.filter((r) => !r.revokedAt).map((r) => ({
      id: r.id,
      clientName: r.clientName,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt || Date.now())).toISOString(),
      lastActiveAt: (r.lastActiveAt instanceof Date ? r.lastActiveAt : new Date(r.lastActiveAt || Date.now())).toISOString(),
    }));
  }

  /** Verbindung trennen (sofort ungültig machen) */
  async disconnect(userId: string, connectionId: string) {
    const conn = await this.connRepo.findOne({ where: { id: connectionId, userId } });
    if (!conn) throw new BadRequestException('Verbindung nicht gefunden.');
    conn.revokedAt = new Date();
    await this.connRepo.save(conn);
    return { success: true };
  }

  /** Prüft, ob ein MCP-Token zu einer OAuth-Verbindung gehört */
  async sessionOfToken(rawToken: string | undefined): Promise<{ session: AiBridgeSession | null; expired?: boolean }> {
    const cleaned = String(rawToken || '').replace(/^Bearer\s+/i, '').trim();
    if (!cleaned.startsWith('lma_oauth_')) return { session: null };

    const conn = await this.connRepo.findOne({ where: { accessTokenHash: sha256(cleaned) } });
    if (!conn || conn.revokedAt) return { session: null };

    // Nach 1 Stunde abgelaufen -> Client muss Refresh-Token nutzen
    if (conn.accessTokenExpiresAt.getTime() <= Date.now()) {
      return { session: null, expired: true };
    }

    // Zuletzt aktiv aktualisieren (höchstens einmal alle 30s schreiben)
    const now = new Date();
    if (now.getTime() - new Date(conn.lastActiveAt).getTime() > 30_000) {
      await this.connRepo.update({ id: conn.id }, { lastActiveAt: now });
    }

    const sessionRow = await this.sessionRepo.findOne({ where: { id: conn.sessionId } });
    if (!sessionRow) return { session: null };
    return { session: this.bridge.fromRow(sessionRow) };
  }

  /** Dauerhafte Sitzung der Lehrkraft sicherstellen */
  private async ensurePersistentSession(userId: string): Promise<AiBridgeSession> {
    return this.bridge.getOrCreatePersistentSession(userId);
  }

  /** Benutzer anhand von Login oder JWT-Token authentifizieren */
  async authenticateUserForAuthorize(body: { email?: string; password?: string; token?: string }) {
    if (body.token) {
      try {
        const payload: any = this.jwtService.verify(body.token);
        // Wie die Anmeldung der App (jwt.strategy): keine Zwischen-Tokens, keine beendete Sitzung, Nutzungsbedingungen bestätigt.
        const sessionOk = !payload?.sid || !this.sessions || !!(await this.sessions.valid(payload.sid, payload.sub));
        if (payload?.sub && !payload.purpose && sessionOk) {
          const user = await this.userRepo.findOne({ where: { id: payload.sub } });
          if (user && user.active !== false && hasAcceptedTerms(user) && (user.role === 'teacher' || user.role === 'admin')) return user;
        }
      } catch { /* ungültiges Token */ }
    }

    if (body.email && body.password) {
      const loginRes: any = await this.auth.login(body.email.trim(), body.password);
      if (loginRes?.user?.id) {
        const user = await this.userRepo.findOne({ where: { id: loginRes.user.id } });
        if (user && user.active !== false && (user.role === 'teacher' || user.role === 'admin')) return user;
      }
    }
    return null;
  }
}
