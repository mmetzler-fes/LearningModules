import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SchoolSso } from '../core/entities/school-sso.entity';
import { School } from '../core/entities/school.entity';
import { User } from '../core/entities/user.entity';
import { MasterKeyService } from '../core/crypto/master-key.service';
import { AuthService } from '../auth/auth.service';
import { ClassbookService } from '../classbook/classbook.service';
import { LinksService } from '../links/links.service';
import { discover, emailOf, microsoftDiscoveryUrl, namesOf, pkce, randomToken, verifyIdToken } from './oidc';

type Purpose = 'teacher' | 'student';

interface Pending {
  schoolId: string;
  purpose: Purpose;
  classbook: string | null;
  /** Klassenlink (?l=) statt Klassenbuch – Schüler. */
  linkToken?: string | null;
  classId?: string | null;
  nonce: string;
  verifier: string;
  redirectUri: string;
  at: number;
}

const STATE_TTL = 10 * 60 * 1000;
const RESULT_TTL = 2 * 60 * 1000;
const MAX_PENDING = 2000;

/**
 * Anmeldung mit dem Schulkonto über OpenID Connect (docs/sso.md). Ablauf:
 * start → Anbieter (Microsoft) → callback (Code gegen ID-Token, prüfen, Konto finden) →
 * Weiterleitung in die App mit einem kurzlebigen Einlöse-Code → redeem liefert, was sonst
 * die Passwort- bzw. PIN-Anmeldung liefert. Nichts davon steht in der Adresse außer dem Einlöse-Code.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private readonly pending = new Map<string, Pending>();
  private readonly results = new Map<string, { at: number; purpose: Purpose; classbook: string | null; linkToken?: string | null; body: any }>();

  constructor(
    @InjectRepository(SchoolSso) private readonly ssoRepo: Repository<SchoolSso>,
    @InjectRepository(School) private readonly schoolRepo: Repository<School>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly masterKey: MasterKeyService,
    private readonly auth: AuthService,
    private readonly classbook: ClassbookService,
    private readonly links: LinksService,
  ) {}

  // ---- Schuladmin ----

  private async adminSchool(user: any): Promise<string> {
    const u = await this.userRepo.findOne({ where: { id: user?.userId } });
    if (!u?.schoolId || !(u.isSchoolAdmin || u.role === 'admin')) throw new ForbiddenException('Nur für Schuladmins.');
    return u.schoolId;
  }

  private view(c: SchoolSso | null, base: string) {
    return {
      provider: c?.provider || 'microsoft',
      tenant: c?.tenant || '',
      clientId: c?.clientId || '',
      hasSecret: !!c?.secretSealed,
      forTeachers: !!c?.forTeachers,
      forStudents: !!c?.forStudents,
      lastLoginAt: c?.lastLoginAt || null,
      redirectUri: `${base}/api/sso/callback`,
    };
  }

  async getConfig(user: any, base: string) {
    const schoolId = await this.adminSchool(user);
    return this.view(await this.ssoRepo.findOne({ where: { schoolId } }), base);
  }

  async saveConfig(user: any, body: any, base: string) {
    const schoolId = await this.adminSchool(user);
    const c = (await this.ssoRepo.findOne({ where: { schoolId } })) || this.ssoRepo.create({ id: crypto.randomUUID(), schoolId, provider: 'microsoft' });
    if (body?.tenant !== undefined) c.tenant = String(body.tenant || '').trim();
    if (body?.clientId !== undefined) c.clientId = String(body.clientId || '').trim();
    if (typeof body?.secret === 'string' && body.secret.trim()) {
      try {
        c.secretSealed = this.masterKey.encrypt('sso', body.secret.trim()).toString('base64');
      } catch (e: any) {
        this.logger.error(`SSO-Geheimnis nicht verschlüsselbar: ${e?.message || e}`);
        if (e?.status) throw e;
        throw new BadRequestException('Der Clientschlüssel lässt sich nicht verschlüsseln: Der Masterkey passt nicht zum Server-Geheimnis (APP_SECRET bzw. data/app-secret). Der Admin kann unter Administration → Shop & Sicherheit den Masterkey neu setzen.');
      }
    }
    if (body?.forTeachers !== undefined) c.forTeachers = !!body.forTeachers;
    if (body?.forStudents !== undefined) c.forStudents = !!body.forStudents;
    if ((c.forTeachers || c.forStudents) && !(c.tenant && c.clientId && c.secretSealed)) {
      throw new BadRequestException('Zum Einschalten fehlen Mandant, Client-ID oder Geheimnis.');
    }
    if (c.tenant) {
      try { microsoftDiscoveryUrl(c.tenant); } catch (e: any) { throw new BadRequestException(e.message); }
    }
    try {
      await this.ssoRepo.save(c);
    } catch (e: any) {
      this.logger.error(`SSO-Einstellungen nicht gespeichert: ${e?.message || e}`);
      throw new BadRequestException(`Speichern fehlgeschlagen: ${String(e?.message || e).slice(0, 200)}`);
    }
    return this.view(c, base);
  }

  /** Verbindung prüfen: Kennt Microsoft den Mandanten? (Client-ID und Geheimnis zeigt erst eine Anmeldung.) */
  async testConfig(user: any) {
    const schoolId = await this.adminSchool(user);
    const c = await this.ssoRepo.findOne({ where: { schoolId } });
    if (!c?.tenant) throw new BadRequestException('Bitte zuerst den Mandanten eintragen.');
    try {
      const d = await discover(microsoftDiscoveryUrl(c.tenant));
      return { success: true, issuer: d.issuer };
    } catch (e: any) {
      throw new BadRequestException(`Microsoft kennt den Mandanten nicht: ${e.message}`);
    }
  }

  // ---- Öffentlich: was die Anmeldeseiten anbieten ----

  private ready = (c: SchoolSso | null) => !!(c && c.tenant && c.clientId && c.secretSealed);

  /** Anmeldeseite der Lehrkräfte: Schulen mit „Mit Microsoft anmelden“. */
  async teacherOptions() {
    const all = (await this.ssoRepo.find({ where: { forTeachers: true } })).filter(this.ready);
    const schools = await Promise.all(all.map((c) => this.schoolRepo.findOne({ where: { id: c.schoolId } })));
    return { schools: all.map((c, i) => ({ schoolId: c.schoolId, name: schools[i]?.name || '', provider: c.provider })) };
  }

  /** Klassennotizbuch: Bietet die Schule der Lehrkraft die Anmeldung für Schüler an? */
  async classbookOption(token: string) {
    const { schoolId } = await this.classbook.ssoContext(token);
    const c = schoolId ? await this.ssoRepo.findOne({ where: { schoolId } }) : null;
    return { enabled: !!(c?.forStudents && this.ready(c)), provider: c?.provider || null };
  }

  /** Klasse und Schule hinter einem Klassenlink (?l=) – null, wenn es keiner mit Klasse ist. */
  private async linkContext(linkToken: string): Promise<{ classId: string; schoolId: string | null } | null> {
    const found = await this.links.linkOfToken(String(linkToken || ''));
    if (!found?.link?.classId) return null;
    const owner = found.link.ownerId ? await this.userRepo.findOne({ where: { id: found.link.ownerId } }) : null;
    return { classId: found.link.classId, schoolId: owner?.schoolId || null };
  }

  /** Klassenlink: Bietet die Schule der Lehrkraft die Anmeldung für Schüler an? */
  async linkOption(linkToken: string) {
    const ctx = await this.linkContext(linkToken);
    const c = ctx?.schoolId ? await this.ssoRepo.findOne({ where: { schoolId: ctx.schoolId } }) : null;
    return { enabled: !!(c?.forStudents && this.ready(c)), provider: c?.provider || null };
  }

  // ---- Ablauf ----

  private async configFor(schoolId: string, purpose: Purpose) {
    const c = await this.ssoRepo.findOne({ where: { schoolId } });
    if (!this.ready(c) || !(purpose === 'teacher' ? c!.forTeachers : c!.forStudents)) {
      throw new NotFoundException('Die Anmeldung mit dem Schulkonto ist hier nicht eingeschaltet.');
    }
    return c!;
  }

  private prune() {
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.at > STATE_TTL) this.pending.delete(k);
    for (const [k, v] of this.results) if (now - v.at > RESULT_TTL) this.results.delete(k);
  }

  /** Adresse beim Anbieter, zu der der Browser geschickt wird. */
  async start(q: { school?: string; purpose?: string; k?: string }, base: string): Promise<string> {
    this.prune();
    if (this.pending.size > MAX_PENDING) throw new BadRequestException('Gerade zu viele Anmeldungen – bitte gleich noch einmal.');
    const purpose: Purpose = q.purpose === 'student' ? 'student' : 'teacher';
    let schoolId = String(q.school || '');
    const classbook = purpose === 'student' && q.k ? String(q.k) : null;
    const linkToken = purpose === 'student' && !classbook && (q as any).l ? String((q as any).l) : null;
    let classId: string | null = null;
    if (purpose === 'student') {
      if (classbook) schoolId = (await this.classbook.ssoContext(classbook)).schoolId || '';
      else if (linkToken) {
        const ctx = await this.linkContext(linkToken);
        if (!ctx) throw new BadRequestException('Dieser Link gehört zu keiner Klasse.');
        schoolId = ctx.schoolId || '';
        classId = ctx.classId;
      } else throw new BadRequestException('Klassenbuch- oder Klassenlink fehlt.');
    }
    const c = await this.configFor(schoolId, purpose);
    const d = await discover(microsoftDiscoveryUrl(c.tenant));
    const state = randomToken();
    const nonce = randomToken();
    const { verifier, challenge } = pkce();
    const redirectUri = `${base}/api/sso/callback`;
    this.pending.set(state, { schoolId, purpose, classbook, linkToken, classId, nonce, verifier, redirectUri, at: Date.now() });
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: c.clientId, response_type: 'code', response_mode: 'query', redirect_uri: redirectUri,
      scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  /** Rückkehr vom Anbieter: prüfen, anmelden, Ergebnis für die App ablegen. Liefert die Zieladresse. */
  async callback(q: { code?: string; state?: string; error?: string; error_description?: string }, base: string, device: string): Promise<string> {
    this.prune();
    const p = q.state ? this.pending.get(String(q.state)) : undefined;
    if (q.state) this.pending.delete(String(q.state));
    const back = (pp: Pending | undefined, params: Record<string, string>) => {
      const sp = new URLSearchParams(params);
      if (pp?.purpose === 'student' && pp.classbook) sp.set('k', pp.classbook);
      if (pp?.purpose === 'student' && pp.linkToken) sp.set('l', pp.linkToken);
      return `${base}/?${sp.toString()}`;
    };
    if (!p) return back(undefined, { ssoError: 'Die Anmeldung ist abgelaufen. Bitte noch einmal versuchen.' });
    if (q.error) return back(p, { ssoError: q.error === 'access_denied' ? 'Anmeldung abgebrochen.' : `Microsoft: ${String(q.error_description || q.error).slice(0, 200)}` });
    try {
      const c = await this.configFor(p.schoolId, p.purpose);
      const d = await discover(microsoftDiscoveryUrl(c.tenant));
      const res = await fetch(d.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: c.clientId, client_secret: this.masterKey.decrypt(Buffer.from(c.secretSealed!, 'base64'), 'sso'),
          grant_type: 'authorization_code', code: String(q.code || ''), redirect_uri: p.redirectUri, code_verifier: p.verifier,
        }).toString(),
      });
      const tok: any = await res.json().catch(() => ({}));
      if (!res.ok || !tok.id_token) throw new Error(tok.error_description || tok.error || `Tausch fehlgeschlagen (HTTP ${res.status}).`);
      const claims = await verifyIdToken(tok.id_token, { jwksUri: d.jwks_uri, issuer: d.issuer, audience: c.clientId, nonce: p.nonce });
      let body: any;
      if (p.purpose === 'teacher') {
        body = await this.auth.ssoLogin(emailOf(claims), p.schoolId, { device });
      } else {
        const { firstName, lastName } = namesOf(claims);
        const subject = `${claims.iss}|${claims.oid || claims.sub}`;
        body = p.classbook
          ? await this.classbook.ssoLogin(p.classbook, { subject, firstName, lastName, email: emailOf(claims) })
          : await this.classbook.ssoLoginClassId(p.classId!, { subject, firstName, lastName, email: emailOf(claims) });
      }
      await this.ssoRepo.update({ id: c.id }, { lastLoginAt: new Date() });
      const code = randomToken();
      this.results.set(code, { at: Date.now(), purpose: p.purpose, classbook: p.classbook, linkToken: p.linkToken, body });
      return back(p, { sso: code });
    } catch (e: any) {
      this.logger.warn(`SSO-Anmeldung fehlgeschlagen: ${e?.message || e}`);
      const msg = e?.response?.message || e?.message || 'Anmeldung fehlgeschlagen.';
      return back(p, { ssoError: String(msg).slice(0, 300) });
    }
  }

  /** Einmal einlösbar, nur kurz gültig. */
  redeem(code: string) {
    this.prune();
    const r = this.results.get(String(code || ''));
    if (!r) throw new NotFoundException('Die Anmeldung ist abgelaufen. Bitte noch einmal versuchen.');
    this.results.delete(String(code));
    return { purpose: r.purpose, classbook: r.classbook, ...r.body };
  }
}
