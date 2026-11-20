import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { LtiCourse, LtiGrade, LtiPlatform } from '../core/entities/lti.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { Result } from '../core/entities/result.entity';
import { User } from '../core/entities/user.entity';
import { MasterKeyService } from '../core/crypto/master-key.service';
import { AuthService } from '../auth/auth.service';
import { ClassbookService } from '../classbook/classbook.service';
import { ClassesService } from '../classes/classes.service';
import { LinksService } from '../links/links.service';
import { onResultSaved, SavedResult } from '../core/result-events';
import { emailOf, namesOf, randomToken, verifyIdToken } from '../sso/oidc';

const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/';
const DL = 'https://purl.imsglobal.org/spec/lti-dl/claim/';
const AGS = 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint';
const SCORE_SCOPE = 'https://purl.imsglobal.org/spec/lti-ags/scope/score';
const TEACHER_ROLES = /#(Instructor|Administrator|ContentDeveloper|Mentor)$|\/(Instructor|Administrator)$/;
const STATE_TTL = 10 * 60 * 1000;
const CODE_TTL = 10 * 60 * 1000;

const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function signJwt(payload: any, privateKey: crypto.KeyObject, kid: string): string {
  const head = b64({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64(payload);
  return `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

/** Adresse des Bewertungsaspekts + „/scores“ (Query bleibt hinten). */
export function scoresUrl(lineitem: string): string {
  const [path, query] = lineitem.split('?');
  return `${path.replace(/\/+$/, '')}/scores${query ? `?${query}` : ''}`;
}

interface Code {
  at: number;
  kind: 'student' | 'teacher' | 'deep';
  body: any;
  deep?: { platformId: string; contextId: string; contextTitle: string; deploymentId: string; returnUrl: string; data?: string; userId: string };
}

/**
 * LTI 1.3 Tool (docs/lti.md): Moodle startet LearningModules mit einem signierten Ausweis.
 * Lehrkräfte → ihr Konto (E-Mail), Schüler → Klasse des Kurses ohne Name und PIN, Deep Linking wählt
 * Lernthema und Klasse, das beste Ergebnis geht über AGS ans Moodle-Notenbuch.
 */
@Injectable()
export class LtiService implements OnModuleInit {
  private readonly logger = new Logger(LtiService.name);
  private readonly pending = new Map<string, { platformId: string; nonce: string; at: number }>();
  private readonly codes = new Map<string, Code>();
  private readonly tokens = new Map<string, { token: string; until: number }>();
  private key: { kid: string; publicJwk: any; privateKey: crypto.KeyObject } | null = null;

  constructor(
    @InjectRepository(LtiPlatform) private readonly platformRepo: Repository<LtiPlatform>,
    @InjectRepository(LtiCourse) private readonly courseRepo: Repository<LtiCourse>,
    @InjectRepository(LtiGrade) private readonly gradeRepo: Repository<LtiGrade>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly masterKey: MasterKeyService,
    private readonly auth: AuthService,
    private readonly classbook: ClassbookService,
    private readonly classes: ClassesService,
    private readonly links: LinksService,
  ) {}

  onModuleInit() {
    onResultSaved((r) => this.sendGrade(r));
  }

  // ---- Schlüssel des Tools ----

  async toolKey() {
    if (this.key) return this.key;
    const row = await this.configRepo.findOne({ where: { key: 'lti.toolKey' } });
    if (row?.value?.sealed) {
      const pem = this.masterKey.decrypt(Buffer.from(row.value.sealed, 'base64'), 'lti');
      this.key = { kid: row.value.kid, publicJwk: row.value.publicJwk, privateKey: crypto.createPrivateKey(pem) };
      return this.key;
    }
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = randomToken(9);
    const publicJwk = { ...(publicKey.export({ format: 'jwk' }) as any), kid, alg: 'RS256', use: 'sig' };
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    await this.configRepo.save({ key: 'lti.toolKey', value: { kid, publicJwk, sealed: this.masterKey.encrypt('lti', pem).toString('base64') } } as any);
    this.key = { kid, publicJwk, privateKey };
    return this.key;
  }

  async jwks() {
    return { keys: [(await this.toolKey()).publicJwk] };
  }

  // ---- Schuladmin ----

  private async adminSchool(user: any): Promise<string> {
    const u = await this.userRepo.findOne({ where: { id: user?.userId } });
    if (!u?.schoolId || !(u.isSchoolAdmin || u.role === 'admin')) throw new ForbiddenException('Nur für Schuladmins.');
    return u.schoolId;
  }

  toolUrls(base: string) {
    return {
      toolUrl: `${base}/api/lti/launch`,
      loginUrl: `${base}/api/lti/login`,
      redirectUrl: `${base}/api/lti/launch`,
      jwksUrl: `${base}/api/lti/jwks`,
      deepLinkUrl: `${base}/api/lti/launch`,
    };
  }

  async getConfig(user: any, base: string) {
    const schoolId = await this.adminSchool(user);
    const p = await this.platformRepo.findOne({ where: { schoolId } });
    return {
      tool: this.toolUrls(base),
      platform: p ? { name: p.name, issuer: p.issuer, clientId: p.clientId, deploymentIds: p.deploymentIds || [], authLoginUrl: p.authLoginUrl, tokenUrl: p.tokenUrl, jwksUrl: p.jwksUrl, active: p.active, lastLaunchAt: p.lastLaunchAt } : null,
    };
  }

  async saveConfig(user: any, body: any, base: string) {
    const schoolId = await this.adminSchool(user);
    const url = (v: any, what: string) => {
      const s = String(v || '').trim();
      if (!/^https?:\/\/[^\s]+$/i.test(s)) throw new BadRequestException(`${what}: bitte die vollständige Adresse aus Moodle eintragen.`);
      return s;
    };
    const p = (await this.platformRepo.findOne({ where: { schoolId } })) || this.platformRepo.create({ id: crypto.randomUUID(), schoolId });
    p.name = String(body?.name || 'Moodle').trim().slice(0, 60) || 'Moodle';
    p.issuer = url(body?.issuer, 'Plattform-ID').replace(/\/+$/, '');
    p.clientId = String(body?.clientId || '').trim();
    if (!p.clientId) throw new BadRequestException('Client-ID fehlt.');
    p.deploymentIds = String(body?.deploymentIds ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    p.authLoginUrl = url(body?.authLoginUrl, 'Authentifizierungsanfrage-URL');
    p.tokenUrl = url(body?.tokenUrl, 'Zugriffstoken-URL');
    p.jwksUrl = url(body?.jwksUrl, 'Öffentlicher Schlüsselsatz-URL');
    p.active = body?.active !== false;
    const clash = await this.platformRepo.findOne({ where: { issuer: p.issuer, clientId: p.clientId } });
    if (clash && clash.id !== p.id) throw new BadRequestException('Diese Plattform ist schon bei einer anderen Schule eingetragen.');
    await this.platformRepo.save(p);
    return this.getConfig(user, base);
  }

  // ---- Start (OIDC, von der Plattform ausgelöst) ----

  private prune() {
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.at > STATE_TTL) this.pending.delete(k);
    for (const [k, v] of this.codes) if (now - v.at > CODE_TTL) this.codes.delete(k);
  }

  async login(q: any, base: string): Promise<string> {
    this.prune();
    const iss = String(q?.iss || '').replace(/\/+$/, '');
    const where: any = { issuer: iss, active: true };
    if (q?.client_id) where.clientId = String(q.client_id);
    const p = await this.platformRepo.findOne({ where });
    if (!p) throw new NotFoundException('Diese Lernplattform ist in LearningModules nicht eingetragen.');
    const state = randomToken();
    const nonce = randomToken();
    this.pending.set(state, { platformId: p.id, nonce, at: Date.now() });
    const u = new URL(p.authLoginUrl);
    const sp = new URLSearchParams({
      scope: 'openid', response_type: 'id_token', response_mode: 'form_post', prompt: 'none',
      client_id: p.clientId, redirect_uri: `${base}/api/lti/launch`, login_hint: String(q?.login_hint || ''), state, nonce,
    });
    if (q?.lti_message_hint) sp.set('lti_message_hint', String(q.lti_message_hint));
    u.search = sp.toString();
    return u.toString();
  }

  /** Ausweis aus Moodle prüfen und weiterleiten (liefert die Zieladresse in LearningModules). */
  async launch(body: any, base: string): Promise<string> {
    this.prune();
    const pend = body?.state ? this.pending.get(String(body.state)) : undefined;
    if (body?.state) this.pending.delete(String(body.state));
    if (!pend) return `${base}/?ltiError=${encodeURIComponent('Der Start aus Moodle ist abgelaufen. Bitte die Aktivität noch einmal öffnen.')}`;
    try {
      const p = await this.platformRepo.findOne({ where: { id: pend.platformId } });
      if (!p?.active) throw new Error('Die Lernplattform ist ausgeschaltet.');
      const c: any = await verifyIdToken(String(body?.id_token || ''), { jwksUri: p.jwksUrl, issuer: p.issuer, audience: p.clientId, nonce: pend.nonce });
      const deployment = String(c[CLAIM + 'deployment_id'] || '');
      if ((p.deploymentIds || []).length && !p.deploymentIds!.includes(deployment)) throw new Error('Unbekannte Deployment-ID – bitte im Admin-Bereich eintragen.');
      if (c[CLAIM + 'version'] !== '1.3.0') throw new Error('Nur LTI 1.3 wird unterstützt.');
      await this.platformRepo.update({ id: p.id }, { lastLaunchAt: new Date() });
      const type = String(c[CLAIM + 'message_type'] || '');
      const roles: string[] = Array.isArray(c[CLAIM + 'roles']) ? c[CLAIM + 'roles'] : [];
      const teacher = roles.some((r) => TEACHER_ROLES.test(r));
      const context = c[CLAIM + 'context'] || {};
      const custom = c[CLAIM + 'custom'] || {};

      if (type === 'LtiDeepLinkingRequest') {
        if (!teacher) throw new Error('Inhalte auswählen dürfen nur Lehrkräfte.');
        const session = await this.auth.ssoLogin(emailOf(c), p.schoolId, { device: 'Moodle' });
        const settings = c[DL + 'deep_linking_settings'] || {};
        const userId = (session as any).id;
        return this.codeUrl(base, {
          kind: 'deep', body: { session },
          deep: { platformId: p.id, contextId: String(context.id || ''), contextTitle: String(context.title || context.label || 'Moodle-Kurs'), deploymentId: deployment, returnUrl: String(settings.deep_link_return_url || ''), data: settings.data, userId },
        });
      }
      if (type !== 'LtiResourceLinkRequest') throw new Error(`Nicht unterstützte Nachricht: ${type}`);

      if (teacher) {
        const session = await this.auth.ssoLogin(emailOf(c), p.schoolId, { device: 'Moodle' });
        return this.codeUrl(base, { kind: 'teacher', body: { session } });
      }
      // Schüler: verbundene Klasse und Klassenlink aus der Aktivität
      const course = await this.courseRepo.findOne({ where: { platformId: p.id, contextId: String(context.id || '') } });
      const classId = String(custom.lm_class || course?.classId || '');
      const link = custom.lm_link ? await this.linkRepo.findOne({ where: { id: String(custom.lm_link) } }) : null;
      if (!classId || !link || link.classId !== classId) throw new Error('Diese Aktivität ist noch nicht mit einem Lernthema verbunden. Bitte die Lehrkraft informieren.');
      const { firstName, lastName } = namesOf(c);
      const who = await this.classbook.ltiStudent(classId, { subject: `${p.issuer}|${c.sub}`, firstName, lastName });
      const ags = c[AGS];
      if (ags?.lineitem && (ags.scope || []).includes(SCORE_SCOPE)) {
        const row = (await this.gradeRepo.findOne({ where: { linkId: link.id, studentId: who.studentId, lineitem: String(ags.lineitem) } }))
          || this.gradeRepo.create({ id: crypto.randomUUID(), platformId: p.id, lineitem: String(ags.lineitem), linkId: link.id, classId, studentId: who.studentId, sentPercent: null, sentAt: null, lastError: null });
        row.userSub = String(c.sub);
        await this.gradeRepo.save(row);
      }
      const share = await this.links.share(link.id, { userId: link.ownerId }, false, { headers: {} });
      const token = new URL(share.url).searchParams.get('l');
      return this.codeUrl(base, { kind: 'student', body: who }, token);
    } catch (e: any) {
      this.logger.warn(`LTI-Start fehlgeschlagen: ${e?.message || e}`);
      return `${base}/?ltiError=${encodeURIComponent(String(e?.response?.message || e?.message || 'Start aus Moodle fehlgeschlagen.').slice(0, 300))}`;
    }
  }

  private codeUrl(base: string, entry: Omit<Code, 'at'>, linkToken: string | null = null) {
    const code = randomToken();
    this.codes.set(code, { ...entry, at: Date.now() });
    const sp = new URLSearchParams({ lti: code });
    if (linkToken) sp.set('l', linkToken);
    return `${base}/?${sp.toString()}`;
  }

  /** Einlöse-Code → Sitzung der Lehrkraft bzw. Geräte-Ausweis des Schülers (einmal). Deep Linking bleibt bis zum Abschluss. */
  redeem(code: string) {
    this.prune();
    const c = this.codes.get(String(code || ''));
    if (!c) throw new NotFoundException('Der Start aus Moodle ist abgelaufen. Bitte die Aktivität noch einmal öffnen.');
    if (c.kind !== 'deep') this.codes.delete(String(code));
    return { kind: c.kind, ...c.body, ...(c.deep ? { deep: { contextTitle: c.deep.contextTitle } } : {}) };
  }

  // ---- Deep Linking: Lernthema und Klasse wählen ----

  async deepLinkComplete(user: any, body: { code?: string; topicId?: string; classMode?: string; classId?: string }, base: string) {
    const c = this.codes.get(String(body?.code || ''));
    if (!c?.deep) throw new NotFoundException('Die Auswahl aus Moodle ist abgelaufen. Bitte in Moodle neu beginnen.');
    if (c.deep.userId && c.deep.userId !== user.userId) throw new ForbiddenException('Diese Auswahl gehört zu einem anderen Konto.');
    const d = c.deep;
    const p = await this.platformRepo.findOne({ where: { id: d.platformId } });
    if (!p) throw new NotFoundException('Lernplattform nicht gefunden.');
    const topic = await this.topicRepo.findOne({ where: { id: String(body?.topicId || '') } });
    if (!topic) throw new BadRequestException('Bitte ein Lernthema wählen.');

    // Klasse des Kurses: bestehende Verbindung, gewählte Klasse oder neu
    let course = await this.courseRepo.findOne({ where: { platformId: p.id, contextId: d.contextId } });
    let classId: string;
    if (body?.classMode === 'existing' && body.classId) {
      classId = (await this.classes.ownedClass(String(body.classId), user)).id;
    } else if (course && body?.classMode !== 'new') {
      classId = course.classId;
    } else {
      classId = (await this.newClass(user, d.contextTitle)).id;
    }
    if (!course) course = this.courseRepo.create({ id: crypto.randomUUID(), platformId: p.id, contextId: d.contextId, contextTitle: d.contextTitle, classId, ownerId: user.userId });
    course.classId = classId;
    course.contextTitle = d.contextTitle;
    await this.courseRepo.save(course);

    const link: any = await this.links.classLinkForTopic(topic.id, classId, user);
    const key = await this.toolKey();
    const now = Math.floor(Date.now() / 1000);
    const jwt = signJwt({
      iss: p.clientId, aud: p.issuer, iat: now, exp: now + 300, nonce: randomToken(),
      [CLAIM + 'deployment_id']: d.deploymentId,
      [CLAIM + 'message_type']: 'LtiDeepLinkingResponse',
      [CLAIM + 'version']: '1.3.0',
      [DL + 'content_items']: [{
        type: 'ltiResourceLink', title: topic.title, url: `${base}/api/lti/launch`,
        custom: { lm_link: link.id, lm_class: classId },
        lineItem: { scoreMaximum: 100, label: topic.title, resourceId: link.id },
      }],
      ...(d.data !== undefined ? { [DL + 'data']: d.data } : {}),
    }, key.privateKey, key.kid);
    this.codes.delete(String(body.code));
    return { returnUrl: d.returnUrl, jwt, classId };
  }

  private async newClass(user: any, title: string) {
    const base = String(title || 'Moodle-Kurs').replace(/\s+/g, ' ').trim().slice(0, 34) || 'Moodle-Kurs';
    for (let i = 0; i < 20; i++) {
      try { return await this.classes.create(user, { name: i ? `${base} (${i + 1})` : base }); } catch (e: any) {
        if (!/vergeben|existiert|schon/i.test(String(e?.message || ''))) throw e;
      }
    }
    throw new BadRequestException('Keine freie Klassenbezeichnung gefunden.');
  }

  // ---- Noten (AGS): bestes Ergebnis ----

  private async accessToken(p: LtiPlatform): Promise<string> {
    const hit = this.tokens.get(p.id);
    if (hit && hit.until > Date.now() + 30_000) return hit.token;
    const key = await this.toolKey();
    const now = Math.floor(Date.now() / 1000);
    const assertion = signJwt({ iss: p.clientId, sub: p.clientId, aud: p.tokenUrl, iat: now, exp: now + 300, jti: randomToken() }, key.privateKey, key.kid);
    const res = await fetch(p.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
        scope: SCORE_SCOPE,
      }).toString(),
    });
    const out: any = await res.json().catch(() => ({}));
    if (!res.ok || !out.access_token) throw new Error(out.error_description || out.error || `Token: HTTP ${res.status}`);
    this.tokens.set(p.id, { token: out.access_token, until: Date.now() + (Number(out.expires_in) || 3600) * 1000 });
    return out.access_token;
  }

  /** Bestes Ergebnis (Prozent) eines Schülers über einen Klassenlink. */
  async bestPercent(linkId: string, studentId: string): Promise<number | null> {
    const rows = await this.resultRepo.find({ where: { linkId, studentId } as any });
    let best: number | null = null;
    for (const r of rows) {
      const pc = typeof (r as any).payload?.percentage === 'number' ? (r as any).payload.percentage
        : r.maxScore ? (Number(r.score) / Number(r.maxScore)) * 100 : null;
      if (pc !== null && Number.isFinite(pc) && (best === null || pc > best)) best = Math.max(0, Math.min(100, pc));
    }
    return best;
  }

  async sendGrade(r: SavedResult) {
    if (!r?.linkId || !r?.studentId) return;
    const rows = await this.gradeRepo.find({ where: { linkId: r.linkId, studentId: r.studentId } });
    if (!rows.length) return;
    const best = await this.bestPercent(r.linkId, r.studentId);
    if (best === null) return;
    for (const g of rows) {
      if (g.sentPercent !== null && g.sentPercent >= best) continue;
      try {
        const p = await this.platformRepo.findOne({ where: { id: g.platformId } });
        if (!p?.active) continue;
        const token = await this.accessToken(p);
        const res = await fetch(scoresUrl(g.lineitem), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.ims.lis.v1.score+json' },
          body: JSON.stringify({
            userId: g.userSub, scoreGiven: Math.round(best * 100) / 100, scoreMaximum: 100,
            activityProgress: 'Completed', gradingProgress: 'FullyGraded', timestamp: new Date().toISOString(),
          }),
        });
        if (!res.ok) throw new Error(`Moodle: HTTP ${res.status}`);
        await this.gradeRepo.update({ id: g.id }, { sentPercent: best, sentAt: new Date(), lastError: null });
      } catch (e: any) {
        this.logger.warn(`Note an Moodle fehlgeschlagen: ${e?.message || e}`);
        await this.gradeRepo.update({ id: g.id }, { lastError: String(e?.message || e).slice(0, 300) });
      }
    }
  }
}
